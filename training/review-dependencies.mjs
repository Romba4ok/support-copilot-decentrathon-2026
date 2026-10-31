import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { hash } from './contract.mjs';

// Read-only public package metadata plus one bounded pure-Python wheel.
// Never fetch the multi-gigabyte Torch/CUDA wheels during this review.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'runtime/training/dependency-review');
mkdirSync(directory, { recursive: true });
const pins = readFileSync(new URL('./requirements-colab.txt', import.meta.url), 'utf8').split('\n').filter(line => line.includes('==') && !line.startsWith('#')).map(line => line.trim().split('=='));
const packages = [];
for (const [name, installedVersion] of pins) {
  const version = installedVersion.split('+')[0];
  const url = `https://pypi.org/pypi/${name}/${version}/json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${name}: metadata HTTP ${response.status}`);
  const metadata = await response.json();
  const entry = { name, version: installedVersion, metadata_url: url, requires_python: metadata.info.requires_python, requires_dist: metadata.info.requires_dist || [], reported_advisories: (metadata.vulnerabilities || []).map(item => ({ id: item.id, fixed_in: item.fixed_in, link: item.link })) };
  packages.push(entry);
  if (name === 'transformers') {
    const wheel = metadata.urls.find(item => item.filename.endsWith('-py3-none-any.whl'));
    if (!wheel || wheel.size > 30 * 1024 * 1024) throw new Error('No bounded Transformers wheel available for source API inspection');
    const bytes = Buffer.from(await (await fetch(wheel.url, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
    const digest = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== wheel.size || digest !== wheel.digests.sha256) throw new Error('Transformers wheel integrity mismatch');
    writeFileSync(join(directory, wheel.filename), bytes);
    entry.source_wheel = { filename: wheel.filename, bytes: wheel.size, sha256: digest, url: wheel.url, installed: false };
  }
}
const torchPin = pins.find(([name]) => name === 'torch')[1];
const indexUrl = 'https://download.pytorch.org/whl/cu126/torch/';
const index = await (await fetch(indexUrl)).text();
const wanted = `torch-${torchPin.replace('+', '%2B')}-cp312-cp312-manylinux_2_28_x86_64.whl`;
const wheelUrl = [...index.matchAll(/href="([^"]+)"/gu)].map(item => item[1]).find(url => url.includes(wanted));
if (!wheelUrl) throw new Error('Official CUDA 12.6 CPython 3.12 Linux wheel is missing');
const metadataUrl = wheelUrl.split('#')[0] + '.metadata';
const torchMetadata = await (await fetch(metadataUrl)).text();
if (!torchMetadata.includes(`Version: ${torchPin}`)) throw new Error('CUDA wheel metadata version mismatch');
writeFileSync(join(directory, 'torch-cuda126-cp312.metadata.txt'), torchMetadata, 'utf8');
const report = { checked_at: new Date().toISOString(), status: packages.every(item => !item.reported_advisories.length) ? 'primary_metadata_checked_no_listed_advisories' : 'reported_advisories_require_review', scope: 'Pinned direct packages only; absence of listed advisories is not proof of full security. No installation or GPU execution.', target: { python: '3.11–3.12', resolver_python: '3.12', platform: 'Linux x86_64', cuda: '12.6' }, packages, torch_wheel: { official_index: indexUrl, url: wheelUrl, metadata_url: metadataUrl, metadata_bytes: Buffer.byteLength(torchMetadata), metadata_sha256: hash(torchMetadata), wheel_downloaded: false, installed: false }, actual_training: false };
writeFileSync(join(directory, 'metadata-review.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: join(directory, 'metadata-review.json'), status: report.status, torch_wheel_downloaded: false, package_count: packages.length, actual_training: false }));
if (packages.some(item => item.reported_advisories.length)) process.exitCode = 1;
