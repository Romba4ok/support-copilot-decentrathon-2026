import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/core/engine.mjs';
import { preparePairs, labelledMetrics, retrievalMetrics, predictionChanges } from '../scripts/evaluation-v2-metrics.mjs';
import { httpBenchmark } from '../scripts/evaluate-v2.mjs';

const input = text => ({ kind: 'report', reporter_hash: 'synthetic-actor', created_at: '2026-10-30T12:00:00Z', messages: [{ role: 'player', text }] });
const predicted = (category, priority, needs_human) => ({ category, priority, needs_human, citations: [] });
const provenance = 'authored_synthetic_test';

test('both arms share sanitized historical input without outcomes, labels, admin or future records', () => {
  const raw = [input('hello'), input('What is RP?')];
  raw[0].messages.push({ role: 'admin', text: 'SECRET ADMIN OUTCOME' });
  Object.assign(raw[0], { category: 'report.payment', priority: 'p0', verdict: 'SECRET VERDICT', labels: { category: 'report.payment' }, expected: { priority: 'p0' } });
  const pairs = preparePairs(raw);
  assert.equal(pairs[0].history.length, 0); assert.equal(pairs[1].history.length, 1);
  assert.equal(pairs[1].history[0], pairs[0].input);
  assert.equal(JSON.stringify(pairs).includes('SECRET'), false);
  for (const key of ['category', 'priority', 'verdict', 'labels', 'expected']) assert.equal(Object.hasOwn(pairs[0].input, key), false);
  assert.equal(pairs[0].input.messages.length, 1);
  assert.equal(raw[0].messages.length, 2);
});

test('missing labels produce null with zero denominators; only explicit auto eligibility counts', () => {
  const predictions = [predicted('report.question', 'p3', false), predicted('report.payment', 'p0', true)];
  const metrics = labelledMetrics(predictions);
  for (const name of ['category_accuracy', 'priority_macro_f1', 'risk_recall', 'auto_precision', 'auto_coverage', 'citation_relevance_precision']) {
    assert.equal(metrics[name].value, null); assert.equal(metrics[name].denominator, 0); assert.equal(metrics[name].provenance, 'unavailable');
  }
  const explicitHuman = labelledMetrics(predictions, [{ row: 1, labels: { needs_human: false }, provenance }], provenance);
  assert.equal(explicitHuman.auto_precision.denominator, 0);
  assert.equal(explicitHuman.human_accuracy.value, 1);
});

test('partial labels use different precision, coverage and risk denominators; macro F1 includes extra predicted classes', () => {
  const predictions = [predicted('a', 'p0', false), predicted('b', 'p2', false), predicted('c', 'p3', true), predicted('c', 'p3', false)];
  const annotations = [
    { row: 1, labels: { category: 'a', priority: 'p0', needs_human: false, auto_eligible: true }, provenance },
    { row: 2, labels: { category: 'c', priority: 'p1', needs_human: true, auto_eligible: false }, provenance },
    { row: 3, labels: { needs_human: true, auto_eligible: true }, provenance },
  ];
  const metrics = labelledMetrics(predictions, annotations, provenance);
  assert.deepEqual([metrics.category_accuracy.numerator, metrics.category_accuracy.denominator], [1, 2]);
  assert.equal(metrics.priority_macro_f1.denominator, 3); assert.equal(metrics.priority_macro_f1.value, 1 / 3);
  assert.deepEqual([metrics.risk_recall.numerator, metrics.risk_recall.denominator], [1, 2]);
  assert.deepEqual([metrics.auto_precision.numerator, metrics.auto_precision.denominator], [1, 2]);
  assert.deepEqual([metrics.auto_coverage.numerator, metrics.auto_coverage.denominator], [1, 2]);
  assert.throws(() => labelledMetrics(predictions, [annotations[0], annotations[0]], provenance), /duplicate/u);
  assert.throws(() => labelledMetrics(predictions, [{ ...annotations[0], provenance: 'human' }], provenance), /provenance/u);
});

test('retrieval matches exact canonical namespace, does not grant a generic KB or wrong-section rule a hit', () => {
  const sources = new Map(['30:1.1', '31:1.1', 'kb:general'].map(id => [id, { id }]));
  const rows = [
    { id: 'wrong-section', expected_source_ids: ['30:1.1'], candidate_ids: ['31:1.1', 'kb:general'] },
    { id: 'third', expected_source_ids: ['30:1.1'], candidate_ids: ['kb:general', '31:1.1', '30:1.1'] },
  ];
  const metrics = retrievalMetrics(rows, sources, provenance);
  assert.equal(metrics.hit_at_1.value, 0); assert.equal(metrics.hit_at_3.value, 0.5);
  assert.equal(metrics.hit_at_8.value, 0.5); assert.equal(metrics.mrr_at_8.value, 1 / 6);
  assert.deepEqual(metrics.misses, ['wrong-section']);
  assert.throws(() => retrievalMetrics([{ expected_source_ids: ['1.1'], candidate_ids: [] }], sources, provenance), /canonical/u);
  assert.throws(() => retrievalMetrics([{ expected_source_ids: ['30:1.1'], candidate_ids: ['99:invented'] }], sources, provenance), /unknown canonical/u);
});

test('citation relevance counts only citations on explicitly labelled rows', () => {
  const predictions = [{ ...predicted('a', 'p0', true), citations: [{ id: '30:1.1' }, { id: '31:1.1' }] }, { ...predicted('a', 'p0', true), citations: [{ id: '30:1.1' }] }];
  const metrics = labelledMetrics(predictions, [{ row: 1, provenance, labels: { relevant_source_ids: ['30:1.1'] } }], provenance);
  assert.deepEqual([metrics.citation_relevance_precision.numerator, metrics.citation_relevance_precision.denominator], [1, 2]);
  assert.throws(() => predictionChanges(predictions, []), /counts/u);
});

test('frozen independent retrieval fixture has 24 distinct canonical targets and six languages', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/retrieval-holdout-v2.json', import.meta.url), 'utf8'));
  assert.equal(fixture.provenance, 'authored_synthetic_independent_control'); assert.equal(fixture.human_reviewed, false);
  assert.equal(fixture.cases.length, 24); assert.equal(new Set(fixture.cases.map(item => item.id)).size, 24);
  assert.deepEqual([...new Set(fixture.cases.map(item => item.lang))].sort(), ['en', 'es', 'kk', 'pt', 'ru', 'uz']);
  const engine = createEngine(), sources = new Map(engine.sources().map(item => [item.id, item]));
  for (const item of fixture.cases) { assert.ok(item.query.trim()); assert.ok(item.rationale.trim()); for (const id of item.expected_source_ids) assert.ok(sources.has(id), id); }
});

test('actual isolated HTTP benchmark includes every row and counts fallback without touching main state', async () => {
  const parent = resolve(fileURLToPath(new URL('../runtime/evaluation-v2', import.meta.url)));
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'test-http-'));
  const engine = createEngine(); let calls = 0;
  const intelligence = { triage: async (clean, { history }) => {
    assert.equal(history.length, 0); assert.equal(Object.hasOwn(clean, 'verdict'), false);
    const result = engine.triage(clean, { history }); calls++;
    result.analysis.intelligence = { version: 'v2', mode: 'baseline-fallback', fallback_reason: 'synthetic unavailable model' }; return result;
  } };
  try {
    const pairs = preparePairs([input('What is RP?'), input('Hello'), input('What is DM?')]);
    const result = await httpBenchmark(engine, intelligence, pairs, join(directory, 'http'), { sample: () => {} }, directory);
    assert.equal(result.report.measured_requests, 3); assert.equal(result.report.latency.count, 3);
    assert.equal(calls, 24); assert.equal(result.report.modes.counts['baseline-fallback'], 3);
    assert.equal(result.report.modes.fallback_reasons['synthetic unavailable model'], 3);
    assert.equal(result.report.http_errors.length, 0); assert.equal(result.report.integrity.schema_failures, 0);
    assert.equal(JSON.parse(readFileSync(join(directory, 'http/state.json'), 'utf8')).tickets.length, 0);
  } finally { const target = resolve(directory); assert.ok(target.startsWith(parent + sep) && target.slice(parent.length + 1).startsWith('test-http-')); rmSync(target, { recursive: true, force: true }); }
});
