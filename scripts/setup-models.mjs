import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
export const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const MODEL_REPO = 'Xenova/multilingual-e5-small';
export const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];

export async function setupModels({ modelDir = resolve(root, 'runtime/models/multilingual-e5-small'), onProgress = item => console.log(JSON.stringify(item)) } = {}) {
  const allowedRoot = resolve(root, 'runtime/models');
  const nested = relative(allowedRoot, resolve(modelDir));
  if (nested.startsWith('..') || isAbsolute(nested)) throw new Error('Model destination must remain inside this project runtime/models');
  await mkdir(modelDir, { recursive: true });
  let old = {};
  try { old = JSON.parse(await readFile(join(modelDir, 'manifest.json'), 'utf8')); } catch {}
  const files = [];
  for (const file of MODEL_FILES) {
    const destination = join(modelDir, file);
    const previous = old.revision === MODEL_REVISION && old.files?.find(item => item.name === file);
    if (previous) {
      const data = await readFile(destination).catch(() => null);
      if (data && createHash('sha256').update(data).digest('hex') === previous.sha256) { files.push(previous); onProgress({ file, status: 'verified', bytes: data.length }); continue; }
    }
    const response = await fetch(`https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file}`, { signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(`Download ${file}: HTTP ${response.status}`);
    await mkdir(resolve(destination, '..'), { recursive: true });
    const temp = `${destination}.partial`;
    const handle = await open(temp, 'w');
    const hash = createHash('sha256');
    let bytes = 0, checkpoint = 0;
    try {
      for await (const chunk of response.body) {
        await handle.write(chunk); hash.update(chunk); bytes += chunk.length;
        if (bytes - checkpoint >= 8 * 1024 * 1024) { checkpoint = bytes; onProgress({ file, status: 'downloading', bytes, total: Number(response.headers.get('content-length')) || null }); }
      }
    } finally { await handle.close(); }
    if (bytes < 10) throw new Error(`Empty/truncated model artifact ${file}`);
    await rename(temp, destination);
    const entry = { name: file, bytes, sha256: hash.digest('hex') };
    files.push(entry); onProgress({ file, status: 'downloaded', bytes });
    await writeFile(join(modelDir, 'manifest.json'), JSON.stringify({ repo: MODEL_REPO, revision: MODEL_REVISION, license: 'MIT', files, complete: files.length === MODEL_FILES.length, updated_at: new Date().toISOString() }, null, 2));
  }
  return { modelDir, repo: MODEL_REPO, revision: MODEL_REVISION, files, complete: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await setupModels())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
