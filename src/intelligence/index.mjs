import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createEngine, sanitizeInput } from '../core/engine.mjs';
import { createRetriever } from '../core/retrieval.mjs';
import { replies } from '../core/language.mjs';
import { createLocalGenerator } from './generator.mjs';
import { codeContextDraft, applyGenerationProjection, bindGenerationBasis } from './draft.mjs';

export const MODEL = 'Xenova/multilingual-e5-small';
const root = fileURLToPath(new URL('../../', import.meta.url));
const errorText = error => String(error?.message || error).slice(0, 500);
const humanCategories = new Set(['report.payment', 'report.account', 'report.complaint', 'complaint.admin']);
// Verified against canonical source text, not the taxonomy's historical shorthand.
const applicableSources = {
  'complaint.insult': ['30:2.1', '30:2.4', '30:2.6'],
  'complaint.cheat': ['30:5.2'],
  'complaint.dm': ['43:DM', '32:1.1', '30:5.3', '30:5.4'],
  'complaint.scam': ['30:4.1', '30:4.2'],
  'complaint.rmt_ads': ['30:2.3', '30:4.4'],
  'complaint.admin': ['30:3.4', '31:1.3.1'],
  'report.account': ['30:1.4'],
};

/** No model download or inference occurs at construction or before initialize(). */
export function createIntelligence({ baseline, dataDir, modelDir = resolve(root, 'runtime/models/multilingual-e5-small'), cacheDir = resolve(root, 'runtime/indexes'), generatorConfig, draftMode = 'fast', generatorFactory = createLocalGenerator, approvedTemplates = () => [], inferenceTimeoutMs = 4300, embeddingFork = fork } = {}) {
  if (!['fast', 'native'].includes(draftMode)) throw new Error('draftMode must be fast or native');
  if (draftMode === 'native' && generatorConfig?.enabled !== true) throw new Error('Native triage drafts require an explicitly enabled generator');
  if (draftMode === 'native' && (generatorConfig.focusMode !== 'model' || !generatorConfig.activationManifestPath || generatorConfig.requiredActivationScope !== 'operator-generation')) throw new Error('Native triage drafts require model focus and operator-generation activation');
  baseline ||= createEngine({ dataDir });
  const rules = baseline.sources().map(source => ({ ...source, source_type: 'rule' }));
  const knowledge = JSON.parse(readFileSync(new URL('../../data/knowledge.json', import.meta.url), 'utf8')).entries;
  const sources = [...rules, ...knowledge.map(entry => ({ id: `kb:${entry.id}`, section_id: 'kb', section: 'Curated support guidance', ref: entry.id, label: entry.title, text: entry.text, source_type: 'knowledge' }))];
  const retrieve = createRetriever(sources);
  const intents = JSON.parse(readFileSync(new URL('../../data/intents.json', import.meta.url), 'utf8'));
  let state = { mode: 'baseline-fallback', state: 'not_initialized', model: MODEL, dimensions: 384, dtype: 'q8', max_tokens: 256, pooling: 'mean', normalized: true, retrieval: '0.85*cosine + 0.15*normalized_BM25*query_term_coverage', source_count: sources.length, rule_count: rules.length, indexed: 0, reason: 'Initialization has not been requested' };
  let worker = null, serial = 0, active = null, initializing = null, closed = false;
  let generationBusy = false, restoreEmbedding = false, closing = null;
  let workerIncarnation = null;
  const retiringWorkers = new Map();
  const routedRestoreToken = Symbol('code-owned-routed-restore');
  function exitOwned(old, deadline, incarnation = workerIncarnation) {
    if (!old) return Promise.resolve();
    const existing = retiringWorkers.get(old);
    if (existing) { if (Number.isFinite(deadline) && deadline - performance.now() < 1000) old.kill('SIGKILL'); return existing.promise; }
    let resolveExit, force, poll, done = false;
    const promise = new Promise(accept => { resolveExit = accept; });
    retiringWorkers.set(old, { incarnation, promise, pid: old.pid });
    const finish = () => { if (done) return; done = true; clearTimeout(force); clearInterval(poll); old.removeListener('exit', finish); old.removeListener('close', finish); retiringWorkers.delete(old); resolveExit(); };
    old.once('exit', finish); old.once('close', finish);
    const exited = () => old.exitCode !== null && old.exitCode !== undefined || old.signalCode !== null && old.signalCode !== undefined;
    if (exited()) finish();
    else {
      old.kill('SIGTERM');
      if (done) return promise;
      force = setTimeout(() => old.kill('SIGKILL'), Math.max(0, Math.min(1000, Number.isFinite(deadline) ? deadline - performance.now() : 1000)));
      poll = setInterval(() => { if (exited()) finish(); }, 20);
    }
    return promise;
  }
  const preparationBudgetMs = 4400;
  const generationBudgetMs = Math.max(1, Math.min(60000, Number(generatorConfig?.timeoutMs) || 60000));
  const nativeBudgetMs = Math.max(1, generationBudgetMs - preparationBudgetMs);
  const generator = generatorFactory({ config: generatorConfig ? { ...generatorConfig, timeoutMs: nativeBudgetMs } : generatorConfig, canonicalSources: rules,
    resourceState: () => ({ main_state: state.state, main_pid: worker?.pid || null, main_incarnation: workerIncarnation, retiring_pid: [...retiringWorkers.values()][0]?.pid || null, retiring_pids: [...retiringWorkers.values()].map(v => v.pid), retiring_instances: [...retiringWorkers.values()].map(({pid,incarnation}) => ({pid,incarnation})), model_dir: resolve(modelDir), cache_dir: resolve(cacheDir), index_fingerprint: state.index_fingerprint || null }),
    acquireResources: async ({ signal, deadline, strictRouted = false } = {}) => {
      if (active || initializing) throw new Error('Embedding operation is busy; generation was not queued');
      if (strictRouted && (signal?.aborted || !Number.isFinite(deadline) || performance.now() >= deadline)) throw new Error('Routed resource acquisition deadline');
      generationBusy = true;
      restoreEmbedding = state.state === 'ready';
      if (strictRouted) await Promise.all([...retiringWorkers.keys()].map(old => exitOwned(old, deadline)));
      const before = { main_was_ready: restoreEmbedding, pause_actual_exit_verified: false, paused_pid: worker?.pid || null, paused_incarnation: workerIncarnation };
      if (strictRouted && worker && generatorConfig?.releaseEmbedding === false) { generationBusy = false; restoreEmbedding = false; throw new Error('Routed inference requires exclusive model release'); }
      if (worker && generatorConfig?.releaseEmbedding !== false) {
        const old = worker; worker = null;
        if (strictRouted) { await exitOwned(old, deadline); before.pause_actual_exit_verified = true; }
        else await new Promise(accept => { old.once('exit', accept); old.kill(); });
        state = { ...state, mode: 'baseline-fallback', state: 'paused', reason: 'Embedding paused for local generation' };
      }
      if (strictRouted && (signal?.aborted || performance.now() >= deadline)) throw new Error('Routed resource acquisition deadline');
      return before;
    },
    releaseResources: async ({ closing: generatorClosing = false, deadline, signal, strictRouted = false } = {}) => {
      if (strictRouted) {
        const required = restoreEmbedding && !closed && !generatorClosing;
        const result = { restore_required: required, restored: false, ready_verified: false, restored_pid: null };
        try {
          if (required) {
            if (signal?.aborted || !Number.isFinite(deadline) || deadline - performance.now() <= 1500) { state = { ...state, state: 'unavailable', mode: 'baseline-fallback', reason: signal?.aborted ? 'Required embedding restore aborted' : 'No bounded restore budget remains' }; throw new Error('Required embedding restore has no bounded budget or was aborted'); }
            state = { ...state, state: 'not_initialized', reason: 'Restoring embedding after routed plan' };
            await initialize({ deadline, signal, _routedRestore: routedRestoreToken });
            if (signal?.aborted || state.state !== 'ready' || !worker || performance.now() >= deadline) throw new Error('Required embedding restore did not become ready within deadline');
            Object.assign(result, { restored: true, ready_verified: true, restored_pid: worker.pid });
          }
          return result;
        } catch (error) {
          if (required) {
            const failedRestore = worker; worker = null;
            state = { ...state, state: 'unavailable', mode: 'baseline-fallback', reason: errorText(error) };
            if (failedRestore) await exitOwned(failedRestore, deadline);
            await Promise.all([...retiringWorkers.values()].map(row => row.promise));
          }
          throw error;
        } finally { restoreEmbedding = false; generationBusy = false; }
      }
      generationBusy = false;
      if (restoreEmbedding && !closed && generatorConfig?.releaseEmbedding !== false) {
        state = { ...state, state: 'not_initialized', reason: 'Restoring embedding after local generation' };
        await initialize();
      }
      restoreEmbedding = false;
    },
  });
  const status = () => ({ ...state, busy: Boolean(active), draft_mode: draftMode, generation: generator.status() });
  function stop(reason) {
    const old = worker; worker = null;
    state = { ...state, mode: 'baseline-fallback', state: 'unavailable', reason };
    if (old) void exitOwned(old);
  }
  function request(type, payload, timeout, onProgress) {
    if (active) return Promise.reject(new Error('Embedding worker is busy; bounded queue has no free slot'));
    return new Promise((resolveRequest, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        active = null; stop(`${type} timeout after ${timeout}ms`); reject(new Error(`${type} timeout after ${timeout}ms`));
      }, timeout);
      active = { id, resolve: resolveRequest, reject, timer, onProgress };
      const failed = error => {
        if (!error || active?.id !== id) return;
        active = null; clearTimeout(timer); stop(errorText(error)); reject(error);
      };
      try { worker.send({ id, type, ...payload }, failed); } catch (error) { failed(error); }
    });
  }
  async function initialize({ onProgress, deadline, signal, _routedRestore } = {}) {
    const bounded = deadline !== undefined;
    if (bounded && (!Number.isFinite(deadline) || signal?.aborted || performance.now() >= deadline - 1500)) throw new Error('Bounded embedding initialization has no remaining budget');
    if (closed) return status();
    if (generationBusy && _routedRestore !== routedRestoreToken) return status();
    if (state.state === 'ready') return status();
    if (initializing) { if (bounded) throw new Error('Embedding initialization is busy'); return initializing; }
    initializing = (async () => {
      if (!existsSync(resolve(modelDir, 'onnx/model_quantized.onnx'))) {
        state = { ...state, state: 'unavailable', reason: 'Model files missing; run npm run models:setup explicitly' };
        return status();
      }
      state = { ...state, state: 'initializing', reason: undefined };
      // Native ONNX teardown during Worker.terminate() can crash Windows Node.
      // A child process gives timeout cancellation an actual native fault boundary.
      await Promise.all([...retiringWorkers.keys()].map(old => exitOwned(old, bounded ? deadline : undefined)));
      if (closed || bounded && (signal?.aborted || performance.now() >= deadline - 1500)) {
        if (!closed) state = { ...state, state: 'unavailable', mode: 'baseline-fallback', reason: 'Bounded embedding initialization cancelled before spawn' };
        throw new Error('Bounded embedding initialization cancelled before spawn');
      }
      worker = embeddingFork(new URL('./worker.mjs', import.meta.url), [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
      workerIncarnation = randomUUID();
      const spawned = worker;
      worker.on('message', message => {
        if (worker !== spawned) return;
        if (!active || active.id !== message.id) return;
        if (message.progress) {
          state = { ...state, ...message.progress };
          try { active.onProgress?.(status()); } catch { /* A progress observer cannot abort the job. */ }
          return;
        }
        const task = active; active = null; clearTimeout(task.timer);
        if (message.error) task.reject(new Error(message.error)); else task.resolve(message.result);
      });
      worker.on('error', error => {
        if (worker !== spawned) return;
        const task = active; active = null;
        if (task) { clearTimeout(task.timer); task.reject(error); }
        stop(errorText(error));
      });
      worker.on('exit', code => {
        if (worker !== spawned || closed) return;
        const task = active; active = null;
        if (task) { clearTimeout(task.timer); task.reject(new Error(`Embedding worker exited (${code})`)); }
        stop(`Embedding worker exited (${code})`);
      });
      const abortInitialize = () => { if (worker !== spawned) return; const task = active; active = null; if (task) { clearTimeout(task.timer); task.reject(new Error('Bounded embedding initialization aborted')); } stop('Bounded embedding initialization aborted'); };
      if (bounded) signal?.addEventListener('abort', abortInitialize, { once: true });
      try {
        if (bounded && signal?.aborted) throw new Error('Bounded embedding initialization aborted before IPC');
        const timeout = bounded ? Math.max(1, Math.min(900000, deadline - performance.now() - 1500)) : 900000;
        const result = await request('initialize', { config: { modelDir: resolve(modelDir), cacheDir: resolve(cacheDir), sources, intents } }, timeout, onProgress);
        if (bounded && (signal?.aborted || performance.now() >= deadline - 1500 || worker !== spawned || closed)) throw new Error('Bounded embedding initialization finished late');
        if (bounded) {
          const prototypes = intents.categories.flatMap(item => Object.entries(item.examples).map(([, text]) => `query: ${text}`));
          const documents = [...sources.map(source => `passage: ${source.section}. ${source.label}. ${source.text}`), ...prototypes];
          const modelManifest = JSON.parse(readFileSync(resolve(modelDir, 'manifest.json'), 'utf8'));
          const expected = createHash('sha256').update(JSON.stringify({ documents, model: MODEL, modelManifest, dtype: 'q8', pooling: 'mean', normalize: true, max_length: 256 })).digest('hex');
          if (result?.phase !== 'ready' || result.indexed !== sources.length || result.prototype_count !== prototypes.length || result.total !== documents.length || result.progress !== 1 || result.index_fingerprint !== expected || result.runtime !== 'isolated-node-process') throw new Error('Bounded restore ready/canonical-index verification failed');
        }
        state = { ...state, ...result, mode: 'semantic-hybrid', state: 'ready', reason: undefined };
      } catch (error) { stop(errorText(error)); }
      finally {
        if (bounded) { signal?.removeEventListener('abort', abortInitialize); if (state.state !== 'ready' || worker !== spawned) { await exitOwned(spawned, deadline); } }
      }
      return status();
    })();
    try { return await initializing; } finally { initializing = null; }
  }
  function lexical(query, limit, reason) {
    return { mode: 'lexical-fallback', model: null, fallback_reason: reason, candidates: retrieve(query, { limit }).map(candidate => ({ ...candidate, lexical_score: candidate.score, semantic_score: null })) };
  }
  function addInstructions(result, query, count) {
    // Approved operator instructions are separate from official rules. Changing
    // content is retrieved lexically, never reused from the permanent model index.
    const templates = approvedTemplates().filter(item => item.status === 'approved').slice(0, 1000).map(item => ({ id: `template:${item.id}`, section_id: 'template', section: 'Approved operator instruction', ref: item.id, label: item.title, text: item.text, source_type: 'approved_template', retrieval: 'lexical', origin_source_ids: item.source_ids || [] }));
    if (templates.length) {
      const originals = new Map(templates.map(item => [item.id, item]));
      // The core retriever indexes section + text. Include the authored title in
      // retrieval documents only, then restore the original display fields.
      const indexed = templates.map(item => ({ ...item, text: `${item.label}\n${item.text}` }));
      result.instructions = createRetriever(indexed)(query, { limit: Math.min(count, 3) }).filter(item => item.score > 0).map(item => ({ ...originals.get(item.id), score: item.score }));
    }
    return result;
  }
  async function searchInternal(query, limit, timeout) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('Search query must be a non-empty string');
    query = query.slice(0, 12000);
    if (generationBusy) return lexical(query, limit, 'Embedding paused for local generation');
    if (state.state !== 'ready' || !worker) return lexical(query, limit, state.reason || state.state);
    try { return await request('search', { query, limit }, timeout); }
    catch (error) { return lexical(query, limit, errorText(error)); }
  }
  async function search(query, { limit = 8 } = {}) {
    const count = Math.max(1, Math.min(30, Number(limit) || 8));
    const result = await searchInternal(query, count, Math.max(1, Math.min(4300, inferenceTimeoutMs)));
    return addInstructions(result, query, count);
  }
  async function analyzeRaw(rawInput, { history = [] } = {}) {
    const start = performance.now();
    const input = sanitizeInput(rawInput);
    const result = baseline.triage(input, { history });
    const baselineHuman = result.needs_human;
    const query = input.messages.filter(message => message.role === 'player').map(message => message.text).join('\n');
    const found = await searchInternal(query, 8, Math.max(1, Math.min(inferenceTimeoutMs, 4400 - (performance.now() - start))));
    addInstructions(found, query, 3);
    const baselineCategory = result.category;
    const suggestions = (found.intents || []).filter(item => item.category.startsWith(`${input.kind}.`));
    const best = suggestions[0], second = suggestions[1];
    const accepted = best && best.score >= 0.79 && best.score - (second?.score || 0) >= 0.025;
    // Suggestions never turn an allegation, a baseline risk or an uncertain case into auto.
    if (best && best.score >= 0.72 && best.category !== baselineCategory) {
      if (accepted && !humanCategories.has(baselineCategory)) result.category = best.category;
      result.needs_human = true;
      result.reasons.push('Семантический прототип предложил другую категорию; расхождение требует проверки человеком.');
    }
    if (best && humanCategories.has(best.category) && best.score >= 0.77) result.needs_human = true;
    let sourceApplication = { status: 'baseline_applicability_retained', selected_ids: result.citations.map(item => item.id) };
    if (result.category !== baselineCategory) {
      const allowed = new Set(applicableSources[result.category] || []);
      const bestSemantic = Math.max(...found.candidates.map(item => item.semantic_score || 0));
      const selected = found.candidates.filter(item => item.source_type === 'rule' && allowed.has(item.id) && item.semantic_score >= 0.78 && item.semantic_score >= bestSemantic - 0.04);
      // Broad category membership alone cannot ground a specialized subrule.
      // Keep only its general definition unless the query contains its context.
      const text = result.analysis.normalized_text;
      const specificContext = {
        '30:2.4': /расизм|racis|дискрим|discrimin|нәсіл|нәсілш|irq/iu,
        '30:2.6': /угроз|угрож|threat|dox|amea[cç]|amenaz|қорқыт|tahdid/iu,
        '32:1.1': /зел[её]н|\bgz\b|green zone|zona verde|жасыл|yashil/iu,
        '30:5.3': /вышел.*игр|уход.*рп|quit.*rp|disconnect|desconect/iu,
        '30:5.4': /(?:^|[^\p{L}])(?:дом|квартир|house|home|casa|үй|uy)/iu,
        '30:4.2': /вымог|extort|бопсала|шантаж|blackmail|tovlam/iu,
        '30:2.3': /реклам|advertis|publicidad|propaganda|reklama|жарнама/iu,
        '30:4.4': /реал|real|dinero|dinheiro|нақты ақша|haqiqiy pul/iu,
      };
      const verified = selected.filter(item => !specificContext[item.id] || specificContext[item.id].test(text)).slice(0, 1);
      const priorities = { 'complaint.insult': 'p2', 'complaint.cheat': 'p1', 'complaint.dm': 'p2', 'complaint.scam': 'p2', 'complaint.rmt_ads': 'p1', 'complaint.admin': 'p1', 'report.account': 'p0', 'report.payment': 'p0', 'report.complaint': 'p2' };
      const proposedPriority = priorities[result.category];
      if (proposedPriority && proposedPriority < result.priority) result.priority = proposedPriority;
      result.citations = verified.map(({ id, section_id, section, ref, text: sourceText }) => ({ id, section_id, section, ref, text: sourceText }));
      result.draft_reply.cited = verified.map(item => item.label);
      const template = replies[result.lang];
      const topic = result.category === 'report.account' ? 'account' : result.category === 'report.payment' ? 'payment' : result.category === 'complaint.admin' ? 'appeal' : result.category === 'report.help' ? 'help' : 'request';
      result.draft_reply.text = [template.greeting, template.received, ...(verified.length ? [`${template.rule} ${verified.map(item => item.label).join(', ')}. ${template.conditional}`] : []), template[topic], ...(result.extracted.has_evidence ? [template.materials] : []), template.human].join('\n\n');
      sourceApplication = { status: verified.length ? 'semantic_category_context_verified' : 'no_supported_rule_for_changed_category', selected_ids: verified.map(item => item.id) };
      result.reasons.push(verified.length ? 'Источник выбран из глобальной семантической выдачи и проверен по категории и контексту; утверждение игрока не подтверждено.' : 'Категория уточнена семантически; подтверждённого правила для нового контекста нет, точная ссылка не добавлена.');
    }
    if (result.needs_human && !baselineHuman) {
      // Keep a safe draft consistent with the raised human gate in the caller's language.
      if (result.category === baselineCategory) result.draft_reply.text += `\n\n${replies[result.lang].human}`;
    }
    // Selected citations are applicability-checked. Global candidates are not citations.
    result.analysis.intelligence = {
      version: 'v2', mode: found.mode === 'semantic-hybrid' ? found.mode : 'baseline-fallback', model: found.model,
      elapsed_ms: Math.round(performance.now() - start), candidates: found.candidates,
      baseline_category: baselineCategory, ...(best ? { suggested_category: best.category, suggestion_score: best.score, suggestion_margin: best.score - (second?.score || 0) } : {}),
      source_application: sourceApplication,
      ...(found.instructions ? { approved_instructions: found.instructions } : {}),
      ...(found.fallback_reason ? { fallback_reason: found.fallback_reason } : {}),
    };
    return result;
  }
  async function generateFromRaw(input, current, rawResult, startedAt) {
    const basis = structuredClone(rawResult);
    basis.needs_human = basis.needs_human || current.needs_human;
    // Fallback text is already safe and localized; source eligibility comes only
    // from this request's original canonical analysis, before fast filtering.
    basis.draft_reply = structuredClone(current.draft_reply);
    // One monotonic partition: preparation includes basis/selection cloning;
    // native includes the provider plus subsequent binding/projection work.
    // A skipped provider has a zero native phase, including later fallback
    // projection in preparation. Independent rounding differs by at most1ms.
    let nativeStartedAt = null;
    const publishTiming = value => {
      const previous = { ...value.metrics }, finishedAt = performance.now();
      const preparedMs = (nativeStartedAt ?? finishedAt) - startedAt;
      const nativeMs = nativeStartedAt === null ? 0 : finishedAt - nativeStartedAt;
      value.metrics = { ...previous, preparation_ms: Math.round(preparedMs), elapsed_ms: Math.round(nativeMs), total_elapsed_ms: Math.round(finishedAt - startedAt), budget_ms: generationBudgetMs, native_budget_ms: nativeBudgetMs };
    };
    const bind = (generation, timingOnly = false) => {
      const bound = bindGenerationBasis(generation, input, timingOnly ? null : basis, rules, startedAt, { publishTiming });
      publishTiming(bound); return bound;
    };
    const preparedAt = performance.now();
    if (generationBudgetMs <= preparationBudgetMs || preparedAt - startedAt >= preparationBudgetMs) return bind({ status: 'unavailable', reason: 'Generation skipped: bounded preparation has no remaining native budget', text: current.draft_reply.text, metrics: { generated: false, executed: false } }, true);
    nativeStartedAt = preparedAt;
    const generation = await generator.generate(input, basis);
    return bind(generation);
  }
  async function triage(rawInput, options = {}) {
    const startedAt = performance.now(), input = sanitizeInput(rawInput);
    let rawResult;
    if (draftMode === 'native' && generationBudgetMs <= preparationBudgetMs) {
      rawResult = baseline.triage(input, options);
      rawResult.analysis.intelligence = { version: 'v2', mode: 'baseline-fallback', model: null, candidates: [], baseline_category: rawResult.category, elapsed_ms: Math.round(performance.now() - startedAt), fallback_reason: 'Configured generation budget cannot reserve bounded semantic preparation' };
    } else rawResult = await analyzeRaw(input, options);
    const result = codeContextDraft(input, structuredClone(rawResult), rules);
    if (draftMode === 'native') {
      try { applyGenerationProjection(result, await generateFromRaw(input, result, rawResult, startedAt), rules); }
      catch (error) { applyGenerationProjection(result, { status: 'unavailable', reason: errorText(error), metrics: { generated: false } }, rules); }
    }
    return result;
  }
  async function generate(rawInput, result) {
    const startedAt = performance.now(), input = sanitizeInput(rawInput);
    if (generationBudgetMs <= preparationBudgetMs) return generateFromRaw(input, result, result, startedAt);
    const rawResult = await analyzeRaw(input);
    return generateFromRaw(input, result, rawResult, startedAt);
  }
  function close() {
    if (closing) return closing;
    closing = (async () => {
      closed = true;
      if (active) { clearTimeout(active.timer); active.reject(new Error('Intelligence closed')); active = null; }
      const old = worker; worker = null;
      state = { ...state, state: 'closed', mode: 'baseline-fallback', reason: 'Intelligence closed' };
      const oldExit = old ? exitOwned(old) : Promise.resolve();
      await generator.close();
      await oldExit;
      await Promise.all([...retiringWorkers.values()].map(row => row.promise));
      state = { ...state, state: 'closed', mode: 'baseline-fallback', reason: 'Intelligence closed' };
    })();
    return closing;
  }
  return { triage, search, status, initialize, generate, close };
}
