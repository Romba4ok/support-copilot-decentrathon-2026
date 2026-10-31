import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.mjs';

const dataDir = fileURLToPath(new URL('../data/hosting-demo/', import.meta.url));
const password = 'test-only-strong-password-123';
const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;

test('hosted HTTP policy protects the application while synthetic stateless triage works', async t => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'support-hosted-test-'));
  const app = createApp({ dataDir, runtimeDir, seed: false, allowRemote: true, publicOrigin: 'https://support.example', adminPassword: password });
  t.after(async () => {
    app.closeAllConnections();
    if (app.listening) await new Promise(resolve => app.close(resolve));
    rmSync(runtimeDir, { recursive: true, force: true });
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  function call(path, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: app.address().port, path, method, headers: { Host: 'support.example', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text, data: text ? JSON.parse(text) : null }));
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  await t.test('unauthenticated platform health is minimal and contains no application information', async () => {
    const result = await call('/healthz');
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { status: 'ok' });
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['www-authenticate'], undefined);
    assert.doesNotMatch(result.text, /source|ticket|corpus|password|model|runtime|intelligence/i);
    const head = await call('/healthz', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.text, '');
  });
  await t.test('application health and root require authentication with the browser challenge', async () => {
    for (const path of ['/api/health', '/']) {
      const result = await call(path);
      assert.equal(result.status, 401);
      assert.equal(result.data.error.code, 'AUTH_REQUIRED');
      assert.equal(result.headers['www-authenticate'], 'Basic realm="Support Copilot", charset="UTF-8"');
      assert.doesNotMatch(result.text, /test-only-strong-password|source_count|corpus_count/);
    }
  });
  await t.test('authenticated synthetic triage succeeds without creating queue items or persisting the input', async () => {
    const headers = { Authorization: authorization, Origin: 'https://support.example' };
    const health = await call('/api/health', { headers });
    assert.equal(health.status, 200);
    assert.equal(health.data.data_available, true);
    const beforeQueue = await call('/api/tickets', { headers });
    assert.deepEqual(beforeQueue.data, { tickets: [] });
    const stateFile = join(runtimeDir, 'state.json');
    const beforeState = existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : null;
    const result = await call('/triage', { method: 'POST', headers, body: { kind: 'report', messages: [{ role: 'player', text: 'SYNTHETIC_HOSTED_HTTP_TEST: игра закрывается при входе, нужна помощь.' }] } });
    assert.equal(result.status, 200);
    assert.equal(typeof result.data.draft_reply.text, 'string');
    assert.deepEqual((await call('/api/tickets', { headers })).data, { tickets: [] });
    assert.equal(existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : null, beforeState);
  });
  await t.test('wrong public host and origin are rejected even with correct credentials', async () => {
    for (const headers of [
      { Host: 'evil.example' },
      { Host: 'support.example:443' },
      { Origin: 'https://evil.example' },
      { Origin: 'http://support.example' },
      { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' }
    ]) {
      const result = await call('/api/health', { headers: { Authorization: authorization, ...headers } });
      assert.equal(result.status, 403);
      assert.ok(['INVALID_HOST', 'INVALID_ORIGIN'].includes(result.data.error.code));
    }
  });
  await t.test('external document navigation reaches authenticated application but cannot mutate cross-site', async () => {
    const headers = { Authorization: authorization, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
    assert.equal((await call('/api/health', { headers })).status, 200);
    const denied = await call('/triage', { method: 'POST', headers, body: { kind: 'report', messages: [{ role: 'player', text: 'Synthetic external mutation' }] } });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, 'INVALID_ORIGIN');
  });
});
