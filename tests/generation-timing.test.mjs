import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntelligence } from '../src/intelligence/index.mjs';
import { applyGenerationProjection, bindGenerationBasis } from '../src/intelligence/draft.mjs';
import { buildGenerationInput, renderPlan } from '../src/intelligence/generation-contract.mjs';

const input = { kind: 'report', lang: 'en', messages: [{ role: 'player', text: 'Hello!' }] };
const result = () => ({ lang: 'en', category: 'report.question', priority: 'p3', needs_human: false, citations: [], reasons: [], draft_reply: { text: 'Safe original', lang: 'en', cited: [] }, analysis: { normalized_text: 'hello' } });
function setup(t, { selection = 12.4, native = 10.4, unavailable = false, budget = 60000 } = {}) {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const advance = value => { clock += value; };
  const baseline = { sources: () => [], triage: () => Object.defineProperty(result(), 'selection_cost', { enumerable: true, get() { advance(selection); return 'authored clone overhead'; } }) };
  let executions = 0;
  const intelligence = createIntelligence({ baseline, generatorConfig: { enabled: true, timeoutMs: budget }, generatorFactory: () => ({ status: () => ({ enabled: true }), close: async () => {}, generate: async (raw, basis) => {
    executions++; advance(native);
    if (unavailable) return { status: 'unavailable', reason: 'authored fake unavailable', text: 'Safe original', metrics: { generated: false, executed: false, elapsed_ms: Math.round(native) } };
    const context = buildGenerationInput(raw, basis, []), plan = { schema_version: 'support-plan-v1', focus: context.allowed_focuses[0], fact_ids: context.facts.map(fact => fact.id), request_fields: [...context.missing_fields], source_ids: [], needs_human: context.needs_human };
    return { status: 'generated', lang: context.lang, plan, ...renderPlan(plan, context), metrics: { generated: true, executed: true, elapsed_ms: Math.round(native) } };
  } }) });
  t.after(() => intelligence.close());
  return { intelligence, advance, executions: () => executions };
}
function coherent(metrics) {
  for (const key of ['preparation_ms', 'elapsed_ms', 'total_elapsed_ms']) assert.ok(Number.isInteger(metrics[key]) && metrics[key] >= 0, key);
  assert.ok(Math.abs(metrics.total_elapsed_ms - metrics.preparation_ms - metrics.elapsed_ms) <= 1, `same-boundary rounding: ${metrics.preparation_ms}+${metrics.elapsed_ms} vs ${metrics.total_elapsed_ms}`);
}
function projectionOverhead(target, advance) {
  const analysis = target.analysis;
  Object.defineProperty(target, 'analysis', { enumerable: true, get() { advance(5.6); return analysis; } });
}

test('generation timing charges delayed basis selection to preparation before native admission', async t => {
  const { intelligence, executions } = setup(t);
  const generation = await intelligence.generate(input, result());
  assert.equal(executions(), 1);
  assert.ok(generation.metrics.preparation_ms >= 12, 'clone/selection work is inside preparation');
  coherent(generation.metrics);
});

test('external accepted projection republishes phases at one common monotonic end including fractional overhead', async t => {
  const { intelligence, advance } = setup(t, { selection: .49, native: 10.49 });
  const target = result(), generation = await intelligence.generate(input, target), initial = generation.metrics.total_elapsed_ms;
  projectionOverhead(target, advance);
  applyGenerationProjection(target, generation, []);
  assert.equal(generation.status, 'generated');
  assert.equal(target.draft_reply.text, generation.text);
  assert.ok(generation.metrics.total_elapsed_ms >= initial + 10, 'projection overhead is observed');
  coherent(generation.metrics);
});

test('unavailable projection counts its overhead without changing fallback acceptance or content', async t => {
  const { intelligence, advance } = setup(t, { unavailable: true });
  const target = result(), generation = await intelligence.generate(input, target), initial = generation.metrics.total_elapsed_ms;
  projectionOverhead(target, advance);
  applyGenerationProjection(target, generation, []);
  assert.equal(generation.status, 'unavailable'); assert.equal(generation.metrics.generated, false);
  assert.equal(target.draft_reply.text, 'Safe original'); assert.equal(target.needs_human, false);
  assert.ok(generation.metrics.total_elapsed_ms > initial, 'failed fallback projection is timed too');
  coherent(generation.metrics);
});

test('selection exhausting preparation skips model execution and publishes coherent zero-native timing', async t => {
  const { intelligence, executions } = setup(t, { selection: 4401 });
  const generation = await intelligence.generate(input, result());
  assert.equal(executions(), 0); assert.equal(generation.metrics.generated, false); assert.equal(generation.status, 'unavailable');
  assert.equal(generation.metrics.elapsed_ms, 0); coherent(generation.metrics);
});

test('timing callbacks come only from the code WeakMap and callback errors are not suppressed', () => {
  const target = result(), generation = { status: 'unavailable', text: 'Safe original', publishTiming: 'untrusted payload', metrics: { generated: false } };
  let invoked = 0;
  const bound = bindGenerationBasis(generation, input, result(), [], performance.now(), { publishTiming: () => { invoked++; throw new Error('authored timing publisher failure'); } });
  assert.throws(() => applyGenerationProjection(target, bound, []), /authored timing publisher failure/);
  assert.equal(invoked, 1);
  assert.equal(target.draft_reply.text, 'Safe original');
  assert.equal(bound.publishTiming, 'untrusted payload', 'serialized payload is not executable timing code');
  assert.throws(() => bindGenerationBasis(generation, input, result(), [], performance.now(), { publishTiming: 'not code' }), TypeError);
});

test('actual delayed cloning overhead is measured even when the fake provider has zero inference work', async t => {
  const baseline = { sources: () => [], triage: () => Object.defineProperty(result(), 'selection_cost', { enumerable: true, get() {
    const until = performance.now() + 10;
    while (performance.now() < until) { /* bounded synthetic selection work */ }
    return 'actual authored clone overhead';
  } }) };
  const intelligence = createIntelligence({ baseline, generatorFactory: () => ({ status: () => ({}), close: async () => {}, generate: async () => ({ status: 'unavailable', text: 'Safe original', metrics: { generated: false, elapsed_ms: 0 } }) }) });
  t.after(() => intelligence.close());
  const generation = await intelligence.generate(input, result());
  assert.ok(generation.metrics.preparation_ms >= 9, 'real clone cost belongs to preparation');
  coherent(generation.metrics);
});
