import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
export const GENERATOR_MODEL = {
  repo: 'Qwen/Qwen3-0.6B-GGUF', revision: '23749fefcc72300e3a2ad315e1317431b06b590a',
  filename: 'Qwen3-0.6B-Q8_0.gguf', bytes: 639446688,
  sha256: '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031', license: 'Apache-2.0',
};
export const GENERATOR_RUNTIME = {
  repo: 'ggml-org/llama.cpp', stable: 'v0.8.0', revision: 'b11960', backend: 'cpu',
  filename: 'llama-b11960-bin-win-cpu-x64.zip', bytes: 24407745,
  sha256: '73f962f82850d244db47eaacb9d913637027b82399124324298576d58c5f4287', license: 'MIT',
};
async function sha256(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
async function download(url, destination, { expectedHash, expectedBytes, onProgress }) {
  try { if (await sha256(destination) === expectedHash) { onProgress({ file: destination, status: 'verified' }); return; } } catch {}
  await mkdir(resolve(destination, '..'), { recursive: true });
  const response = await fetch(url, { signal: AbortSignal.timeout(900000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const handle = await open(`${destination}.partial`, 'w');
  const hash = createHash('sha256');
  let bytes = 0, checkpoint = 0;
  try {
    for await (const chunk of response.body) {
      await handle.write(chunk); hash.update(chunk); bytes += chunk.length;
      if (bytes - checkpoint >= 32 * 1024 * 1024) { checkpoint = bytes; onProgress({ file: destination, status: 'downloading', bytes, total: expectedBytes }); }
    }
  } finally { await handle.close(); }
  if (bytes !== expectedBytes || hash.digest('hex') !== expectedHash) throw new Error(`Checksum/size mismatch: ${destination}`);
  await rename(`${destination}.partial`, destination);
  onProgress({ file: destination, status: 'downloaded', bytes });
}
function within(parent, path) { const nested = relative(resolve(parent), resolve(path)); if (nested.startsWith('..') || isAbsolute(nested)) throw new Error('Destination must remain inside project runtime'); }
export async function setupGenerator({ onProgress = item => console.log(JSON.stringify(item)) } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This pinned setup supports Windows x64 CPU; use a separately verified official runtime for another platform');
  const modelDir = resolve(root, 'runtime/models/qwen3-0.6b');
  const toolsDir = resolve(root, 'runtime/tools');
  const runtimeDir = join(toolsDir, `llama-${GENERATOR_RUNTIME.revision}-cpu`);
  within(resolve(root, 'runtime/models'), modelDir); within(toolsDir, runtimeDir);
  await mkdir(modelDir, { recursive: true }); await mkdir(runtimeDir, { recursive: true });
  const modelUrl = `https://huggingface.co/${GENERATOR_MODEL.repo}/resolve/${GENERATOR_MODEL.revision}/${GENERATOR_MODEL.filename}`;
  await download(modelUrl, join(modelDir, GENERATOR_MODEL.filename), { expectedHash: GENERATOR_MODEL.sha256, expectedBytes: GENERATOR_MODEL.bytes, onProgress });
  const runtimeUrl = `https://github.com/${GENERATOR_RUNTIME.repo}/releases/download/${GENERATOR_RUNTIME.revision}/${GENERATOR_RUNTIME.filename}`;
  const zip = join(toolsDir, GENERATOR_RUNTIME.filename);
  await download(runtimeUrl, zip, { expectedHash: GENERATOR_RUNTIME.sha256, expectedBytes: GENERATOR_RUNTIME.bytes, onProgress });
  await new Promise((resolveUnzip, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:SUPPORT_GENERATOR_ZIP -DestinationPath $env:SUPPORT_GENERATOR_DEST -Force'], { windowsHide: true, stdio: 'pipe', env: { ...process.env, SUPPORT_GENERATOR_ZIP: zip, SUPPORT_GENERATOR_DEST: runtimeDir } });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 1000); });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolveUnzip() : reject(new Error(`Runtime extraction failed (${code}): ${stderr}`)));
  });
  const runtimePath = join(runtimeDir, 'llama-server.exe');
  const executableHash = await sha256(runtimePath);
  const manifest = { model: { ...GENERATOR_MODEL, url: modelUrl, path: join(modelDir, GENERATOR_MODEL.filename) }, runtime: { ...GENERATOR_RUNTIME, url: runtimeUrl, path: runtimePath, executable_sha256: executableHash }, complete: true, installed_at: new Date().toISOString() };
  await writeFile(join(modelDir, 'generator-manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(runtimeDir, 'generator-manifest.json'), JSON.stringify(manifest.runtime, null, 2));
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await setupGenerator())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
