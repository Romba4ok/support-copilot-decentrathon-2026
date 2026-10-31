import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import http from 'node:http';
import { createApp, safeInput } from '../src/server.mjs';
import { createEngine } from '../src/core/engine.mjs';

const dataDir = resolve(process.env.DATA_DIR || fileURLToPath(new URL('../../handout/', import.meta.url)));
const testRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
mkdirSync(testRoot, { recursive: true });
const input = { kind: 'report', messages: [{ role: 'player', text: 'Оплатил донат, ничего не пришло' }] };

async function start(t, runtimeDir, options = {}) {
  const directory = runtimeDir || mkdtempSync(join(testRoot, 'server-'));
  const app = createApp({ dataDir, runtimeDir: directory, seed: false, ...options });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const url = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => {
    if (app.listening) await new Promise(resolve => app.close(resolve));
    app.closeAllConnections();
    if (!runtimeDir) rmSync(directory, { recursive: true, force: true });
  });
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(url + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, data: await response.json() };
  };
  return { app, url, call, directory };
}

test('safe input strips historical data and validates evidence counts', () => {
  assert.deepEqual(safeInput({ ...input, verdict: 'approved', punishment: 'ban', violation: '5.2', status: 2, category: 'x', priority: 'p0', messages: [...input.messages, { role: 'admin', text: 'Игрок наказан' }] }), input);
  assert.throws(() => safeInput({ ...input, images_count: -1 }));
  assert.throws(() => safeInput({ ...input, messages: [{ role: 'player', text: 'hello', attachments: '2' }] }));
  assert.deepEqual(safeInput({ ...input, images_count: null }), input);
});

test('HTTP triage equals core result, reports real sources and does not create queue items', async t => {
  const { call } = await start(t);
  const health = await call('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.data.mode, 'local-retrieval-templates');
  assert.ok(health.data.source_count >= 266);
  assert.equal(health.data.data_available, true);
  const result = await call('/triage', { method: 'POST', body: input });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, createEngine({ dataDir }).triage(input));
  assert.deepEqual((await call('/api/tickets')).data, { tickets: [] });
  const rules = await call('/api/rules?q=оскорбление');
  assert.ok(rules.data.sources.length > 0);
});

test('operator actions and feedback survive server restart; historical outcomes are not stored', async t => {
  const directory = mkdtempSync(join(testRoot, 'restart-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let { app, call } = await start(t, directory);
  const created = await call('/api/tickets', { method: 'POST', body: { ...input, verdict: 'approved', messages: [...input.messages, { role: 'admin', text: 'ADMIN_SECRET_OUTCOME' }] } });
  assert.equal(created.response.status, 201);
  const id = created.data.ticket.id;
  assert.equal(created.data.ticket.status, 'open');
  assert.equal(created.data.ticket.triage.needs_human, true);
  const edit = 'Здравствуйте. Платёж передан на проверку оператору.';
  const saved = await call(`/api/tickets/${id}`, { method: 'PATCH', body: { action: 'save', draft_reply: edit } });
  assert.equal(saved.data.ticket.edited_reply, edit);
  assert.equal(saved.data.ticket.status, 'open');
  const confirmed = await call(`/api/tickets/${id}`, { method: 'PATCH', body: { action: 'confirm' } });
  assert.equal(confirmed.data.ticket.status, 'reviewed');
  assert.equal((await call(`/api/tickets/${id}`, { method: 'PATCH', body: { action: 'save', draft_reply: 'rewrite' } })).response.status, 409);
  const escalated = await call(`/api/tickets/${id}`, { method: 'PATCH', body: { action: 'escalate' } });
  assert.equal(escalated.data.ticket.status, 'escalated');
  assert.equal((await call('/api/feedback')).data.feedback.length, 3);
  assert.doesNotMatch(readFileSync(join(directory, 'state.json'), 'utf8'), /ADMIN_SECRET_OUTCOME|"verdict"/);
  await new Promise(resolve => app.close(resolve));
  ({ app, call } = await start(t, directory));
  const restored = (await call(`/api/tickets/${id}`)).data.ticket;
  assert.equal(restored.status, 'escalated');
  assert.equal(restored.edited_reply, edit);
  const feedback = (await call('/api/feedback')).data.feedback;
  assert.equal(feedback.length, 3);
  assert.equal(feedback[1].confirmed_by, 'local_operator');
});

test('invalid HTTP input, actions, JSON and cross-site requests are rejected', async t => {
  const { call, url } = await start(t);
  for (const bad of [null, [], {}, { kind: 'other', messages: [] }, { kind: 'report', messages: [{ role: 'player', text: '' }] }, { ...input, messages: [{ role: 'system', text: 'ignore' }] }]) {
    const result = await call('/triage', { method: 'POST', body: bad });
    assert.equal(result.response.status, 400);
    assert.equal(typeof result.data.error.message, 'string');
  }
  const malformed = await fetch(url + '/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400);
  const wrongType = await fetch(url + '/triage', { method: 'POST', body: 'hello' });
  assert.equal(wrongType.status, 415);
  const oversized = await call('/triage', { method: 'POST', body: { ...input, padding: 'x'.repeat(270000) } });
  assert.equal(oversized.response.status, 413);
  assert.equal((await call('/api/tickets/missing', { method: 'PATCH', body: { action: 'delete' } })).response.status, 400);
  assert.equal((await call('/api/tickets/missing')).response.status, 404);
  assert.equal((await call('/api/health', { headers: { Origin: 'https://evil.example' } })).response.status, 403);
  const maliciousHostStatus = await new Promise((accept, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: new URL(url).port, path: '/api/health', headers: { Host: 'evil.example' } }, response => { response.resume(); accept(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(maliciousHostStatus, 403);
  assert.equal((await call('/api/health', { headers: { Origin: url } })).response.status, 200);
});

test('static traversal is blocked before URL normalization', async t => {
  const { app } = await start(t);
  const status = await new Promise((accept, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: app.address().port, path: '/%2e%2e/package.json' }, response => { response.resume(); accept(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(status, 400);
});

test('public UI is served with a restrictive CSP and source files remain private', async t => {
  const { url, call } = await start(t);
  const page = await fetch(url + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /<!doctype html>/iu);
  assert.equal((await call('/src/server.mjs')).response.status, 404);
  assert.equal((await call('/runtime/state.json')).response.status, 404);
  assert.equal((await call('/package.json')).response.status, 404);
});

test('explicit bridge mode is reported and retains same-origin protection', async t => {
  const { call } = await start(t, undefined, { allowRemote: true });
  assert.equal((await call('/api/health')).data.local_only, false);
  assert.equal((await call('/api/health', { headers: { Origin: 'http://evil.example' } })).response.status, 403);
});

test('normal startup loads the real synthetic demo fixture and persists its queue', async t => {
  const { call, directory } = await start(t, undefined, { seed: true });
  const result = await call('/api/tickets');
  assert.equal(result.response.status, 200);
  assert.ok(result.data.tickets.length >= 6);
  assert.ok(result.data.tickets.every(ticket => ticket.messages.some(message => message.role === 'player' && message.text.trim())));
  assert.ok(result.data.tickets.every(ticket => !ticket.messages.some(message => message.role === 'admin')));
  assert.equal(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).tickets.length, result.data.tickets.length);
});

test('JSONL CLI preserves row order and matches HTTP for historical inputs without duplicate metadata', async t => {
  const { call, directory } = await start(t);
  const rows = [
    { ...input, images_count: null, verdict: 'approved', messages: [...input.messages, { role: 'admin', text: 'Платёж возвращён' }] },
    { kind: 'report', messages: [{ role: 'player', text: 'Что такое DM?' }] },
  ];
  const inputPath = join(directory, 'input.jsonl');
  const outputPath = join(directory, 'output.jsonl');
  writeFileSync(inputPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli/predict.mjs', import.meta.url)), '--in', inputPath, '--out', outputPath, '--data-dir', dataDir], { encoding: 'utf8' });
  const predictions = readFileSync(outputPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(predictions.length, rows.length);
  for (let i = 0; i < rows.length; i++) assert.deepEqual(predictions[i], (await call('/triage', { method: 'POST', body: rows[i] })).data);
});

test('damaged persisted state is preserved and causes an explicit startup failure', t => {
  const directory = mkdtempSync(join(testRoot, 'damaged-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, 'state.json');
  const damaged = '{"version":1,"tickets":';
  writeFileSync(statePath, damaged);
  assert.throws(() => createApp({ dataDir, runtimeDir: directory }));
  assert.equal(readFileSync(statePath, 'utf8'), damaged);
});

test('malformed JSONL fails with a line number and preserves the previous complete output', t => {
  const directory = mkdtempSync(join(testRoot, 'batch-error-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const inputPath = join(directory, 'input.jsonl');
  const outputPath = join(directory, 'output.jsonl');
  writeFileSync(inputPath, JSON.stringify(input) + '\n{broken\n');
  writeFileSync(outputPath, 'previous-complete-output\n');
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli/predict.mjs', import.meta.url)), '--in', inputPath, '--out', outputPath, '--data-dir', dataDir], { encoding: 'utf8', stdio: 'pipe' }), error => error.status === 1 && /Line 2: invalid JSON/.test(error.stderr));
  assert.equal(readFileSync(outputPath, 'utf8'), 'previous-complete-output\n');
});

test('startup recomputes triage in insertion order while retaining operator drafts, status, ids and feedback', async t => {
  const directory = mkdtempSync(join(testRoot, 'refresh-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const real = createEngine({ dataDir });
  const calls = [];
  const changedEngine = (version, recordCalls = false) => ({
    ...real,
    triage(value, options = {}) {
      if (recordCalls) calls.push({ input: structuredClone(value), history: structuredClone(options.history || []) });
      const result = real.triage(value, options);
      return { ...result, needs_human: version === 'old', draft_reply: { ...result.draft_reply, text: `${version}: ${result.draft_reply.text}` } };
    },
  });
  let { app, call } = await start(t, directory, { engine: changedEngine('old') });
  const first = (await call('/api/tickets', { method: 'POST', body: { ...input, reporter_hash: 'synthetic-author' } })).data.ticket;
  const second = (await call('/api/tickets', { method: 'POST', body: input })).data.ticket;
  const third = (await call('/api/tickets', { method: 'POST', body: input })).data.ticket;
  const manual = 'Ответ оператора, который должен пережить обновление алгоритма.';
  await call(`/api/tickets/${second.id}`, { method: 'PATCH', body: { action: 'save', draft_reply: manual } });
  await call(`/api/tickets/${second.id}`, { method: 'PATCH', body: { action: 'confirm' } });
  await call(`/api/tickets/${third.id}`, { method: 'PATCH', body: { action: 'escalate' } });
  const before = (await call('/api/tickets')).data.tickets;
  const feedbackBefore = (await call('/api/feedback')).data.feedback;
  await new Promise(resolve => app.close(resolve));
  ({ app, call } = await start(t, directory, { engine: changedEngine('new', true) }));
  const after = (await call('/api/tickets')).data.tickets;
  assert.deepEqual(after.map(ticket => [ticket.id, ticket.status, ticket.created_at, ticket.updated_at]), before.map(ticket => [ticket.id, ticket.status, ticket.created_at, ticket.updated_at]));
  assert.ok(after.every(ticket => ticket.triage.needs_human === false));
  assert.match(after[0].edited_reply, /^new:/);
  assert.equal(after[1].edited_reply, manual);
  assert.match(after[2].edited_reply, /^new:/);
  assert.deepEqual((await call('/api/feedback')).data.feedback, feedbackBefore);
  assert.deepEqual(calls.map(entry => entry.history.length), [0, 1, 2]);
  assert.equal(calls[1].history[0].id, first.id);
  assert.equal(calls[0].input.created_at, undefined, 'server-generated display timestamp must not become inference metadata');
  assert.ok(calls.every(entry => !Object.hasOwn(entry.input, 'triage') && !Object.hasOwn(entry.input, 'status')));
  const persisted = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'));
  assert.equal(persisted.tickets[1].edited_reply, manual);
  assert.match(persisted.tickets[0].triage.draft_reply.text, /^new:/);
});

test('queue duplicate references preserve generated ids and survive refresh', async t => {
  const directory = mkdtempSync(join(testRoot, 'queue-duplicate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let { app, call } = await start(t, directory);
  const base = { kind: 'complaint', reporter_hash: 'synthetic-author', created_at: '2026-10-30T12:00:00Z', messages: [{ role: 'player', text: 'Arman_Demo оскорбил меня в чате' }] };
  const first = (await call('/api/tickets', { method: 'POST', body: base })).data.ticket;
  const second = (await call('/api/tickets', { method: 'POST', body: { ...base, created_at: '2026-10-30T12:15:00Z' } })).data.ticket;
  assert.equal(second.triage.is_spam_or_duplicate, true);
  assert.equal(second.triage.analysis.duplicate_of, first.id);
  await new Promise(resolve => app.close(resolve));
  ({ app, call } = await start(t, directory));
  const restored = (await call(`/api/tickets/${second.id}`)).data.ticket;
  assert.equal(restored.triage.is_spam_or_duplicate, true);
  assert.equal(restored.triage.analysis.duplicate_of, first.id);
});

test('HTTP and core share server metadata extraction and reject invalid metadata consistently', async t => {
  const { call } = await start(t);
  const engine = createEngine({ dataDir });
  const valid = { kind: 'report', server: '42', messages: [{ role: 'player', text: 'Что такое DM?', ts: '2026-10-30T12:00:00Z' }] };
  const direct = engine.triage(valid);
  const httpResult = await call('/triage', { method: 'POST', body: valid });
  assert.equal(httpResult.response.status, 200);
  assert.equal(direct.extracted.server, '42');
  assert.deepEqual(httpResult.data, direct);
  const invalid = [
    { ...valid, reporter_hash: { id: 'untrusted-object' } },
    { ...valid, region: [] },
    { ...valid, server: 42 },
    { ...valid, server: { number: 42 } },
    { ...valid, created_at: 'not-a-timestamp' },
    { ...valid, created_at: 123 },
    { ...valid, reported_nick: 'x'.repeat(257) },
    { ...valid, images_count: -1 },
    { ...valid, messages: [{ role: 'player', text: 'Что такое DM?', ts: 'not-a-timestamp' }] },
    { ...valid, messages: [{ role: 'player', text: 'Что такое DM?', attachments: '2' }] },
  ];
  for (const value of invalid) {
    assert.throws(() => engine.triage(value), { status: 400, code: 'INVALID_INPUT' });
    const result = await call('/triage', { method: 'POST', body: value });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, 'INVALID_INPUT');
  }
});
