import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createApp } from '../src/server.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const tmp = join(appRoot, 'tests/.tmp');
mkdirSync(tmp, { recursive: true });
const dataDir = process.env.DATA_DIR || resolve(appRoot, '../handout');
const sample = { kind: 'report', messages: [{ role: 'player', text: 'Что такое DM?' }] };
function setup(t) {
  const directory = mkdtempSync(join(tmp, 'ownership-'));
  t.after(() => { assert.ok(relative(tmp, directory).startsWith('ownership-')); rmSync(directory, { recursive: true, force: true }); });
  return { directory, runtimeDir: join(directory, 'runtime') };
}
async function dispose(app) {
  try { await app.workspace.close(); }
  finally { app.releaseRuntimeLease(); }
}
function cli(input, runtimeDir) {
  return spawnSync(process.execPath, [join(appRoot, 'scripts/import-tickets.mjs'), '--in', input, '--runtime-dir', runtimeDir, '--data-dir', dataDir, '--batch-size', '1'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
}
async function owner(t, runtimeDir) {
  const code = `import {createApp} from ${JSON.stringify(new URL('../src/server.mjs', import.meta.url).href)};
    const app=createApp({runtimeDir:process.argv[1],dataDir:process.argv[2],seed:false});
    app.store.transact(state=>{if(!state.feedback.length)state.feedback.push({id:'synthetic-preserved-feedback'});});
    process.send({ready:true}); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, runtimeDir, dataDir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } });
  await Promise.race([
    once(child, 'message').then(([message]) => assert.equal(message.ready, true)),
    once(child, 'exit').then(() => { throw new Error(`Owner exited before ready: ${errors}`); }),
  ]);
  return child;
}

test('independent owners in the same PID are refused; server close permits reopen', async t => {
  const { runtimeDir } = setup(t);
  const app = createApp({ dataDir, runtimeDir, seed: false });
  t.after(() => dispose(app));
  const state = readFileSync(join(runtimeDir, 'state.json'), 'utf8');
  const workspace = readFileSync(join(runtimeDir, 'workspace.json'), 'utf8');
  assert.throws(() => createApp({ dataDir, runtimeDir, seed: false }), { code: 'RUNTIME_BUSY' });
  assert.equal(readFileSync(join(runtimeDir, 'state.json'), 'utf8'), state);
  assert.equal(readFileSync(join(runtimeDir, 'workspace.json'), 'utf8'), workspace);
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  await new Promise(accept => app.close(accept));
  assert.equal(existsSync(join(runtimeDir, '.runtime-owner')), false);
  const reopened = createApp({ dataDir, runtimeDir, seed: false });
  t.after(() => dispose(reopened));
  app.releaseRuntimeLease();
  assert.throws(() => createApp({ dataDir, runtimeDir, seed: false }), { code: 'RUNTIME_BUSY' });
  assert.throws(() => app.store.transact(value => { value.feedback.push({ id: 'late-write' }); }), { code: 'RUNTIME_CLOSED' });
});

test('CLI refuses a live process before changing queue/workspace or creating import checkpoints', { timeout: 15000 }, async t => {
  const { directory, runtimeDir } = setup(t);
  const child = await owner(t, runtimeDir);
  const input = join(directory, 'synthetic.jsonl'); writeFileSync(input, JSON.stringify(sample) + '\n');
  const before = ['state.json', 'workspace.json'].map(name => readFileSync(join(runtimeDir, name), 'utf8'));
  const result = cli(input, runtimeDir);
  assert.equal(result.status, 1); assert.match(result.stderr, /owned by another live process/u);
  assert.deepEqual(['state.json', 'workspace.json'].map(name => readFileSync(join(runtimeDir, name), 'utf8')), before);
  assert.equal(existsSync(join(runtimeDir, 'imports')), false);
  assert.equal(child.exitCode, null);
});

test('actual killed owner is reclaimed without losing state; a successor remains exclusive', { timeout: 15000 }, async t => {
  const { runtimeDir } = setup(t);
  const child = await owner(t, runtimeDir);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  assert.equal(existsSync(join(runtimeDir, '.runtime-owner')), true);
  const reopened = createApp({ dataDir, runtimeDir, seed: false });
  t.after(() => dispose(reopened));
  assert.equal(reopened.store.snapshot().feedback[0].id, 'synthetic-preserved-feedback');
  assert.throws(() => createApp({ dataDir, runtimeDir, seed: false }), { code: 'RUNTIME_BUSY' });
});

test('reused self PID from an older process generation is reclaimed; current generation stays exclusive', async t => {
  const { runtimeDir } = setup(t), token = randomUUID();
  const lock = join(runtimeDir, '.runtime-owner'); mkdirSync(lock, { recursive: true });
  const marker = `${process.pid}-${token}.json`;
  writeFileSync(join(lock, marker), JSON.stringify({ pid: process.pid, token, hostname: hostname(), process_time_origin_ms: performance.timeOrigin - 60000, created_at: new Date(performance.timeOrigin - 60000).toISOString() }));
  const app = createApp({ dataDir, runtimeDir, seed: false });
  t.after(() => dispose(app));
  const files = readdirSync(lock); assert.equal(files.length, 1); assert.notEqual(files[0], marker);
  const currentOwner = JSON.parse(readFileSync(join(lock, files[0]), 'utf8'));
  assert.equal(currentOwner.pid, process.pid); assert.equal(currentOwner.process_time_origin_ms, performance.timeOrigin);
  assert.equal(currentOwner.hostname, hostname());
  assert.throws(() => createApp({ dataDir, runtimeDir, seed: false }), { code: 'RUNTIME_BUSY' });
  assert.deepEqual(readdirSync(lock), files);
});

test('a live self PID marker with unknown process identity is conservatively refused', t => {
  const { runtimeDir } = setup(t), token = randomUUID();
  const lock = join(runtimeDir, '.runtime-owner'); mkdirSync(lock, { recursive: true });
  const marker = `${process.pid}-${token}.json`;
  writeFileSync(join(lock, marker), JSON.stringify({ pid: process.pid, token, hostname: hostname(), created_at: new Date().toISOString() }));
  assert.throws(() => createApp({ dataDir, runtimeDir, seed: false }), { code: 'RUNTIME_BUSY' });
  assert.equal(existsSync(join(runtimeDir, 'state.json')), false);
  assert.deepEqual(readdirSync(lock), [marker]);
});

test('foreign or unknown host cannot reclaim a same-PID marker with another time origin', t => {
  const { runtimeDir } = setup(t), token = randomUUID();
  const lock = join(runtimeDir, '.runtime-owner'); mkdirSync(lock, { recursive: true });
  const marker = `${process.pid}-${token}.json`;
  for (const host of [`${hostname()}-different-container`, undefined]) {
    const contents = JSON.stringify({ pid: process.pid, token, ...(host ? { hostname: host } : {}), process_time_origin_ms: performance.timeOrigin - 60000 });
    writeFileSync(join(lock, marker), contents);
    assert.throws(() => createApp({ dataDir, runtimeDir, seed: false }), { code: 'RUNTIME_BUSY' });
    assert.equal(readFileSync(join(lock, marker), 'utf8'), contents);
    assert.deepEqual(readdirSync(lock), [marker]);
    assert.equal(existsSync(join(runtimeDir, 'state.json')), false);
    assert.equal(existsSync(join(runtimeDir, 'workspace.json')), false);
  }
});

test('constructor failure releases ownership without removing damaged state', async t => {
  const { runtimeDir } = setup(t);
  mkdirSync(runtimeDir); writeFileSync(join(runtimeDir, 'state.json'), '{ damaged');
  assert.throws(() => createApp({ dataDir, runtimeDir, seed: false }));
  assert.equal(existsSync(join(runtimeDir, '.runtime-owner')), false);
  assert.equal(readFileSync(join(runtimeDir, 'state.json'), 'utf8'), '{ damaged');
  writeFileSync(join(runtimeDir, 'state.json'), JSON.stringify({ version: 1, tickets: [], feedback: [] }));
  const reopened = createApp({ dataDir, runtimeDir, seed: false });
  t.after(() => dispose(reopened));
});

test('SIGKILL during a real CLI import resumes the checkpoint exactly once', { timeout: 30000 }, async t => {
  const { directory, runtimeDir } = setup(t);
  const app = createApp({ dataDir, runtimeDir, seed: false });
  app.store.transact(state => { state.feedback.push({ id: 'synthetic-before-import' }); });
  await dispose(app);
  const input = join(directory, 'synthetic-import.jsonl'), total = 100;
  writeFileSync(input, Array.from({ length: total }, (_, index) => JSON.stringify({ ...sample, ticket_id: `authored-${index}` })).join('\n') + '\n');
  const args = [join(appRoot, 'scripts/import-tickets.mjs'), '--in', input, '--runtime-dir', runtimeDir, '--data-dir', dataDir, '--batch-size', String(total)];
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } });
  const originalSize = statSync(join(runtimeDir, 'state.json')).size, deadline = Date.now() + 10000;
  while (Date.now() < deadline && child.exitCode === null && statSync(join(runtimeDir, 'state.json')).size < originalSize + 10000) await delay(2);
  child.kill('SIGKILL'); await exited;
  const readState = () => JSON.parse(readFileSync(join(runtimeDir, 'state.json'), 'utf8'));
  const partial = readState().tickets.length;
  assert.ok(partial > 0 && partial < total, `Expected a partial import, observed ${partial}`);
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
  }
  const state = readState();
  assert.equal(state.tickets.length, total); assert.equal(new Set(state.tickets.map(ticket => ticket.id)).size, total);
  assert.deepEqual(state.feedback, [{ id: 'synthetic-before-import' }]);
  assert.equal(existsSync(join(runtimeDir, '.runtime-owner')), false);
  t.diagnostic(`Actual interrupted importer: ${partial}/${total} durable tickets; resumed ${total}/${total}; repeated import added 0.`);
});

test('CLI releases its lease on success/error and clears a recovered checkpoint error', async t => {
  const { directory, runtimeDir } = setup(t);
  const input = join(directory, 'synthetic.jsonl'); writeFileSync(input, JSON.stringify(sample) + '\n');
  let result = cli(input, runtimeDir); assert.equal(result.status, 0, result.stderr);
  const checkpointPath = JSON.parse(result.stdout).checkpoint;
  const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
  checkpoint.status = 'interrupted'; checkpoint.error = 'synthetic prior failure';
  writeFileSync(checkpointPath, JSON.stringify(checkpoint));
  result = cli(input, runtimeDir); assert.equal(result.status, 0, result.stderr);
  const recovered = JSON.parse(readFileSync(checkpointPath, 'utf8'));
  assert.equal(recovered.status, 'completed'); assert.equal(Object.hasOwn(recovered, 'error'), false);
  assert.equal(existsSync(join(runtimeDir, '.runtime-owner')), false);
  writeFileSync(input, '{ invalid\n'); result = cli(input, runtimeDir); assert.equal(result.status, 1);
  assert.equal(existsSync(join(runtimeDir, '.runtime-owner')), false);
  const reopened = createApp({ dataDir, runtimeDir, seed: false });
  t.after(() => dispose(reopened));
  assert.equal(reopened.store.snapshot().tickets.length, 1);
});
