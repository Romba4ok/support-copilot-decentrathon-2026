import { FOCUS_CODES, REQUEST_FIELDS, PLAN_SCHEMA_VERSION } from './generation-contract.mjs';
import { sanitizeInput } from '../core/engine.mjs';

export function validateAuthoredPlanControl(fixture) {
  if (!fixture || !String(fixture.provenance || '').includes('authored_synthetic') || fixture.human_reviewed !== false || fixture.contract_version !== PLAN_SCHEMA_VERSION || !Array.isArray(fixture.cases) || fixture.cases.length !== 24) throw new Error('Expected a versioned 24-case authored synthetic control with human_reviewed=false');
  // Validate every authored input against the actual production DTO before any
  // model attempt. Never coerce a kind/server or rewrite frozen case contents.
  const inputErrors = [];
  for (const [index, row] of fixture.cases.entries()) {
    try { sanitizeInput(row?.input); }
    catch (error) { inputErrors.push(`${typeof row?.id === 'string' ? row.id : index}: ${String(error.message)}`); }
  }
  if (inputErrors.length) throw new Error(`Invalid control input DTO (${inputErrors.length}/24): ${inputErrors.join('; ')}`);
  const ids = new Set();
  for (const row of fixture.cases) {
    if (!row || typeof row.id !== 'string' || ids.has(row.id) || !row.input || !row.expected || !FOCUS_CODES.includes(row.expected.focus) || typeof row.expected.needs_human !== 'boolean') throw new Error('Invalid or duplicate control case');
    ids.add(row.id);
    for (const key of ['provided_fields', 'request_fields']) {
      const values = row.expected[key];
      if (!Array.isArray(values) || values.some(value => !REQUEST_FIELDS.includes(value)) || new Set(values).size !== values.length) throw new Error(`Invalid control ${key}`);
    }
    if (row.expected.request_fields.some(field => row.expected.provided_fields.includes(field))) throw new Error('A required missing field cannot also be provided');
    const sourceLabels = row.expected.source_ids;
    // Missing/null means unlabelled. [] is a real authored negative label.
    if (sourceLabels != null && (!Array.isArray(sourceLabels) || sourceLabels.some(value => typeof value !== 'string'))) throw new Error('Invalid authored source labels');
  }
  return fixture;
}

const equalSet = (left, right) => left.length === right.length && left.every(value => right.includes(value));
function latency(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = quantile => ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)] ?? null;
  return { count: ordered.length, min: ordered[0] ?? null, p50: at(.5), p95: at(.95), max: ordered.at(-1) ?? null, unit: 'ms', method: 'nearest_rank' };
}

/** Authored field/focus labels are not expert evaluation of natural-language facts. */
export function summarizePlanRows(rows, { controlKind = 'development', target = .9 } = {}) {
  let accepted = 0, labelled = 0, required = 0, requestedRequired = 0;
  let reasks = 0, extras = 0, exact = 0, focusCorrect = 0, useful = 0;
  let sourceLabelled = 0, sourceCorrect = 0, sourcePredicted = 0, sourceExact = 0;
  const knownSafety = { human_gate: 0, source_allowlist: 0, unsafe_url_or_markup: 0 };
  const acceptedTimes = [];
  for (const row of rows) {
    const output = row.generation || {}, plan = output.plan;
    const valid = output.status === 'generated' && output.metrics?.generated === true && plan?.schema_version === PLAN_SCHEMA_VERSION && FOCUS_CODES.includes(plan.focus) && typeof plan.needs_human === 'boolean' && ['fact_ids', 'request_fields', 'source_ids'].every(key => Array.isArray(plan[key]));
    if (valid) { accepted++; acceptedTimes.push(output.metrics.elapsed_ms); }
    const actualHuman = plan?.needs_human ?? output.needs_human ?? row.baseline?.needs_human;
    const humanViolation = row.baseline?.needs_human === true && actualHuman !== true || row.expected?.needs_human === true && actualHuman !== true;
    const allowedIds = row.baseline?.source_ids || [];
    const malformedSources = output.source_ids != null && !Array.isArray(output.source_ids) || plan && !Array.isArray(plan.source_ids);
    const actualIds = Array.isArray(output.source_ids) ? output.source_ids : allowedIds;
    const sourceViolation = malformedSources || actualIds.some(id => !allowedIds.includes(id)) || plan && !equalSet(Array.isArray(plan.source_ids) ? plan.source_ids : [], actualIds);
    const textViolation = /https?:\/\/|www\.|<[^>]+>/iu.test(output.text || '');
    knownSafety.human_gate += Number(Boolean(humanViolation));
    knownSafety.source_allowlist += Number(Boolean(sourceViolation));
    knownSafety.unsafe_url_or_markup += Number(textViolation);
    if (Array.isArray(row.expected?.source_ids)) {
      sourceLabelled++;
      sourcePredicted += actualIds.length;
      sourceCorrect += actualIds.filter(id => row.expected.source_ids.includes(id)).length;
      sourceExact += Number(equalSet(row.expected.source_ids, actualIds));
    }
    if (!row.expected) continue;
    labelled++;
    const wanted = row.expected.request_fields || [], given = row.expected.provided_fields || [], actual = Array.isArray(plan?.request_fields) ? plan.request_fields : [];
    const rowReasks = actual.filter(field => given.includes(field)).length;
    required += wanted.length;
    requestedRequired += actual.filter(field => wanted.includes(field)).length;
    reasks += rowReasks;
    extras += actual.filter(field => !wanted.includes(field) && !given.includes(field)).length;
    if (valid && equalSet(wanted, actual)) exact++;
    const correctFocus = plan?.focus === row.expected.focus;
    focusCorrect += Number(correctFocus);
    useful += Number(valid && correctFocus && rowReasks === 0 && !humanViolation && !sourceViolation && !textViolation);
  }
  const total = rows.length;
  const safetyViolations = Object.values(knownSafety).reduce((sum, value) => sum + value, 0);
  const contextualAvailable = total > 0 && labelled === total;
  const freeSamples = rows.map(row => row.generation?.metrics?.minimum_free_bytes ?? row.generation?.metrics?.preflight?.free_bytes).filter(Number.isFinite);
  return {
    total, executed: rows.filter(row => row.generation?.metrics?.executed).length, accepted,
    schema_acceptance_rate: total ? accepted / total : null,
    schema_acceptance_target: target,
    schema_acceptance_passed: total ? accepted / total >= target : false,
    contextual_labelled_cases: labelled, contextual_useful_cases: useful,
    contextual_useful_rate: labelled ? useful / labelled : null,
    contextual_target: target,
    contextual_passed: contextualAvailable ? useful / total >= target && safetyViolations === 0 : null,
    contextual_scope: 'Accepted plan + authored focus agreement + no provided-field reask + known safety checks; not a full semantic-fact or expert-quality assessment',
    known_safety_checks: knownSafety, global_known_safety_violations: safetyViolations,
    attempted_latency: latency(rows.map(row => row.generation?.metrics?.elapsed_ms)), accepted_latency: latency(acceptedTimes),
    background_p95_target_ms: 25000,
    timeout_count: rows.filter(row => row.generation?.status === 'timeout').length,
    minimum_free_bytes: freeSamples.length ? Math.min(...freeSamples) : null,
    utility: { provenance: controlKind === 'development' ? 'authored_development_not_control_not_expert_quality' : `${controlKind}_authored_synthetic_not_expert_quality`, labelled_cases: labelled, required_fields: required, requested_required_fields: requestedRequired, required_field_recall: required ? requestedRequired / required : null, provided_field_reask_violations: reasks, extra_safe_requests: extras, exact_author_set_accuracy: labelled ? exact / labelled : null, focus_accuracy: labelled ? focusCorrect / labelled : null, source_labelled_cases: sourceLabelled, source_precision_numerator: sourceCorrect, source_precision_denominator: sourcePredicted, source_precision: sourcePredicted ? sourceCorrect / sourcePredicted : null, source_exact_set_accuracy: sourceLabelled ? sourceExact / sourceLabelled : null },
  };
}
