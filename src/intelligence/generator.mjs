import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sanitizeInput } from '../core/engine.mjs';
import { PLAN_SCHEMA_VERSION, GENERATION_PIPELINE_VERSION, FOCUS_SCHEMA_VERSION, buildGenerationInput, buildPlanSchema, buildPlanMessages, validatePlan, renderPlan } from './generation-contract.mjs';
import { createTwoPhaseGenerator } from './two-phase.mjs';
import { createRoutedGenerator } from './routed-generator.mjs';
import { ROUTED_SCHEMAS, ROUTED_PROTOCOL } from './routed-contract.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const GENERATOR_ID = 'Qwen/Qwen3-0.6B';
export const Q8_MODEL_PATH = resolve(root, 'runtime/models/qwen3-0.6b/Qwen3-0.6B-Q8_0.gguf');
export const Q4_MODEL_PATH = resolve(root, 'runtime/models/qwen3-0.6b/Qwen3-0.6B-Q4_K_M.gguf');
export const defaultGeneratorModelPath = () => existsSync(`${Q4_MODEL_PATH}.manifest.json`) && existsSync(Q4_MODEL_PATH) ? Q4_MODEL_PATH : Q8_MODEL_PATH;
export const DEFAULT_MODEL_PATH = defaultGeneratorModelPath();
export const DEFAULT_RUNTIME_PATH = resolve(root, 'runtime/tools/llama-b11960-cpu/llama-server.exe');
export const MEASURED_Q4_SHA256 = '15e434d8ddf0af38fe3f7003af6ce6eac4edada6df34324aa45979f9cc79f02e';
const clamp = (value, low, high, fallback) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));
const MiB = 1024 * 1024;
const within = (directory, path) => { const nested = relative(resolve(directory), resolve(path)); return !nested.startsWith('..') && !isAbsolute(nested); };
export function generatorModelMetadata(path) {
  try {
    const manifest = JSON.parse(readFileSync(`${path}.manifest.json`, 'utf8'));
    if (manifest.complete && manifest.bytes === statSync(path).size && typeof manifest.id === 'string') return { id: manifest.id, quantization: manifest.quantization || 'unknown', sha256: manifest.sha256 || null, provenance: manifest.derivation || 'local_manifest' };
  } catch {}
  if (resolve(path) === Q8_MODEL_PATH) return { id: 'Qwen/Qwen3-0.6B-GGUF:Q8_0', quantization: 'Q8_0', sha256: '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031', provenance: 'official_pinned_model' };
  return { id: `local:${basename(path)}`, quantization: basename(path).match(/Q\d+_[A-Z0-9_]+/iu)?.[0] || 'unknown', sha256: null, provenance: 'unverified_local_candidate' };
}

export function resourcePreflight({ modelBytes = 639446688, contextSize = 1024, freeBytes = freemem() } = {}) {
  // Qwen3-0.6B: 28 layers, 8 KV heads, 128 dimensions, K+V f16.
  const kv_bytes = 28 * 8 * 128 * 2 * 2 * contextSize;
  const scratch_bytes = 128 * MiB, reserve_bytes = 256 * MiB;
  const required_bytes = modelBytes + kv_bytes + scratch_bytes + reserve_bytes;
  return { ok: freeBytes >= required_bytes, free_bytes: freeBytes, required_bytes, model_bytes: modelBytes, kv_bytes, scratch_bytes, reserve_bytes, context_tokens: contextSize };
}
export function generatorPreflight({ modelPath, contextSize = 1024, freeBytes = freemem(), disableRepack = true }) {
  const metadata = generatorModelMetadata(modelPath);
  const result = resourcePreflight({ modelBytes: statSync(modelPath).size, contextSize, freeBytes });
  // This exact derived model/profile was measured on this runner: CPU_Mapped
  // 372.65MiB, KV112MiB, compute1.81MiB, peak private237400064B at ctx1024.
  // An unknown adapter/model retains the full-file conservative check.
  if (metadata.sha256 === MEASURED_Q4_SHA256 && metadata.quantization === 'Q4_K_M' && contextSize <= 1024 && disableRepack) {
    result.full_file_required_bytes = result.required_bytes;
    result.file_backed_weight_bytes = result.model_bytes;
    result.required_new_committed_bytes = result.kv_bytes + result.scratch_bytes;
    result.required_bytes = result.required_new_committed_bytes + result.reserve_bytes;
    result.ok = freeBytes >= result.required_bytes;
    result.mode = 'measured_qwen3_q4_mmap_no_repack';
    result.evidence = 'plan-mmap-1024-production-preflight.json';
  } else result.mode = 'conservative_full_file';
  return result;
}

export function prepareGeneration(rawInput, result, canonicalSources, options = {}) {
  const context = buildGenerationInput(rawInput, result, canonicalSources, options);
  return { input: sanitizeInput(rawInput), context, sources: context.allowed_sources, schema: buildPlanSchema(context), messages: buildPlanMessages(context) };
}
export function validateGeneration(raw, options) {
  const context = options.context || buildGenerationInput(options.input, options.result, options.sources || []);
  return validatePlan(raw, context);
}
export function validateCompletion(payload, options) {
  if (payload?.choices?.[0]?.finish_reason !== 'stop') return { ok: false, reason: 'generation_incomplete' };
  if (options.context?.unresolved) return { ok: false, reason: options.context.unresolved_reason || 'unresolved_context' };
  return validateGeneration(payload.choices[0].message?.content || '', options);
}

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const port = server.address().port;
  await new Promise(accept => server.close(accept));
  return port;
}
async function stopChild(child) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(accept => { child.once('close', accept); child.kill(); });
}
export function createLocalGenerator({ config, canonicalSources, acquireResources = async () => {}, releaseResources = async () => {}, resourceState = () => ({}) }) {
  if (config?.focusMode === 'model') {
    let routed = false;
    try { routed = JSON.parse(readFileSync(config.activationManifestPath, 'utf8')).schema_version === ROUTED_SCHEMAS.activation; } catch { /* The verifier fails closed before any process. */ }
    if (routed) return createRoutedGenerator({ config: { ...config, adapterProtocol: ROUTED_PROTOCOL.id }, canonicalSources, acquireResources, releaseResources, resourceState });
    // The family verifier rejects a routed manifest switched into this legacy
    // adapter after construction; no failed family can fall back to another.
    return createTwoPhaseGenerator({ config, canonicalSources, acquireResources, releaseResources });
  }
  const enabled = config?.enabled === true;
  const modelPath = resolve(config?.modelPath || defaultGeneratorModelPath());
  const modelMetadata = generatorModelMetadata(modelPath);
  const modelId = modelMetadata.id;
  const runtimePath = resolve(config?.runtimePath || DEFAULT_RUNTIME_PATH);
  const timeoutMs = clamp(config?.timeoutMs, 1, 60000, 60000);
  const contextSize = Math.round(clamp(config?.contextSize, 512, 2048, 1024));
  const maxTokens = Math.round(clamp(config?.maxTokens, 32, 256, 192));
  const threads = Math.round(clamp(config?.threads, 1, 4, 2));
  const mmapTrial = config?.experimentalMmapTrial === true;
  const observeMemory = mmapTrial || config?.observeMemory === true;
  const disableRepack = config?.disableRepack !== false;
  const batchSize = mmapTrial ? 16 : 64, microBatchSize = mmapTrial ? 8 : 32;
  let busy = false, closed = false, child = null, closing = null;
  let activeAbort = null, exitHookAdded = false;
  let state = { status: 'unavailable', model: modelId, model_metadata: modelMetadata, contract_version: PLAN_SCHEMA_VERSION, output_mode: 'model_plan', text_origin: 'deterministic_renderer', reason: enabled ? 'Experiment configured; model preflight has not run' : 'Local generator is disabled; set LOCAL_GENERATOR=1 explicitly for the experiment', enabled, context_tokens: contextSize, max_tokens: maxTokens, timeout_ms: timeoutMs, backend: 'cpu', thinking: false };
  const onExit = () => child?.kill();
  const status = () => ({ ...state, busy, runtime_pid: child?.pid || null });
  async function generate(rawInput, result) {
    const start = performance.now();
    const fallback = result?.draft_reply?.text || '';
    const baseMetrics = { generated: false, executed: false, model: modelId, model_metadata: modelMetadata, contract_version: PLAN_SCHEMA_VERSION, pipeline_version: GENERATION_PIPELINE_VERSION, classifier_contract_version: FOCUS_SCHEMA_VERSION, focus_phase_executed: false, output_mode: 'model_plan', plan_origin: null, text_origin: 'baseline_fallback', elapsed_ms: 0, thinking: false, context_tokens: contextSize, max_tokens: maxTokens };
    let prepared;
    try { prepared = prepareGeneration(rawInput, result, canonicalSources); }
    catch (error) {
      const reason = `Generation context unavailable: ${String(error.message).slice(0, 200)}`;
      if (!busy) state = { ...state, status: 'unavailable', reason };
      return { status: 'unavailable', text: fallback, reason, metrics: { ...baseMetrics, elapsed_ms: Math.round(performance.now() - start) } };
    }
    // This object is produced exclusively from validated code context. Never
    // read it (or its human flag) from an accepted or rejected model payload.
    const safety_context = {
      schema_version: 'generation-safety-v1', origin: 'code_context', needs_human: prepared.context.needs_human,
      reason: prepared.context.original_human_gate ? 'baseline_required' : prepared.context.unresolved ? 'unresolved_context' : prepared.context.intent_mode === 'knowledge_gap' ? 'no_verified_answer' : prepared.context.intent_mode === 'actual_incident' ? 'incident_requires_verification' : 'not_required',
    };
    const fail = (reason, extra = {}) => {
      if (!busy || state.status !== 'running') state = { ...state, status: 'unavailable', reason };
      return { status: 'unavailable', text: fallback, reason, safety_context, needs_human: prepared.context.needs_human, original_human_gate: prepared.context.original_human_gate, contextual_human: prepared.context.contextual_human, human_escalation: prepared.context.human_escalation, metrics: { ...baseMetrics, elapsed_ms: Math.round(performance.now() - start), ...extra } };
    };
    if (!enabled || closed) return fail(closed ? 'Generator is closed' : 'Local generator is disabled; set LOCAL_GENERATOR=1 explicitly for the experiment');
    if (prepared.context.unresolved) {
      const output = { ...fail(prepared.context.unresolved_reason || 'Unresolved generation context'), status: 'quality-failed' };
      state = { ...state, status: output.status, reason: output.reason };
      return output;
    }
    if (busy) return fail('Generator is busy; bounded queue has no free slot');
    if (!within(resolve(root, 'runtime/models'), modelPath) || !within(resolve(root, 'runtime/tools'), runtimePath)) return fail('Generator files must remain inside project runtime/models and runtime/tools');
    if (!existsSync(modelPath) || !existsSync(runtimePath)) return fail('Generator files missing; run node scripts/setup-generator.mjs explicitly');
    busy = true;
    let acquired = false, timer, memoryTimer, sampleTimer, sampling = null, reply, abortReason;
    const allocationLog = [];
    const observedMemory = { peak_rss_bytes: 0, peak_private_bytes: 0, sampled_cpu_seconds: 0 };
    const abort = new AbortController();
    activeAbort = abort;
    let executed = false, preflight;
    try {
      await acquireResources(); acquired = true;
      preflight = generatorPreflight({ modelPath, contextSize, disableRepack });
      if (mmapTrial) {
        preflight.production_preflight_ok = preflight.ok;
        preflight.mode = 'experimental_mmap_warmup';
        preflight.file_backed_weight_bytes = preflight.model_bytes;
        preflight.required_new_committed_bytes = preflight.kv_bytes + preflight.scratch_bytes + preflight.reserve_bytes;
        preflight.ok = preflight.free_bytes >= preflight.required_new_committed_bytes;
      }
      if (!preflight.ok) {
        state = { ...state, status: 'unavailable', reason: 'Insufficient free memory for generator plus reserve', preflight };
        reply = fail(state.reason, { preflight });
      } else {
        state = { ...state, status: 'running', reason: undefined, preflight };
        timer = setTimeout(() => { abortReason = 'timeout'; abort.abort(); child?.kill(); }, timeoutMs);
        let minFree = preflight.free_bytes;
        memoryTimer = setInterval(() => {
          minFree = Math.min(minFree, freemem());
          state.minimum_free_bytes = minFree;
          if (minFree < preflight.reserve_bytes) { abortReason = 'memory_pressure'; abort.abort(); child?.kill(); }
        }, 250);
        const port = await freePort();
        const key = randomBytes(24).toString('hex');
        const args = ['--model', modelPath, '--host', '127.0.0.1', '--port', String(port), '--api-key', key, '--ctx-size', String(contextSize), '--parallel', '1', '--threads', String(threads), '--threads-batch', String(threads), '--batch-size', String(batchSize), '--ubatch-size', String(microBatchSize), '--gpu-layers', '0', '--reasoning', 'off', '--reasoning-budget', '0', '--jinja', '--offline', '--no-webui', '--load-mode', 'mmap', ...(disableRepack ? ['--no-repack'] : []), ...(observeMemory ? ['--log-verbosity', '4'] : ['--log-disable'])];
        if (!exitHookAdded) { process.once('exit', onExit); exitHookAdded = true; }
        child = spawn(runtimePath, args, { windowsHide: true, stdio: ['ignore', observeMemory ? 'pipe' : 'ignore', observeMemory ? 'pipe' : 'ignore'], cwd: resolve(runtimePath, '..'), env: { ...process.env, HF_HUB_OFFLINE: '1' } });
        if (observeMemory) {
          for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
            for (const line of chunk.toString().split(/\r?\n/u)) if (/mmap|mapped|buffer|KV.*(?:cache|size)|memory/iu.test(line) && allocationLog.length < 80) allocationLog.push(line.slice(0, 500));
          });
          sampleTimer = setInterval(() => {
            const pid = child?.pid;
            if (sampling || !pid) return;
            sampling = new Promise(accept => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process -Id ([int]$env:SUPPORT_GENERATOR_SAMPLE_PID) -ErrorAction Stop | Select-Object WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress'], { windowsHide: true, env: { ...process.env, SUPPORT_GENERATOR_SAMPLE_PID: String(pid) } }, (error, stdout) => {
              if (!error) try { const value = JSON.parse(stdout); observedMemory.peak_rss_bytes = Math.max(observedMemory.peak_rss_bytes, value.WorkingSet64); observedMemory.peak_private_bytes = Math.max(observedMemory.peak_private_bytes, value.PrivateMemorySize64); observedMemory.sampled_cpu_seconds = Math.max(observedMemory.sampled_cpu_seconds, value.CPU || 0); } catch {}
              accept();
            })).finally(() => { sampling = null; });
          }, 1000);
        }
        let childError = null;
        child.once('error', error => { childError = error; });
        const url = `http://127.0.0.1:${port}`;
        while (true) {
          if (abort.signal.aborted) throw new Error('generation_timeout');
          if (childError) throw childError;
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(`generator_runtime_exit_${child.exitCode}`);
          try { const health = await fetch(`${url}/health`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(500)]) }); if (health.ok) break; } catch (error) { if (abort.signal.aborted) throw error; }
          await delay(100, undefined, { signal: abort.signal });
        }
        executed = true;
        const response = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(buildGenerationPayload(prepared, maxTokens, modelId)), signal: abort.signal });
        if (!response.ok) throw new Error(`generator_http_${response.status}`);
        const payload = await response.json();
        const raw = payload.choices?.[0]?.message?.content || '';
        try { config?.onRawOutput?.({ text: raw, usage: payload.usage, finish_reason: payload.choices?.[0]?.finish_reason }); } catch { /* Private benchmark observer cannot alter a result. */ }
        const checked = validateCompletion(payload, { context: prepared.context });
        const metrics = { ...baseMetrics, executed: true, generated: checked.ok, elapsed_ms: Math.round(performance.now() - start), preflight, runtime_mode: mmapTrial ? 'experimental_mmap_warmup' : 'production_preflight', batch_size: batchSize, micro_batch_size: microBatchSize, ...(observeMemory ? { observed_memory: observedMemory, allocation_log: allocationLog } : {}), minimum_free_bytes: minFree, grammar: 'json_schema', usage: payload.usage || null, timings: payload.timings || null, output_sha256: createHash('sha256').update(raw).digest('hex'), finish_reason: payload.choices?.[0]?.finish_reason || null };
        if (!checked.ok) reply = { status: 'quality-failed', text: fallback, reason: checked.reason, metrics };
        else {
          const rendered = renderPlan(checked.value, prepared.context);
          const contextMetadata = { pipeline_version: GENERATION_PIPELINE_VERSION, lang: rendered.lang, language_origin: rendered.language_origin, intent_mode: prepared.context.intent_mode, focus_origin: prepared.context.focus_origin, focus_changed: prepared.context.focus_changed, original_human_gate: rendered.original_human_gate, contextual_human: rendered.contextual_human, human_escalation: rendered.human_escalation };
          Object.assign(metrics, contextMetadata, { plan_origin: 'local_llm', text_origin: 'deterministic_renderer', used_fact_ids: rendered.used_fact_ids, requested_fields: rendered.requested_fields, source_applicability: prepared.context.source_applicability });
          reply = { status: 'generated', text: rendered.text, ...contextMetadata, source_ids: rendered.source_ids, needs_human: rendered.needs_human, plan: checked.value, plan_origin: 'local_llm', text_origin: 'deterministic_renderer', metrics };
        }
        state = { ...state, status: reply.status, reason: reply.reason, last_metrics: metrics };
      }
    } catch (error) {
      const timedOut = abortReason === 'timeout';
      reply = { status: timedOut ? 'timeout' : 'unavailable', text: fallback, reason: timedOut ? `Local generator timeout after ${timeoutMs}ms` : abortReason === 'memory_pressure' ? 'Local generator stopped because free memory fell below reserve' : closed ? 'Generator is closed' : String(error.message).slice(0, 300), metrics: { ...baseMetrics, executed, elapsed_ms: Math.round(performance.now() - start), runtime_mode: mmapTrial ? 'experimental_mmap_warmup' : 'production_preflight', ...(observeMemory ? { observed_memory: observedMemory, allocation_log: allocationLog } : {}), ...(preflight ? { preflight } : {}) } };
      state = { ...state, status: reply.status, reason: reply.reason, last_metrics: reply.metrics };
    } finally {
      clearTimeout(timer);
      clearInterval(memoryTimer);
      clearInterval(sampleTimer);
      const old = child; child = null;
      await stopChild(old); // Release the actual native model before restoring E5.
      if (sampling) await sampling;
      if (acquired) {
        const restoreStart = performance.now();
        try { await releaseResources(); } catch { reply.metrics.embedding_restore_failed = true; }
        reply.metrics.embedding_restore_ms = Math.round(performance.now() - restoreStart);
      }
      activeAbort = null;
      busy = false;
    }
    reply.metrics.elapsed_ms = Math.round(performance.now() - start);
    return { ...reply, safety_context };
  }
  function close() {
    if (closing) return closing;
    closing = (async () => {
      closed = true; process.removeListener('exit', onExit);
      activeAbort?.abort();
      const old = child; child = null; await stopChild(old);
      state = { ...state, status: 'unavailable', reason: 'Generator is closed' };
    })();
    return closing;
  }
  return { status, generate, close };
}

export function buildGenerationPayload(prepared, maxTokens = 192, modelId = GENERATOR_ID) {
  return { model: modelId, messages: prepared.messages, max_tokens: maxTokens, temperature: 0, seed: 42, stream: false,
    response_format: { type: 'json_schema', json_schema: { name: 'support_reply', strict: true, schema: prepared.schema } },
    chat_template_kwargs: { enable_thinking: false }, reasoning_effort: 'none' };
}
