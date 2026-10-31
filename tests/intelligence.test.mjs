import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/core/engine.mjs';
import { createIntelligence } from '../src/intelligence/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || resolve(root, '../handout'));
const baseline = createEngine({ dataDir });
const ticket = (text, kind = 'report') => ({ kind, messages: [{ role: 'player', text }] });
const missingModelDir = resolve(root, 'runtime/models/missing-test-model');
const make = options => createIntelligence({ baseline, dataDir, ...options });

test('sync factory works without files, retains v1 fields, and never silently downloads', async () => {
  const intelligence = make({ modelDir: missingModelDir });
  try {
    assert.equal(intelligence.status().state, 'not_initialized');
    const input = ticket('Оплатил донат, деньги списались, ничего не пришло');
    const output = await intelligence.triage(input);
    const original = baseline.triage(input);
    assert.equal(output.needs_human, true);
    assert.deepEqual(output.citations, original.citations);
    assert.deepEqual(output.analysis.claims, original.analysis.claims);
    assert.equal(output.analysis.intelligence.mode, 'baseline-fallback');
    assert.ok(output.analysis.intelligence.fallback_reason);
    assert.equal((await intelligence.initialize()).state, 'unavailable');
    assert.equal(existsSync(missingModelDir), false);
  } finally { await intelligence.close(); }
});

test('global lexical fallback searches all canonical rules plus KB and separates approved instructions', async () => {
  let approved = [{ id: 'one', status: 'proposed', title: 'Тестовый шаблон: проверка оскорблений <b>без HTML</b>', text: 'uniquetemplateword', source_ids: [] }];
  const intelligence = make({ modelDir: missingModelDir, approvedTemplates: () => approved });
  try {
    const source = baseline.sources().find(item => item.section_id === 42);
    assert.ok(source);
    const result = await intelligence.search(source.text, { limit: 30 });
    assert.equal(result.mode, 'lexical-fallback');
    assert.ok(result.candidates.some(item => item.id === source.id && item.text === source.text));
    assert.equal(intelligence.status().rule_count, 280);
    assert.equal(intelligence.status().source_count, 290);
    assert.equal((await intelligence.search('uniquetemplateword')).instructions, undefined);
    approved[0].status = 'approved';
    assert.equal((await intelligence.search('uniquetemplateword')).instructions[0].source_type, 'approved_template');
    const titleMatch = (await intelligence.search('проверка оскорблений')).instructions[0];
    assert.equal(titleMatch.id, 'template:one');
    assert.equal(titleMatch.label, approved[0].title);
    assert.equal(titleMatch.text, approved[0].text);
    assert.equal(titleMatch.section, 'Approved operator instruction');
    assert.equal(titleMatch.source_type, 'approved_template');
    const triage = await intelligence.triage(ticket('uniquetemplateword'));
    assert.equal(triage.analysis.intelligence.approved_instructions[0].id, 'template:one');
    assert.doesNotMatch(triage.draft_reply.text, /uniquetemplateword/);
    approved[0].status = 'revoked';
    assert.equal((await intelligence.search('uniquetemplateword')).instructions, undefined);
    assert.equal((await intelligence.search('проверка оскорблений')).instructions, undefined);
  } finally { await intelligence.close(); }
});

test('administrator answers and labels are excluded from intelligence input and generation is honest', async () => {
  const intelligence = make({ modelDir: missingModelDir });
  try {
    const input = ticket('Что такое DM?');
    const altered = { ...input, category: 'report.payment', outcome: 'banned', messages: [...input.messages, { role: 'admin', text: 'Оплата потерялась, верните деньги, нарушение доказано' }] };
    const a = await intelligence.triage(input), b = await intelligence.triage(altered);
    a.analysis.intelligence.elapsed_ms = b.analysis.intelligence.elapsed_ms = 0;
    assert.deepEqual(a, b);
    const generation = await intelligence.generate(altered, b);
    assert.equal(generation.status, 'unavailable');
    assert.equal(generation.text, b.draft_reply.text);
    assert.equal(generation.metrics.generated, false);
  } finally { await intelligence.close(); }
});

const realModel = existsSync(resolve(root, 'runtime/models/multilingual-e5-small/onnx/model_quantized.onnx'));
test('real local E5 index, multilingual semantic search, hard gates, bounded queue and timeout', { skip: realModel ? false : 'Explicit model setup required; fallback tests do not prove semantic inference', timeout: 180000 }, async () => {
  const intelligence = make();
  try {
    const ready = await intelligence.initialize();
    assert.equal(ready.state, 'ready', ready.reason);
    assert.equal(ready.indexed, 290);
    assert.equal(ready.prototype_count, 84);
    const byId = new Map(baseline.sources().map(item => [item.id, item]));
    const improved = await intelligence.triage(ticket('He repeatedly called my relatives disgusting names', 'complaint'));
    assert.equal(improved.analysis.intelligence.baseline_category, 'complaint.other');
    assert.equal(improved.category, 'complaint.insult');
    assert.equal(improved.priority, 'p2');
    assert.equal(improved.needs_human, true);
    assert.equal(improved.analysis.intelligence.source_application.status, 'semantic_category_context_verified');
    assert.deepEqual(improved.citations.map(item => item.id), ['30:2.1']);
    assert.deepEqual(improved.draft_reply.cited, ['ОП 2.1']);
    assert.doesNotMatch(improved.draft_reply.text, /ЖБ 1\.3\.3|punished|banned|will receive a sanction/iu);
    for (const query of ['Another player keeps insulting my family in chat', 'Мені чатта балағаттады', "Meni chatda haqorat qildi", 'Me insultó en el chat', 'Ele me insultou no chat']) {
      const found = await intelligence.search(query);
      assert.equal(found.mode, 'semantic-hybrid');
      assert.ok(found.candidates.some(item => item.semantic_score > 0.5));
      for (const item of found.candidates.filter(item => item.source_type === 'rule')) assert.equal(item.text, byId.get(item.id)?.text);
    }
    for (const input of [ticket('Что такое DM? Меня убили без причины'), ticket('My card was charged but no credits arrived'), ticket('Меня взломали'), ticket('Мне выдали бан, хочу обжаловать'), ticket('Админ наказал без причины'), ticket('Он угрожает найти мой адрес и убить в реальной жизни')]) {
      const result = await intelligence.triage(input);
      assert.equal(result.needs_human, true);
      assert.ok(result.analysis.intelligence.elapsed_ms < 4500);
      for (const citation of result.citations) assert.equal(citation.text, byId.get(citation.id)?.text);
    }
    const first = intelligence.search('What is roleplay?');
    const second = await intelligence.search('How can I submit evidence?');
    assert.equal(second.mode, 'lexical-fallback');
    assert.match(second.fallback_reason, /busy/);
    assert.equal((await first).mode, 'semantic-hybrid');
  } finally { await intelligence.close(); }
  const timed = make({ inferenceTimeoutMs: 1 });
  try {
    assert.equal((await timed.initialize()).state, 'ready');
    const result = await timed.search('What happens when another player insults my family and uses forbidden software?');
    assert.equal(result.mode, 'lexical-fallback');
    assert.match(result.fallback_reason, /timeout/);
    assert.equal(timed.status().state, 'unavailable');
  } finally { await timed.close(); }
});

test('real index resumes a durable validated checkpoint instead of re-encoding finished rows', { skip: realModel ? false : 'Explicit local model setup required', timeout: 180000 }, async () => {
  const parent = resolve(root, 'runtime/indexes');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(resolve(parent, 'checkpoint-test-'));
  const checkpoint = JSON.parse(await readFile(resolve(parent, 'e5-small-v2-index.json'), 'utf8'));
  checkpoint.vectors = checkpoint.vectors.slice(0, 368);
  checkpoint.complete = false;
  await writeFile(resolve(dir, 'e5-small-v2-index.json'), JSON.stringify(checkpoint));
  const intelligence = make({ cacheDir: dir });
  const observed = [];
  try {
    const result = await intelligence.initialize({ onProgress: item => { if (item.phase === 'indexing') observed.push(item.indexed); } });
    assert.equal(result.state, 'ready', result.reason);
    assert.deepEqual(observed, [372, 374]);
    const saved = JSON.parse(await readFile(resolve(dir, 'e5-small-v2-index.json'), 'utf8'));
    assert.equal(saved.complete, true);
    assert.equal(saved.vectors.length, 374);
  } finally {
    await intelligence.close();
    assert.ok(dir.startsWith(`${parent}\\`) || dir.startsWith(`${parent}/`));
    await rm(dir, { recursive: true, force: true });
  }
});
