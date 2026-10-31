import { readFileSync, mkdirSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/core/engine.mjs';
import { hash } from './plan-contract.mjs';
import { prepareJointExamples } from './joint-contract.mjs';
import { FOCUS_SCHEMA_VERSION, PLAN_SCHEMA_VERSION, FOCUS_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from '../src/intelligence/generation-contract.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export function buildJointSplit({ dataDir } = {}) {
  const planRecords = readFileSync(join(root, 'fixtures/training-plan-author-synthetic.jsonl'), 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
  const split = prepareJointExamples({ baseline: createEngine(dataDir ? { dataDir } : {}), planRecords });
  const sourceFiles = ['src/intelligence/generation-contract.mjs', 'src/intelligence/generator.mjs', 'training/focus-author-data.mjs', 'fixtures/training-plan-author-synthetic.jsonl', 'training/joint-contract.mjs', 'training/plan-contract.mjs'];
  split.manifest.sources = Object.fromEntries(sourceFiles.map(name => [name, hash(readFileSync(join(root, name), 'utf8'))]));
  split.manifest.factory_source_sha256 = split.manifest.sources['src/intelligence/generation-contract.mjs'];
  split.manifest.source_identity_sha256 = hash(split.manifest.sources);
  split.manifest.prompt_sha256 = { [FOCUS_SCHEMA_VERSION]: hash(FOCUS_SYSTEM_PROMPT), [PLAN_SCHEMA_VERSION]: hash(PLAN_SYSTEM_PROMPT) };
  return split;
}
export function prepareJointTraining({ outputDir = join(root, 'runtime/training/joint-author-synthetic'), dataDir } = {}) {
  const output = resolve(outputDir), nested = relative(resolve(root, 'runtime/training'), output);
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) throw new Error('Joint output must be a dedicated directory inside runtime/training');
  const split = buildJointSplit({ dataDir });
  const files = Object.fromEntries(['train', 'holdout'].map(name => [`${name}.jsonl`, split[name].map(row => JSON.stringify(row)).join('\n') + '\n']));
  const manifest = { ...split.manifest, files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)])) };
  if (existsSync(join(output, 'manifest.json')) && JSON.stringify(JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'))) !== JSON.stringify(manifest)) throw new Error('Different joint snapshot exists; choose a new output and preserve previous identity');
  mkdirSync(output, { recursive: true });
  for (const [name, text] of Object.entries({ ...files, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' })) { const destination = join(output, name), temp = `${destination}.${process.pid}.tmp`; writeFileSync(temp, text, { mode: 0o600 }); renameSync(temp, destination); }
  return { output_dir: output, ...manifest };
}
