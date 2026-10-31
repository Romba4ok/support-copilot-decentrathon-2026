import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter, getEventListeners} from 'node:events';
import {fork} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createRoutingEncoderSession, routingQueryText, ROUTING_ENCODER_LIMITS} from '../src/intelligence/routing-encoder-session.mjs';

const MODEL = resolve('synthetic-test-model'), RESERVE = 256 * 1024 ** 2;
const vector = () => Array.from({length: 384}, (_, i) => i === 0 ? 2 : 0);
function fakeProcess({reply, closeDelay = 0, pid = 12345, closeEvent = false} = {}) {
  const child = new EventEmitter();
  Object.assign(child, {pid, exitCode: null, signalCode: null, connected: true, requests: [], kills: []});
  function exit(code = 0, signal = null) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.exitCode = code; child.signalCode = signal;
    child.emit('exit', code, signal);
    if (closeEvent) child.emit('close', code, signal);
  }
  child.send = (message, callback) => {
    child.requests.push(message); callback?.();
    const response = reply ? reply(message) : {result: message.type === 'initialize' ? {ready: true} : {vector: vector()}};
    if (response) queueMicrotask(() => child.emit('message', {id: message.id, memory: {rss: 1000}, ...response}));
  };
  child.disconnect = () => { child.connected = false; setTimeout(() => exit(), closeDelay); };
  child.kill = signal => { child.kills.push(signal); setTimeout(() => exit(null, signal), closeDelay); return true; };
  child.exit = exit;
  return child;
}
function session(child, extra = {}, options = {}) {
  return createRoutingEncoderSession({modelDir: MODEL, deadline: performance.now() + 3000, ...options}, {
    forkProcess: () => child, freeMemory: () => RESERVE * 4, validateDirectory: async path => path, ...extra,
  });
}

test('routing worker is byte-identical to the previously measured offline worker', async () => {
  const bytes = await readFile(new URL('../src/intelligence/routing-worker.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '647895b4ae4b3b77a1ba8909487b19af6ea90b91842e6a64b2c25335abf31295');
});

test('query serialization accepts player text only, prefixes then bounds characters', () => {
  assert.equal(routingQueryText('hello\nsecond message'), 'query: hello\nsecond message');
  assert.equal(routingQueryText('x'.repeat(13000)).length, 12000);
  for (const input of ['', ' ', {messages: [], category: 'payment'}, undefined]) assert.throws(() => routingQueryText(input));
  for (const modelDir of ['repo/model', 'https://host/model', '\\\\host\\model']) assert.throws(() => createRoutingEncoderSession({modelDir, deadline: 100}));
  assert.throws(() => createRoutingEncoderSession({modelDir: MODEL}), /absolute_deadline/);
});

test('one offline worker, exact start/RPC shape, normalized vectors and idempotent OS-exit close', async () => {
  const child = fakeProcess({closeEvent: true}); let forks = 0, forkOptions;
  const encoder = session(child, {forkProcess: (path, args, options) => { forks++; forkOptions = options; assert.match(path, /routing-worker\.mjs$/u); return child; }});
  const first = encoder.start(); assert.equal(encoder.start(), first); await first;
  assert.equal(encoder.pid, 12345);
  assert.deepEqual(await encoder.encode('player text'), vector().map(x => x / 2));
  assert.deepEqual(child.requests.map(({type, modelDir, text}) => ({type, modelDir, text})), [
    {type: 'initialize', modelDir: MODEL, text: undefined}, {type: 'embed', modelDir: undefined, text: 'query: player text'},
  ]);
  assert.equal(forks, 1); assert.deepEqual(forkOptions.stdio, ['ignore', 'ignore', 'ignore', 'ipc']);
  assert.equal(forkOptions.env.HF_HUB_OFFLINE, '1'); assert.equal(forkOptions.env.TRANSFORMERS_OFFLINE, '1');
  const closing = encoder.close(); assert.equal(encoder.close(), closing); await closing;
  const metrics = encoder.observedMetrics();
  assert.equal(encoder.pid, null); assert.equal(metrics.started, 1); assert.equal(metrics.closed, 1);
  assert.equal(metrics.exit.observed_via, 'exit'); assert.equal(metrics.encode_calls, 1);
  assert.equal(metrics.rpc_memory_samples, 2); assert.equal(metrics.maximum_rpc_sample_rss_bytes, 1000);
  assert.match(metrics.memory_measurement, /not continuous peak/u);
  await assert.rejects(encoder.encode('after closed'), /closed/u);
});

test('serial requests reject concurrency without killing the active request', async () => {
  const child = fakeProcess({reply: m => m.type === 'initialize' ? {result: {ready: true}} : null});
  const encoder = session(child); await encoder.start();
  const pending = encoder.encode('first'); await delay(1);
  await assert.rejects(encoder.encode('second'), /serial_requests/u);
  child.emit('message', {id: 2, result: {vector: vector()}});
  assert.equal((await pending)[0], 1); assert.equal(child.kills.length, 0); await encoder.close();
});

test('malformed and zero/nonfinite embeddings fail and await actual owned exit', async () => {
  for (const bad of [[], Array(384).fill(0), Array(384).fill(NaN)]) {
    const child = fakeProcess({reply: m => ({result: m.type === 'initialize' ? {ready: true} : {vector: bad}})});
    const encoder = session(child);
    await assert.rejects(encoder.encode('player'), /invalid_embedding/u);
    assert.equal(encoder.pid, null); assert.equal(encoder.observedMetrics().closed, 1);
  }
});

test('aborted active RPC terminates only its worker and closes before rejection', async () => {
  const child = fakeProcess({reply: m => m.type === 'initialize' ? {result: {ready: true}} : null});
  const encoder = session(child), abort = new AbortController();
  await encoder.start(); const pending = encoder.encode('player', {signal: abort.signal}); await delay(1); abort.abort();
  await assert.rejects(pending, /rpc_aborted/u);
  assert.equal(encoder.pid, null); assert.equal(encoder.observedMetrics().closed, 1); assert.ok(child.kills.includes('SIGTERM'));
});

test('pre-aborted encode never validates or spawns and does not retain cancellation listeners', async () => {
  let validations = 0, forks = 0;
  const abort = new AbortController(); abort.abort();
  const encoder = session(null, {
    validateDirectory: async path => { validations++; return path; },
    forkProcess: () => { forks++; },
  });
  await assert.rejects(encoder.encode('player', {signal: abort.signal}), /rpc_aborted/u);
  assert.equal(validations, 0); assert.equal(forks, 0); assert.equal(encoder.pid, null);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('encode abort during delayed validation rejects promptly and prevents a late fork or initialize', async () => {
  let release, forks = 0;
  const abort = new AbortController(), child = fakeProcess();
  const encoder = session(child, {
    validateDirectory: () => new Promise(ok => { release = ok; }),
    forkProcess: () => { forks++; return child; },
  });
  const pending = encoder.encode('player', {signal: abort.signal});
  await delay(1); abort.abort();
  await assert.rejects(pending, /rpc_aborted/u);
  assert.equal(forks, 0); release(MODEL); await delay(5);
  assert.equal(forks, 0); assert.equal(child.requests.length, 0); assert.equal(encoder.pid, null);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('encode cancellation during initialization awaits actual exit and never submits embed', async () => {
  const abort = new AbortController(), child = fakeProcess({reply: () => null, closeDelay: 20});
  const encoder = session(child), pending = encoder.encode('player', {signal: abort.signal});
  await delay(1); assert.deepEqual(child.requests.map(m => m.type), ['initialize']); abort.abort();
  await assert.rejects(pending, /rpc_aborted/u);
  assert.deepEqual(child.requests.map(m => m.type), ['initialize']);
  assert.equal(encoder.pid, null); assert.equal(encoder.observedMetrics().closed, 1);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('requested close records physical exit but rejects nonzero code or unrequested termination', async () => {
  for (const [code, signal] of [[4, null], [null, 'SIGTERM']]) {
    const child = fakeProcess(); child.disconnect = () => { child.connected = false; queueMicrotask(() => child.exit(code, signal)); };
    const encoder = session(child); await encoder.start();
    const closing = encoder.close(); assert.equal(encoder.close(), closing);
    await assert.rejects(closing, /abnormal_worker_exit/u);
    const metrics = encoder.observedMetrics();
    assert.equal(metrics.failure, 'routing_abnormal_worker_exit'); assert.equal(encoder.pid, null);
    assert.equal(metrics.started, 1); assert.equal(metrics.closed, 1);
    assert.equal(metrics.exit.code, code); assert.equal(metrics.exit.signal, signal);
    assert.equal(encoder.close(), closing);
  }
});

test('global deadline settles hung validation without spawning or hidden warmup', async () => {
  let forks = 0;
  const encoder = session(null, {forkProcess: () => { forks++; }, validateDirectory: () => new Promise(() => {})}, {deadline: performance.now() + 40});
  const at = performance.now(); await assert.rejects(encoder.start(), /native_deadline/u);
  assert.ok(performance.now() - at < 1000); assert.equal(forks, 0); assert.equal(encoder.pid, null);
});

test('deadline clamp, initial reserve and pre-aborted signal prevent unguarded admission', async () => {
  let forks = 0;
  const encoder = session(null, {forkProcess: () => { forks++; }, freeMemory: () => RESERVE - 1}, {deadline: performance.now() + 999999});
  const metrics = encoder.observedMetrics();
  assert.ok(metrics.requested_deadline - metrics.deadline > 900000);
  assert.ok(metrics.deadline <= performance.now() + ROUTING_ENCODER_LIMITS.native_ms);
  await assert.rejects(encoder.start(), /memory_reserve/u);
  const abort = new AbortController(); abort.abort();
  const cancelled = session(null, {forkProcess: () => { forks++; }}, {signal: abort.signal});
  await assert.rejects(cancelled.start()); assert.equal(forks, 0);
});

test('close interrupts hung validation, prevents late spawn and remains the same promise', async () => {
  let release, forks = 0;
  const encoder = session(null, {forkProcess: () => { forks++; }, validateDirectory: () => new Promise(ok => { release = ok; })});
  const pending = encoder.start(); await delay(1); const closed = encoder.close(); assert.equal(encoder.close(), closed);
  await closed; await assert.rejects(pending, /closed/u); release(MODEL); await delay(1); assert.equal(forks, 0);
});

test('100ms RAM monitor stays live during delayed OS exit and rejects low reserve', async () => {
  const child = fakeProcess({closeDelay: 260}); let memory = RESERVE * 4, samples = 0;
  const encoder = session(child, {freeMemory: () => { samples++; return memory; }});
  await encoder.start(); const pending = encoder.close(); setTimeout(() => { memory = RESERVE - 1; }, 110);
  await assert.rejects(pending, /memory_reserve/u);
  assert.ok(samples >= 3); assert.equal(encoder.pid, null); assert.equal(encoder.observedMetrics().closed, 1);
});

test('global deadline includes actual cleanup, late exit rejects without clearing PID early', async () => {
  const child = fakeProcess({closeDelay: 100});
  const encoder = session(child, {}, {deadline: performance.now() + 50}); await encoder.start();
  const pending = encoder.close(); await delay(65); assert.equal(encoder.pid, 12345);
  await assert.rejects(pending, /native_deadline/u); assert.equal(encoder.pid, null);
});

test('unresponsive owned child is TERM then KILLed; ownership stays until actual exit', async () => {
  const child = fakeProcess(); child.disconnect = () => { child.connected = false; };
  child.kill = signal => { child.kills.push(signal); if (signal === 'SIGKILL') setTimeout(() => child.exit(null, signal), 10); return true; };
  const encoder = session(child); await encoder.start();
  const closing = encoder.close(); await delay(300);
  assert.equal(encoder.pid, 12345); assert.ok(child.kills.includes('SIGTERM'));
  await closing; assert.equal(encoder.pid, null); assert.equal(encoder.observedMetrics().closed, 1);
  assert.ok(child.kills.indexOf('SIGTERM') < child.kills.indexOf('SIGKILL'));
});

test('new logical sessions allow OS PID reuse after the prior session actually exits', async () => {
  const a = session(fakeProcess()), b = session(fakeProcess());
  await a.start(); await a.close(); await b.start(); await b.close();
  assert.notEqual(a.observedMetrics().incarnation, b.observedMetrics().incarnation);
  assert.equal(a.observedMetrics().closed, 1); assert.equal(b.observedMetrics().closed, 1);
});

test('failed initialization and unexpected exit fail closed with no restart', async () => {
  const child = fakeProcess({reply: () => ({error: 'synthetic initialization failure'})}), encoder = session(child);
  await assert.rejects(encoder.start(), /synthetic initialization failure/u);
  assert.equal(encoder.pid, null); assert.equal(encoder.observedMetrics().started, 1);
  const child2 = fakeProcess(), encoder2 = session(child2); await encoder2.start(); child2.exit(4);
  await assert.rejects(encoder2.close(), /unexpected_worker_exit/u); assert.equal(encoder2.pid, null);
});

test('REAL trivial Node fork with ignored stdio: OS exit reaps even without close (no E5/model)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'routing-session-test-'));
  const fixture = join(dir, 'artificial-worker.mjs');
  await writeFile(fixture, `process.on('message',m=>process.send({id:m.id,result:m.type==='initialize'?{ready:true}:{vector:Array.from({length:384},(_,i)=>i===0?1:0)},memory:process.memoryUsage()}));process.on('disconnect',()=>process.exit(0));\n`);
  let child, closeSeen = false;
  const encoder = session(null, {forkProcess: (_path, args, options) => { child = fork(fixture, args, options); child.on('close', () => { closeSeen = true; }); return child; }}, {deadline: performance.now() + 3000});
  try {
    await encoder.start(); assert.equal((await encoder.encode('synthetic only'))[0], 1);
    await encoder.close(); const metrics = encoder.observedMetrics();
    assert.equal(metrics.exit.code, 0); assert.equal(metrics.exit.observed_via, 'exit');
    assert.equal(metrics.started, 1); assert.equal(metrics.closed, 1); assert.equal(encoder.pid, null);
    // Whether Node emits close is platform-dependent. OS exit is sufficient.
    assert.equal(typeof closeSeen, 'boolean'); assert.equal(child.exitCode, 0);
  } finally { await encoder.close().catch(() => {}); await rm(dir, {recursive: true, force: true}); }
});
