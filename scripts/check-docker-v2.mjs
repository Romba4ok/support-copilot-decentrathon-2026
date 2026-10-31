import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = resolve(process.env.DATA_DIR || join(root, '../handout'));
const suffix = randomUUID().slice(0, 8);
const container = `copilot-v2-qa-${suffix}`, volume = `copilot-v2-qa-${suffix}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 180000 }).trim();
const report = { created_at: new Date().toISOString(), image: 'support-copilot:0.2.0', test_data: 'authored_synthetic_except_readonly_private_rule_and_validation_mount', external_deployment: false, models_baked_in: false };
let createdVolume = false, createdContainer = false;
try {
  docker(['volume', 'create', '--label', 'codex.probe=support-copilot-v2', volume]); createdVolume = true;
  docker(['run', '-d', '--name', container, '-p', '127.0.0.1::3000', '--mount', `type=bind,source=${data},target=/data,readonly`, '--mount', `type=volume,source=${volume},target=/app/runtime`, report.image]); createdContainer = true;
  let base;
  report.port_history = [];
  function refreshAddress(stage) {
    const port = docker(['port', container, '3000/tcp']).match(/127\.0\.0\.1:(\d+)/)?.[1]; assert.ok(port);
    base = `http://127.0.0.1:${port}`;
    report.port_history.push({ stage, port });
  }
  refreshAddress('initial');
  async function ready() {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { const response = await fetch(base + '/api/health'); if (response.ok) return response.json(); } catch {}
      await delay(100);
    }
    throw new Error('Docker HTTP did not become ready');
  }
  async function call(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    assert.ok(response.ok, `Docker request failed: ${path} ${response.status}`); return response.json();
  }
  report.health = await ready();
  assert.equal(docker(['exec', container, 'id', '-u']), '1000');
  assert.ok((await (await fetch(base)).text()).includes('intelligence.js'));
  const triage = await call('/triage', 'POST', { kind: 'report', lang: 'en', messages: [{ role: 'player', text: 'My card was charged but the purchase did not arrive. Please help review my payment.' }] });
  assert.equal(triage.needs_human, true); assert.equal(triage.priority, 'p0'); assert.equal(triage.analysis.intelligence.mode, 'baseline-fallback');
  const { ticket } = await call('/api/tickets', 'POST', { kind: 'report', lang: 'en', messages: [{ role: 'player', text: 'Authored Docker persistence sample. Please help me contact support.' }] });
  const saved = 'Authored Docker saved operator reply.';
  await call(`/api/tickets/${ticket.id}`, 'PATCH', { action: 'save', draft_reply: saved });
  const feedbackBefore = (await call('/api/feedback')).feedback;
  const hostBefore = docker(['exec', container, 'hostname']);
  docker(['restart', '--time', '10', container]); refreshAddress('graceful_restart'); await ready();
  assert.equal((await call(`/api/tickets/${ticket.id}`)).ticket.edited_reply, saved);
  assert.deepEqual((await call('/api/feedback')).feedback, feedbackBefore);
  docker(['kill', '--signal', 'KILL', container]); docker(['start', container]); refreshAddress('sigkill_restart'); await ready();
  assert.equal(docker(['exec', container, 'hostname']), hostBefore);
  assert.equal((await call(`/api/tickets/${ticket.id}`)).ticket.edited_reply, saved);
  assert.deepEqual((await call('/api/feedback')).feedback, feedbackBefore);
  // A second container has its own PID1. It must not steal this live volume.
  const refusal = docker(['run', '--rm', '--mount', `type=bind,source=${data},target=/data,readonly`, '--mount', `type=volume,source=${volume},target=/app/runtime`, report.image, 'node', '--input-type=module', '-e', 'import{createApp}from"./src/server.mjs";try{createApp();console.log("UNSAFE_SECOND_WRITER");process.exitCode=1;}catch(e){if(e.code!=="RUNTIME_BUSY")throw e;console.log("RUNTIME_BUSY");}']);
  assert.equal(refusal, 'RUNTIME_BUSY');
  docker(['exec', container, 'make', 'predict', 'IN=/data/tickets_valid.jsonl', 'OUT=/app/runtime/docker-predictions.jsonl']);
  const batch = JSON.parse(docker(['exec', container, 'node', '--input-type=module', '-e', 'import{readFileSync}from"node:fs";const rows=readFileSync("/app/runtime/docker-predictions.jsonl","utf8").trim().split(String.fromCharCode(10)).map(line=>JSON.parse(line));console.log(JSON.stringify({count:rows.length,fallback:rows.filter(x=>x.analysis.intelligence.mode==="baseline-fallback").length}));']));
  assert.equal(batch.count, 1000); assert.equal(batch.fallback, 1000);
  report.result = { status: 'PASS', nonroot_uid: 1000, http_and_ui: true, missing_model_fallback: true, graceful_restart_preserved_feedback: true, actual_sigkill_pid1_restart: true, same_container_hostname: true, second_container_writer_refused: true, batch };
} catch (error) {
  report.result = { status: 'FAIL', message: error.message };
  if (createdContainer) { try { report.container_log = docker(['logs', '--tail', '20', container]); } catch {} }
  process.exitCode = 1;
} finally {
  if (createdContainer) { try { docker(['rm', '-f', container]); } catch {} }
  if (createdVolume) { try { docker(['volume', 'rm', volume]); } catch {} }
  const output = join(root, 'artifacts/private/v2-evaluation'); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'docker-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
