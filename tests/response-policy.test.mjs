import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server.mjs';
import { createStore } from '../src/storage.mjs';
import { createWorkspace } from '../src/workspace/index.mjs';
import { automaticReplyEligibility, ticketGuard } from '../src/workspace/reply-policy.mjs';

const tempRoot = fileURLToPath(new URL('../runtime/test-response-policy/', import.meta.url));
mkdirSync(tempRoot, { recursive: true });
const input = { kind: 'report', lang: 'en', messages: [{ role: 'player', text: 'Hello!' }] };
const engine = {
  mode: 'baseline', sources: () => [],
  taxonomy: { categories: [{ code: 'report.question' }, { code: 'complaint.player' }], priorities: ['p0', 'p1', 'p2', 'p3'].map(code => ({ code })) },
  triage: value => ({ lang: 'en', category: value.kind === 'complaint' ? 'complaint.player' : 'report.question', priority: 'p3', needs_human: false, confidence: .8, is_spam_or_duplicate: false, extracted: {}, citations: [], reasons: [], draft_reply: { lang: 'en', text: 'Safe original draft', cited: [] }, analysis: { intelligence: { version: 'v2', mode: 'baseline-fallback' } } }),
};
const qualified = () => ({ generation: { operator_activation: true, activation_scope: 'operator-generation', busy: false }, busy: false });
const accepted = () => ({ status: 'generated', lang: 'en', text: 'Hello, how can support help?', source_ids: [], needs_human: false, plan: { schema_version: 'support-plan-v1', focus: 'clarification', fact_ids: [], request_fields: [], source_ids: [], needs_human: false }, safety_context: { schema_version: 'generation-safety-v1', origin: 'code_context', needs_human: false, reason: 'not_required' }, metrics: { generated: true, validation_only: false, activation_sha256: 'a'.repeat(64), elapsed_ms: 1 } });
function provider(options = {}) {
  let calls = 0, active = 0, maximum = 0, verified = false;
  return {
    status: () => options.status?.() || (verified ? qualified() : { generation: { operator_activation: false }, busy: false }),
    triage: async value => engine.triage(value),
    async generate(value, triage) { calls++; active++; maximum = Math.max(maximum, active); try { const result = await (options.generate?.(value, triage) ?? accepted()); verified = true; return result; } finally { active--; } },
    async close() {}, stats: () => ({ calls, maximum }),
  };
}
function directory(t) { const path = mkdtempSync(join(tempRoot, 'isolated-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
async function setup(t, options = {}) {
  const runtimeDir = options.runtimeDir || directory(t), intelligence = options.intelligence || provider();
  const app = createApp({ runtimeDir, engine, intelligence, seed: false, refreshTriage: false });
  await new Promise(resolveListen => app.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => { if (app.listening) { app.closeAllConnections(); await new Promise(resolveClose => app.close(resolveClose)); } });
  const base = `http://127.0.0.1:${app.address().port}`;
  async function request(path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  return { app, request, runtimeDir, intelligence };
}
async function settle(app, id) {
  for (let i = 0; i < 200; i++) {
    const result = app.workspace.replies(id);
    if (['stored_locally', 'staff_review', 'cancelled'].includes(result.auto_reply.status)) return result;
    await delay(5);
  }
  throw new Error('Automatic reply did not settle');
}
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5); } throw new Error('Expected asynchronous boundary'); }
const enable = async request => { const result = await request('/api/settings', { reply_mode: 'auto', revision: 0 }, 'PATCH'); assert.equal(result.status, 200); return result; };

test('reply settings default review reads old workspace v2 without rewriting it or old state', async t => {
  const runtimeDir = directory(t);
  const legacy = { version: 2, jobs: [], annotations: [], comparisons: [], templates: [], radar: { clusters: [] }, preserved: 'legacy extension' };
  const legacyState = { version: 1, tickets: [], feedback: [] };
  writeFileSync(join(runtimeDir, 'workspace.json'), JSON.stringify(legacy));
  writeFileSync(join(runtimeDir, 'state.json'), JSON.stringify(legacyState));
  const oldWorkspace = readFileSync(join(runtimeDir, 'workspace.json')), oldState = readFileSync(join(runtimeDir, 'state.json'));
  const { request } = await setup(t, { runtimeDir });
  assert.deepEqual((await request('/api/settings')).body, { settings: { reply_mode: 'review' }, revision: 0, capabilities: { external_delivery: false } });
  assert.deepEqual(readFileSync(join(runtimeDir, 'workspace.json')), oldWorkspace);
  assert.deepEqual(readFileSync(join(runtimeDir, 'state.json')), oldState);
  await enable(request);
  assert.equal(JSON.parse(readFileSync(join(runtimeDir, 'workspace.json'))).preserved, 'legacy extension');
});

test('settings are strict, optimistic, local-only and persist their revision', async t => {
  const { request, runtimeDir } = await setup(t);
  for (const body of [{ reply_mode: 'send', revision: 0 }, { reply_mode: 'auto' }, { reply_mode: 'auto', revision: -1 }, { reply_mode: 'auto', revision: 0, path: '/arbitrary' }, { reply_mode: 'auto', revision: 0, capabilities: { external_delivery: true } }]) assert.equal((await request('/api/settings', body, 'PATCH')).status, 400);
  await enable(request);
  assert.equal((await request('/api/settings', { reply_mode: 'review', revision: 0 }, 'PATCH')).status, 409);
  assert.equal((await request('/api/settings', { reply_mode: 'review', revision: 1 }, 'PATCH', { origin: 'http://elsewhere.invalid' })).status, 403);
  assert.deepEqual(JSON.parse(readFileSync(join(runtimeDir, 'workspace.json'))).settings, { reply_mode: 'auto', revision: 1 });
});

test('review arrivals and stateless triage never enqueue an automatic response', async t => {
  const { request, app, intelligence } = await setup(t);
  const ticket = (await request('/api/tickets', input)).body.ticket;
  assert.equal((await request(`/api/tickets/${ticket.id}/replies`)).body.auto_reply.status, 'not_requested');
  await enable(request);
  await request('/triage', input);
  await delay(15);
  assert.equal(app.workspace.jobs().length, 0);
  assert.equal(intelligence.stats().calls, 0);
});

test('future auto arrivals serialize verified normal generation and store only a local AI reply', async t => {
  const intelligence = provider({ generate: async () => { await delay(15); return accepted(); } });
  const { request, app } = await setup(t, { intelligence });
  await enable(request);
  const first = (await request('/api/tickets', input)).body.ticket;
  const second = (await request('/api/tickets', input)).body.ticket;
  for (const ticket of [first, second]) {
    const result = await settle(app, ticket.id);
    assert.equal(result.auto_reply.status, 'stored_locally'); assert.equal(result.replies.length, 1);
    assert.equal(result.replies[0].kind, 'ai_auto'); assert.equal(result.replies[0].delivery_state, 'stored_locally');
    assert.equal(result.replies[0].external_sent, false); assert.equal(result.replies[0].confirmed_by, null);
    const latest = (await request(`/api/tickets/${ticket.id}`)).body.ticket;
    assert.equal(latest.edited_reply, 'Safe original draft'); assert.equal(latest.status, 'open'); assert.equal(latest.triage.needs_human, false);
  }
  assert.equal(app.store.snapshot().feedback.length, 0);
  assert.equal(app.store.snapshot().reply_confirmation_intents, undefined, 'AI output never creates operator confirmation intent');
  assert.deepEqual(intelligence.stats(), { calls: 2, maximum: 1 });
});

test('disabling auto during inference prevents local publication and does not affect the manual draft', async t => {
  let release;
  const intelligence = provider({ generate: () => new Promise(resolveGeneration => { release = resolveGeneration; }) });
  const { app, request } = await setup(t, { intelligence });
  await enable(request); const ticket = (await request('/api/tickets', input)).body.ticket;
  await until(() => Boolean(release));
  assert.equal((await request('/api/settings', { reply_mode: 'review', revision: 1 }, 'PATCH')).status, 200);
  release(accepted());
  const result = await settle(app, ticket.id);
  assert.equal(result.auto_reply.status, 'cancelled'); assert.equal(result.replies.length, 0);
  assert.equal(app.store.snapshot().tickets[0].edited_reply, 'Safe original draft');
});

test('manual save or status change during inference wins; explicit confirm is idempotent local operator output', async t => {
  let release;
  const intelligence = provider({ generate: () => new Promise(resolveGeneration => { release = resolveGeneration; }) });
  const { app, request } = await setup(t, { intelligence });
  await enable(request); const ticket = (await request('/api/tickets', input)).body.ticket;
  await until(() => Boolean(release));
  assert.equal((await request(`/api/tickets/${ticket.id}`, { action: 'save', draft_reply: 'My manual text' }, 'PATCH')).status, 200);
  release(accepted()); const outcome = await settle(app, ticket.id);
  assert.equal(outcome.auto_reply.status, 'staff_review'); assert.equal(outcome.replies.length, 0);
  await request(`/api/tickets/${ticket.id}`, { action: 'confirm' }, 'PATCH');
  await request(`/api/tickets/${ticket.id}`, { action: 'confirm' }, 'PATCH');
  const replies = (await request(`/api/tickets/${ticket.id}/replies`)).body.replies;
  assert.equal(replies.length, 1); assert.equal(replies[0].kind, 'operator_confirmed'); assert.equal(replies[0].confirmed_by, 'local_operator'); assert.equal(replies[0].external_sent, false); assert.equal(replies[0].text, 'My manual text');
  assert.equal(app.store.snapshot().tickets[0].status, 'reviewed');
});

test('saving even unchanged text during inference invalidates its manual revision', async t => {
  let release;
  const intelligence = provider({ generate: () => new Promise(resolveGeneration => { release = resolveGeneration; }) });
  const { app, request } = await setup(t, { intelligence }); await enable(request);
  const ticket = (await request('/api/tickets', input)).body.ticket; await until(() => Boolean(release));
  await request(`/api/tickets/${ticket.id}`, { action: 'save' }, 'PATCH'); release(accepted());
  assert.equal((await settle(app, ticket.id)).replies.length, 0);
});

test('unavailable, private-scope, safety-raised and forged-code outcomes hand off instead of auto-approving', async t => {
  for (const change of [
    value => ({ ...value, status: 'unavailable' }),
    value => ({ ...value, metrics: { ...value.metrics, generated: false } }),
    value => ({ ...value, metrics: { ...value.metrics, validation_only: true } }),
    value => ({ ...value, metrics: { ...value.metrics, activation_sha256: undefined } }),
    value => ({ ...value, needs_human: true }),
    value => ({ ...value, safety_context: { ...value.safety_context, needs_human: true, reason: 'unresolved_context' } }),
    value => ({ ...value, safety_context: undefined }),
  ]) {
    const intelligence = provider({ generate: () => change(accepted()) });
    const { app, request } = await setup(t, { intelligence }); await enable(request);
    const ticket = (await request('/api/tickets', input)).body.ticket;
    const result = await settle(app, ticket.id); assert.equal(result.auto_reply.status, 'staff_review'); assert.equal(result.replies.length, 0);
  }
});

test('human-required and complaint arrivals are handed to staff without invoking the model', async t => {
  const { app, request, intelligence } = await setup(t); await enable(request);
  const ticket = (await request('/api/tickets', { ...input, kind: 'complaint' })).body.ticket;
  assert.equal((await settle(app, ticket.id)).auto_reply.status, 'staff_review'); assert.equal(intelligence.stats().calls, 0);
});

test('pure eligibility independently enforces all human gates and the trusted operator scope', () => {
  const ticket = { input, status: 'open', triage: engine.triage(input) };
  assert.equal(automaticReplyEligibility(ticket, accepted(), qualified()), null);
  assert.ok(automaticReplyEligibility({ ...ticket, triage: { ...ticket.triage, needs_human: true } }, accepted(), qualified()));
  assert.ok(automaticReplyEligibility(ticket, { ...accepted(), plan: { ...accepted().plan, needs_human: true } }, qualified()));
  assert.ok(automaticReplyEligibility(ticket, accepted(), { generation: { operator_activation: true, activation_scope: 'private-validation' } }));
  assert.ok(automaticReplyEligibility({ ...ticket, triage: { ...ticket.triage, priority: 'p0' } }, accepted(), qualified()));
});

test('auto setting does not backfill an existing queue on mode change or restart', async t => {
  const { app, request, intelligence, runtimeDir } = await setup(t);
  const old = (await request('/api/tickets', input)).body.ticket;
  await enable(request); await delay(10);
  assert.equal(app.workspace.jobs().length, 0); assert.equal(intelligence.stats().calls, 0);
  assert.equal(app.workspace.replies(old.id).replies.length, 0);
  app.closeAllConnections(); await new Promise(resolveClose => app.close(resolveClose));
  const restarted = await setup(t, { runtimeDir, intelligence });
  assert.deepEqual((await restarted.request('/api/settings')).body.settings, { reply_mode: 'auto' });
  await delay(10);
  assert.equal(restarted.app.workspace.jobs().length, 0); assert.equal(intelligence.stats().calls, 0);
});

test('durable pending auto job restarts once, while duplicate import id cannot create another reply', async t => {
  const runtimeDir = directory(t), store = createStore({ runtimeDir });
  const intelligence = provider();
  let workspace;
  const addTicket = async (value, id, options) => {
    const ticket = store.transact(state => { const prior = state.tickets.find(item => item.id === id); if (prior) return prior; const next = { id, input: value, triage: engine.triage(value), edited_reply: 'Safe original draft', status: 'open', updated_at: 'authored', arrival_reply_policy: options.replyPolicy }; state.tickets.push(next); return next; });
    workspace.onArrival(ticket); return ticket;
  };
  workspace = createWorkspace({ runtimeDir, store, engine, intelligence, analyze: value => engine.triage(value), addTicket });
  workspace.patchSettings({ reply_mode: 'auto', revision: 0 });
  const ticket = { id: 'recover:0', input, triage: engine.triage(input), edited_reply: 'Safe original draft', status: 'open', updated_at: 'authored', arrival_reply_policy: { reply_mode: 'auto', revision: 1 } };
  store.transact(state => { state.tickets.push(ticket); }); workspace.onArrival(ticket); await workspace.close();
  workspace = createWorkspace({ runtimeDir, store, engine, intelligence, analyze: value => engine.triage(value), addTicket });
  t.after(() => workspace.close());
  await until(() => workspace.replies(ticket.id).replies.length === 1);
  assert.equal(intelligence.stats().calls, 1);
  const job = workspace.importTickets([input], { id: 'stable-import' });
  assert.equal(workspace.importTickets([input], { id: 'stable-import' }).id, job.id);
  await until(() => store.snapshot().tickets.some(item => item.id === 'stable-import:0') && workspace.replies('stable-import:0').replies.length === 1);
  assert.equal(store.snapshot().tickets.length, 2); assert.equal(intelligence.stats().calls, 2);
  assert.ok(workspace.jobs().every(item => !Object.hasOwn(item, 'payload')));
  // Crash window: durable outbox committed, but the generic completion marker
  // did not. Recovery must use the committed record without calling generate.
  workspace.db.transact(state => { state.jobs.find(item => item.type === 'auto_reply').status = 'running'; });
  await workspace.close();
  workspace = createWorkspace({ runtimeDir, store, engine, intelligence, analyze: value => engine.triage(value), addTicket });
  await until(() => workspace.jobs().filter(item => item.type === 'auto_reply').every(item => item.status === 'completed'));
  assert.equal(intelligence.stats().calls, 2); assert.equal(workspace.replies(ticket.id).replies.length, 1);
});

test('arrivals admitted in review stay manual when settings change during asynchronous analysis', async t => {
  let releaseAnalysis;
  const intelligence = provider();
  intelligence.triage = () => new Promise(resolveTriage => { releaseAnalysis = resolveTriage; });
  const { app, request } = await setup(t, { intelligence });
  const arriving = request('/api/tickets', input);
  await until(() => Boolean(releaseAnalysis)); await enable(request);
  releaseAnalysis(engine.triage(input)); const ticket = (await arriving).body.ticket;
  await delay(10);
  assert.equal(app.workspace.replies(ticket.id).auto_reply.status, 'not_requested'); assert.equal(intelligence.stats().calls, 0);
});

test('busy and throwing normal providers stop at staff handoff without retry', async t => {
  for (const options of [{ status: () => ({ busy: true }) }, { generate: () => { throw new Error('Authored fake unavailable'); } }]) {
    const intelligence = provider(options), { app, request } = await setup(t, { intelligence }); await enable(request);
    const ticket = (await request('/api/tickets', input)).body.ticket;
    const result = await settle(app, ticket.id);
    assert.equal(result.auto_reply.status, 'staff_review'); assert.equal(result.replies.length, 0);
    await delay(10); assert.ok(intelligence.stats().calls <= 1);
    assert.equal(app.workspace.jobs()[0].resumable, false);
  }
});

test('input revision races cancel the old job and a bounded full job history hands off safely', async t => {
  let release;
  const intelligence = provider({ generate: () => new Promise(resolveGeneration => { release = resolveGeneration; }) });
  const { app, request } = await setup(t, { intelligence }); await enable(request);
  const ticket = (await request('/api/tickets', input)).body.ticket; await until(() => Boolean(release));
  app.store.transact(state => { state.tickets[0].input.messages[0].text = 'Changed authored input'; }); release(accepted());
  assert.equal((await settle(app, ticket.id)).replies.length, 0);
  app.workspace.db.transact(state => { state.jobs = Array.from({ length: 1000 }, (_, index) => ({ id: `history-${index}`, type: 'radar', status: 'completed', payload: {} })); });
  const next = (await request('/api/tickets', input)).body.ticket;
  assert.equal(app.workspace.replies(next.id).auto_reply.reason, 'job_limit'); assert.equal(app.workspace.jobs().length, 1000);
});

test('explicit confirmation survives failure between queue commit and outbox write without duplicates', async t => {
  const { app, request, runtimeDir } = await setup(t);
  const ticket = (await request('/api/tickets', input)).body.ticket;
  app.workspace.confirmReply = () => { throw new Error('Authored outbox boundary failure'); };
  const failure = await request(`/api/tickets/${ticket.id}`, { action: 'confirm', draft_reply: 'First explicitly confirmed text' }, 'PATCH');
  assert.equal(failure.status, 500);
  const committed = JSON.parse(readFileSync(join(runtimeDir, 'state.json')));
  assert.equal(committed.tickets[0].status, 'reviewed'); assert.equal(committed.feedback.length, 1);
  assert.equal(committed.reply_confirmation_intents.length, 1);
  assert.equal(committed.feedback[0].reply_intent_id, committed.reply_confirmation_intents[0].id);
  assert.equal(app.workspace.replies(ticket.id).replies.length, 0, 'fault occurs before outbox persistence');
  const committedBytes = readFileSync(join(runtimeDir, 'state.json'));
  app.closeAllConnections(); await new Promise(resolveClose => app.close(resolveClose));
  const restarted = await setup(t, { runtimeDir });
  assert.deepEqual(readFileSync(join(runtimeDir, 'state.json')), committedBytes, 'recovery only publishes outbox, not rewriting source ticket or feedback');
  let replies = (await restarted.request(`/api/tickets/${ticket.id}/replies`)).body.replies;
  assert.equal(replies.length, 1); assert.equal(replies[0].text, 'First explicitly confirmed text');
  assert.equal(replies[0].id, committed.reply_confirmation_intents[0].id); assert.equal(replies[0].external_sent, false);
  await restarted.request(`/api/tickets/${ticket.id}`, { action: 'confirm' }, 'PATCH');
  assert.equal(restarted.app.workspace.replies(ticket.id).replies.length, 1, 'same-content HTTP retry is idempotent');
  await restarted.request(`/api/tickets/${ticket.id}`, { action: 'escalate' }, 'PATCH');
  await restarted.request(`/api/tickets/${ticket.id}`, { action: 'save', draft_reply: 'Second explicitly confirmed text' }, 'PATCH');
  await restarted.request(`/api/tickets/${ticket.id}`, { action: 'confirm' }, 'PATCH');
  replies = restarted.app.workspace.replies(ticket.id).replies;
  assert.deepEqual(replies.map(item => item.text), ['First explicitly confirmed text', 'Second explicitly confirmed text']);
  assert.ok(replies.every(item => item.confirmed_by === 'local_operator' && item.delivery_state === 'stored_locally' && item.external_sent === false));
});

test('historical reviewed tickets and untagged confirmed feedback are never backfilled or rewritten', async t => {
  const runtimeDir = directory(t), timestamp = '2026-01-02T03:04:05.000Z';
  const oldTicket = { id: 'legacy-reviewed', input, triage: engine.triage(input), status: 'reviewed', edited_reply: 'Legacy confirmed text', updated_at: timestamp };
  const feedback = Array.from({ length: 3 }, (_, i) => ({ id: `legacy-feedback-${i}`, ticket_id: oldTicket.id, action: 'confirm', edited_reply: oldTicket.edited_reply, confirmed_by: 'local_operator', created_at: timestamp }));
  writeFileSync(join(runtimeDir, 'state.json'), JSON.stringify({ version: 1, tickets: [oldTicket], feedback }));
  const before = readFileSync(join(runtimeDir, 'state.json'));
  const { app } = await setup(t, { runtimeDir });
  assert.equal(app.workspace.replies(oldTicket.id).replies.length, 0);
  assert.equal(app.workspace.replies(oldTicket.id).auto_reply.status, 'not_requested');
  assert.deepEqual(readFileSync(join(runtimeDir, 'state.json')), before);
});
