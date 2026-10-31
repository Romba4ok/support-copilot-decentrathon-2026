import { createReadStream, statSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server.mjs';
import { createJsonStore } from '../src/storage.mjs';
import { sanitizeInput } from '../src/core/engine.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const usage = 'Usage: node scripts/import-tickets.mjs --in tickets.jsonl [--runtime-dir directory] [--data-dir directory] [--batch-size 100]';

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(usage); return; }
  for (let i = 0; i < args.length; i++) {
    if (!['--in', '--runtime-dir', '--data-dir', '--batch-size'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error(usage);
    options[args[i]] = args[++i];
  }
  if (!options['--in']) throw new Error(usage);
  const batchSize = Number(options['--batch-size'] || 100);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('--batch-size must be 1–1000');
  const inputPath = realpathSync(resolve(options['--in']));
  const info = statSync(inputPath);
  if (!info.isFile()) throw new Error('--in must name a regular file');
  const runtimeDir = resolve(options['--runtime-dir'] || process.env.RUNTIME_DIR || join(appRoot, 'runtime'));
  const fingerprint = createHash('sha256').update(`${inputPath}\0${info.size}\0${info.mtimeMs}`).digest('hex');
  const server = createApp({ ...(options['--data-dir'] ? { dataDir: options['--data-dir'] } : {}), runtimeDir, seed: false, refreshTriage: false });
  let checkpoint, input, lines;
  try {
  checkpoint = createJsonStore({ runtimeDir: join(runtimeDir, 'imports'), filename: `${fingerprint}.json`, initial: { version: 1, fingerprint, input_path: inputPath, size: info.size, modified_ms: info.mtimeMs, batch_size: batchSize, line: 0, imported: 0, status: 'running' }, validate: value => value.version === 1 && value.fingerprint === fingerprint && Number.isInteger(value.line) });
  if (checkpoint.snapshot().batch_size !== batchSize) throw new Error('Resume with the same --batch-size as the saved checkpoint.');
  checkpoint.transact(state => { state.status = 'running'; delete state.error; });
  input = createReadStream(inputPath, { encoding: 'utf8' });
  lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0, batch = [], lastLine = checkpoint.snapshot().line;
  async function flush() {
    if (!batch.length) return;
    const id = `cli-import:${fingerprint.slice(0, 20)}:${lastLine}`;
    let job = server.workspace.importTickets(batch, { id });
    if (job.resumable) job = server.workspace.resumeJob(job.id);
    while (['pending', 'running'].includes(job.status)) { await delay(25); job = server.workspace.jobs().find(item => item.id === id); }
    if (job.status !== 'completed') throw new Error(`Import checkpoint ${id}: ${job.error || job.status}. Restart the same command to resume.`);
    checkpoint.transact(state => { state.line = lastLine; state.imported += batch.length; state.status = 'running'; state.updated_at = new Date().toISOString(); });
    console.error(`Imported ${checkpoint.snapshot().imported} records; input line ${lastLine}; checkpoint saved.`);
    batch = [];
  }
  try {
    for await (let line of lines) {
      lineNumber++;
      if (lineNumber <= checkpoint.snapshot().line) continue;
      if (lineNumber === 1) line = line.replace(/^\uFEFF/u, '');
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, 'utf8') > 2 * 1024 * 1024) throw new Error(`Line ${lineNumber}: record exceeds 2 MiB`);
      try { batch.push(sanitizeInput(JSON.parse(line))); }
      catch (error) { throw new Error(`Line ${lineNumber}: ${error.message}`); }
      lastLine = lineNumber;
      if (batch.length >= batchSize) await flush();
    }
    await flush();
    checkpoint.transact(state => { state.status = 'completed'; state.updated_at = new Date().toISOString(); });
    console.log(JSON.stringify({ imported: checkpoint.snapshot().imported, status: 'completed', checkpoint: checkpoint.stateFile, inference: 'baseline', private_local_data: true }));
  } catch (error) {
    checkpoint.transact(state => { state.status = 'interrupted'; state.error = String(error.message).slice(0, 500); });
    throw error;
  }
  } finally { lines?.close(); input?.destroy(); try { await server.workspace.close(); } finally { server.releaseRuntimeLease(); } }
}

main().catch(error => { console.error(`import: ${error.message}`); process.exitCode = 1; });
