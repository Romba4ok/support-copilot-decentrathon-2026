import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createStore } from '../src/storage.mjs';
import { createWorkspace, parseImport } from '../src/workspace/index.mjs';
import { createEngine } from '../src/core/engine.mjs';
import { comparisonMetrics } from '../src/workspace/metrics.mjs';

const root = fileURLToPath(new URL('./.tmp/', import.meta.url));
mkdirSync(root, { recursive: true });
const engine = createEngine({ dataDir: resolve(process.env.DATA_DIR || fileURLToPath(new URL('../../handout/', import.meta.url))) });
const sample = { kind: 'report', messages: [{ role: 'player', text: 'Что такое DM?' }] };
async function finished(workspace, id) {
  for (let i = 0; i < 100; i++) { const job = workspace.jobs().find(item => item.id === id); if (['completed', 'failed', 'interrupted'].includes(job.status)) return job; await delay(5); }
  throw new Error('Job did not finish');
}
function setup(t, options = {}) {
  const runtimeDir = mkdtempSync(join(root, 'workspace-')), store = createStore({ runtimeDir });
  let workspace;
  const addTicket = async (input, id) => store.transact(state => { const ticket = { id, input, triage: engine.triage(input), status: 'open', edited_reply: 'manual' }; state.tickets.push(ticket); return ticket; });
  workspace = createWorkspace({ runtimeDir, store, engine, analyze: async input => engine.triage(input), addTicket, ...options });
  t.after(async () => { await workspace.close(); rmSync(runtimeDir, { recursive: true, force: true }); });
  return { workspace, runtimeDir, store, addTicket };
}

test('import allowlist removes outcomes/admin labels and rejects filesystem and oversized records', () => {
  assert.deepEqual(parseImport({ jsonl: JSON.stringify({ ...sample, labels: { category: 'gold' }, outcome: 'SECRET', messages: [...sample.messages, { role: 'admin', text: 'PRIVATE_ADMIN' }] }) }), [sample]);
  assert.throws(() => parseImport({ path: 'C:/private.jsonl' }), { status: 400 });
  assert.throws(() => parseImport({ tickets: [sample], jsonl: '{}' }), { status: 400 });
  assert.throws(() => parseImport({ tickets: Array(1001).fill(sample) }), { status: 400 });
});

test('import resumes exactly once after a crash between durable ticket and cursor writes', async t => {
  const { workspace, store } = setup(t);
  const job = workspace.importTickets([sample, sample]);
  await workspace.close(); // pending job remains resumable, as after power interruption
  assert.equal(workspace.jobs()[0].status, 'interrupted');
  const runtimeDir = resolve(workspace.db.stateFile, '..');
  // Simulate the queue write having committed before the cursor checkpoint.
  store.transact(state => { state.tickets.push({ id: `${job.id}:0`, input: sample, triage: engine.triage(sample) }); });
  const resumed = createWorkspace({ runtimeDir, store, engine, analyze: async input => engine.triage(input), addTicket: async (input, id) => store.transact(state => { state.tickets.push({ id, input, triage: engine.triage(input) }); }) });
  t.after(() => resumed.close());
  assert.equal(resumed.jobs()[0].resumable, true);
  resumed.resumeJob(job.id);
  const done = await finished(resumed, job.id);
  assert.equal(done.status, 'completed'); assert.equal(done.processed, 2);
  assert.equal(store.snapshot().tickets.length, 2);
  assert.equal(new Set(store.snapshot().tickets.map(item => item.id)).size, 2);
  assert.ok(!Object.hasOwn(done, 'payload'));
});

test('running checkpoint is recovered as interrupted and damaged files are preserved', t => {
  const { workspace, store, runtimeDir } = setup(t);
  workspace.db.transact(state => { state.jobs.push({ id: 'power-loss', type: 'initialize', status: 'running', processed: 2, total: 10, payload: {}, resumable: false }); });
  const restored = createWorkspace({ runtimeDir, store, engine, analyze: input => engine.triage(input), addTicket: async () => {} });
  assert.equal(restored.jobs()[0].status, 'interrupted'); assert.equal(restored.jobs()[0].processed, 2); assert.equal(restored.jobs()[0].resumable, true);
});

test('quality requires explicit human labels, null denominators and identical safe comparison input', async t => {
  const calls = [];
  const { workspace, addTicket, runtimeDir } = setup(t, { analyze: async input => { calls.push(structuredClone(input)); return engine.triage(input); } });
  await addTicket(sample, 'one');
  assert.equal(workspace.quality().metrics.v2.category_accuracy.value, null);
  assert.equal(workspace.quality().provenance.human, 0);
  const annotation = workspace.annotate({ ticket_id: 'one', category: 'report.question', priority: 'p3', needs_human: false, auto_eligible: true, lang: 'ru', relevant_source_ids: ['43:DM'] });
  assert.equal(annotation.provenance, 'human');
  assert.throws(() => workspace.annotate({ ticket_id: 'one', category: 'wrong' }), { status: 400 });
  assert.throws(() => workspace.annotate({ ticket_id: 'one', provenance: 'synthetic', priority: 'p3' }), { status: 400 });
  const { comparison, metrics } = await workspace.compare({ ticket_ids: ['one'] });
  assert.deepEqual(calls, [sample]); assert.deepEqual(comparison.rows[0].input, sample);
  assert.equal(metrics.v2.category_accuracy.value, 1); assert.equal(metrics.v2.category_accuracy.denominator, 1);
  assert.equal(metrics.v2.risk_recall.value, null); assert.equal(metrics.v2.auto_coverage.value, 1);
  assert.equal(metrics.slices.kk.v2.category_accuracy.value, null);
  assert.match(readFileSync(join(runtimeDir, 'workspace.json'), 'utf8'), /human_reviewed/);
});

test('template approval is explicit; editing requires a new approval and revoke removes active instruction', t => {
  const { workspace } = setup(t);
  const template = workspace.propose({ title: 'Справка', text: 'Попросить уточнить сервер.', lang: 'ru', category: 'report.question', source_ids: ['43:DM'] });
  assert.equal(template.status, 'proposed'); assert.equal(workspace.approvedTemplates().length, 0);
  workspace.patchTemplate(template.id, { action: 'approve' }); assert.equal(workspace.approvedTemplates().length, 1);
  workspace.patchTemplate(template.id, { action: 'edit', text: 'Уточнить время.' }); assert.equal(workspace.approvedTemplates().length, 0);
  workspace.patchTemplate(template.id, { action: 'approve' }); workspace.patchTemplate(template.id, { action: 'revoke' });
  assert.equal(workspace.approvedTemplates().length, 0); assert.equal(workspace.templates()[0].history.length, 5);
  assert.throws(() => workspace.propose({ title: 'x', text: 'x', lang: 'ru', source_ids: ['fake:1'] }), { status: 400 });
});

test('lexical radar groups actual repeated issues without marking them duplicates', async t => {
  const { workspace, addTicket } = setup(t);
  await addTicket(sample, 'first'); await addTicket(sample, 'second');
  await addTicket({ kind: 'report', messages: [{ role: 'player', text: 'Оплата не пришла на аккаунт' }] }, 'different');
  assert.equal((await finished(workspace, workspace.startJob('radar').id)).status, 'completed');
  const radar = workspace.radar();
  assert.equal(radar.stats.method, 'lexical'); assert.equal(radar.clusters[0].count, 2); assert.equal(radar.clusters[0].duplicate, false);
});

test('citation integrity checks the canonical namespace and text rather than trusting a plausible reference', () => {
  const baseline = engine.triage(sample), v2 = structuredClone(baseline);
  v2.citations[0].section_id = 'fabricated-section';
  const metrics = comparisonMetrics([{ input: sample, labels: {}, baseline, v2, baseline_elapsed_ms: 1, v2_elapsed_ms: 1 }], engine.sources());
  assert.equal(metrics.baseline.citation_integrity.value, 1);
  assert.equal(metrics.v2.citation_integrity.value, 0);
  assert.equal(metrics.v2.source_relevance.value, null);
});

test('radar records lexical fallback when a ready model cannot supply semantic retrieval', async t => {
  const { workspace, addTicket } = setup(t, { intelligence: { status: () => ({ state: 'ready' }), search: async () => ({ mode: 'lexical-fallback', candidates: [], fallback_reason: 'busy' }) } });
  await addTicket(sample, 'first'); await addTicket(sample, 'second');
  await finished(workspace, workspace.startJob('radar').id);
  assert.equal(workspace.radar().stats.method, 'lexical');
  assert.equal(workspace.radar().clusters[0].method, 'lexical');
});

test('priority macro F1 fraction uses classes while labelled sample count remains explicit', () => {
  const result = engine.triage(sample);
  const row = priority => ({ input: sample, labels: { priority }, baseline: structuredClone(result), v2: structuredClone(result), baseline_elapsed_ms: 1, v2_elapsed_ms: 1 });
  const perfect = comparisonMetrics(Array.from({ length: 5 }, () => row('p3')), engine.sources()).v2.priority_macro_f1;
  assert.equal(perfect.value, 1); assert.equal(perfect.numerator, 1); assert.equal(perfect.denominator, 1); assert.equal(perfect.labelled_count, 5);
  const imbalanced = comparisonMetrics([row('p3'), row('p3'), row('p3'), row('p3'), row('p0')], engine.sources()).v2.priority_macro_f1;
  assert.equal(imbalanced.denominator, 2); assert.equal(imbalanced.labelled_count, 5); assert.equal(imbalanced.classes, 2);
  assert.ok(Math.abs(imbalanced.value - 4 / 9) < 1e-12);
  assert.equal(imbalanced.value, imbalanced.numerator / imbalanced.denominator);
});

test('semantic radar separates payment and account issues despite identical sources while grouping related payments', async t => {
  const { workspace, addTicket, store } = setup(t, { intelligence: { status: () => ({ state: 'ready' }), search: async () => ({ mode: 'semantic-hybrid', candidates: [{ id: '30:1.4', semantic_score: .95 }, { id: 'kb:account', semantic_score: .95 }] }) } });
  const payment = await addTicket({ kind: 'report', messages: [{ role: 'player', text: 'Pagué una compra y no recibí los créditos' }] }, 'payment-es');
  const account = await addTicket({ kind: 'report', messages: [{ role: 'player', text: 'Minha conta foi invadida e não consigo entrar' }] }, 'account-pt');
  const related = await addTicket({ kind: 'report', messages: [{ role: 'player', text: 'Оплатил донат, деньги списались, ничего не пришло' }] }, 'payment-ru');
  assert.equal(payment.triage.category, 'report.payment'); assert.equal(account.triage.category, 'report.account'); assert.equal(related.triage.category, 'report.payment');
  await finished(workspace, workspace.startJob('radar').id);
  let clusters = workspace.radar().clusters;
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.find(item => item.count === 2).ticket_ids.sort(), ['payment-es', 'payment-ru']);
  assert.equal(clusters.find(item => item.count === 2).method, 'semantic-source-affinity');
  assert.deepEqual(clusters.find(item => item.count === 1).ticket_ids, ['account-pt']);
  // A model category suggestion must not collapse the baseline payment family.
  store.transact(state => { const ticket = state.tickets.find(item => item.id === 'payment-es'); ticket.triage.analysis.intelligence = { baseline_category: 'report.payment' }; ticket.triage.category = 'report.account'; });
  await finished(workspace, workspace.startJob('radar').id);
  clusters = workspace.radar().clusters;
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.find(item => item.count === 2).ticket_ids.sort(), ['payment-es', 'payment-ru']);
});
