import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestAccessPolicy } from '../src/http-access.mjs';

const password = 'test-password-0123456789';
const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
const request = (headers = {}, remoteAddress = '127.0.0.1', extra = {}) => ({ headers: { host: 'localhost:3000', ...headers }, socket: { remoteAddress }, ...extra });
const publicPolicy = () => createRequestAccessPolicy({ allowRemote: true, publicOrigin: 'https://support.example', adminPassword: password });
const publicRequest = (headers = {}, extra = {}) => request({ host: 'support.example', authorization, ...headers }, '10.0.0.8', extra);
const errorCode = (fn, status, code) => assert.throws(fn, e => e.status === status && e.code === code);

test('local policy preserves loopback, Docker bridge opt-in, and same origin checks', () => {
  const local = createRequestAccessPolicy();
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.doesNotThrow(() => local(request({ origin: 'http://localhost:3000' }, address)));
  errorCode(() => local(request({}, '10.0.0.8')), 403, 'LOCAL_ONLY');
  const docker = createRequestAccessPolicy({ allowRemote: true });
  assert.doesNotThrow(() => docker(request({}, '10.0.0.8')));
  for (const host of ['evil.example', 'localhost@evil.example', 'evil.example@localhost']) errorCode(() => docker(request({ host }, '10.0.0.8')), 403, 'INVALID_HOST');
  for (const origin of ['https://localhost:3000', 'http://evil.example', 'null']) errorCode(() => local(request({ origin })), 403, 'INVALID_ORIGIN');
  errorCode(() => local(request({ 'sec-fetch-site': 'cross-site' })), 403, 'INVALID_ORIGIN');
});

test('public configuration fails closed before accepting requests', () => {
  for (const publicOrigin of ['http://support.example', 'https://user:pass@support.example', 'https://support.example/path', 'https://support.example/?x=1', 'https://support.example/#hash', 'garbage', ' https://support.example']) assert.throws(() => createRequestAccessPolicy({ allowRemote: true, publicOrigin, adminPassword: password }));
  assert.throws(() => createRequestAccessPolicy({ publicOrigin: 'https://support.example', adminPassword: password }));
  for (const adminPassword of [null, '', 'short', 1234567890123456]) assert.throws(() => createRequestAccessPolicy({ allowRemote: true, publicOrigin: 'https://support.example', adminPassword }));
  for (const adminUsername of ['', 'a:b', 'a\nb']) assert.throws(() => createRequestAccessPolicy({ allowRemote: true, publicOrigin: 'https://support.example', adminPassword: password, adminUsername }));
});

test('public requests require exact public host and HTTPS origin, regardless of forwarded headers', () => {
  const policy = publicPolicy();
  assert.doesNotThrow(() => policy(publicRequest()));
  assert.doesNotThrow(() => policy(publicRequest({ origin: 'https://support.example', 'sec-fetch-site': 'same-origin' })));
  assert.doesNotThrow(() => policy(publicRequest({ authorization: authorization.replace('Basic', 'bAsIc') })));
  for (const host of ['localhost:3000', 'support.example:443', 'support.example.evil', 'SUPPORT.EXAMPLE']) errorCode(() => policy(publicRequest({ host, 'x-forwarded-host': 'support.example' })), 403, 'INVALID_HOST');
  for (const origin of ['http://support.example', 'https://support.example/', 'https://evil.example', 'null', '']) errorCode(() => policy(publicRequest({ origin })), 403, 'INVALID_ORIGIN');
  errorCode(() => policy(publicRequest({ 'sec-fetch-site': 'cross-site' })), 403, 'INVALID_ORIGIN');
});

test('public HTML and API requests reject missing, wrong, malformed or duplicate credentials', () => {
  const policy = publicPolicy();
  for (const authorization of [undefined, '', 'Bearer secret', 'Basic !!!', 'Basic YQ==', 'Basic YQ', 'Basic YQ===', 'Basic YR==', `Basic ${Buffer.from('admin:wrong-password').toString('base64')}`, ['one', 'two']]) {
    for (const url of ['/', '/app.js', '/api/health', '/api/tickets']) {
      assert.throws(() => policy(publicRequest({ authorization }, { url })), e => e.status === 401 && e.code === 'AUTH_REQUIRED' && e.headers['WWW-Authenticate'] === 'Basic realm="Support Copilot", charset="UTF-8"' && !e.message.includes(password));
    }
  }
  errorCode(() => policy(publicRequest({}, { rawHeaders: ['Authorization', authorization, 'authorization', authorization] })), 401, 'AUTH_REQUIRED');
  errorCode(() => policy(publicRequest({}, { headersDistinct: { authorization: [authorization, authorization] } })), 401, 'AUTH_REQUIRED');
});

test('external top-level safe navigation is allowed while cross-site subresources and mutations remain blocked', () => {
  const policy = publicPolicy();
  const navigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  for (const method of ['GET', 'HEAD']) {
    assert.doesNotThrow(() => policy(publicRequest(navigation, { method, url: '/' })));
    errorCode(() => policy(publicRequest({ ...navigation, origin: 'https://evil.example' }, { method })), 403, 'INVALID_ORIGIN');
    errorCode(() => policy(publicRequest({ ...navigation, authorization: undefined }, { method })), 401, 'AUTH_REQUIRED');
  }
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']) errorCode(() => policy(publicRequest(navigation, { method })), 403, 'INVALID_ORIGIN');
  for (const headers of [
    { ...navigation, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
    { ...navigation, 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' },
    { ...navigation, 'sec-fetch-dest': 'iframe' },
    { ...navigation, 'sec-fetch-mode': undefined },
    { ...navigation, 'sec-fetch-dest': undefined }
  ]) errorCode(() => policy(publicRequest(headers, { method: 'GET' })), 403, 'INVALID_ORIGIN');
});
