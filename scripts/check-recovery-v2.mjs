import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server.mjs';

// Isolated authored data only. Never opens the operator's normal runtime state.
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, '../handout'));
const parent = join(root, 'runtime/recovery-v2');
mkdirSync(parent, { recursive: true });
const runtimeDir = mkdtempSync(join(parent, 'run-'));
const read = name => JSON.parse(readFileSync(join(runtimeDir, name), 'utf8'));
const total = 300;
const report = { created_at: new Date().toISOString(), provenance: 'automated_authored_synthetic_recovery_probe', real_data_used: false, model_loaded: false, runtime_dir: runtimeDir, expected_imports: total };
let app, child;
try {
  app = createApp({ runtimeDir, dataDir, seed: false });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, method, value) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.ok(response.ok, `Recovery setup request failed: ${response.status}`);
    return response.json();
  }
  const { ticket } = await call('/api/tickets', 'POST', { kind: 'report', lang: 'en', messages: [{ role: 'player', text: 'Someone threatened to find my home address. Please help me contact support.' }] });
  await call(`/api/tickets/${ticket.id}`, 'PATCH', { action: 'save', draft_reply: 'Authored recovery probe: preserve the saved operator text.' });
  await call(`/api/tickets/${ticket.id}`, 'PATCH', { action: 'escalate' });
  await call('/api/quality/annotations', 'POST', { ticket_id: ticket.id, category: ticket.triage.category, needs_human: true, auto_eligible: false, note: 'Automated synthetic persistence probe; not expert or real human quality annotation.' });
  const original = read('state.json'), originalAnnotations = read('workspace.json').annotations;
  await new Promise(accept => app.close(accept)); app = null;

  const inputFile = join(runtimeDir, 'authored-import.jsonl');
  writeFileSync(inputFile, Array.from({ length: total }, (_, index) => JSON.stringify({
    kind: 'report', ticket_id: `recovery-synthetic-${index}`, lang: 'en',
    messages: [{ role: 'player', text: `What does DM mean? Authored recovery sample ${index}.` }, { role: 'admin', text: 'ADMIN_RECOVERY_IGNORE' }],
    outcome: 'OUTCOME_RECOVERY_IGNORE', category: 'report.payment', priority: 'p0',
  })).join('\n') + '\n');
  const args = [join(root, 'scripts/import-tickets.mjs'), '--in', inputFile, '--runtime-dir', runtimeDir, '--data-dir', dataDir, '--batch-size', String(total)];
  function startImporter() {
    const processChild = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    processChild.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-4000); });
    processChild.stderr.on('data', () => {});
    const finished = new Promise((accept, reject) => { processChild.once('error', reject); processChild.once('exit', (code, signal) => accept({ code, signal, output })); });
    return { processChild, finished };
  }
  let active = startImporter(); child = active.processChild;
  const deadline = Date.now() + 20000;
  let partialObserved = false;
  const initialBytes = statSync(join(runtimeDir, 'state.json')).size;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    // Opening the Windows destination for repeated reads can itself prevent an
    // atomic rename. Observe file size, then inspect contents only after exit.
    if (statSync(join(runtimeDir, 'state.json')).size > initialBytes + 20000) { partialObserved = true; break; }
    await delay(5);
  }
  assert.ok(partialObserved, 'Could not observe a partial import; no interruption evidence');
  child.kill('SIGKILL');
  const killed = await active.finished; child = null;
  const interruptedCount = read('state.json').tickets.length - 1;
  assert.ok(interruptedCount > 0 && interruptedCount < total, 'Importer completed before interruption; no partial recovery evidence');
  const interruptedWorkspace = read('workspace.json');
  const interruptedJob = interruptedWorkspace.jobs.find(job => job.type === 'import');
  assert.ok(interruptedJob && interruptedJob.processed < total, 'Import was not interrupted mid-checkpoint');
  report.interruption = { partial_file_size_observed_before_kill: true, durable_imports_after_kill: interruptedCount, durable_tickets_after_kill: read('state.json').tickets.length, durable_cursor: interruptedJob.processed, durable_job_status: interruptedJob.status, forced_exit: killed };
  const resumeStart = performance.now();
  active = startImporter(); child = active.processChild;
  const resumed = await active.finished; child = null;
  assert.equal(resumed.code, 0, 'Resume failed');
  report.resume_ms = Math.round(performance.now() - resumeStart);
  active = startImporter(); child = active.processChild;
  const repeated = await active.finished; child = null;
  assert.equal(repeated.code, 0, 'Idempotent repeat failed');
  const restored = read('state.json'), workspace = read('workspace.json');
  assert.equal(restored.tickets.length, total + 1);
  assert.equal(new Set(restored.tickets.map(item => item.id)).size, total + 1);
  assert.equal(new Set(restored.tickets.filter(item => item.id !== ticket.id).map(item => item.input.ticket_id)).size, total);
  const seed = restored.tickets.find(item => item.id === ticket.id), oldSeed = original.tickets.find(item => item.id === ticket.id);
  assert.equal(seed.edited_reply, oldSeed.edited_reply); assert.equal(seed.status, oldSeed.status);
  assert.deepEqual(restored.feedback, original.feedback); assert.deepEqual(workspace.annotations, originalAnnotations);
  assert.doesNotMatch(JSON.stringify(restored), /ADMIN_RECOVERY_IGNORE|OUTCOME_RECOVERY_IGNORE/);
  assert.ok(workspace.jobs.filter(job => job.type === 'import').every(job => job.status === 'completed'));
  report.result = { status: 'PASS', tickets: restored.tickets.length, unique_tickets: total + 1, imported: total, repeat_added: 0, operator_edits_preserved: true, feedback_preserved: true, annotations_preserved: true, admin_and_outcome_excluded: true, actual_forced_process_interruption: true };
} catch (error) {
  report.result = { status: 'FAIL', message: error.message }; process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill('SIGKILL');
  if (app?.listening) await new Promise(accept => app.close(accept));
  const output = join(root, 'artifacts/private/v2-evaluation'); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'recovery-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
