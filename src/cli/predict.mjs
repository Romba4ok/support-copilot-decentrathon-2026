import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync, realpathSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createEngine, sanitizeInput } from '../core/engine.mjs';
import { parseInferenceConfig } from '../intelligence/config.mjs';

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (key === '--initialize') { options.initialize = true; continue; }
    if (!['--in', '--out', '--data-dir', '--mode', '--model-dir', '--index-dir'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Usage: node src/cli/predict.mjs --in tickets.jsonl --out pred.jsonl [--mode baseline|v2] [--initialize] [--data-dir directory]');
    }
    if (options[key]) throw new Error(`Duplicate option: ${key}`);
    options[key] = args[++index];
  }
  if (!options['--in'] || !options['--out']) throw new Error('Both --in and --out are required');
  if (options['--mode'] && !['baseline', 'v2'].includes(options['--mode'])) throw new Error('--mode must be baseline or v2');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node src/cli/predict.mjs --in tickets.jsonl --out pred.jsonl [--mode baseline|v2] [--initialize] [--data-dir directory] [--model-dir directory] [--index-dir directory]');
    return;
  }
  const inference = parseInferenceConfig(process.env);
  if (options['--mode'] !== 'v2' && (inference.generatorConfig.enabled || inference.draftMode === 'native')) throw new Error('Local generation requires --mode v2; baseline does not run a generator.');
  const inputPath = resolve(options['--in']);
  const outputPath = resolve(options['--out']);
  const realInput = realpathSync(inputPath);
  if (inputPath === outputPath || (existsSync(outputPath) && realInput === realpathSync(outputPath))) throw new Error('Input and output must be different files');
  const engine = createEngine(options['--data-dir'] ? { dataDir: options['--data-dir'] } : {});
  let intelligence;
  if (options['--mode'] === 'v2') {
    const { createIntelligence } = await import('../intelligence/index.mjs');
    const modelDir = options['--model-dir'] || process.env.MODEL_DIR;
    const cacheDir = options['--index-dir'] || process.env.INDEX_DIR;
    intelligence = createIntelligence({ baseline: engine, ...inference, ...(modelDir ? { modelDir } : {}), ...(cacheDir ? { cacheDir } : {}) });
    if (options.initialize) await intelligence.initialize();
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  const output = createWriteStream(temporaryPath, { encoding: 'utf8', fd: openSync(temporaryPath, 'wx', 0o600), autoClose: true });
  const input = createReadStream(inputPath, { encoding: 'utf8' });
  // Register error listeners immediately, including before the first write.
  let inputError;
  let outputError;
  input.on('error', error => { inputError = error; });
  output.on('error', error => { outputError = error; });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const historyByActor = new Map();
  let lineNumber = 0;
  let count = 0;
  try {
    for await (const line of lines) {
      lineNumber++;
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, 'utf8') > 1024 * 1024) throw new Error(`Line ${lineNumber}: record exceeds 1 MiB`);
      let ticket;
      try { ticket = JSON.parse(lineNumber === 1 ? line.replace(/^\uFEFF/u, '') : line); }
      catch { throw new Error(`Line ${lineNumber}: invalid JSON`); }
      const actorHistory = typeof ticket?.reporter_hash === 'string' ? historyByActor.get(ticket.reporter_hash) || [] : [];
      let result;
      try { ticket = sanitizeInput(ticket); result = await (intelligence || engine).triage(ticket, { history: actorHistory }); }
      catch (error) { throw new Error(`Line ${lineNumber}: ${error.code === 'INVALID_INPUT' ? error.message : 'triage failed'}`); }
      if (!output.write(`${JSON.stringify(result)}\n`)) await once(output, 'drain');
      if (outputError) throw outputError;
      count++;
      if (typeof ticket.reporter_hash === 'string' && ticket.created_at) {
        actorHistory.push({
          ticket_id: ticket.ticket_id || ticket.id || `line:${lineNumber}`, kind: ticket.kind,
          reporter_hash: ticket.reporter_hash, reported_hash: ticket.reported_hash,
          reported_nick: ticket.reported_nick, created_at: ticket.created_at,
          messages: ticket.messages.filter(message => message.role === 'player').map(message => ({ role: 'player', text: message.text })),
        });
        historyByActor.set(ticket.reporter_hash, actorHistory);
      }
    }
    if (inputError) throw inputError;
    output.end();
    await once(output, 'finish');
    if (!output.closed) await once(output, 'close');
    if (outputError) throw outputError;
    renameSync(temporaryPath, outputPath);
    console.error(`Processed ${count} tickets. Mode: ${intelligence?.status().mode || engine.mode}; external API calls: 0.`);
  } catch (error) {
    lines.close();
    input.destroy();
    output.destroy();
    // Wait until the temporary file handle closes before removing it on Windows.
    if (!output.closed) await once(output, 'close').catch(() => {});
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  } finally {
    await intelligence?.close();
  }
}

main().catch(error => {
  console.error(`predict: ${error.message}`);
  process.exitCode = 1;
});
