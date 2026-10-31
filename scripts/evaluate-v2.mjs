import { readFileSync, writeFileSync, mkdirSync, appendFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release, totalmem, freemem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createEngine } from '../src/core/engine.mjs';
import { createRetriever } from '../src/core/retrieval.mjs';
import { createIntelligence } from '../src/intelligence/index.mjs';
import { createApp } from '../src/server.mjs';
import { latencySummary } from './evaluation-metrics.mjs';
import { preparePairs, labelledMetrics, predictionChanges, modes, retrievalMetrics, integrity } from './evaluation-v2-metrics.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
function put(path, value) { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(`${path}.tmp`, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); renameSync(`${path}.tmp`, path); }
const elapsed = before => performance.now() - before;
const count = (rows, field) => Object.fromEntries([...new Set(rows.map(item => item[field]))].map(value => [String(value), rows.filter(item => item[field] === value).length]));
function sourcesFor(engine) {
  const knowledge = JSON.parse(readFileSync(join(root, 'data/knowledge.json'), 'utf8')).entries;
  return [...engine.sources().map(item => ({ ...item, source_type: 'rule' })), ...knowledge.map(item => ({ id: `kb:${item.id}`, section_id: 'kb', section: 'Curated support guidance', ref: item.id, label: item.title, text: item.text, source_type: 'knowledge' }))];
}

/** Windows OS working sets include the isolated native ONNX worker. Samples are outside latency intervals. */
export function createMemorySampler() {
  let childIds = [], samples = [], error = null;
  function sample(phase, discover = false) {
    try {
      if (platform() === 'win32') {
        if (discover) {
          const found = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${process.pid}' | Where-Object { $_.Name -eq 'node.exe' } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
          const value = found ? JSON.parse(found) : []; childIds = Array.isArray(value) ? value : [value];
        }
        const ids = [process.pid, ...childIds];
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64) | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
        const parsed = output ? JSON.parse(output) : [];
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const parent = rows.find(item => item.Id === process.pid)?.WorkingSet64 ?? null;
        const children = rows.filter(item => childIds.includes(item.Id));
        samples.push({ phase, parent_rss_bytes: parent, worker_rss_bytes: children.reduce((sum, item) => sum + item.WorkingSet64, 0), combined_rss_bytes: rows.reduce((sum, item) => sum + item.WorkingSet64, 0), worker_process_count: children.length, free_system_bytes: freemem() });
      } else { samples.push({ phase, parent_rss_bytes: process.memoryUsage().rss, worker_rss_bytes: null, combined_rss_bytes: null, free_system_bytes: freemem() }); }
    } catch (caught) { error = caught.code || caught.name; }
  }
  return { sample, report: () => ({ method: 'OS working-set snapshots before/after initialize and every 100 requests; not continuous peak; parent plus direct node children', child_pids: childIds, sample_count: samples.length, peak_sampled_parent_rss_bytes: samples.length ? Math.max(...samples.map(item => item.parent_rss_bytes || 0)) : null, peak_sampled_worker_rss_bytes: childIds.length ? Math.max(...samples.map(item => item.worker_rss_bytes || 0)) : null, peak_sampled_combined_rss_bytes: childIds.length ? Math.max(...samples.map(item => item.combined_rss_bytes || 0)) : null, min_sampled_free_system_bytes: samples.length ? Math.min(...samples.map(item => item.free_system_bytes)) : null, error, samples }) };
}

export async function authorRegression(engine, intelligence, fixture) {
  const arms = { baseline: [], v2: [] }, mismatch = { baseline: [], v2: [] };
  for (const item of fixture.cases) {
    const pair = preparePairs([item.input])[0];
    const history = (item.history || []).map(input => preparePairs([input])[0].input);
    const actual = { baseline: engine.triage(pair.input, { history }), v2: await intelligence.triage(pair.input, { history }) };
    for (const arm of Object.keys(arms)) {
      arms[arm].push(actual[arm]);
      const errors = [];
      for (const [field, expected] of Object.entries(item.expected || {})) {
        const observed = field === 'has_evidence' ? actual[arm].extracted.has_evidence : field === 'normalized_contains' ? actual[arm].analysis.normalized_text.includes(expected) : field === 'forbidden_cited' ? actual[arm].draft_reply.cited.some(label => label.includes(expected)) : actual[arm][field];
        const target = field === 'normalized_contains' ? true : field === 'forbidden_cited' ? false : expected;
        if (observed !== target) errors.push({ field, expected: target, observed });
      }
      if (errors.length) mismatch[arm].push({ id: item.id, errors });
    }
  }
  const provenance = 'authored_synthetic_regression';
  const annotations = fixture.cases.map((item, index) => ({ row: index + 1, labels: item.expected || {}, provenance }));
  return { predictions: arms, report: { count: fixture.cases.length, provenance, human_reviewed: false, description: 'Existing authored regression; previously used during development, not unseen or independent expert gold.', ...Object.fromEntries(Object.keys(arms).map(arm => [arm, { metrics: labelledMetrics(arms[arm], annotations, provenance), all_expectations_pass: fixture.cases.length - mismatch[arm].length, mismatches: mismatch[arm], integrity: integrity(arms[arm], engine), modes: modes(arms[arm]) }])) } };
}

export async function httpBenchmark(engine, intelligence, pairs, directory, sampler, checkpoint) {
  const before = performance.now();
  const server = createApp({ engine, intelligence, runtimeDir: directory, seed: false });
  let listening = false;
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { listening = true; accept(); }); });
    const startupMs = elapsed(before), url = `http://127.0.0.1:${server.address().port}/triage`;
    async function post(input) {
      const started = performance.now();
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
      const prediction = await response.json();
      return { elapsed_ms: elapsed(started), status: response.status, prediction };
    }
    const first = await post(pairs[0].input);
    for (let index = 0; index < 20; index++) await post(pairs[index % pairs.length].input);
    const samples = [], predictions = [], errors = [];
    for (const pair of pairs) {
      const result = await post(pair.input); samples.push(result.elapsed_ms); predictions.push(result.prediction);
      if (result.status !== 200) errors.push({ row: pair.row, status: result.status });
      appendFileSync(join(checkpoint, 'http.predictions.jsonl'), JSON.stringify({ row: pair.row, ...result }) + '\n');
      if (pair.row % 100 === 0) { sampler.sample(`http-${pair.row}`); put(join(checkpoint, 'progress.json'), { phase: 'http', processed: pair.row, total: pairs.length }); }
    }
    const latency = latencySummary(samples);
    return { predictions, report: { endpoint: 'POST /triage', transport: 'actual loopback HTTP JSON serialization, request, response read and parse', concurrency: 1, startup_ms: startupMs, first_request_ms: first.elapsed_ms, warmup_excluded: 20, measured_requests: pairs.length, input_selection: 'Every validation row once in file order. Sanitized input; empty isolated store, no persisted cross-request history. Direct paired comparison below uses identical prior-actor history in both arms.', latency, p95_under_5000ms: latency.p95 <= 5000, http_errors: errors, modes: modes(predictions), integrity: integrity(predictions, engine) } };
  } finally { if (listening) await new Promise(accept => server.close(accept)); }
}

export async function runEvaluationV2({ inputPath = resolve(root, '../handout/tickets_valid.jsonl'), holdoutPath = join(root, 'fixtures/retrieval-holdout-v2.json'), dataDir = process.env.DATA_DIR } = {}) {
  const inputBytes = readFileSync(inputPath), records = inputBytes.toString('utf8').split(/\r?\n/u).filter(line => line.trim()).map((line, index) => { try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on input row ${index + 1}`); } });
  if (!records.length) throw new Error('Evaluation input is empty');
  // Freeze holdout bytes and checksum before any evaluated model call.
  const holdoutBytes = readFileSync(holdoutPath), holdout = JSON.parse(holdoutBytes), frozenAt = new Date().toISOString();
  if (!holdout.provenance || !Array.isArray(holdout.cases) || !holdout.cases.length) throw new Error('Holdout must have explicit provenance and cases');
  const runId = new Date().toISOString().replace(/[:.]/gu, '-');
  const privateDir = join(root, 'artifacts/private/v2-evaluation', runId), runtime = join(root, 'runtime/evaluation-v2', runId);
  mkdirSync(privateDir, { recursive: true }); mkdirSync(runtime, { recursive: true });
  const pairs = preparePairs(records), sampler = createMemorySampler();
  const initBaseline = performance.now(), engine = createEngine({ dataDir }), baselineInitMs = elapsed(initBaseline);
  const intelligence = createIntelligence({ baseline: engine, dataDir, cacheDir: join(root, 'runtime/indexes') });
  const fullSources = sourcesFor(engine), sourceMap = new Map(fullSources.map(item => [item.id, item]));
  // Validate exact canonical namespaces before initialization, including KB IDs.
  retrievalMetrics(holdout.cases.map(item => ({ ...item, candidate_ids: [] })), sourceMap, holdout.provenance);
  put(join(privateDir, 'frozen-holdout.json'), holdoutBytes.toString('utf8'));
  put(join(privateDir, 'progress.json'), { phase: 'initializing', processed: 0, total: pairs.length, holdout_sha256: hash(holdoutBytes), frozen_before_evaluation_at: frozenAt });
  sampler.sample('before-initialize');
  try {
    const initStarted = performance.now(), initialized = await intelligence.initialize(), initializationMs = elapsed(initStarted);
    sampler.sample('after-initialize', true);
    const baseline = [], v2 = [], baselineTimes = [], v2Times = [];
    for (const pair of pairs) {
      let start = performance.now(); const first = engine.triage(pair.input, { history: pair.history }); baselineTimes.push(elapsed(start));
      start = performance.now(); const second = await intelligence.triage(pair.input, { history: pair.history }); v2Times.push(elapsed(start));
      baseline.push(first); v2.push(second);
      appendFileSync(join(privateDir, 'paired.predictions.jsonl'), JSON.stringify({ row: pair.row, baseline: first, v2: second }) + '\n');
      if (pair.row % 100 === 0) { sampler.sample(`paired-${pair.row}`); put(join(privateDir, 'progress.json'), { phase: 'paired', processed: pair.row, total: pairs.length }); }
    }
    const control = await authorRegression(engine, intelligence, JSON.parse(readFileSync(join(root, 'fixtures/control.json'), 'utf8')));
    put(join(privateDir, 'control.predictions.json'), control.predictions);
    const lexical = createRetriever(fullSources), retrievalRows = { lexical_global: [], hybrid: [] };
    for (const item of holdout.cases) {
      const found = await intelligence.search(item.query, { limit: 8 });
      retrievalRows.lexical_global.push({ id: item.id, lang: item.lang, expected_source_ids: item.expected_source_ids, candidate_ids: lexical(item.query, { limit: 8 }).map(source => source.id) });
      retrievalRows.hybrid.push({ id: item.id, lang: item.lang, expected_source_ids: item.expected_source_ids, candidate_ids: found.candidates.map(source => source.id), mode: found.mode, fallback_reason: found.fallback_reason });
    }
    put(join(privateDir, 'retrieval.predictions.json'), retrievalRows);
    const retrieval = { provenance: holdout.provenance, human_reviewed: holdout.human_reviewed === true, frozen_before_evaluation_at: frozenAt, fixture_sha256: hash(holdoutBytes), corpus_source_count: fullSources.length, selection: 'Identical global rule+curated-KB corpus; exact expected canonical IDs; no allowed-ID or generic-KB masking; no tuning on this result.', ...Object.fromEntries(Object.entries(retrievalRows).map(([arm, rows]) => [arm, { ...retrievalMetrics(rows, sourceMap, holdout.provenance), language_slices: Object.fromEntries([...new Set(rows.map(item => item.lang))].map(lang => [lang, retrievalMetrics(rows.filter(item => item.lang === lang), sourceMap, holdout.provenance)])), ...(arm === 'hybrid' ? { mode_counts: count(rows, 'mode') } : {}) }])) };
    const http = await httpBenchmark(engine, intelligence, pairs, join(runtime, 'http'), sampler, privateDir);
    sampler.sample('after-http');
    const report = { version: 2, run_id: runId, environment: { timestamp_utc: new Date().toISOString(), node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, logical_cpus: cpus().length, total_system_bytes: totalmem() }, validation: { count: pairs.length, source_category_fields: records.filter(item => typeof item.category === 'string').length, source_priority_fields: records.filter(item => typeof item.priority === 'string').length, labels: 'No independently supplied category/priority/risk/auto-eligibility/relevance labels. Original lang is heuristic metadata, not gold. Administrative outcomes are excluded.', input_sha256: hash(inputBytes), history_policy: 'Both direct arms receive the same sanitizeInput allowlist and previous same-actor sanitized records in file order; no future/admin/outcome/labels.', history_rows: pairs.filter(pair => pair.history.length && pair.input.created_at).length, baseline: { integrity: integrity(baseline, engine), metrics: labelledMetrics(baseline), latency: latencySummary(baselineTimes) }, v2: { integrity: integrity(v2, engine), metrics: labelledMetrics(v2), latency: latencySummary(v2Times), modes: modes(v2) }, changes: predictionChanges(baseline, v2), metadata_language_slices: Object.fromEntries(['kk', 'uz'].map(lang => { const indices = records.map((item, index) => item.lang === lang ? index : -1).filter(index => index >= 0); return [lang, { provenance: 'source_heuristic_language_metadata_not_gold', count: indices.length, baseline_human: indices.filter(index => baseline[index].needs_human).length, v2_human: indices.filter(index => v2[index].needs_human).length }]; })) }, initialization: { baseline_ms: baselineInitMs, intelligence_wall_ms: initializationMs, status: initialized, note: 'Existing index cache; initialization is separate from measured warmed HTTP. Direct comparison starts immediately after initialization; no hidden direct warmup.' }, author_regression: control.report, retrieval_holdout: retrieval, http: http.report, memory: sampler.report(), cost: { external_api_calls: 0, external_api_usd: 0, local_compute_usd: null }, generator: { enabled: false, executed: false, reason: 'Optional generator remains off after separate 0/8 acceptance benchmark; /triage does not generate.' }, limitations: ['No expert quality, real-validation accuracy, risk recall, auto precision/coverage or manual citation relevance can be claimed without corresponding labels.', 'Author regression is development regression; retrieval holdout is authored and not native-speaker/expert reviewed. Misses remain reported.', 'Citation integrity verifies exact canonical source existence/text/namespace, not relevance.', 'Sequential local HTTP is not concurrency/load or external-network SLA. Memory maxima are sampled, not continuous.', 'Original validation language values are metadata; kk/uz gold evaluation exists only in authored fixtures.'] };
    const armFailures = value => value.schema_failures + value.grounding_failures + value.mandatory_human_violations;
    const riskFailures = arm => arm.metrics.risk_recall.denominator - arm.metrics.risk_recall.numerator;
    report.safety_failures = armFailures(report.validation.baseline.integrity) + armFailures(report.validation.v2.integrity) + armFailures(report.author_regression.baseline.integrity) + armFailures(report.author_regression.v2.integrity) + riskFailures(report.author_regression.baseline) + riskFailures(report.author_regression.v2) + armFailures(report.http.integrity) + report.http.http_errors.length;
    report.semantic_requirement_met = initialized.state === 'ready' && report.validation.v2.modes.counts['semantic-hybrid'] > 0 && report.retrieval_holdout.hybrid.mode_counts['semantic-hybrid'] === holdout.cases.length;
    put(join(privateDir, 'changed-rows.json'), pairs.filter((pair, index) => ['category', 'priority', 'lang', 'needs_human', 'is_spam_or_duplicate'].some(field => baseline[index][field] !== v2[index][field])).map(pair => ({ row: pair.row, changed_fields: ['category', 'priority', 'lang', 'needs_human', 'is_spam_or_duplicate'].filter(field => baseline[pair.row - 1][field] !== v2[pair.row - 1][field]) })));
    const recoveryPath = join(root, 'artifacts/private/v2-evaluation/recovery-report.json');
    if (existsSync(recoveryPath)) {
      const recovery = JSON.parse(readFileSync(recoveryPath, 'utf8'));
      report.recovery = { provenance: recovery.provenance, real_data_used: recovery.real_data_used, model_loaded: recovery.model_loaded, expected_imports: recovery.expected_imports, interruption: { durable_imports_after_kill: recovery.interruption?.durable_imports_after_kill, durable_cursor: recovery.interruption?.durable_cursor, durable_job_status: recovery.interruption?.durable_job_status, signal: recovery.interruption?.forced_exit?.signal }, resume_ms: recovery.resume_ms, result: recovery.result };
    }
    put(join(privateDir, 'metrics.json'), report); put(join(privateDir, 'progress.json'), { phase: 'complete', processed: pairs.length, total: pairs.length, safety_failures: report.safety_failures });
    put(join(root, 'runtime/evaluation-v2/latest.json'), { run_id: runId, metrics_path: join(privateDir, 'metrics.json') });
    put(join(root, 'docs/evaluation-v2.md'), renderReport(report));
    return report;
  } finally { await intelligence.close(); }
}

export function renderReport(report) {
  const value = metric => metric.value === null ? `null (${metric.numerator}/${metric.denominator})` : `${(metric.value * 100).toFixed(2)}% (${metric.numerator}/${metric.denominator})`;
  const row = (name, arm) => `| ${name} | ${arm.integrity.escalations}/${arm.integrity.count} | ${arm.integrity.citation_valid}/${arm.integrity.citation_total} | ${arm.integrity.schema_failures} | ${arm.integrity.grounding_failures} |`;
  const labelledRows = ['category_accuracy', 'priority_macro_f1', 'risk_recall', 'auto_precision', 'auto_coverage', 'citation_relevance_precision'];
  const text = `# Фактическая оценка v2\n\nЗапуск ${report.run_id}, ${report.environment.node}, ${report.environment.cpu}. Реальный E5 ONNX int8: ${report.initialization.status.state}; initialize ${report.initialization.intelligence_wall_ms.toFixed(1)} мс (существующий приватный cache); генератор выключен.\n\n## Реальные validation: ${report.validation.count}\n\nОба direct arm получили одинаковый sanitizeInput и предыдущую историю того же автора (${report.validation.history_rows} записей с историей и временем); admin/outcome/labels исключены. Полей category в исходнике: ${report.validation.source_category_fields}; priority: ${report.validation.source_priority_fields}. Независимый gold не предоставлен. Исторический lang — эвристические metadata.\n\n| Arm | Передано человеку | Точные цитаты | Ошибки схемы | Ошибки grounding |\n|---|---:|---:|---:|---:|\n${row('baseline', report.validation.baseline)}\n${row('v2', report.validation.v2)}\n\nИзменения: ${JSON.stringify(report.validation.changes)}. V2 режимы: ${JSON.stringify(report.validation.v2.modes)}.\n\nПредсказанные распределения (не accuracy):\n\n\`\`\`json\n${JSON.stringify({ baseline: report.validation.baseline.integrity.counts, v2: report.validation.v2.integrity.counts, kk_uz_metadata: report.validation.metadata_language_slices }, null, 2)}\n\`\`\`\n\n| Метрика на real valid | baseline | v2 |\n|---|---:|---:|\n${labelledRows.map(name => `| ${name} | ${value(report.validation.baseline.metrics[name])} | ${value(report.validation.v2.metrics[name])} |`).join('\n')}\n\nНет нужных меток: нулевой знаменатель означает null. Все метрики содержат numerator/denominator/provenance; macro-F1 знаменатель — объединение ожидаемых/предсказанных классов, numerator — сумма F1 классов.\n\n## Настоящий HTTP\n\nPOST /triage на отдельном ephemeral localhost, seed=false, приватный отдельный runtime, concurrency=1. Все ${report.http.measured_requests} validation-запросов один раз; JSON serialization/transport/read/parse включены. Store пуст: этот HTTP замер без истории между запросами. First request ${report.http.first_request_ms.toFixed(1)} мс и 20 warmup отдельно. Измеренные p50=${report.http.latency.p50.toFixed(1)} мс, p95=${report.http.latency.p95.toFixed(1)} мс, max=${report.http.latency.max.toFixed(1)} мс; p95<=5000: ${report.http.p95_under_5000ms}. Ошибок HTTP ${report.http.http_errors.length}; режимы/fallback: ${JSON.stringify(report.http.modes)}. Initialization не спрятана в latency.\n\nПамять по OS working sets parent+worker: sampled max parent ${report.memory.peak_sampled_parent_rss_bytes} B, worker ${report.memory.peak_sampled_worker_rss_bytes} B, combined ${report.memory.peak_sampled_combined_rss_bytes} B; samples ${report.memory.sample_count}; min sampled free ${report.memory.min_sampled_free_system_bytes} B. Это дискретные снимки каждые 100 записей, не непрерывный пик.\n\n## Авторский regression\n\n${report.author_regression.count} сценариев из существующего control.json; provenance=${report.author_regression.provenance}; не unseen и не экспертный gold. All expectations baseline ${report.author_regression.baseline.all_expectations_pass}/${report.author_regression.count}, v2 ${report.author_regression.v2.all_expectations_pass}/${report.author_regression.count}.\n\n| Метрика | baseline | v2 |\n|---|---:|---:|\n${['category_accuracy', 'priority_macro_f1', 'language_accuracy', 'risk_recall', 'auto_precision', 'auto_coverage'].map(name => `| ${name} | ${value(report.author_regression.baseline.metrics[name])} | ${value(report.author_regression.v2.metrics[name])} |`).join('\n')}\n\nРасхождения авторских ожиданий: ${JSON.stringify({ baseline: report.author_regression.baseline.mismatches, v2: report.author_regression.v2.mismatches })}.\n\n## Отдельный retrieval holdout\n\n${report.retrieval_holdout.hybrid.count} запросов; provenance=${report.retrieval_holdout.provenance}; human_reviewed=${report.retrieval_holdout.human_reviewed}; SHA256=${report.retrieval_holdout.fixture_sha256}; заморожен ${report.retrieval_holdout.frozen_before_evaluation_at} до evaluated inference. Global lexical и hybrid используют те же ${report.retrieval_holdout.corpus_source_count} источников. Exact canonical IDs с namespace; generic KB не подменяет expected rule. Никакой настройки по результату.\n\n| Метрика | Global lexical | Hybrid E5 |\n|---|---:|---:|\n${['hit_at_1', 'hit_at_3', 'hit_at_8', 'mrr_at_8', 'expected_recall_at_8'].map(name => `| ${name} | ${value(report.retrieval_holdout.lexical_global[name])} | ${value(report.retrieval_holdout.hybrid[name])} |`).join('\n')}\n\nMiss IDs lexical: ${JSON.stringify(report.retrieval_holdout.lexical_global.misses)}; hybrid: ${JSON.stringify(report.retrieval_holdout.hybrid.misses)}.\n\nПо языкам (авторские метки; не оценка носителями):\n\n| Язык | n | Lexical hit@8 | Hybrid hit@8 |\n|---|---:|---:|---:|\n${Object.entries(report.retrieval_holdout.hybrid.language_slices).map(([lang, metrics]) => `| ${lang} | ${metrics.count} | ${value(report.retrieval_holdout.lexical_global.language_slices[lang].hit_at_8)} | ${value(metrics.hit_at_8)} |`).join('\n')}\n\n## Воспроизведение и ограничения\n\nКоманда: \`node scripts/evaluate-v2.mjs\` (или \`--input <private.jsonl>\`). Модель заранее локально установлена; автоматической загрузки нет. Приватные результаты/checkpoints: \`artifacts/private/v2-evaluation/<run-id>/\`; изолированный пустой HTTP runtime: \`runtime/evaluation-v2/<run-id>/http/\`. \`runtime/evaluation-v2/latest.json\` указывает на actual report. Скрипт не меняет основной state.json и не использует train. Полные prediction/failure rows остаются приватными.\n\n${report.limitations.map(item => `- ${item}`).join('\n')}\n\nSafety failures: ${report.safety_failures}. External API calls: 0, API cost $0; локальная стоимость не оценивалась. Benchmark не запускает генератор или GPU training. Checkpoint recovery проверяется отдельным main-owned script; здесь сохраняется прогресс выполнения, resume этого benchmark не заявляется.\n`;
  return text + (report.recovery ? `\n## Отдельная проверка восстановления\n\n\`node scripts/check-recovery-v2.mjs\`: ${report.recovery.result.status}; provenance=${report.recovery.provenance}; только авторская синтетика, без real data/model. Процесс импортера фактически прерван ${report.recovery.interruption.signal} после durable cursor ${report.recovery.interruption.durable_cursor}/${report.recovery.expected_imports}; сохранённый job=${report.recovery.interruption.durable_job_status}. Повтор той же команды возобновил импорт за ${report.recovery.resume_ms} мс: ${report.recovery.result.imported} imported + 1 seed = ${report.recovery.result.tickets} unique; повторно добавлено ${report.recovery.result.repeat_added}. Operator edit/escalated status/feedback/annotation сохранены; admin/outcome исключены. Отдельный первый probe с частым открытием файла наблюдал Windows EPERM rename; гипотеза конкурирующего чтения подтверждается успешным stat-only probe. Ошибка и данные сохранены приватно; это не скрытый PASS первого запуска. Основной runtime не изменён.\n` : '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--input')) { console.error('Usage: node scripts/evaluate-v2.mjs [--input private.jsonl]'); process.exitCode = 1; }
  else try { const report = await runEvaluationV2(args.length ? { inputPath: resolve(args[1]) } : {}); console.log(JSON.stringify({ run_id: report.run_id, validation_count: report.validation.count, modes: report.validation.v2.modes, http: { measured_requests: report.http.measured_requests, latency: report.http.latency, modes: report.http.modes }, memory: { parent: report.memory.peak_sampled_parent_rss_bytes, worker: report.memory.peak_sampled_worker_rss_bytes, combined: report.memory.peak_sampled_combined_rss_bytes }, safety_failures: report.safety_failures, semantic_requirement_met: report.semantic_requirement_met, report: 'docs/evaluation-v2.md' }, null, 2)); if (report.safety_failures || !report.semantic_requirement_met || !report.http.p95_under_5000ms) process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({ error: 'V2 evaluation failed; inspect private progress, no ticket text printed', type: error.name, code: error.code || null, stack_location: error.stack?.split('\n')[1]?.trim() })); process.exitCode = 1; }
}
