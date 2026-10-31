/** Evaluation helpers. No ticket text is returned in aggregate diagnostics. */
export function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }

/** Nearest-rank percentile; samples are milliseconds. */
export function percentile(samples, quantile) {
  if (!samples.length) return null;
  if (quantile < 0 || quantile > 1) throw new RangeError('Quantile must be in [0, 1]');
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(quantile * ordered.length) - 1)];
}

export function latencySummary(samples) {
  return { count: samples.length, unit: 'ms', percentile_method: 'nearest-rank', min: samples.length ? Math.min(...samples) : null, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: samples.length ? Math.max(...samples) : null, mean: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null };
}

export function classificationMetrics(rows, field) {
  const labelled = rows.filter(row => typeof row.expected?.[field] === 'string');
  if (!labelled.length) return { labelled_count: 0, accuracy: null, macro_f1: null, classes: [] };
  const labels = [...new Set(labelled.flatMap(row => [row.expected[field], row.actual?.[field]]).filter(value => typeof value === 'string'))].sort();
  const classes = labels.map(label => {
    const tp = labelled.filter(row => row.expected[field] === label && row.actual?.[field] === label).length;
    const fp = labelled.filter(row => row.expected[field] !== label && row.actual?.[field] === label).length;
    const fn = labelled.filter(row => row.expected[field] === label && row.actual?.[field] !== label).length;
    return { label, support: tp + fn, true_positive: tp, false_positive: fp, false_negative: fn, f1: 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0 };
  });
  return { labelled_count: labelled.length, accuracy: labelled.filter(row => row.expected[field] === row.actual?.[field]).length / labelled.length, macro_f1: classes.reduce((sum, entry) => sum + entry.f1, 0) / classes.length, classes };
}

export function schemaErrors(result, categories) {
  const errors = [];
  if (!result || typeof result !== 'object') return ['result_not_object'];
  if (!['ru', 'kk', 'uz', 'en', 'es', 'pt', 'und'].includes(result.lang)) errors.push('invalid_language');
  if (!categories.has(result.category)) errors.push('invalid_category');
  if (!['p0', 'p1', 'p2', 'p3'].includes(result.priority)) errors.push('invalid_priority');
  if (typeof result.is_spam_or_duplicate !== 'boolean') errors.push('invalid_duplicate_flag');
  if (typeof result.needs_human !== 'boolean') errors.push('invalid_human_flag');
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) errors.push('invalid_confidence');
  if (!Array.isArray(result.reasons) || result.reasons.some(reason => typeof reason !== 'string')) errors.push('invalid_reasons');
  if (!result.extracted || typeof result.extracted.has_evidence !== 'boolean' || !Array.isArray(result.extracted.rule_refs) || result.extracted.rule_refs.some(ref => typeof ref !== 'string') || !(result.extracted.nickname === null || typeof result.extracted.nickname === 'string') || !(result.extracted.server === null || typeof result.extracted.server === 'string')) errors.push('invalid_extracted');
  if (!result.draft_reply || typeof result.draft_reply.text !== 'string' || !result.draft_reply.text.trim() || result.draft_reply.lang !== result.lang || !Array.isArray(result.draft_reply.cited) || result.draft_reply.cited.some(ref => typeof ref !== 'string')) errors.push('invalid_draft');
  if (!Array.isArray(result.citations)) errors.push('invalid_citations');
  return errors;
}

/** Existence and exact source integrity, not semantic relevance or translation quality. */
export function groundingCheck(result, sourceMap) {
  const citations = Array.isArray(result.citations) ? result.citations : [];
  const cited = Array.isArray(result.draft_reply?.cited) ? result.draft_reply.cited : [];
  const errors = [];
  let valid = 0;
  for (let index = 0; index < citations.length; index++) {
    const citation = citations[index];
    const source = sourceMap.get(citation?.id);
    const codes = [];
    if (!source) codes.push('nonexistent_source');
    else {
      if (citation.text !== source.text) codes.push('source_text_mismatch');
      if (citation.id !== `${citation.section_id}:${citation.ref}` || citation.section_id !== source.section_id || citation.section !== source.section || citation.ref !== source.ref) codes.push('namespace_mismatch');
      if (!cited.includes(source.label) || !String(result.draft_reply?.text || '').includes(source.label)) codes.push('missing_cited_label');
    }
    if (!codes.length) valid++;
    for (const code of codes) errors.push({ index, code });
  }
  const canonicalLabels = new Set(citations.map(citation => sourceMap.get(citation?.id)?.label).filter(Boolean));
  for (const label of cited) if (!canonicalLabels.has(label)) errors.push({ code: 'unbacked_cited_label' });
  if (canonicalLabels.size !== citations.length) errors.push({ code: 'duplicate_citation' });
  return { total: citations.length, valid, errors };
}

export function summarizePredictions(predictions, sourceMap, categories, alwaysHuman = []) {
  const counts = { category: {}, priority: {}, lang: {} };
  let escalations = 0, withCitations = 0, citationTotal = 0, citationValid = 0, schemaFailures = 0, groundingFailures = 0, mandatoryHumanViolations = 0;
  const failures = [];
  for (let index = 0; index < predictions.length; index++) {
    const result = predictions[index];
    for (const field of Object.keys(counts)) if (typeof result?.[field] === 'string') counts[field][result[field]] = (counts[field][result[field]] || 0) + 1;
    if (result?.needs_human) escalations++;
    const schema = schemaErrors(result, categories);
    const grounding = groundingCheck(result || {}, sourceMap);
    const humanViolation = alwaysHuman.includes(result?.category) && result?.needs_human !== true;
    if (schema.length) schemaFailures++;
    if (grounding.errors.length) groundingFailures++;
    if (humanViolation) mandatoryHumanViolations++;
    if (grounding.total) withCitations++;
    citationTotal += grounding.total;
    citationValid += grounding.valid;
    if (schema.length || grounding.errors.length || humanViolation) failures.push({ row: index + 1, schema, grounding: grounding.errors, mandatory_human_violation: humanViolation });
  }
  return { count: predictions.length, counts, escalations, escalation_rate: ratio(escalations, predictions.length), with_citations: withCitations, citation_coverage: ratio(withCitations, predictions.length), citation_total: citationTotal, citation_valid: citationValid, citation_integrity_rate: ratio(citationValid, citationTotal), schema_failures: schemaFailures, grounding_failures: groundingFailures, mandatory_human_violations: mandatoryHumanViolations, failures };
}
