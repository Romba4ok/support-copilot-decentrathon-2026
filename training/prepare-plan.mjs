import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/core/engine.mjs';
import { preparePlanExamples, hash } from './plan-contract.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export function preparePlanTraining({ inputPath = join(root, 'fixtures/training-plan-author-synthetic.jsonl'), outputDir = join(root, 'runtime/training/plan-author-synthetic'), dataDir, seed } = {}) {
  const output = resolve(outputDir), nested = relative(resolve(root, 'runtime/training'), output);
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) throw new Error('Plan data output must be a new directory inside runtime/training');
  const content = readFileSync(inputPath, 'utf8');
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('Authored pilot is limited to 2 MiB');
  const records = content.trim().split(/\r?\n/u).map(JSON.parse);
  const split = preparePlanExamples(records, { baseline: createEngine(dataDir ? { dataDir } : {}), ...(seed ? { seed } : {}) });
  const files = Object.fromEntries(['train', 'holdout'].map(name => [`${name}.jsonl`, split[name].map(row => JSON.stringify(row)).join('\n') + '\n']));
  const manifest = { ...split.manifest, factory_source_sha256: hash(readFileSync(join(root, 'src/intelligence/generation-contract.mjs'), 'utf8')), files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)])) };
  mkdirSync(output, { recursive: true });
  if (existsSync(join(output, 'manifest.json')) && JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')).fingerprint !== manifest.fingerprint) throw new Error('Different pilot dataset exists; preserve it and choose a new output');
  for (const [name, text] of Object.entries({ ...files, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' })) { const path = join(output, name), temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, text, { mode: 0o600 }); renameSync(temp, path); }
  return { output_dir: output, ...manifest };
}
