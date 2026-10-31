import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/core/engine.mjs';
import { splitExamples, hash } from '../training/contract.mjs';
import { preparePlanTraining } from '../training/prepare-plan.mjs';
import { prepareJointTraining } from '../training/prepare-joint.mjs';
export { preparePlanTraining } from '../training/prepare-plan.mjs';
export { prepareJointTraining } from '../training/prepare-joint.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
export function prepareTraining({ inputPath = join(appRoot, 'fixtures/training-author-synthetic.jsonl'), outputDir = join(appRoot, 'runtime/training/author-synthetic'), dataDir, seed, holdoutFraction } = {}) {
  const output = resolve(outputDir), allowed = resolve(appRoot, 'runtime');
  const nested = relative(allowed, output);
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) throw new Error('Training output must be a dedicated directory inside this project runtime/');
  const content = readFileSync(resolve(inputPath), 'utf8');
  if (Buffer.byteLength(content, 'utf8') > 16 * 1024 * 1024) throw new Error('Authored fixture exceeds 16 MiB');
  const records = content.replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(line => line.trim()).map((line, index) => { try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON at record ${index + 1}`); } });
  const split = splitExamples(records, { baseline: createEngine(dataDir ? { dataDir } : {}), ...(seed ? { seed } : {}), ...(holdoutFraction !== undefined ? { holdoutFraction } : {}) });
  const train = split.train.map(row => JSON.stringify(row)).join('\n') + '\n', holdout = split.holdout.map(row => JSON.stringify(row)).join('\n') + '\n';
  const manifest = { ...split.manifest, files: { 'train.jsonl': hash(train), 'holdout.jsonl': hash(holdout) }, prepared_at: new Date().toISOString(), actual_training: 'not_run', network_requests: 0 };
  mkdirSync(output, { recursive: true });
  const oldManifest = join(output, 'manifest.json');
  if (existsSync(oldManifest) && JSON.parse(readFileSync(oldManifest, 'utf8')).fingerprint !== manifest.fingerprint) throw new Error('Output contains a different split. Choose another runtime/training directory to preserve existing checkpoints.');
  for (const [name, value] of [['train.jsonl', train], ['holdout.jsonl', holdout], ['manifest.json', JSON.stringify(manifest, null, 2) + '\n']]) { const destination = join(output, name), temp = `${destination}.${process.pid}.tmp`; writeFileSync(temp, value, { mode: 0o600 }); renameSync(temp, destination); }
  return { output_dir: output, ...manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  const flags = { '--in': 'inputPath', '--out': 'outputDir', '--data-dir': 'dataDir', '--seed': 'seed', '--holdout': 'holdoutFraction', '--mode': 'mode' };
  try {
    if (args.includes('--help')) { console.log('Usage: node scripts/prepare-training.mjs [--mode plan|joint] [--out runtime/training/name] [--data-dir directory]. Joint mode uses only the two fixed authored sources and fixed grouped seeds.'); }
    else { for (let i = 0; i < args.length; i++) { if (!flags[args[i]] || args[i + 1] === undefined || args[i + 1].startsWith('--') || options[flags[args[i]]] !== undefined) throw new Error('Unknown, duplicate or missing preparation option; use --help'); const field = flags[args[i]]; options[field] = field === 'holdoutFraction' ? Number(args[++i]) : args[++i]; } const mode = options.mode || 'plan'; delete options.mode; if (!['plan','joint'].includes(mode)) throw new Error('Mode must be plan or joint'); if (options.holdoutFraction !== undefined) throw new Error('Pilot uses fixed grouped holdout; --holdout is a legacy-only option'); if (mode === 'joint' && (options.inputPath || options.seed)) throw new Error('Joint mode uses fixed authored sources/seeds'); console.log(JSON.stringify(mode === 'joint' ? prepareJointTraining(options) : preparePlanTraining(options), null, 2)); }
  } catch (error) { console.error(`prepare-training: ${error.message}`); process.exitCode = 1; }
}
