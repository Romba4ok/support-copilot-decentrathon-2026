import { buildGenerationInput, renderPlan, validatePlan, PLAN_SCHEMA_VERSION } from './generation-contract.mjs';
import { sanitizeInput } from '../core/engine.mjs';
import { replies } from '../core/language.mjs';

// Only index.mjs registers results immediately after its own same-input raw
// analysis. This provenance never survives serialization or comes from metadata.
const generationBases = new WeakMap();
const timingPublishers = new WeakMap();
const sameCanonical = (source, canonical) => canonical && ['text', 'section_id', 'section', 'ref'].every(key => canonical[key] === source[key]);
export function bindGenerationBasis(generation, input, rawResult, canonicalSources, startedAt, { publishTiming } = {}) {
  if (publishTiming !== undefined && typeof publishTiming !== 'function') throw new TypeError('Timing publisher must be trusted code');
  const fresh = structuredClone(generation);
  if (publishTiming) timingPublishers.set(fresh, publishTiming);
  // A CODE-skipped provider needs timing publication without acquiring a
  // trusted inference basis or changing its existing fallback projection.
  if (rawResult === null) return fresh;
  const canonical = new Map(canonicalSources.map(source => [source.id, source]));
  const citations = (rawResult.citations || []).filter(source => sameCanonical(source, canonical.get(source.id)));
  generationBases.set(fresh, { input: sanitizeInput(input), result: { lang: rawResult.lang, category: rawResult.category, needs_human: rawResult.needs_human, citations: structuredClone(citations) }, startedAt });
  return fresh;
}

const uncertain = {
  ru: 'Сведения обращения неоднозначны. Сотрудник поддержки проверит контекст; утверждения и материалы пока не проверены.',
  en: 'The report contains unclear information. A support staff member needs to review the context; claims and materials have not been verified.',
  kk: 'Өтініштегі мәліметтер бірмәнді емес. Қолдау қызметкері мәнмәтінді тексеруі қажет; мәлімдемелер мен материалдар әлі тексерілген жоқ.',
  uz: 'Murojaatdagi ma’lumotlar noaniq. Yordam xodimi holatni tekshirishi kerak; da’volar va materiallar hali tekshirilmagan.',
  es: 'La solicitud contiene información ambigua. El personal de soporte debe revisar el contexto; las declaraciones y los materiales no se han verificado.',
  pt: 'A solicitação contém informações ambíguas. A equipe de suporte precisa analisar o contexto; as declarações e os materiais não foram verificados.',
};

const codeReasons = {
  baseline_required: 'Контекст обращения требует проверки сотрудником поддержки.',
  unresolved_context: 'Контекст обращения неоднозначен; требуется проверка сотрудником поддержки.',
  no_verified_answer: 'Сервис не может уверенно сформировать подтверждённый ответ; нужна проверка человеком.',
  incident_requires_verification: 'Описанный инцидент требует проверки сотрудником поддержки.',
};

const contextSafety = context => ({ schema_version: 'generation-safety-v1', origin: 'code_context', needs_human: context.needs_human, reason: context.original_human_gate ? 'baseline_required' : context.unresolved ? 'unresolved_context' : context.intent_mode === 'knowledge_gap' ? 'no_verified_answer' : context.intent_mode === 'actual_incident' ? 'incident_requires_verification' : 'not_required' });

function raiseHuman(result, generation) {
  const safety = generation.safety_context;
  if (safety?.schema_version === 'generation-safety-v1' && safety.origin === 'code_context' && safety.needs_human === true && Object.hasOwn(codeReasons, safety.reason)) {
    result.needs_human = true;
    if (!result.reasons.includes(codeReasons[safety.reason])) result.reasons.push(codeReasons[safety.reason]);
  }
}

/** Shared UI/native projection. Caller retains ownership of operator text/status. */
export function applyGenerationProjection(result, generation, canonicalSources = []) {
  const basis = generationBases.get(generation);
  try {
  result.analysis.intelligence ||= { version: 'v2', mode: 'baseline-fallback', model: null, candidates: [], baseline_category: result.category };
  result.analysis.intelligence.generation = generation;
  let currentBasis;
  if (!basis) raiseHuman(result, generation);
  else {
    const canonical = new Map(canonicalSources.map(source => [source.id, source]));
    currentBasis = { ...basis.result, citations: basis.result.citations.filter(source => sameCanonical(source, canonical.get(source.id))) };
    const safe = buildGenerationInput(basis.input, currentBasis, canonicalSources);
    raiseHuman(result, { safety_context: contextSafety(safe) });
  }
  if (!['completed', 'generated'].includes(generation.status) || generation.metrics?.generated !== true || typeof generation.text !== 'string' || !generation.text.trim()) return result;
  if (!basis) {
    if (Array.isArray(generation.plan?.source_ids)) {
      const canonical = new Map(canonicalSources.map(source => [source.id, source]));
      const prior = new Set((result.citations || []).filter(source => sameCanonical(source, canonical.get(source.id))).map(source => source.id));
      if (JSON.stringify(generation.source_ids) !== JSON.stringify(generation.plan.source_ids) || generation.source_ids.some(id => !prior.has(id))) {
        Object.assign(generation, { status: 'quality-failed', reason: 'projection_rejected: trusted_canonical_basis_missing', text: result.draft_reply.text, source_ids: [] });
        generation.metrics = { ...generation.metrics, generated: false, text_origin: 'code_context_fallback' };
        return result;
      }
    }
    return projectAccepted(result, generation, canonicalSources);
  }
  let context;
  try {
    context = buildGenerationInput(basis.input, currentBasis, canonicalSources, { proposedFocus: generation.plan?.focus, focusOrigin: 'local_llm' });
    const checked = validatePlan(generation.plan, context);
    if (context.unresolved || !checked.ok || JSON.stringify(generation.source_ids) !== JSON.stringify(checked.value.source_ids)) throw new Error(checked.reason || 'source_set_or_context_changed');
    // A concurrent operator/context escalation can only raise the accepted gate.
    if (result.needs_human && !context.needs_human) context = buildGenerationInput(basis.input, { ...currentBasis, needs_human: true }, canonicalSources, { proposedFocus: checked.value.focus, focusOrigin: 'local_llm' });
    const plan = { ...checked.value, needs_human: context.needs_human };
    const rendered = renderPlan(plan, context);
    Object.assign(generation, rendered, { plan, intent_mode: context.intent_mode, contextual_human: context.contextual_human, focus_changed: context.focus_changed, safety_context: contextSafety(context) });
    generation.metrics.source_applicability = context.source_applicability;
    projectAccepted(result, generation, canonicalSources, currentBasis.citations);
  } catch (error) {
    Object.assign(generation, { status: 'quality-failed', reason: `projection_rejected: ${String(error.message).slice(0, 160)}`, text: result.draft_reply.text, source_ids: [] });
    generation.metrics = { ...generation.metrics, generated: false, text_origin: 'code_context_fallback' };
  }
  if (context?.needs_human) result.needs_human = true;
  if (!timingPublishers.has(generation)) generation.metrics.total_elapsed_ms = Math.round(performance.now() - basis.startedAt);
  return result;
  } finally {
    // WeakMap-owned CODE callback only: never a plan/HTTP/payload function.
    // This also observes early fallback/rejection paths and propagates errors.
    timingPublishers.get(generation)?.(generation);
  }
}

function projectAccepted(result, draft, canonicalSources, citationBasis) {
  result.draft_reply.text = draft.text;
  if (draft.plan?.schema_version === PLAN_SCHEMA_VERSION && Array.isArray(draft.source_ids)) {
    if (['ru', 'en', 'kk', 'uz', 'es', 'pt'].includes(draft.lang)) result.lang = result.draft_reply.lang = draft.lang;
    result.needs_human = result.needs_human || draft.needs_human === true;
    const previous = citationBasis || result.citations || [], canonical = new Map(canonicalSources.map(source => [source.id, source]));
    const selected = new Set(draft.source_ids);
    const retained = previous.filter(source => selected.has(source.id) && canonical.has(source.id) && ['text', 'section_id', 'section', 'ref'].every(key => canonical.get(source.id)[key] === source[key]));
    result.citations = retained;
    result.draft_reply.cited = retained.map(source => canonical.get(source.id).label);
    draft.source_ids = retained.map(source => source.id);
    draft.metrics.source_applicability = { retained_ids: draft.source_ids, excluded_ids: previous.map(source => source.id).filter(id => !draft.source_ids.includes(id)), reason: draft.metrics.source_applicability?.reason || 'Accepted plan retained only its applicable prior canonical citations' };
  }
  return result;
}

function projectUnresolved(result, context, meta, reason) {
  result.lang = result.draft_reply.lang = context.lang;
  result.draft_reply.text = [replies[context.lang].greeting, uncertain[context.lang], replies[context.lang].human].join('\n\n');
  result.citations = []; result.draft_reply.cited = [];
  result.analysis.intelligence.draft = { status: 'context-unresolved', ...meta, reason };
  return result;
}

/** Deterministic context selection, explicitly not native generation evidence. */
export function codeContextDraft(rawInput, result, canonicalSources = []) {
  result.analysis.intelligence ||= { version: 'v2', mode: 'baseline-fallback', model: null, candidates: [], baseline_category: result.category };
  const context = buildGenerationInput(rawInput, result, canonicalSources);
  const safety_context = contextSafety(context);
  const metrics = { generated: false, executed: false, output_mode: 'code_context', plan_origin: 'code_context', text_origin: 'deterministic_renderer', provided_fields: context.provided_fields, missing_fields: context.missing_fields, field_states: context.field_states, source_applicability: context.source_applicability };
  const meta = { lang: context.lang, language_origin: context.language_origin, intent_mode: context.intent_mode, original_human_gate: context.original_human_gate, contextual_human: context.contextual_human, human_escalation: context.human_escalation, needs_human: context.needs_human, safety_context, metrics };
  raiseHuman(result, meta);
  // A conflict has no reliable fact selection. Do not re-ask unavailable fields.
  if (context.unresolved) return projectUnresolved(result, context, meta, context.unresolved_reason);
  const focus = context.allowed_focuses[0];
  const text = rawInput.messages.filter(message => message.role === 'player').map(message => message.text).join('\n');
  // Ask a short first set of relevant questions. A visual UI failure does not
  // need a map location; location matters for a movement/position incident.
  const positionIncident = /stuck|under the map|застр|под текстур|қозғал|тұрып қал|xarita ost|harakat|atascad|atrapad|travado|debaixo|debajo/iu.test(text);
  const priorities = focus === 'payment' ? ['transaction_id', 'payment_date', 'amount', 'platform'] : focus === 'technical' ? ['reproduction_steps', 'platform', 'server', 'event_time', ...(positionIncident ? ['location'] : [])] : focus === 'account' ? ['participant', 'server', 'event_time', 'reproduction_steps'] : context.missing_fields;
  const requests = priorities.filter(field => context.missing_fields.includes(field)).slice(0, 3);
  if (!requests.length && !context.facts.length && !context.answer_topic && !context.plain_greeting && context.intent_mode !== 'knowledge_gap') return projectUnresolved(result, context, meta, 'no_relevant_safe_questions');
  const plan = { schema_version: PLAN_SCHEMA_VERSION, focus, fact_ids: context.facts.map(fact => fact.id), request_fields: requests, source_ids: context.allowed_sources.map(source => source.id), needs_human: context.needs_human };
  const draft = { status: 'code-context', ...renderPlan(plan, context), ...meta, plan };
  projectAccepted(result, draft, canonicalSources);
  result.analysis.intelligence.draft = draft;
  return result;
}
