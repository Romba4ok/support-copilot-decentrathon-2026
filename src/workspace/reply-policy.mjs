import { createHash } from 'node:crypto';
import { sanitizeInput } from '../core/engine.mjs';

export const DEFAULT_REPLY_SETTINGS = Object.freeze({ reply_mode: 'review', revision: 0 });
export const inputRevision = input => createHash('sha256').update(JSON.stringify(sanitizeInput(input))).digest('hex');
export const ticketGuard = ticket => ({ input_hash: inputRevision(ticket.input || ticket), status: ticket.status, edited_reply: ticket.edited_reply, updated_at: ticket.updated_at, manual_revision: ticket.reply_revision || 0 });
export const sameTicketGuard = (ticket, guard) => JSON.stringify(ticketGuard(ticket)) === JSON.stringify(guard);
const confirmationId = (ticketId, inputHash, textHash) => `operator_reply:${createHash('sha256').update(JSON.stringify([ticketId, inputHash, textHash])).digest('hex')}`;
export function confirmationIntent(ticket) {
  const input_hash = inputRevision(ticket.input || ticket), text_sha256 = createHash('sha256').update(ticket.edited_reply).digest('hex');
  return { schema_version: 'local-operator-confirmation-intent-v1', id: confirmationId(ticket.id, input_hash, text_sha256), ticket_id: ticket.id, input_hash, text_sha256, text: ticket.edited_reply, created_at: ticket.updated_at };
}
export function isTaggedConfirmation(intent, state) {
  return intent?.schema_version === 'local-operator-confirmation-intent-v1' && typeof intent.text === 'string' && intent.text.trim().length > 0 && intent.text.length <= 20000
    && /^[a-f0-9]{64}$/u.test(intent.input_hash || '') && intent.text_sha256 === createHash('sha256').update(intent.text).digest('hex')
    && intent.id === confirmationId(intent.ticket_id, intent.input_hash, intent.text_sha256)
    && state.tickets.some(ticket => ticket.id === intent.ticket_id)
    && state.feedback.some(entry => entry.reply_intent_id === intent.id && entry.ticket_id === intent.ticket_id && entry.action === 'confirm' && entry.confirmed_by === 'local_operator' && entry.edited_reply === intent.text);
}
export function settingsView(state) {
  const value = state.settings || DEFAULT_REPLY_SETTINGS;
  return { settings: { reply_mode: value.reply_mode }, revision: value.revision, capabilities: { external_delivery: false } };
}
export function automaticReplyEligibility(ticket, generation, providerStatus) {
  if (ticket.status !== 'open') return 'ticket_not_open';
  if (ticket.input?.kind === 'complaint' || /^complaint\./u.test(ticket.triage.category || '') || ['p0', 'p1'].includes(ticket.triage.priority)) return 'risk_requires_staff';
  if (ticket.triage.needs_human !== false || generation?.needs_human !== false || generation?.plan?.needs_human !== false) return 'human_required';
  if (!['generated', 'completed'].includes(generation?.status) || generation?.metrics?.generated !== true || typeof generation.text !== 'string' || !generation.text.trim()) return 'generation_not_accepted';
  if (generation.safety_context?.schema_version !== 'generation-safety-v1' || generation.safety_context.origin !== 'code_context' || generation.safety_context.needs_human !== false || generation.safety_context.reason !== 'not_required') return 'safety_context_not_clear';
  // These are returned by the ordinary, trusted CODE provider after its normal
  // verification. No HTTP request can supply an activation scope or proof.
  const status = providerStatus?.generation;
  if (status?.operator_activation !== true || status.activation_scope !== 'operator-generation' || generation.metrics.validation_only !== false || !/^[a-f0-9]{64}$/u.test(generation.metrics.activation_sha256 || '')) return 'operator_activation_not_verified';
  if (generation.unresolved === true || generation.metrics.unresolved === true || generation.safety_context.reason === 'unresolved_context') return 'context_conflict';
  return null;
}
