import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createEngine, sanitizeInput } from './core/engine.mjs';
import { createStore, acquireRuntimeLease } from './storage.mjs';
import { createWorkspace, parseImport } from './workspace/index.mjs';
import { parseInferenceConfig } from './intelligence/config.mjs';
import { codeContextDraft, applyGenerationProjection } from './intelligence/draft.mjs';
import { confirmationIntent } from './workspace/reply-policy.mjs';
import { createRequestAccessPolicy } from './http-access.mjs';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MAX_BODY = 256 * 1024;
const MAX_TEXT = 20000;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** Allowlisted player input only; historical outcomes and admin replies never enter storage/inference. */
export function safeInput(value) {
  return sanitizeInput(value);
}

function readJson(request, maximum = MAX_BODY) {
  const contentType = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return Promise.reject(problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.'));
  if (Number(request.headers['content-length']) > maximum) return Promise.reject(problem(413, 'BODY_TOO_LARGE', 'Request body is too large.'));
  return new Promise((accept, reject) => {
    const chunks = [];
    let bytes = 0;
    let oversized = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maximum) {
        if (!oversized) reject(problem(413, 'BODY_TOO_LARGE', 'Request body is too large.'));
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      if (oversized) return;
      try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(problem(400, 'INVALID_JSON', 'Request body is not valid JSON.')); }
    });
  });
}

export function createApp({ dataDir, runtimeDir = process.env.RUNTIME_DIR || join(appRoot, 'runtime'), publicDir = join(appRoot, 'public'), seed = true, allowRemote = false, publicOrigin = null, adminUsername = 'admin', adminPassword = null, refreshTriage = true, engine: suppliedEngine, intelligence } = {}) {
  const checkAccess = createRequestAccessPolicy({ allowRemote, publicOrigin, adminUsername, adminPassword });
  const lease = acquireRuntimeLease(runtimeDir);
  try {
  const engine = suppliedEngine || createEngine({ dataDir });
  const initialTickets = [];
  const fixture = join(appRoot, 'fixtures', 'demo-tickets.json');
  if (seed && !existsSync(join(runtimeDir, 'state.json')) && existsSync(fixture)) {
    const raw = JSON.parse(readFileSync(fixture, 'utf8'));
    const fixtures = Array.isArray(raw) ? raw : raw.tickets;
    for (const item of fixtures || []) initialTickets.push(makeTicket(safeInput(item), initialTickets));
  }
  const store = createStore({ runtimeDir, initialTickets });

  function historyInput(ticket) {
    return { ...safeInput(ticket.input || ticket), id: ticket.id };
  }

  // Triage is a projection of player input. Refresh it after an implementation update,
  // preserving operator decisions and texts while never feeding outcomes back to the engine.
  if (refreshTriage && store.snapshot().tickets.length) {
    store.transact(state => {
      const history = [];
      for (const ticket of state.tickets) {
        const input = safeInput(ticket.input || ticket);
        // Preserve a v2 projection until an explicit asynchronous re-analysis.
        if (ticket.triage?.analysis?.intelligence?.version === 'v2') { history.push({ ...input, id: ticket.id }); continue; }
        const oldDraft = ticket.triage?.draft_reply?.text;
        const triage = engine.triage(input, { history });
        if (ticket.edited_reply === oldDraft) ticket.edited_reply = triage.draft_reply.text;
        ticket.triage = triage;
        ticket.input = input;
        history.push({ ...input, id: ticket.id });
      }
    });
  }

  function makeTicket(input, history) {
    const now = new Date().toISOString();
    const triage = engine.triage(input, { history: history.map(historyInput) });
    return { ...input, input: structuredClone(input), id: randomUUID(), created_at: input.created_at || now, triage, status: 'open', edited_reply: triage.draft_reply.text, updated_at: now };
  }

  async function analyze(input, history = []) {
    history = history.map(historyInput);
    if (!intelligence) return engine.triage(input, { history });
    try { return await intelligence.triage(safeInput(input), { history }); }
    catch (error) {
      const result = engine.triage(input, { history });
      result.analysis.intelligence = { version: 'v2', mode: 'baseline-fallback', model: null, elapsed_ms: 0, baseline_category: result.category, candidates: [], fallback_reason: String(error.message).slice(0, 500) };
      return codeContextDraft(input, result, engine.sources());
    }
  }
  async function addTicket(input, id = randomUUID(), options = {}) {
    if (store.snapshot().tickets.length >= 10000) throw problem(409, 'QUEUE_LIMIT', 'The local queue contains 10000 tickets. Archive state before importing more.');
    const arrivalPolicy = options.replyPolicy || workspace.replyPolicyForArrival();
    const clean = safeInput(input), triage = await analyze(clean, store.snapshot().tickets);
    let created = false;
    const result = store.transact(state => {
      const existing = state.tickets.find(item => item.id === id);
      if (existing) return existing;
      if (state.tickets.length >= 10000) throw problem(409, 'QUEUE_LIMIT', 'The local queue contains 10000 tickets.');
      const timestamp = new Date().toISOString();
      const ticket = { ...clean, input: clean, id, created_at: clean.created_at || timestamp, triage, status: 'open', edited_reply: triage.draft_reply.text, updated_at: timestamp, arrival_reply_policy: arrivalPolicy };
      created = true;
      state.tickets.push(ticket); return ticket;
    });
    if (created) workspace.onArrival(result);
    return result;
  }
  const workspace = createWorkspace({ runtimeDir, store, engine, intelligence, analyze, addTicket });

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('Cache-Control', 'no-store');
    const json = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    try {
      // Public health checks disclose no corpus, queue, configuration or secrets.
      if (publicOrigin && request.url === '/healthz' && ['GET', 'HEAD'].includes(request.method)) return json(200, { status: 'ok' });
      checkAccess(request);
      let decoded;
      try { decoded = decodeURIComponent(request.url.split('?')[0]); }
      catch { throw problem(400, 'INVALID_PATH', 'Malformed request path.'); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) throw problem(400, 'INVALID_PATH', 'Invalid request path.');
      const url = new URL(request.url, `http://${request.headers.host}`);
      const path = decoded;
      const method = request.method;
      if (method === 'GET' && path === '/api/health') {
        const sources = engine.sources();
        return json(200, { status: 'ok', mode: intelligence?.status().mode || engine.mode, baseline_mode: engine.mode, sources: sources.length, source_count: sources.length, data_available: sources.length > 0, corpus_count: sources.length, local_only: !allowRemote, external_api_calls: 0, persistence: 'atomic-json', synthetic_demo: true, intelligence: intelligence?.status() || { mode: 'baseline-fallback', state: 'not_configured', model: null, reason: 'Intelligence is not configured' } });
      }
      if (method === 'GET' && path === '/api/intelligence') return json(200, { status: intelligence?.status() || { mode: 'baseline-fallback', state: 'not_configured', model: null, reason: 'Intelligence is not configured' } });
      if (method === 'GET' && path === '/api/settings') return json(200, workspace.settings());
      if (method === 'PATCH' && path === '/api/settings') return json(200, workspace.patchSettings(await readJson(request)));
      if (method === 'POST' && path === '/api/intelligence/initialize') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw problem(400, 'INVALID_INPUT', 'Initialization accepts an empty object only.');
        return json(202, { job: workspace.startJob('initialize') });
      }
      if (method === 'GET' && path === '/api/jobs') return json(200, { jobs: workspace.jobs() });
      const resumeRoute = /^\/api\/jobs\/([^/]+)\/resume$/.exec(path);
      if (method === 'POST' && resumeRoute) {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw problem(400, 'INVALID_INPUT', 'Resume accepts an empty object only.');
        return json(202, { job: workspace.resumeJob(resumeRoute[1]) });
      }
      if (method === 'POST' && path === '/api/tickets/import') return json(202, { job: workspace.importTickets(parseImport(await readJson(request, 2 * 1024 * 1024))) });
      if (method === 'GET' && path === '/api/quality') return json(200, workspace.quality());
      if (method === 'POST' && path === '/api/quality/annotations') return json(201, { annotation: workspace.annotate(await readJson(request)) });
      if (method === 'POST' && path === '/api/quality/compare') return json(200, await workspace.compare(await readJson(request)));
      if (method === 'GET' && path === '/api/radar') return json(200, workspace.radar());
      if (method === 'POST' && path === '/api/radar/rebuild') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw problem(400, 'INVALID_INPUT', 'Radar rebuild accepts an empty object only.');
        return json(202, { job: workspace.startJob('radar') });
      }
      if (method === 'GET' && path === '/api/templates') return json(200, { templates: workspace.templates() });
      if (method === 'POST' && path === '/api/templates') return json(201, { template: workspace.propose(await readJson(request)) });
      const templateRoute = /^\/api\/templates\/([^/]+)$/.exec(path);
      if (method === 'PATCH' && templateRoute) return json(200, { template: workspace.patchTemplate(templateRoute[1], await readJson(request)) });
      const analyzeRoute = /^\/api\/tickets\/([^/]+)\/(analyze|generate)$/.exec(path);
      if (method === 'POST' && analyzeRoute) {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw problem(400, 'INVALID_INPUT', 'This action accepts an empty object only.');
        const old = workspace.findTicket(analyzeRoute[1]), input = safeInput(old.input || old);
        if (analyzeRoute[2] === 'analyze') {
          const all = store.snapshot().tickets;
          const triage = await analyze(input, all.slice(0, all.findIndex(item => item.id === old.id)));
          const ticket = store.transact(state => {
            const current = state.tickets.find(item => item.id === old.id);
            // Re-read after inference so concurrent operator edits always survive.
            if (current.triage.needs_human && !triage.needs_human) {
              triage.needs_human = true;
              const reason = 'Сохранено ранее установленное требование проверки человеком.';
              if (!triage.reasons.includes(reason)) triage.reasons.push(reason);
            }
            if (current.edited_reply === current.triage.draft_reply.text) current.edited_reply = triage.draft_reply.text;
            current.triage = triage; current.updated_at = new Date().toISOString(); return current;
          });
          return json(200, { ticket });
        }
        const generation = intelligence ? await intelligence.generate(input, old.triage) : { status: 'unavailable', text: old.triage.draft_reply.text, reason: 'Intelligence is not configured', metrics: { generated: false, elapsed_ms: 0 } };
        const ticket = store.transact(state => {
          const current = state.tickets.find(item => item.id === old.id);
          applyGenerationProjection(current.triage, generation, engine.sources());
          current.updated_at = new Date().toISOString(); return current;
        });
        return json(200, { ticket, generation });
      }
      if (method === 'GET' && path === '/api/tickets') return json(200, { tickets: store.snapshot().tickets });
      if (method === 'GET' && path === '/api/feedback') return json(200, { feedback: store.snapshot().feedback });
      if (method === 'GET' && path === '/api/rules') {
        const query = (url.searchParams.get('q') || '').toLowerCase().slice(0, 1000);
        return json(200, { sources: engine.sources().filter(source => !query || [source.id, source.section, source.ref, source.text].join(' ').toLowerCase().includes(query)) });
      }
      if (method === 'GET' && path === '/api/search') {
        const query = (url.searchParams.get('q') || '').slice(0, 12000);
        if (!query.trim()) throw problem(400, 'INVALID_INPUT', 'Search query is required.');
        return json(200, intelligence ? await intelligence.search(query, { limit: url.searchParams.get('limit') || 8 }) : { mode: 'lexical-fallback', model: null, fallback_reason: 'Intelligence is not configured', candidates: engine.sources().filter(source => [source.section, source.ref, source.text].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0, 8) });
      }
      if (method === 'POST' && path === '/triage') {
        const input = safeInput(await readJson(request));
        return json(200, await analyze(input, input.reporter_hash && input.created_at ? store.snapshot().tickets.map(historyInput) : []));
      }
      if (method === 'POST' && path === '/api/tickets') {
        const input = safeInput(await readJson(request));
        const ticket = await addTicket(input);
        return json(201, { ticket });
      }
      const repliesRoute = /^\/api\/tickets\/([^/]+)\/replies$/.exec(path);
      if (method === 'GET' && repliesRoute) return json(200, workspace.replies(repliesRoute[1]));
      const ticketRoute = /^\/api\/tickets\/([^/]+)$/.exec(path);
      if (ticketRoute && method === 'GET') {
        const ticket = store.snapshot().tickets.find(item => item.id === ticketRoute[1]);
        if (!ticket) throw problem(404, 'NOT_FOUND', 'Ticket not found.');
        return json(200, { ticket });
      }
      if (ticketRoute && method === 'PATCH') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || !['save', 'confirm', 'escalate'].includes(body.action)) throw problem(400, 'INVALID_ACTION', 'action must be save, confirm or escalate.');
        if (Object.keys(body).some(key => !['action', 'draft_reply'].includes(key))) throw problem(400, 'INVALID_ACTION', 'Unsupported action field.');
        if (body.draft_reply !== undefined && (typeof body.draft_reply !== 'string' || !body.draft_reply.trim() || body.draft_reply.length > MAX_TEXT)) throw problem(400, 'INVALID_INPUT', 'draft_reply must be non-empty and at most 20000 characters.');
        const ticket = store.transact(state => {
          const item = state.tickets.find(entry => entry.id === ticketRoute[1]);
          if (!item) throw problem(404, 'NOT_FOUND', 'Ticket not found.');
          if (item.status === 'reviewed' && body.action === 'save') throw problem(409, 'INVALID_TRANSITION', 'A confirmed answer cannot be edited. Escalate it for further review.');
          const before = item.edited_reply;
          if (body.draft_reply !== undefined) item.edited_reply = body.draft_reply;
          item.status = body.action === 'confirm' ? 'reviewed' : body.action === 'escalate' ? 'escalated' : item.status;
          item.updated_at = new Date().toISOString();
          item.reply_revision = (item.reply_revision || 0) + 1;
          let intent;
          if (body.action === 'confirm') {
            intent = confirmationIntent(item);
            state.reply_confirmation_intents ||= [];
            if (!state.reply_confirmation_intents.some(entry => entry.id === intent.id)) state.reply_confirmation_intents.push(intent);
          }
          state.feedback.push({ id: randomUUID(), ticket_id: item.id, action: body.action, previous_reply: before, edited_reply: item.edited_reply, original_reply: item.triage.draft_reply.text, needs_human: item.triage.needs_human, confirmed_by: body.action === 'confirm' ? 'local_operator' : null, created_at: item.updated_at, ...(intent ? { reply_intent_id: intent.id } : {}) });
          return item;
        });
        if (body.action === 'confirm') workspace.confirmReply(ticket);
        return json(200, { ticket });
      }
      if (path.startsWith('/api/') || path === '/triage') throw problem(404, 'NOT_FOUND', 'Endpoint not found.');
      if (!['GET', 'HEAD'].includes(method)) throw problem(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed.');
      const root = resolve(publicDir);
      const file = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
      if (!file.startsWith(root + sep) || !mime[extname(file)] || !existsSync(file) || !statSync(file).isFile()) throw problem(404, 'NOT_FOUND', 'File not found.');
      response.writeHead(200, { 'Content-Type': mime[extname(file)] });
      response.end(method === 'HEAD' ? undefined : readFileSync(file));
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      if (status === 401 && error.headers?.['WWW-Authenticate']) response.setHeader('WWW-Authenticate', error.headers['WWW-Authenticate']);
      if (status === 500) console.error('Local request failed:', error.message);
      json(status, { error: { code: status === 500 ? 'INTERNAL_ERROR' : error.code || 'INVALID_INPUT', message: status === 500 ? 'Local request failed. Check the server terminal.' : error.message } });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.engine = engine;
  server.store = store;
  server.workspace = workspace;
  server.intelligence = intelligence;
  server.releaseRuntimeLease = lease.release;
  server.on('close', () => { void workspace.close(); void intelligence?.close?.(); lease.release(); });
  return server;
  } catch (error) { lease.release(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const allowRemote = process.env.ALLOW_REMOTE === '1';
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !allowRemote) throw new Error('A non-loopback HOST requires explicit ALLOW_REMOTE=1 (for a local Docker bridge).');
  const inference = parseInferenceConfig(process.env);
  const baseline = createEngine();
  const { createIntelligence } = await import('./intelligence/index.mjs');
  const intelligence = createIntelligence({ baseline, modelDir: process.env.MODEL_DIR || join(appRoot, 'runtime/models/multilingual-e5-small'), cacheDir: process.env.INDEX_DIR || join(appRoot, 'runtime/indexes'), ...inference, approvedTemplates: () => server.workspace.approvedTemplates() });
  const server = createApp({ allowRemote, engine: baseline, intelligence, publicOrigin: process.env.PUBLIC_ORIGIN || null, adminUsername: process.env.SUPPORT_ADMIN_USER || 'admin', adminPassword: process.env.SUPPORT_ADMIN_PASSWORD || null });
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  server.listen(port, host, () => console.log(`Support Copilot: http://${host.includes(':') ? `[${host}]` : host}:${port} (${server.engine.mode})`));
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeAllConnections();
    await Promise.all([server.workspace.close(), intelligence.close()]);
    process.exit(0);
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void shutdown().catch(error => { console.error('Shutdown failed:', error.message); process.exit(1); });
  });
}
