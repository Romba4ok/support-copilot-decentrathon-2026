import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { platform, release, arch, cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createEngine, sanitizeInput } from '../src/core/engine.mjs';
import { createApp } from '../src/server.mjs';
import { classificationMetrics, latencySummary, summarizePredictions, ratio } from './evaluation-metrics.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
function put(path, value) { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, value, 'utf8'); }
function percentage(value) { return value === null || value === undefined ? 'не измеряется' : `${(value * 100).toFixed(2)}%`; }
function ms(value) { return value === null || value === undefined ? '—' : `${value.toFixed(3)} мс`; }
function countTable(counts) { return ['| Значение | Количество |','|---|---:|',...Object.entries(counts).sort(([a],[b]) => a.localeCompare(b)).map(([label,count]) => `| ${label} | ${count} |`)].join('\n'); }
function safeRuntimeCleanup(directory) { const allowed = resolve(root, 'runtime'); const target = resolve(directory); if (!target.startsWith(allowed + sep) || !target.slice(allowed.length + 1).startsWith('eval-http-')) throw new Error('Unsafe temporary runtime cleanup target'); rmSync(target, { recursive: true, force: true }); }

export function evaluateControl(engine, cases, sourceMap, categories, alwaysHuman) {
  const rows = cases.map(entry => {
    const actual = engine.triage(entry.input, { history: entry.history || [] });
    const mismatches = [];
    for (const [field, expected] of Object.entries(entry.expected || {})) {
      const observed = field === 'has_evidence' ? actual.extracted.has_evidence : field === 'normalized_contains' ? actual.analysis.normalized_text.includes(expected) : field === 'forbidden_cited' ? actual.draft_reply.cited.some(label => label.includes(expected)) : actual[field];
      const target = field === 'normalized_contains' ? true : field === 'forbidden_cited' ? false : expected;
      if (observed !== target) mismatches.push({ field, expected: target, actual: observed });
    }
    return { id: entry.id, expected: entry.expected || {}, actual, mismatches };
  });
  const integrity = summarizePredictions(rows.map(row => row.actual), sourceMap, categories, alwaysHuman);
  const mandatoryViolations = rows.filter(row => row.expected.needs_human === true && row.actual.needs_human !== true).map(row => row.id);
  return { rows, report: { description: 'Author-labelled synthetic smoke; not independent expert or Grand Mobile validation.', count: rows.length, category: classificationMetrics(rows, 'category'), priority: classificationMetrics(rows, 'priority'), language: classificationMetrics(rows, 'lang'), human_labelled_count: rows.filter(row => typeof row.expected.needs_human === 'boolean').length, human_accuracy: ratio(rows.filter(row => typeof row.expected.needs_human === 'boolean' && row.actual.needs_human === row.expected.needs_human).length, rows.filter(row => typeof row.expected.needs_human === 'boolean').length), all_expectations_pass: rows.filter(row => !row.mismatches.length).length, mismatches: rows.filter(row => row.mismatches.length).map(({ id, mismatches }) => ({ id, mismatches })), mandatory_human_violations: mandatoryViolations, integrity } };
}

async function benchmarkHttp(engine, inputRows, count = 100) {
  mkdirSync(join(root, 'runtime'), { recursive: true });
  const directory = mkdtempSync(join(root, 'runtime', 'eval-http-'));
  const started = performance.now();
  const server = createApp({ engine, runtimeDir: directory, seed: false });
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const startupMs = performance.now() - started;
    const address = `http://127.0.0.1:${server.address().port}/triage`;
    async function post(input) {
      const before = performance.now();
      const response = await fetch(address, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sanitizeInput(input)), signal: AbortSignal.timeout(15000) });
      const actual = await response.json();
      if (response.status !== 200) throw new Error(`HTTP benchmark failed: status ${response.status}`);
      return { elapsed: performance.now() - before, actual };
    }
    const first = await post(inputRows[0]);
    for (let index = 0; index < 10; index++) await post(inputRows[index % inputRows.length]);
    const samples = [], predictions = [];
    for (let index = 0; index < count; index++) { const item = await post(inputRows[index % inputRows.length]); samples.push(item.elapsed); predictions.push(item.actual); }
    return { report: { endpoint: 'POST /triage', transport: 'real HTTP loopback 127.0.0.1 with JSON request and response parsing', concurrency: 1, startup_ms: startupMs, first_request_ms: first.elapsed, warmup_requests_excluded: 10, measured_requests: count, input_selection: 'First 100 validation records in file order; sanitized player input only; non-persisting requests, no cross-request history.', warm: latencySummary(samples) }, predictions };
  } finally {
    await new Promise(accept => server.close(accept));
    safeRuntimeCleanup(directory);
  }
}

export async function runEvaluation({ inputPath = resolve(root, '../handout/tickets_valid.jsonl'), dataDir = process.env.DATA_DIR, httpCount = 100 } = {}) {
  if (!Number.isInteger(httpCount) || httpCount < 100) throw new Error('HTTP benchmark requires at least 100 measured requests');
  const lines = readFileSync(inputPath, 'utf8').split(/\r?\n/u).filter(line => line.trim());
  const records = lines.map((line, index) => { try { return JSON.parse(line); } catch { throw new Error(`Invalid input JSON on line ${index + 1}`); } });
  if (!records.length) throw new Error('Evaluation input is empty');
  const created = new Date();
  const environment = { timestamp_utc: created.toISOString(), local_time: new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(created), time_zone: 'Asia/Qyzylorda', node: process.version, platform: platform(), os_release: release(), arch: arch(), cpu_model: cpus()[0]?.model || 'unknown', logical_cpus: cpus().length };
  const initBefore = performance.now();
  const engine = createEngine({ dataDir });
  const initMs = performance.now() - initBefore;
  const sourceMap = new Map(engine.sources().map(source => [source.id, source]));
  const categories = new Set(engine.taxonomy.categories.map(category => category.code));
  const alwaysHuman = engine.taxonomy.needs_human_always || [];
  const coldBefore = performance.now(); engine.triage(records[0]); const coldMs = performance.now() - coldBefore;
  for (let index = 0; index < 20; index++) engine.triage(records[index % records.length]);
  const samples = [], predictions = [], historyByActor = new Map();
  let historyEligible = 0;
  for (const record of records) {
    const input = sanitizeInput(record);
    const history = input.reporter_hash ? historyByActor.get(input.reporter_hash) || [] : [];
    if (history.length && input.created_at) historyEligible++;
    const before = performance.now(); const prediction = engine.triage(input, { history }); samples.push(performance.now() - before); predictions.push(prediction);
    if (input.reporter_hash) { if (!historyByActor.has(input.reporter_hash)) historyByActor.set(input.reporter_hash, []); historyByActor.get(input.reporter_hash).push(input); }
  }
  const summary = summarizePredictions(predictions, sourceMap, categories, alwaysHuman);
  const labelledCategory = records.filter(record => typeof record.category === 'string').length;
  const labelledPriority = records.filter(record => typeof record.priority === 'string').length;
  const validation = { ...summary, input_count: records.length, category_ground_truth_count: labelledCategory, priority_ground_truth_count: labelledPriority, category_accuracy: null, priority_macro_f1: null, metric_note: 'Historical extracted verdict/punishment/violation and heuristic lang are not category/priority ground truth; no expert classification score is claimed.', history_policy: 'File order only; history contains sanitized previous records of the same actor, never future or admin/outcome data.', history_eligible_records: historyEligible, engine_init_ms: initMs, first_inference_ms: coldMs, warmup_requests_excluded: 20, warm_core: latencySummary(samples) };
  const fixtures = JSON.parse(readFileSync(join(root, 'fixtures/control.json'), 'utf8'));
  const control = evaluateControl(engine, fixtures.cases, sourceMap, categories, alwaysHuman);
  const http = await benchmarkHttp(engine, records, httpCount);
  const httpIntegrity = summarizePredictions(http.predictions, sourceMap, categories, alwaysHuman);
  const report = { environment, mode: engine.mode, sources: sourceMap.size, validation, synthetic_control: control.report, http: { ...http.report, integrity: httpIntegrity }, cost: { external_api_calls: 0, external_api_usd_per_ticket: 0, local_compute_cost_usd_per_ticket: null, note: 'No external provider is called. Local hardware, energy and operator labor are not priced.' }, limitations: ['Citation checks verify source existence, exact text, section namespace and labels; they do not establish semantic relevance.', 'No independent expert category/priority labels, administrator blind review or kk/uz native-speaker review are available.', 'Synthetic author labels check selected examples only; they are not a held-out representative quality estimate.', 'Confidence is heuristic, not a calibrated probability.', 'Cold engine initialization, first inference and warmed core timings are separate; HTTP measures sequential loopback on this machine, without production concurrency or network.', 'Priority follows approved content-risk policy: attachment count and claimed evidence alone do not prove violation or increase urgency. This resolves the source taxonomy/example inconsistency.'] };
  const privateDir = join(root, 'artifacts/private'); mkdirSync(privateDir, { recursive: true });
  put(join(privateDir,'validation.predictions.jsonl'),predictions.map((prediction,index) => JSON.stringify({row:index+1,ticket_id:records[index].ticket_id ?? null,prediction})).join('\n')+'\n');
  put(join(privateDir,'control.predictions.jsonl'),control.rows.map(row => JSON.stringify(row)).join('\n')+'\n');
  put(join(privateDir,'evaluation.metrics.json'),JSON.stringify(report,null,2)+'\n');
  const sampleIds = ['ru-insult','kk-payment','uz-insult'];
  const sampleDrafts = sampleIds.map(id => { const entry = fixtures.cases.find(item => item.id === id); const row = control.rows.find(item => item.id === id); return `### Синтетический пример ${id}\n\nАвторский вход: ${entry.input.messages[0].text}\n\nЧерновик (${row.actual.lang}; needs_human=${row.actual.needs_human}):\n\n${row.actual.draft_reply.text.split('\n').map(line => `> ${line}`).join('\n')}`; }).join('\n\n');
  const mismatchTable = control.report.mismatches.length ? ['| Авторский сценарий | Поле | Ожидалось | Получено |','|---|---|---|---|',...control.report.mismatches.flatMap(row => row.mismatches.map(mismatch => `| ${row.id} | ${mismatch.field} | ${String(mismatch.expected)} | ${String(mismatch.actual)} |`))].join('\n') : 'Все заданные ожидания авторского набора выполнены.';
  const document = `# Фактическая оценка Support Copilot\n\nЗапуск: ${environment.local_time} (${environment.time_zone}); UTC: ${environment.timestamp_utc}.\n\nСреда: Node ${environment.node}; ${environment.platform} ${environment.os_release} ${environment.arch}; CPU ${environment.cpu_model}, логических процессоров: ${environment.logical_cpus}. Режим: ${engine.mode}; источников правил: ${sourceMap.size}.\n\n## Предоставленная validation\n\nОбработано ${records.length} записей. Разметка category: ${labelledCategory}; priority: ${labelledPriority}. Accuracy и macro-F1 на этой выборке не заявляются: поля исхода из административного ответа не заменяют такую разметку. Исторический lang — эвристика и не используется как языковой gold standard.\n\nАдминистративные сообщения и поля исхода исключены allowlist перед inference. История: только уже обработанные записи того же автора в порядке файла; ${historyEligible} записей имели предыдущую историю и время. Оценка не использует train, в котором возможны пересечения с valid.\n\nЭскалация: ${summary.escalations}/${summary.count} (${percentage(summary.escalation_rate)}). Правила процитированы: ${summary.with_citations}/${summary.count} (${percentage(summary.citation_coverage)}); точная целостность цитат: ${summary.citation_valid}/${summary.citation_total} (${percentage(summary.citation_integrity_rate)}). Ошибок схемы: ${summary.schema_failures}; обращений с ошибками цитат: ${summary.grounding_failures}; нарушений обязательной эскалации по таксономии: ${summary.mandatory_human_violations}. Проверка цитат проверяет существование, точный текст, namespace раздела и связь cited с черновиком; семантическая релевантность автоматически не измерена.\n\n### Предсказанные категории\n\n${countTable(summary.counts.category)}\n\n### Предсказанные приоритеты\n\n${countTable(summary.counts.priority)}\n\n### Предсказанные языки\n\n${countTable(summary.counts.lang)}\n\n## Латентность и стоимость\n\nОдин процесс; операции последовательные. Инициализация корпуса: ${ms(initMs)}; первый inference до прогрева: ${ms(coldMs)}. Затем исключены 20 прогревающих вызовов. Измеренные core-вызовы: ${samples.length}; p50 ${ms(validation.warm_core.p50)}, p95 ${ms(validation.warm_core.p95)}, max ${ms(validation.warm_core.max)}. Парсинг JSONL, запись отчёта и sanitize вне core-замера, но ядро повторно применяет allowlist. Это локальные измерения, не производственный SLA.\n\nРеальный HTTP POST /triage на ephemeral loopback-порту: concurrency=1, seed=false. Запуск HTTP-сервера ${ms(http.report.startup_ms)}, первый запрос ${ms(http.report.first_request_ms)}; 10 прогревающих запросов исключены. Измерены ${httpCount} запросов по первым ${Math.min(httpCount,records.length)} validation-записям в порядке файла, без сохраняемой межзапросной истории. Включены сериализация входа, HTTP и чтение/парсинг ответа. p50 ${ms(http.report.warm.p50)}, p95 ${ms(http.report.warm.p95)}, max ${ms(http.report.warm.max)}. HTTP ошибок схемы: ${httpIntegrity.schema_failures}; ошибок целостности цитат: ${httpIntegrity.grounding_failures}.\n\nВнешних API-вызовов: 0. Стоимость внешних API на обращение: $0.000000. Стоимость локального оборудования, электричества и работы оператора не оценивалась. Порог p95<=5с ${http.report.warm.p95 <= 5000 ? 'выполнен в этом последовательном локальном замере' : 'не выполнен в этом замере'}.\n\n## Авторский синтетический smoke-набор\n\n${control.rows.length} вручную написанных сценариев; это не экспертная разметка Grand Mobile и не репрезентативная оценка на скрытом тесте. Набор покрывает все 14 категорий, 6 языков, cp1251, угрозы, платежи, взлом, апелляции, FAQ с риском, ложный пункт, injection, отсутствие доказательств и границы дедупликации. Ожидания заданы до запуска; пропущенные поля не входят в знаменатель. Macro-F1 — среднее по объединению ожидаемых и предсказанных классов среди размеченных строк.\n\n| Проверка | Размечено | Результат |\n|---|---:|---:|\n| Category accuracy | ${control.report.category.labelled_count} | ${percentage(control.report.category.accuracy)} |\n| Priority macro-F1 | ${control.report.priority.labelled_count} | ${percentage(control.report.priority.macro_f1)} |\n| Язык accuracy | ${control.report.language.labelled_count} | ${percentage(control.report.language.accuracy)} |\n| Needs human accuracy | ${control.report.human_labelled_count} | ${percentage(control.report.human_accuracy)} |\n| Сценарии со всеми ожиданиями | ${control.rows.length} | ${control.report.all_expectations_pass} |\n\n${mismatchTable}\n\nСогласованная политика срочности опирается на содержание и риски. Число вложений и заявление о доказательствах не устанавливают нарушение и сами по себе не повышают приоритет. Это явно выбранное разрешение противоречия taxonomy (жалоба с доказательствами p1) и примера задания (оскорбление с вложениями p2).\n\n## Примеры черновиков — только синтетические\n\n${sampleDrafts}\n\n## Ограничения и воспроизведение\n\n${report.limitations.map(value => `- ${value}`).join('\n')}\n\nЗапуск: npm run evaluate. Данные читаются из ../handout/tickets_valid.jsonl; DATA_DIR задаёт каталог rules.json/taxonomy.json. Необязательный --input задаёт другой приватный JSONL. В консоль и этот документ попадают только агрегаты и авторские синтетические примеры. Полные предсказания и JSON-метрики сохраняются только в исключённом artifacts/private/. Временный HTTP runtime удаляется после измерения.\n\nExit code 1 означает ошибку схемы/целостности цитат/обязательной эскалации; классификационные и языковые расхождения сообщаются отдельно без сокрытия. Не выполнены экспертная слепая оценка черновиков, оценка носителями kk/uz и нагрузочное тестирование с параллельными клиентами.\n`;
  put(join(root,'docs/evaluation.md'),document);
  const safetyFailures = summary.schema_failures + summary.grounding_failures + summary.mandatory_human_violations + control.report.integrity.schema_failures + control.report.integrity.grounding_failures + control.report.integrity.mandatory_human_violations + control.report.mandatory_human_violations.length + httpIntegrity.schema_failures + httpIntegrity.grounding_failures + httpIntegrity.mandatory_human_violations;
  return { report, safetyFailures, consoleSummary: { mode: engine.mode, validation_count: records.length, schema_failures: summary.schema_failures, grounding_failures: summary.grounding_failures, mandatory_human_violations: summary.mandatory_human_violations, escalation_rate: summary.escalation_rate, core_p95_ms: validation.warm_core.p95, http_count: httpCount, http_p95_ms: http.report.warm.p95, synthetic_count: control.rows.length, synthetic_category_accuracy: control.report.category.accuracy, synthetic_priority_macro_f1: control.report.priority.macro_f1, synthetic_mismatches: control.report.mismatches, safety_failures: safetyFailures, report: 'docs/evaluation.md', private_outputs: 'artifacts/private/' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((value,index) => !['--input'].includes(value) && args[index-1] !== '--input') || (args.includes('--input') && !args[args.indexOf('--input')+1])) { console.error('Usage: node scripts/evaluate.mjs [--input private-validation.jsonl]'); process.exitCode = 1; }
  else {
    try { const inputArgument = args.includes('--input') ? resolve(args[args.indexOf('--input')+1]) : undefined; const result = await runEvaluation({inputPath:inputArgument}); console.log(JSON.stringify(result.consoleSummary,null,2)); if (result.safetyFailures) process.exitCode = 1; }
    catch (error) { console.error(JSON.stringify({error:'Evaluation failed',type:error.name,message:error.code || 'Inspect local data/configuration; no player text is printed.'})); process.exitCode = 1; }
  }
}
