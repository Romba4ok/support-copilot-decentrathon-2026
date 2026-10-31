import {fork} from 'node:child_process';
import {lstat, realpath} from 'node:fs/promises';
import {freemem} from 'node:os';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

export const ROUTING_ENCODER_LIMITS = Object.freeze({
  native_ms: 55600, initialize_ms: 30000, encode_ms: 10000,
  reserve_bytes: 256 * 1024 ** 2, memory_interval_ms: 100,
  dimensions: 384, maximum_text_chars: 12000,
});
const WORKER = fileURLToPath(new URL('./routing-worker.mjs', import.meta.url));

/** The caller supplies player text only. No category, outcome or label is added. */
export function routingQueryText(playerText) {
  if (typeof playerText !== 'string' || !playerText.trim()) throw new TypeError('routing_player_text_required');
  return ('query: ' + playerText).slice(0, ROUTING_ENCODER_LIMITS.maximum_text_chars);
}

function localPath(value) {
  // modelDir is a trusted application path, never a model ID, URL or UNC share.
  if (typeof value !== 'string' || !isAbsolute(value) || /^(?:[\\/]{2}|[a-z]+:\/\/)/iu.test(value) || value.includes('\0')) {
    throw new TypeError('routing_local_absolute_model_directory_required');
  }
  return value;
}
async function validateLocalDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('routing_regular_model_directory_required');
  return localPath(await realpath(path));
}
function normalizedVector(value) {
  if (!Array.isArray(value) || value.length !== ROUTING_ENCODER_LIMITS.dimensions || value.some(x => !Number.isFinite(x))) {
    throw new Error('routing_invalid_embedding');
  }
  const norm = Math.hypot(...value);
  if (!(norm > 0) || !Number.isFinite(norm)) throw new Error('routing_invalid_embedding_norm');
  return value.map(x => x / norm);
}

/**
 * One offline E5 child, with serial RPCs and no automatic restart or model swap.
 * deadline is the caller's absolute performance.now() deadline. Construction
 * clamps it to at most 55.6 s; validation, initialization, encoding and cleanup
 * all consume that same allowance. The caller must await close() before loading
 * another model, including after failure. A late OS exit rejects, never qualifies.
 * This building block does not select/activate a router or restore another model.
 */
export function createRoutingEncoderSession({modelDir, deadline, signal} = {}, deps = {}) {
  localPath(modelDir);
  const clock = deps.clock || (() => performance.now());
  if (!Number.isFinite(deadline)) throw new TypeError('routing_absolute_deadline_required');
  const forkProcess = deps.forkProcess || fork;
  const freeMemory = deps.freeMemory || freemem;
  const validateDirectory = deps.validateDirectory || validateLocalDirectory;
  const created = clock(), effectiveDeadline = Math.min(deadline, created + ROUTING_ENCODER_LIMITS.native_ms);
  const usage = {
    incarnation: randomUUID(), deadline: effectiveDeadline, requested_deadline: deadline,
    started: 0, closed: 0, maximum_concurrent: 0, remaining_pid: null,
    minimum_free_bytes: null, initialize_ms: null, encode_calls: 0, close_ms: null,
    rpc_memory_samples: 0, maximum_rpc_sample_rss_bytes: 0,
    memory_measurement: 'worker process.memoryUsage at RPC responses; not continuous peak RSS',
    exit: null, failure: null,
  };
  let child, starting, closing, exitPromise, resolveExit, exited = false, closingRequested = false;
  let active, serial = 0, memoryTimer, deadlineTimer, reapTimer, termTimer, killTimer;
  const ownedTerminationSignals = new Set();
  let haltedReject;
  const halted = new Promise((_, reject) => { haltedReject = reject; });
  halted.catch(() => {});
  const failure = () => new Error(usage.failure || 'routing_session_closed');
  const kill = termination => {
    if (child && !exited && child.exitCode === null && child.signalCode === null) {
      if (child.kill(termination)) ownedTerminationSignals.add(termination);
    }
  };
  function fail(reason) {
    usage.failure ??= String(reason).slice(0, 500);
    haltedReject(failure());
    if (active) { clearTimeout(active.timer); active.reject(failure()); active = null; }
    kill('SIGTERM');
    if (child && !exited) killTimer ??= setTimeout(() => kill('SIGKILL'), 1000);
  }
  function sampleMemory() {
    try {
      const free = freeMemory();
      usage.minimum_free_bytes = usage.minimum_free_bytes === null ? free : Math.min(usage.minimum_free_bytes, free);
      if (!Number.isFinite(free) || free < ROUTING_ENCODER_LIMITS.reserve_bytes) fail('routing_memory_reserve');
      if (clock() >= effectiveDeadline) fail('routing_native_deadline');
    } catch (error) { fail('routing_memory_monitor:' + error.message); }
  }
  function guard() {
    if (usage.failure || closingRequested || signal?.aborted) throw failure();
    if (clock() >= effectiveDeadline) { fail('routing_native_deadline'); throw failure(); }
  }
  async function bounded(action) {
    guard();
    return Promise.race([Promise.resolve().then(action), halted]);
  }
  const onAbort = () => { fail('routing_aborted'); void close().catch(() => {}); };
  const emergency = () => kill('SIGKILL');
  function stopMonitors() {
    clearInterval(memoryTimer); clearTimeout(deadlineTimer); clearInterval(reapTimer);
    clearTimeout(termTimer); clearTimeout(killTimer);
    signal?.removeEventListener('abort', onAbort);
    process.removeListener('exit', emergency);
  }
  function observeExit(code, termination, observedVia) {
    if (exited) return;
    exited = true;
    if (usage.started) usage.closed++;
    usage.remaining_pid = null;
    usage.exit = {code, signal: termination, observed_via: observedVia};
    if (!closingRequested) fail('routing_unexpected_worker_exit');
    else if (!(code === 0 && termination === null) && !(code === null && ownedTerminationSignals.has(termination))) {
      fail('routing_abnormal_worker_exit');
    }
    resolveExit?.();
  }
  function rpc(type, payload, limit, rpcSignal) {
    guard();
    if (active) return Promise.reject(new Error('routing_serial_requests_only'));
    if (rpcSignal?.aborted) { fail('routing_rpc_aborted'); return Promise.reject(failure()); }
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const abortRpc = () => fail('routing_rpc_aborted');
      rpcSignal?.addEventListener('abort', abortRpc, {once: true});
      const finish = callback => value => { rpcSignal?.removeEventListener('abort', abortRpc); callback(value); };
      active = {id, resolve: finish(resolve), reject: finish(reject), timer: setTimeout(() => fail('routing_' + type + '_timeout'), Math.max(0, Math.min(limit, effectiveDeadline - clock())))};
      try { child.send({id, type, ...payload}, error => { if (error) fail('routing_ipc:' + error.message); }); }
      catch (error) { fail('routing_ipc:' + error.message); }
    });
  }
  function start() {
    if (starting) return starting;
    starting = (async () => {
      try {
        guard();
        memoryTimer = setInterval(sampleMemory, ROUTING_ENCODER_LIMITS.memory_interval_ms);
        deadlineTimer = setTimeout(() => { fail('routing_native_deadline'); void close().catch(() => {}); }, Math.max(0, effectiveDeadline - clock()));
        signal?.addEventListener('abort', onAbort, {once: true});
        sampleMemory(); guard();
        const path = await bounded(() => validateDirectory(modelDir));
        guard();
        localPath(path);
        child = forkProcess(WORKER, [], {execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'}});
        exitPromise = new Promise(resolve => { resolveExit = resolve; });
        child.once('error', error => {
          fail('routing_worker_error:' + error.message);
          // spawn failure with no PID owns no process to reap.
          if (!Number.isInteger(child.pid) || child.pid < 1) { exited = true; resolveExit(); }
        });
        child.once('exit', (code, termination) => observeExit(code, termination, 'exit'));
        child.once('close', (code, termination) => observeExit(code, termination, 'close'));
        child.on('message', message => {
          if (!active || message?.id !== active.id) return;
          const pending = active; active = null; clearTimeout(pending.timer);
          if (message.error) { pending.reject(new Error('routing_worker_reply:' + String(message.error).slice(0, 400))); return; }
          const rss = message.memory?.rss;
          if (Number.isFinite(rss) && rss > 0) { usage.rpc_memory_samples++; usage.maximum_rpc_sample_rss_bytes = Math.max(usage.maximum_rpc_sample_rss_bytes, rss); }
          pending.resolve(message.result);
        });
        if (!Number.isInteger(child.pid) || child.pid < 1) throw new Error('routing_owned_pid_required');
        usage.started = 1; usage.maximum_concurrent = 1; usage.remaining_pid = child.pid;
        process.once('exit', emergency);
        // Ignored stdio + IPC may emit exit without ever emitting close.
        reapTimer = setInterval(() => {
          if (!exited && (typeof child.exitCode === 'number' || typeof child.signalCode === 'string')) observeExit(child.exitCode, child.signalCode, 'OS_exit_properties');
        }, 20);
        const at = clock(), value = await rpc('initialize', {modelDir: path}, ROUTING_ENCODER_LIMITS.initialize_ms);
        usage.initialize_ms = clock() - at;
        if (value?.ready !== true) throw new Error('routing_worker_not_ready');
        guard();
      } catch (error) {
        fail(error.message);
        await close().catch(() => {});
        throw failure();
      }
    })();
    return starting;
  }
  async function encode(playerText, {signal: rpcSignal} = {}) {
    const text = routingQueryText(playerText);
    const abortEncode = () => { fail('routing_rpc_aborted'); void close().catch(() => {}); };
    if (rpcSignal?.aborted) {
      fail('routing_rpc_aborted');
      await close().catch(() => {});
      throw failure();
    }
    // Cancellation owns the whole single-owner session, including validation
    // and initialization before the embed RPC exists.
    rpcSignal?.addEventListener('abort', abortEncode, {once: true});
    try {
      await start();
      // Reject concurrent callers without cancelling the already owned RPC.
      if (active) throw new Error('routing_serial_requests_only');
      try {
        const value = await rpc('embed', {text}, ROUTING_ENCODER_LIMITS.encode_ms, rpcSignal);
        const vector = normalizedVector(value?.vector);
        guard(); usage.encode_calls++;
        return vector;
      } catch (error) {
        fail(error.message);
        await close().catch(() => {});
        throw failure();
      }
    } finally { rpcSignal?.removeEventListener('abort', abortEncode); }
  }
  function close() {
    if (closing) return closing;
    closingRequested = true;
    // Wake validation/RPC waiters even if their dependency never settles.
    haltedReject(failure());
    if (active) { clearTimeout(active.timer); active.reject(failure()); active = null; }
    closing = (async () => {
      const at = clock();
      try {
        if (child && !exited) {
          try { if (child.connected) child.disconnect(); else kill('SIGTERM'); }
          catch { kill('SIGTERM'); }
          termTimer = setTimeout(() => kill('SIGTERM'), Math.max(0, Math.min(250, effectiveDeadline - clock())));
          killTimer ??= setTimeout(() => kill('SIGKILL'), Math.max(0, Math.min(1000, effectiveDeadline - clock())));
          // Never clear ownership or stop RAM/deadline guards before OS exit.
          await exitPromise;
        }
        sampleMemory();
        usage.close_ms = clock() - at;
      } finally { stopMonitors(); }
      if (usage.failure) throw failure();
    })();
    return closing;
  }
  return {
    start, encode, close,
    get pid() { return usage.remaining_pid; },
    observedMetrics: () => structuredClone(usage),
  };
}
