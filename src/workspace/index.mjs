import { randomUUID, createHash } from 'node:crypto';
import { createJsonStore } from '../storage.mjs';
import { sanitizeInput } from '../core/engine.mjs';
import { comparisonMetrics } from './metrics.mjs';
import { DEFAULT_REPLY_SETTINGS, settingsView, ticketGuard, sameTicketGuard, inputRevision, automaticReplyEligibility, confirmationIntent, isTaggedConfirmation } from './reply-policy.mjs';
import { applyGenerationProjection } from '../intelligence/draft.mjs';

const now = () => new Date().toISOString();
export const workspaceError = (status, code, message) => Object.assign(new Error(message), { status, code });
const invalid = message => workspaceError(400, 'INVALID_INPUT', message);
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw invalid('Unsupported request field or invalid object.');
}
function text(value, name, maximum = 20000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw invalid(`${name} must be non-empty text of at most ${maximum} characters.`);
  return value;
}
export const publicJob = job => { const { payload, ...visible } = job; return visible; };

export function parseImport(body, { maximum = 1000 } = {}) {
  object(body, ['tickets', 'jsonl']);
  if ((body.tickets === undefined) === (body.jsonl === undefined)) throw invalid('Provide tickets or jsonl, exclusively.');
  let rows = body.tickets;
  if (body.jsonl !== undefined) {
    if (typeof body.jsonl !== 'string') throw invalid('jsonl must be a string.');
    const lines = body.jsonl.replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(line => line.trim());
    if (lines.length > maximum) throw invalid(`Import is limited to ${maximum} records.`);
    rows = lines.map((line, i) => { try { return JSON.parse(line); } catch { throw invalid(`JSONL record ${i + 1} is invalid.`); } });
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > maximum) throw invalid(`tickets must contain 1–${maximum} records.`);
  return rows.map(sanitizeInput);
}

/** Workspace payloads are private and checkpointed; HTTP exposes publicJob only. */
export function createWorkspace({ runtimeDir, store, engine, intelligence, analyze, addTicket }) {
  const db = createJsonStore({ runtimeDir, filename: 'workspace.json', initial: { version: 2, jobs: [], annotations: [], comparisons: [], templates: [], radar: { clusters: [], stats: { ticket_count: 0, cluster_count: 0, method: 'lexical', rebuilt_at: null } } }, validate: value => value.version === 2 && ['jobs', 'annotations', 'comparisons', 'templates'].every(key => Array.isArray(value[key])) && value.radar && Array.isArray(value.radar.clusters) && (value.settings === undefined || ['review', 'auto'].includes(value.settings?.reply_mode) && Number.isSafeInteger(value.settings.revision) && value.settings.revision >= 0) && ['replies', 'reply_outcomes'].every(key => value[key] === undefined || Array.isArray(value[key])) });
  const running = new Set();
  let stopped = false;
  let serial = Promise.resolve();
  const schedule = id => { setImmediate(() => { if (!stopped) serial = serial.then(() => run(id)); }); };
  const categories = new Set(engine.taxonomy.categories.map(item => item.code));
  const priorities = new Set(engine.taxonomy.priorities.map(item => item.code));
  const sourceIds = new Set(engine.sources().map(item => item.id));
  const languages = new Set(['ru', 'en', 'es', 'pt', 'kk', 'uz']);
  if (db.snapshot().jobs.some(job => ['running', 'pending'].includes(job.status))) db.transact(state => { for (const job of state.jobs) if (['running', 'pending'].includes(job.status)) Object.assign(job, { status: 'interrupted', resumable: true, updated_at: now(), error: 'Process interrupted; resume this checkpoint.' }); });
  const tickets = () => store.snapshot().tickets;
  function findTicket(id) { const ticket = tickets().find(item => item.id === id); if (!ticket) throw workspaceError(404, 'NOT_FOUND', 'Ticket not found.'); return ticket; }
  const updateJob = (id, update) => db.transact(state => { const job = state.jobs.find(item => item.id === id); Object.assign(job, update, { updated_at: now() }); return job; });
  const getJob = id => db.snapshot().jobs.find(item => item.id === id);
  const replyPolicyForArrival = () => structuredClone(db.snapshot().settings || DEFAULT_REPLY_SETTINGS);
  function settings() { return settingsView(db.snapshot()); }
  function patchSettings(body) {
    object(body, ['reply_mode', 'revision']);
    if (!['review', 'auto'].includes(body.reply_mode) || !Number.isSafeInteger(body.revision) || body.revision < 0) throw invalid('reply_mode must be review or auto and revision must be a non-negative integer.');
    return db.transact(state => {
      const previous = state.settings || DEFAULT_REPLY_SETTINGS;
      if (previous.revision !== body.revision) throw workspaceError(409, 'SETTINGS_CONFLICT', 'Settings changed; reload their current revision.');
      if (previous.revision >= Number.MAX_SAFE_INTEGER) throw workspaceError(409, 'SETTINGS_REVISION_LIMIT', 'Preserve and archive settings before their revision limit.');
      state.settings = { reply_mode: body.reply_mode, revision: previous.revision + 1 };
      return settingsView(state);
    });
  }
  function replies(id) {
    findTicket(id);
    const state = db.snapshot(), job = state.jobs.find(item => item.type === 'auto_reply' && item.payload.ticket_id === id);
    const outcome = state.reply_outcomes?.find(item => item.ticket_id === id);
    return { replies: (state.replies || []).filter(item => item.ticket_id === id), auto_reply: outcome || { status: job?.status === 'completed' ? 'staff_review' : job?.status || 'not_requested', reason: job?.error || null, job_id: job?.id || null, needs_staff: true } };
  }
  function outcome(id, jobId, status, reason = null) {
    return db.transact(state => {
      state.reply_outcomes ||= [];
      const next = { ticket_id: id, input_hash: inputRevision(findTicket(id).input || findTicket(id)), status, reason, job_id: jobId, needs_staff: status !== 'stored_locally', updated_at: now() };
      const index = state.reply_outcomes.findIndex(item => item.ticket_id === id);
      if (index < 0) state.reply_outcomes.push(next); else state.reply_outcomes[index] = next;
      return next;
    });
  }
  function onArrival(ticket) {
    const policy = ticket.arrival_reply_policy;
    if (policy?.reply_mode !== 'auto') return;
    const hash = inputRevision(ticket.input || ticket), id = `auto_reply:${createHash('sha256').update(`${ticket.id}|${hash}`).digest('hex')}`;
    if (getJob(id) || db.snapshot().reply_outcomes?.some(item => item.ticket_id === ticket.id && item.input_hash === hash)) return;
    if (db.snapshot().jobs.length >= 1000) { outcome(ticket.id, null, 'staff_review', 'job_limit'); return; }
    const job = { id, type: 'auto_reply', status: 'pending', processed: 0, total: 1, progress: 0, resumable: false, created_at: now(), updated_at: now(), payload: { ticket_id: ticket.id, policy, guard: ticketGuard(ticket) } };
    db.transact(state => { state.jobs.push(job); });
    schedule(id);
  }
  function publishConfirmation(intent) {
    const existing = (db.snapshot().replies || []).find(item => item.ticket_id === intent.ticket_id && item.kind === 'operator_confirmed' && item.input_hash === intent.input_hash && item.text_sha256 === intent.text_sha256);
    if (existing) return existing;
    return db.transact(state => {
      state.replies ||= [];
      const reply = { id: intent.id, ticket_id: intent.ticket_id, input_hash: intent.input_hash, text_sha256: intent.text_sha256, kind: 'operator_confirmed', text: intent.text, source_ids: [], delivery_state: 'stored_locally', external_sent: false, confirmed_by: 'local_operator', created_at: intent.created_at };
      state.replies.push(reply); return reply;
    });
  }
  function confirmReply(ticket) {
    const state = store.snapshot(), id = confirmationIntent(ticket).id;
    const intent = state.reply_confirmation_intents?.find(entry => entry.id === id);
    if (!isTaggedConfirmation(intent, state)) throw workspaceError(409, 'CONFIRMATION_INTENT_MISSING', 'A durable explicit confirmation is required.');
    return publishConfirmation(intent);
  }
  async function runAutomatic(job) {
    const { ticket_id: id, policy, guard } = job.payload;
    if (db.snapshot().replies?.some(item => item.job_id === job.id)) return outcome(id, job.id, 'stored_locally');
    const currentPolicy = replyPolicyForArrival(), ticket = findTicket(id);
    if (currentPolicy.reply_mode !== 'auto' || currentPolicy.revision !== policy.revision) return outcome(id, job.id, 'cancelled', 'reply_mode_changed');
    if (!sameTicketGuard(ticket, guard) || ticket.edited_reply !== ticket.triage.draft_reply.text || ticket.status !== 'open') return outcome(id, job.id, 'staff_review', 'ticket_changed_or_manual');
    if (ticket.triage.needs_human !== false || ticket.input?.kind === 'complaint' || /^complaint\./u.test(ticket.triage.category || '') || ['p0', 'p1'].includes(ticket.triage.priority)) return outcome(id, job.id, 'staff_review', 'human_required');
    if (!intelligence?.generate) return outcome(id, job.id, 'staff_review', 'generator_unavailable');
    if (intelligence.status()?.busy || intelligence.status()?.generation?.busy) return outcome(id, job.id, 'staff_review', 'generator_busy');
    let generation;
    try { generation = await intelligence.generate(sanitizeInput(ticket.input || ticket), structuredClone(ticket.triage)); }
    catch { return stopped ? null : outcome(id, job.id, 'staff_review', 'generation_failed'); }
    if (stopped) return;
    const latest = findTicket(id), after = replyPolicyForArrival();
    if (after.reply_mode !== 'auto' || after.revision !== policy.revision) return outcome(id, job.id, 'cancelled', 'reply_mode_changed');
    if (!sameTicketGuard(latest, guard) || latest.edited_reply !== latest.triage.draft_reply.text) return outcome(id, job.id, 'staff_review', 'ticket_changed_or_manual');
    const projection = structuredClone(latest.triage);
    applyGenerationProjection(projection, generation, engine.sources());
    const reason = automaticReplyEligibility({ ...latest, triage: projection }, generation, intelligence.status());
    if (reason) return outcome(id, job.id, 'staff_review', reason);
    db.transact(state => {
      state.replies ||= []; state.reply_outcomes ||= [];
      if (!state.replies.some(item => item.job_id === job.id)) state.replies.push({ id: randomUUID(), ticket_id: id, input_hash: guard.input_hash, kind: 'ai_auto', text: generation.text, source_ids: generation.source_ids || [], delivery_state: 'stored_locally', external_sent: false, confirmed_by: null, job_id: job.id, created_at: now() });
      const next = { ticket_id: id, status: 'stored_locally', reason: null, job_id: job.id, needs_staff: false, updated_at: now() };
      const index = state.reply_outcomes.findIndex(item => item.ticket_id === id);
      if (index < 0) state.reply_outcomes.push(next); else state.reply_outcomes[index] = next;
    });
  }
  async function run(id) {
    if (running.has(id) || stopped) return;
    running.add(id); updateJob(id, { status: 'running', resumable: false, error: null });
    try {
      let job = getJob(id);
      if (job.type === 'initialize') {
        if (!intelligence) throw new Error('Intelligence is not configured; baseline remains available.');
        const status = await intelligence.initialize({ onProgress: progress => { if (!stopped) updateJob(id, { processed: progress.indexed || 0, total: progress.source_count || 1, progress: progress.source_count ? Math.min(99, Math.round((progress.indexed || 0) / progress.source_count * 100)) : 0 }); } });
        if (status.state !== 'ready') throw new Error(status.reason || 'Model unavailable; safe baseline remains active.');
      } else if (job.type === 'import') {
        for (let cursor = job.processed; cursor < job.payload.tickets.length; cursor++) {
          if (stopped) return;
          const ticketId = `${id}:${cursor}`;
          if (!tickets().some(item => item.id === ticketId)) await addTicket(job.payload.tickets[cursor], ticketId, { replyPolicy: job.payload.reply_policy || DEFAULT_REPLY_SETTINGS });
          job = updateJob(id, { processed: cursor + 1, progress: Math.round((cursor + 1) / job.total * 100) });
        }
      } else if (job.type === 'auto_reply') {
        await runAutomatic(job);
      } else if (job.type === 'radar') {
        const radar = await buildRadar();
        if (!stopped) db.transact(state => { state.radar = radar; });
      }
      if (!stopped) updateJob(id, { status: 'completed', processed: getJob(id).total, progress: 100, resumable: false });
    } catch (error) {
      if (!stopped) {
        if (getJob(id).type === 'auto_reply') outcome(getJob(id).payload.ticket_id, id, 'staff_review', 'generation_failed');
        updateJob(id, { status: 'failed', error: String(error.message).slice(0, 500), resumable: getJob(id).type !== 'auto_reply' });
      }
    } finally { running.delete(id); }
  }
  function startJob(type, payload = {}, total = 1, id = randomUUID()) {
    const duplicate = getJob(id);
    if (duplicate) return publicJob(duplicate);
    const existing = db.snapshot().jobs.find(job => job.type === type && ['pending', 'running'].includes(job.status));
    if (existing && type !== 'import') return publicJob(existing);
    if (db.snapshot().jobs.length >= 1000) throw workspaceError(409, 'JOB_LIMIT', 'The local workspace contains 1000 jobs. Preserve and archive it before creating more.');
    if (db.snapshot().jobs.filter(job => ['pending', 'running'].includes(job.status)).length >= 2) throw workspaceError(409, 'JOB_BUSY', 'Wait for an active job to finish.');
    const job = { id, type, status: 'pending', processed: 0, total, progress: 0, resumable: false, created_at: now(), updated_at: now(), payload };
    db.transact(state => { state.jobs.push(job); });
    schedule(job.id);
    return publicJob(job);
  }
  function resumeJob(id) {
    const job = getJob(id);
    if (!job) throw workspaceError(404, 'NOT_FOUND', 'Job not found.');
    if (!job.resumable || running.has(id)) throw workspaceError(409, 'INVALID_TRANSITION', 'This job cannot be resumed.');
    if (db.snapshot().jobs.filter(job => ['pending', 'running'].includes(job.status)).length >= 2) throw workspaceError(409, 'JOB_BUSY', 'Wait for an active job to finish.');
    const resumed = updateJob(id, { status: 'pending', resumable: false, error: null });
    schedule(id);
    return publicJob(resumed);
  }
  function annotate(body) {
    object(body, ['ticket_id', 'category', 'priority', 'lang', 'needs_human', 'auto_eligible', 'relevant_source_ids', 'note']);
    findTicket(body.ticket_id);
    const labels = {};
    for (const [key, allowed] of [['category', categories], ['priority', priorities], ['lang', languages]]) if (body[key] !== undefined) { if (!allowed.has(body[key])) throw invalid(`Unknown ${key}.`); labels[key] = body[key]; }
    for (const key of ['needs_human', 'auto_eligible']) if (body[key] !== undefined) { if (typeof body[key] !== 'boolean') throw invalid(`${key} must be boolean.`); labels[key] = body[key]; }
    if (labels.needs_human === true && labels.auto_eligible === true) throw invalid('A required human review cannot be marked auto eligible.');
    if (body.relevant_source_ids !== undefined) { if (!Array.isArray(body.relevant_source_ids) || body.relevant_source_ids.length > 100 || body.relevant_source_ids.some(id => !sourceIds.has(id))) throw invalid('relevant_source_ids must contain existing rule IDs.'); labels.relevant_source_ids = [...new Set(body.relevant_source_ids)]; }
    if (!Object.keys(labels).length) throw invalid('At least one label is required.');
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 4000)) throw invalid('note is limited to 4000 characters.');
    return db.transact(state => {
      let annotation = state.annotations.find(item => item.ticket_id === body.ticket_id);
      if (!annotation) { annotation = { id: randomUUID(), ticket_id: body.ticket_id, labels: {}, provenance: 'human', review_status: 'human_reviewed', created_at: now() }; state.annotations.push(annotation); }
      annotation.labels = { ...annotation.labels, ...labels };
      if (annotation.labels.needs_human === true && annotation.labels.auto_eligible === true) throw invalid('A required human review cannot be marked auto eligible.');
      Object.assign(annotation, { updated_at: now(), ...(body.note !== undefined ? { note: body.note } : {}) });
      return annotation;
    });
  }
  async function compare(body = {}) {
    object(body, ['ticket_ids']);
    if (body.ticket_ids !== undefined && (!Array.isArray(body.ticket_ids) || body.ticket_ids.length > 1000 || body.ticket_ids.some(id => typeof id !== 'string'))) throw invalid('ticket_ids must be an array of at most 1000 IDs.');
    const selected = body.ticket_ids ? [...new Set(body.ticket_ids)].map(findTicket) : tickets().slice(0, 1000);
    const annotations = db.snapshot().annotations;
    const rows = [];
    for (const ticket of selected) {
      const input = sanitizeInput(ticket.input || ticket);
      const start = performance.now(), baseline = engine.triage(input), baseline_elapsed_ms = performance.now() - start;
      const next = performance.now(), v2 = await analyze(input, []), v2_elapsed_ms = performance.now() - next;
      rows.push({ ticket_id: ticket.id, input, baseline, v2, baseline_elapsed_ms, v2_elapsed_ms, labels: structuredClone(annotations.find(item => item.ticket_id === ticket.id && item.provenance === 'human')?.labels || {}) });
    }
    const metrics = comparisonMetrics(rows, engine.sources());
    const comparison = { id: randomUUID(), created_at: now(), input_policy: 'sanitized-player-only; labels held separately', provenance: 'human-labels-only', rows, metrics };
    db.transact(state => { state.comparisons.push(comparison); });
    return { comparison, metrics };
  }
  function quality() {
    const state = db.snapshot();
    return { annotations: state.annotations, metrics: state.comparisons.at(-1)?.metrics || comparisonMetrics([], engine.sources()), comparisons: state.comparisons.map(({ rows, ...summary }) => summary), provenance: { human: state.annotations.filter(item => item.provenance === 'human').length, synthetic: 0, draft_agent: 0, unlabelled: tickets().filter(ticket => !state.annotations.some(item => item.ticket_id === ticket.id)).length, description: 'Only explicit operator annotation writes human labels; synthetic demo tickets are not gold labels.' } };
  }
  function propose(body) {
    object(body, ['cluster_id', 'title', 'text', 'lang', 'category', 'source_ids']);
    text(body.title, 'title', 200); text(body.text, 'text');
    if (!languages.has(body.lang)) throw invalid('Unknown template language.');
    if (body.category !== undefined && !categories.has(body.category)) throw invalid('Unknown template category.');
    const ids = body.source_ids || [];
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !sourceIds.has(id))) throw invalid('source_ids must contain existing rule IDs.');
    const cluster = body.cluster_id ? db.snapshot().radar.clusters.find(item => item.id === body.cluster_id) : null;
    if (body.cluster_id && !cluster) throw workspaceError(404, 'NOT_FOUND', 'Cluster not found.');
    const template = { id: randomUUID(), title: body.title, text: body.text, lang: body.lang, ...(body.category ? { category: body.category } : {}), source_ids: [...new Set(ids)], origin_ticket_ids: cluster?.ticket_ids || [], status: 'proposed', created_at: now(), updated_at: now(), history: [{ action: 'propose', at: now() }] };
    return db.transact(state => { state.templates.push(template); return template; });
  }
  function patchTemplate(id, body) {
    object(body, ['action', 'title', 'text']);
    if (!['approve', 'revoke', 'edit'].includes(body.action)) throw invalid('action must be approve, revoke or edit.');
    if (body.action !== 'edit' && (body.title !== undefined || body.text !== undefined)) throw invalid('Edit text separately before approval.');
    if (body.action === 'edit' && body.title === undefined && body.text === undefined) throw invalid('Provide title or text to edit.');
    if (body.title !== undefined) text(body.title, 'title', 200);
    if (body.text !== undefined) text(body.text, 'text');
    return db.transact(state => {
      const template = state.templates.find(item => item.id === id);
      if (!template) throw workspaceError(404, 'NOT_FOUND', 'Template not found.');
      const previous = { title: template.title, text: template.text, status: template.status };
      if (body.action === 'edit') { if (body.title !== undefined) template.title = body.title; if (body.text !== undefined) template.text = body.text; template.status = 'proposed'; }
      else template.status = body.action === 'approve' ? 'approved' : 'revoked';
      template.updated_at = now(); template.history.push({ action: body.action, at: template.updated_at, previous });
      return template;
    });
  }
  async function buildRadar() {
    const all = tickets().slice(0, 1000), groups = [], mode = intelligence?.status().state === 'ready' ? 'semantic-source-affinity' : 'lexical';
    const words = value => new Set(value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
    const sensitiveCategories = new Set(['report.payment', 'report.account', 'complaint.admin']);
    const issueFamily = ticket => {
      const baseline = ticket.triage.analysis?.intelligence?.baseline_category;
      // Shared security rules cannot erase a baseline-sensitive issue family,
      // even if the semantic classifier has suggested a different category.
      return sensitiveCategories.has(baseline) ? baseline : ticket.triage.category;
    };
    for (const ticket of all) {
      if (stopped) throw new Error('Workspace stopped.');
      const input = sanitizeInput(ticket.input || ticket), content = input.messages.filter(item => item.role === 'player').map(item => item.text).join(' ');
      const tokens = words(content);
      const family = issueFamily(ticket);
      const found = mode === 'semantic-source-affinity' ? await intelligence.search(content, { limit: 4 }) : null;
      const semanticIds = new Set((found?.mode === 'semantic-hybrid' ? found.candidates : []).filter(item => (item.semantic_score || 0) >= .7).map(item => item.id));
      let best = null, score = 0, semanticMatch = false;
      for (const group of groups) {
        if (input.kind !== group.kind || family !== group.issueFamily) continue;
        const overlap = [...tokens].filter(token => group.tokens.has(token)).length;
        const lexical = overlap / Math.max(1, new Set([...tokens, ...group.tokens]).size);
        const semantic = semanticIds.size && group.semanticIds.size ? [...semanticIds].filter(id => group.semanticIds.has(id)).length / Math.max(semanticIds.size, group.semanticIds.size) : 0;
        const similarity = semantic ? .7 * semantic + .3 * lexical : lexical;
        if (similarity >= (semantic ? .48 : .22) && similarity > score) { best = group; score = similarity; semanticMatch = Boolean(semantic); }
      }
      if (!best) { best = { kind: input.kind, issueFamily: family, tokens, semanticIds, members: [], title: content.slice(0, 100) || 'Обращение', scores: [], semanticApplied: false }; groups.push(best); }
      else { best.scores.push(score); best.semanticApplied ||= semanticMatch; }
      best.members.push(ticket);
    }
    const clusters = groups.sort((a, b) => b.members.length - a.members.length).map(group => ({ id: `cluster:${createHash('sha256').update(group.members.map(item => item.id).sort().join('|')).digest('hex').slice(0, 16)}`, title: group.title, ticket_ids: group.members.map(item => item.id), count: group.members.length, languages: [...new Set(group.members.map(item => item.triage.lang))], priorities: [...new Set(group.members.map(item => item.triage.priority))], method: group.semanticApplied ? 'semantic-source-affinity' : 'lexical', score: group.scores.length ? group.scores.reduce((a, b) => a + b, 0) / group.scores.length : null, incident_candidate: group.members.length >= 3, duplicate: false }));
    const actualMode = clusters.some(cluster => cluster.method === 'semantic-source-affinity') ? 'semantic-source-affinity' : 'lexical';
    return { clusters, stats: { ticket_count: all.length, queue_count: tickets().length, limit: 1000, cluster_count: clusters.length, incident_candidates: clusters.filter(item => item.incident_candidate).length, method: actualMode, threshold: actualMode === 'lexical' ? .22 : .48, thresholds: { lexical: .22, semantic_source_affinity: .48 }, rebuilt_at: now(), note: 'Similarity groups are candidates for review, not duplicates or proven incidents.' } };
  }
  // Recover only arrivals explicitly tagged at creation. Existing queues and
  // imports created before this feature are never backfilled by a mode change.
  const confirmationState = store.snapshot();
  for (const intent of confirmationState.reply_confirmation_intents || []) if (isTaggedConfirmation(intent, confirmationState)) publishConfirmation(intent);
  for (const ticket of tickets()) onArrival(ticket);
  for (const job of db.snapshot().jobs) if (job.type === 'auto_reply' && job.status === 'interrupted') schedule(job.id);
  return { db, settings, patchSettings, replies, confirmReply, onArrival, replyPolicyForArrival, findTicket, jobs: () => db.snapshot().jobs.map(publicJob), startJob, resumeJob, importTickets: (rows, { id } = {}) => startJob('import', { tickets: rows.map(sanitizeInput), reply_policy: replyPolicyForArrival() }, rows.length, id), annotate, compare, quality, propose, patchTemplate, templates: () => db.snapshot().templates, approvedTemplates: () => db.snapshot().templates.filter(item => item.status === 'approved'), radar: () => db.snapshot().radar, async close() { if (stopped) return; stopped = true; if (db.snapshot().jobs.some(job => ['pending', 'running'].includes(job.status))) db.transact(state => { for (const job of state.jobs) if (['pending', 'running'].includes(job.status)) Object.assign(job, { status: 'interrupted', resumable: true, updated_at: now(), error: 'Process stopped; resume this checkpoint.' }); }); } };
}
