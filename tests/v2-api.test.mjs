import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server.mjs';
import { createEngine } from '../src/core/engine.mjs';
import { createIntelligence } from '../src/intelligence/index.mjs';
import { createLocalGenerator } from '../src/intelligence/generator.mjs';
import { buildGenerationInput, renderPlan, validatePlan } from '../src/intelligence/generation-contract.mjs';

const tmp = fileURLToPath(new URL('./.tmp/', import.meta.url));
mkdirSync(tmp, { recursive: true });
const dataDir = resolve(process.env.DATA_DIR || fileURLToPath(new URL('../../handout/', import.meta.url)));
const engine = createEngine({ dataDir });
const input = { kind: 'report', messages: [{ role: 'player', text: 'Что такое DM?' }] };
function fakeIntelligence() {
  return {
    status: () => ({ state: 'ready', mode: 'semantic-hybrid', model: 'test-only' }),
    async triage(value, options) { const result = engine.triage(value, options); result.analysis.intelligence = { version: 'v2', mode: 'semantic-hybrid', model: 'test-only', candidates: [], baseline_category: result.category }; result.draft_reply.text = 'v2: ' + result.draft_reply.text; return result; },
    async search() { return { mode: 'semantic-hybrid', model: 'test-only', candidates: [] }; },
    async initialize() { return this.status(); },
    async generate() { return { status: 'completed', text: 'Отдельный проверенный черновик', metrics: { generated: true, elapsed_ms: 1 } }; },
    async close() {},
  };
}
async function start(t, options = {}) {
  const runtimeDir = options.runtimeDir || mkdtempSync(join(tmp, 'v2-api-'));
  const app = createApp({ dataDir, runtimeDir, seed: false, ...options });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const url = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { if (app.listening) await new Promise(resolve => app.close(resolve)); app.closeAllConnections(); if (!options.runtimeDir) rmSync(runtimeDir, { recursive: true, force: true }); });
  const call = async (path, method = 'GET', body) => { const response = await fetch(url + path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; };
  return { app, call, runtimeDir, url };
}
async function jobDone(call, id) {
  for (let i = 0; i < 100; i++) { const job = (await call('/api/jobs')).data.jobs.find(item => item.id === id); if (!['pending', 'running'].includes(job.status)) return job; await delay(5); }
  throw new Error('Job did not complete');
}

test('v2 API awaits intelligence, preserves manual draft/status and persists v2 projection across restart', async t => {
  const runtimeDir = mkdtempSync(join(tmp, 'v2-restart-'));
  t.after(() => rmSync(runtimeDir, { recursive: true, force: true }));
  let { app, call } = await start(t, { runtimeDir, intelligence: fakeIntelligence() });
  const health = (await call('/api/health')).data;
  assert.equal(health.mode, 'semantic-hybrid');
  assert.equal(health.baseline_mode, engine.mode);
  assert.equal((await call('/triage', 'POST', input)).data.analysis.intelligence.version, 'v2');
  const created = await call('/api/tickets', 'POST', { ...input, outcome: 'PRIVATE_OUTCOME', messages: [...input.messages, { role: 'admin', text: 'PRIVATE_ADMIN' }] });
  const id = created.data.ticket.id;
  assert.match(created.data.ticket.triage.draft_reply.text, /^v2:/);
  await call(`/api/tickets/${id}`, 'PATCH', { action: 'save', draft_reply: 'Ручная правка' });
  await call(`/api/tickets/${id}`, 'PATCH', { action: 'escalate' });
  const analyzed = (await call(`/api/tickets/${id}/analyze`, 'POST', {})).data.ticket;
  assert.equal(analyzed.edited_reply, 'Ручная правка'); assert.equal(analyzed.status, 'escalated');
  const generated = (await call(`/api/tickets/${id}/generate`, 'POST', {})).data;
  assert.equal(generated.ticket.edited_reply, 'Ручная правка'); assert.equal(generated.ticket.triage.draft_reply.text, generated.generation.text);
  await new Promise(resolve => app.close(resolve));
  ({ app, call } = await start(t, { runtimeDir }));
  const restored = (await call(`/api/tickets/${id}`)).data.ticket;
  assert.equal(restored.triage.draft_reply.text, generated.generation.text); assert.equal(restored.edited_reply, 'Ручная правка');
  assert.doesNotMatch(readFileSync(join(runtimeDir, 'state.json'), 'utf8'), /PRIVATE_OUTCOME|PRIVATE_ADMIN/);
});

test('missing local model is an explicit failed/resumable initialize job while triage remains available', async t => {
  const missing = join(tmp, 'model-that-does-not-exist');
  const intelligence = createIntelligence({ baseline: engine, modelDir: missing });
  const { call } = await start(t, { intelligence });
  const initial = await call('/api/intelligence'); assert.equal(initial.data.status.state, 'not_initialized');
  const created = await call('/api/intelligence/initialize', 'POST', {});
  assert.equal(created.status, 202);
  const job = await jobDone(call, created.data.job.id);
  assert.equal(job.status, 'failed'); assert.equal(job.resumable, true); assert.match(job.error, /missing/i);
  const result = await call('/triage', 'POST', input);
  assert.equal(result.status, 200); assert.equal(result.data.analysis.intelligence.mode, 'baseline-fallback');
  assert.equal((await call('/api/health')).data.intelligence.state, 'unavailable');
  assert.equal((await call('/api/search?q=DM')).data.mode, 'lexical-fallback');
});

test('generation readiness or failure never replaces the safe draft', async t => {
  const intelligence = fakeIntelligence();
  let result;
  intelligence.generate = async () => result;
  const { call } = await start(t, { intelligence });
  const ticket = (await call('/api/tickets', 'POST', input)).data.ticket;
  for (const generation of [
    { status: 'ready', metrics: { generated: true } },
    { status: 'generated', metrics: { generated: false } },
    { status: 'quality-failed', metrics: { generated: true } },
    { status: 'timeout', metrics: { generated: false } },
  ]) {
    result = { ...generation, text: 'Rejected model output', source_ids: [], plan: { schema_version: 'support-plan-v1' } };
    const response = (await call(`/api/tickets/${ticket.id}/generate`, 'POST', {})).data;
    assert.equal(response.ticket.triage.draft_reply.text, ticket.triage.draft_reply.text);
    assert.equal(response.ticket.edited_reply, ticket.edited_reply);
    assert.deepEqual(response.ticket.triage.citations, ticket.triage.citations);
    assert.deepEqual(response.ticket.triage.draft_reply.cited, ticket.triage.draft_reply.cited);
  }
});

test('only a versioned code safety context may raise a human gate on rejected generation', async t => {
  const intelligence = fakeIntelligence();
  let generation;
  intelligence.generate = async () => structuredClone(generation);
  const { call } = await start(t, { intelligence });
  const ticket = (await call('/api/tickets', 'POST', input)).data.ticket;
  assert.equal(ticket.triage.needs_human, false);
  await call(`/api/tickets/${ticket.id}`, 'PATCH', { action: 'save', draft_reply: 'Operator preserved text' });
  await call(`/api/tickets/${ticket.id}`, 'PATCH', { action: 'escalate' });
  const safety = { schema_version: 'generation-safety-v1', origin: 'code_context', needs_human: true, reason: 'no_verified_answer' };
  for (const invalid of [undefined, { ...safety, origin: 'model' }, { ...safety, schema_version: 'unknown' }, { ...safety, needs_human: 'true' }, { ...safety, reason: 'invented_reason' }]) {
    generation = { status: 'quality-failed', text: 'Rejected output', lang: 'es', needs_human: true, source_ids: ['invented:9'], safety_context: invalid, metrics: { generated: false } };
    const response = (await call(`/api/tickets/${ticket.id}/generate`, 'POST', {})).data.ticket;
    assert.equal(response.triage.needs_human, false, 'model-only or malformed flags are not code decisions');
    assert.equal(response.triage.draft_reply.text, ticket.triage.draft_reply.text);
    assert.equal(response.triage.lang, ticket.triage.lang);
    assert.deepEqual(response.triage.citations, ticket.triage.citations);
    assert.equal(response.edited_reply, 'Operator preserved text');
    assert.equal(response.status, 'escalated');
  }
  generation = { ...generation, needs_human: false, safety_context: safety };
  const raised = (await call(`/api/tickets/${ticket.id}/generate`, 'POST', {})).data.ticket;
  assert.equal(raised.triage.needs_human, true, 'independent code decision survives a rejected model flag');
  assert.match(raised.triage.reasons.join(' '), /не может уверенно сформировать подтверждённый ответ/u);
  assert.equal(raised.triage.draft_reply.text, ticket.triage.draft_reply.text);
  assert.equal(raised.triage.lang, ticket.triage.lang);
  assert.deepEqual(raised.triage.citations, ticket.triage.citations);
  assert.deepEqual(raised.triage.draft_reply.cited, ticket.triage.draft_reply.cited);
  assert.equal(raised.edited_reply, 'Operator preserved text');
  assert.equal(raised.status, 'escalated');
  generation = { ...generation, safety_context: { ...safety, needs_human: false, reason: 'not_required' } };
  assert.equal((await call(`/api/tickets/${ticket.id}/generate`, 'POST', {})).data.ticket.triage.needs_human, true);
  const reanalyzed = (await call(`/api/tickets/${ticket.id}/analyze`, 'POST', {})).data.ticket;
  assert.equal(reanalyzed.triage.needs_human, true, 'reanalyzing the unchanged player input cannot erase the gate');
  assert.equal(reanalyzed.edited_reply, 'Operator preserved text');
  assert.equal(reanalyzed.status, 'escalated');
  assert.equal((await call(`/api/tickets/${ticket.id}/generate`, 'POST', { safety_context: safety })).status, 400);
});

test('disabled real generator exposes code-only safety without replacing the HTTP fallback', async t => {
  const local = createLocalGenerator({ config: { enabled: false }, canonicalSources: [] });
  t.after(() => local.close());
  const intelligence = fakeIntelligence();
  intelligence.generate = (raw, triage) => local.generate(raw, triage);
  const { call } = await start(t, { intelligence });
  const ticket = (await call('/api/tickets', 'POST', input)).data.ticket;
  assert.equal(ticket.triage.needs_human, false);
  const response = (await call(`/api/tickets/${ticket.id}/generate`, 'POST', {})).data;
  assert.equal(response.generation.status, 'unavailable');
  assert.equal(response.generation.metrics.generated, false);
  assert.equal(response.generation.metrics.executed, false);
  assert.equal(response.generation.safety_context.origin, 'code_context');
  assert.equal(response.generation.safety_context.reason, 'no_verified_answer');
  assert.equal(response.ticket.triage.needs_human, true);
  assert.equal(response.ticket.triage.draft_reply.text, ticket.triage.draft_reply.text);
  assert.equal(response.ticket.edited_reply, ticket.edited_reply);
  assert.deepEqual(response.ticket.triage.citations, ticket.triage.citations);
  assert.equal(response.ticket.status, ticket.status);
});

test('accepted support plan projects only prior canonical citation subset and preserves operator/human state', async t => {
  const intelligence = fakeIntelligence();
  let generation;
  intelligence.generate = async () => structuredClone(generation);
  const { call } = await start(t, { intelligence });
  const complaint = (await call('/api/tickets', 'POST', { kind:'report', messages:[{role:'player',text:'Игрок убил меня без причины. Сервер 77.'}] })).data.ticket;
  assert.ok(complaint.triage.citations.some(source => source.id === '43:DM'));
  assert.equal(complaint.triage.needs_human,true);
  await call(`/api/tickets/${complaint.id}`, 'PATCH', { action:'save', draft_reply:'Ручной ответ оператора' });
  generation = { status:'generated', text:'Проверенный новый план технической проблемы.', source_ids:[], needs_human:false, plan:{schema_version:'support-plan-v1'}, metrics:{generated:true,source_applicability:{retained_ids:[],excluded_ids:['43:DM'],reason:'Prior citations excluded because they do not apply to the selected plan focus'}} };
  const removed = (await call(`/api/tickets/${complaint.id}/generate`, 'POST', {})).data;
  assert.deepEqual(removed.ticket.triage.citations,[]);assert.deepEqual(removed.ticket.triage.draft_reply.cited,[]);
  assert.deepEqual(removed.generation.metrics.source_applicability.excluded_ids,['43:DM']);
  assert.equal(removed.generation.metrics.source_applicability.reason,generation.metrics.source_applicability.reason);
  assert.equal(removed.ticket.edited_reply,'Ручной ответ оператора');assert.equal(removed.ticket.triage.needs_human,true);assert.equal(removed.ticket.status,'open');
  const filing = (await call('/api/tickets', 'POST', { kind:'report', messages:[{role:'player',text:'Как правильно оформить жалобу и какие доказательства приложить?'}] })).data.ticket;
  assert.ok(filing.triage.citations.length >= 2);
  const selected = filing.triage.citations[0];
  generation = { status:'generated', text:'План использует только подходящий прежний источник.', source_ids:[selected.id,'30:1.4','invented:9'], plan:{schema_version:'support-plan-v1'}, metrics:{generated:true} };
  const subset = (await call(`/api/tickets/${filing.id}/generate`, 'POST', {})).data;
  assert.deepEqual(subset.ticket.triage.citations,[selected]);
  assert.deepEqual(subset.generation.source_ids,[selected.id]);
  assert.deepEqual(subset.ticket.triage.draft_reply.cited,[engine.sources().find(source => source.id === selected.id).label]);
  assert.deepEqual(subset.generation.metrics.source_applicability.retained_ids,[selected.id]);
  assert.deepEqual(subset.generation.metrics.source_applicability.excluded_ids,filing.triage.citations.slice(1).map(source => source.id));
  assert.equal(subset.ticket.edited_reply,filing.edited_reply);
  assert.equal(subset.ticket.triage.needs_human,filing.triage.needs_human);
});

test('accepted plan applies effective human gate and rendered language atomically without changing operator decisions', async t => {
  const intelligence = fakeIntelligence();
  let generation;
  intelligence.generate = async () => structuredClone(generation);
  const { call } = await start(t, { intelligence });
  const ticket = (await call('/api/tickets', 'POST', input)).data.ticket;
  assert.equal(ticket.triage.needs_human, false);
  await call('/api/tickets/' + ticket.id, 'PATCH', { action:'save', draft_reply:'Operator authored reply' });
  await call('/api/tickets/' + ticket.id, 'PATCH', { action:'escalate' });
  generation = {status:'generated', text:'A specialist must verify this information.', lang:'en', language_origin:'input.lang', original_human_gate:false, human_escalation:{escalated:true,reason:'no_verified_answer'}, needs_human:true, source_ids:[], plan:{schema_version:'support-plan-v1',needs_human:true}, metrics:{generated:true}};
  const accepted = (await call('/api/tickets/' + ticket.id + '/generate', 'POST', {})).data.ticket;
  assert.equal(accepted.triage.lang,'en'); assert.equal(accepted.triage.draft_reply.lang,'en');
  assert.equal(accepted.triage.draft_reply.text,generation.text); assert.equal(accepted.triage.needs_human,true);
  assert.deepEqual(accepted.triage.citations,[]); assert.deepEqual(accepted.triage.draft_reply.cited,[]);
  assert.equal(accepted.status,'escalated'); assert.equal(accepted.edited_reply,'Operator authored reply');
  assert.deepEqual(accepted.triage.analysis.intelligence.generation.human_escalation,generation.human_escalation);
  generation = {...generation, status:'quality-failed', lang:'es', needs_human:false, text:'Rejected text'};
  const rejected = (await call('/api/tickets/' + ticket.id + '/generate', 'POST', {})).data.ticket;
  for (const key of ['lang','needs_human','draft_reply','citations']) assert.deepEqual(rejected.triage[key],accepted.triage[key]);
  generation = {...generation, status:'completed', lang:'es', text:'Respuesta aceptada.', metrics:{generated:true}};
  const continued = (await call('/api/tickets/' + ticket.id + '/generate', 'POST', {})).data.ticket;
  assert.equal(continued.triage.lang,'es'); assert.equal(continued.triage.draft_reply.lang,'es');
  assert.equal(continued.triage.needs_human,true,'an accepted result cannot lower the already active gate');
  assert.equal(continued.edited_reply,'Operator authored reply'); assert.equal(continued.status,'escalated');
});

test('real factory and renderer project explicit language and a contextual human escalation through HTTP', async t => {
  const intelligence = fakeIntelligence();
  let rendered, context;
  intelligence.generate = async (raw, triage) => {
    context = buildGenerationInput(raw, triage, []);
    const plan = {schema_version:'support-plan-v1',focus:context.allowed_focuses[0],fact_ids:[],request_fields:[],source_ids:[],needs_human:context.needs_human};
    assert.equal(validatePlan(plan, context).ok, true);
    rendered = renderPlan(plan, context);
    const metadata = Object.fromEntries(['lang','language_origin','intent_mode','original_human_gate','contextual_human','human_escalation'].map(key => [key, context[key]]));
    return {status:'generated',...rendered,...metadata,plan,metrics:{generated:true,...metadata}};
  };
  const { call } = await start(t, { intelligence });
  const ticket = (await call('/api/tickets','POST',{...input,lang:'es'})).data.ticket;
  assert.equal(ticket.triage.needs_human,false);
  const accepted = (await call('/api/tickets/' + ticket.id + '/generate','POST',{})).data;
  assert.equal(context.lang,'es'); assert.equal(context.language_origin,'input.lang');
  assert.equal(context.intent_mode,'knowledge_gap'); assert.equal(context.original_human_gate,false);
  assert.equal(context.needs_human,true); assert.equal(context.human_escalation.reason,'no_verified_answer');
  assert.equal(accepted.ticket.triage.lang,'es'); assert.equal(accepted.ticket.triage.draft_reply.lang,'es');
  assert.equal(accepted.ticket.triage.draft_reply.text,rendered.text); assert.equal(accepted.ticket.triage.needs_human,true);
  assert.deepEqual(accepted.ticket.triage.citations,[]); assert.deepEqual(accepted.ticket.triage.draft_reply.cited,[]);
  assert.deepEqual(accepted.generation.human_escalation,context.human_escalation);
});

test('explicit v2 batch and HTTP share safe fallback results with model initialization unavailable', async t => {
  const missing = join(tmp, 'missing-parity-model');
  const intelligence = createIntelligence({ baseline: engine, modelDir: missing });
  await intelligence.initialize();
  const { call, runtimeDir } = await start(t, { intelligence });
  const row = { ...input, category: 'report.payment', outcome: 'SECRET', messages: [...input.messages, { role: 'admin', text: 'UNTRUSTED_ADMIN' }] };
  const inputPath = join(runtimeDir, 'batch.jsonl'), outputPath = join(runtimeDir, 'predictions.jsonl');
  writeFileSync(inputPath, JSON.stringify(row) + '\n');
  execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli/predict.mjs', import.meta.url)), '--in', inputPath, '--out', outputPath, '--data-dir', dataDir, '--mode', 'v2', '--initialize', '--model-dir', missing], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const batch = JSON.parse(readFileSync(outputPath, 'utf8'));
  const http = (await call('/triage', 'POST', row)).data;
  batch.analysis.intelligence.elapsed_ms = http.analysis.intelligence.elapsed_ms = 0;
  assert.deepEqual(batch, http);
  assert.equal(batch.analysis.intelligence.mode, 'baseline-fallback');
  assert.doesNotMatch(JSON.stringify(batch), /SECRET|UNTRUSTED_ADMIN/);
  const envOutput = join(runtimeDir, 'environment-predictions.jsonl');
  execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli/predict.mjs', import.meta.url)), '--in', inputPath, '--out', envOutput, '--data-dir', dataDir, '--mode', 'v2', '--initialize'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MODEL_DIR: missing, INDEX_DIR: join(runtimeDir, 'environment-index') } });
  const environmentBatch = JSON.parse(readFileSync(envOutput, 'utf8'));
  environmentBatch.analysis.intelligence.elapsed_ms = 0;
  assert.deepEqual(environmentBatch, batch, 'batch uses the same explicit model location through arguments or documented environment');
});

test('HTTP import, human quality comparison and approved template workflow use real persisted operations', async t => {
  const { call, runtimeDir } = await start(t, { intelligence: fakeIntelligence() });
  const imported = await call('/api/tickets/import', 'POST', { jsonl: JSON.stringify(input) + '\n' + JSON.stringify(input) });
  assert.equal(imported.status, 202); assert.equal((await jobDone(call, imported.data.job.id)).processed, 2);
  const queue = (await call('/api/tickets')).data.tickets;
  assert.equal(queue.length, 2); assert.ok(!Object.hasOwn((await call('/api/jobs')).data.jobs[0], 'payload'));
  const encoded = encodeURIComponent(queue[0].id);
  assert.match(encoded, /%3A/);
  assert.equal((await call(`/api/tickets/${encoded}`)).status, 200);
  assert.equal((await call(`/api/tickets/${encoded}`, 'PATCH', { action: 'save', draft_reply: 'Ручная правка импортированного обращения' })).status, 200);
  assert.equal((await call(`/api/tickets/${encoded}/analyze`, 'POST', {})).status, 200);
  assert.equal((await call(`/api/tickets/${encoded}`)).data.ticket.edited_reply, 'Ручная правка импортированного обращения');
  assert.equal((await call('/api/quality')).data.metrics.v2.category_accuracy.value, null);
  const annotation = await call('/api/quality/annotations', 'POST', { ticket_id: queue[0].id, category: 'report.question', auto_eligible: true });
  assert.equal(annotation.status, 201); assert.equal(annotation.data.annotation.provenance, 'human');
  const comparison = await call('/api/quality/compare', 'POST', { ticket_ids: [queue[0].id] });
  assert.equal(comparison.data.metrics.v2.category_accuracy.value, 1); assert.equal(comparison.data.metrics.v2.category_accuracy.denominator, 1);
  const radarJob = (await call('/api/radar/rebuild', 'POST', {})).data.job;
  assert.equal((await jobDone(call, radarJob.id)).status, 'completed');
  const cluster = (await call('/api/radar')).data.clusters[0];
  const template = (await call('/api/templates', 'POST', { cluster_id: cluster.id, title: 'Уточнение', text: 'Попросить сервер и время.', lang: 'ru', source_ids: ['43:DM'] })).data.template;
  assert.equal(template.status, 'proposed'); assert.ok(template.origin_ticket_ids.length);
  assert.equal((await call(`/api/templates/${template.id}`, 'PATCH', { action: 'approve' })).data.template.status, 'approved');
  assert.equal((await call(`/api/templates/${template.id}`, 'PATCH', { action: 'revoke' })).data.template.status, 'revoked');
  assert.equal(JSON.parse(readFileSync(join(runtimeDir, 'workspace.json'), 'utf8')).annotations.length, 1);
});

test('new API rejects unsupported paths, labels, file imports and limits without bypassing Host/Origin policy', async t => {
  const { call, url } = await start(t);
  const bad = [
    ['/api/tickets/import', { path: 'D:/private.jsonl' }], ['/api/tickets/import', { tickets: Array(1001).fill(input) }],
    ['/api/intelligence/initialize', { modelDir: 'C:/' }], ['/api/quality/compare', { command: 'powershell' }],
    ['/api/quality/annotations', { ticket_id: 'missing', priority: 'p0', provenance: 'human' }],
    ['/api/templates', { title: 'x', text: 'x', lang: 'ru', source_ids: ['fake:1'] }],
  ];
  for (const [path, body] of bad) assert.equal((await call(path, 'POST', body)).status, 400);
  assert.equal((await call('/api/tickets/import', 'POST', { jsonl: 'x'.repeat(2 * 1024 * 1024) })).status, 413);
  const response = await fetch(url + '/api/quality', { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 403); assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await call('/api/jobs/unknown/resume', 'POST', {})).status, 404);
});

test('local streaming import CLI resumes its checkpoint without duplicating completed records', t => {
  const runtimeDir = mkdtempSync(join(tmp, 'cli-import-'));
  t.after(() => rmSync(runtimeDir, { recursive: true, force: true }));
  const inputPath = join(runtimeDir, 'tickets.jsonl');
  writeFileSync(inputPath, JSON.stringify(input) + '\n' + JSON.stringify(input) + '\n');
  const args = [fileURLToPath(new URL('../scripts/import-tickets.mjs', import.meta.url)), '--in', inputPath, '--runtime-dir', runtimeDir, '--data-dir', dataDir, '--batch-size', '1'];
  const first = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const second = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(first.imported, 2); assert.equal(second.imported, 2);
  assert.equal(JSON.parse(readFileSync(join(runtimeDir, 'state.json'), 'utf8')).tickets.length, 2);
});
