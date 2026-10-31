import { sanitizeInput } from '../src/core/engine.mjs';
import { classificationMetrics, ratio, summarizePredictions } from './evaluation-metrics.mjs';

export const metric = (numerator, denominator, provenance, extra = {}) => ({ value: ratio(numerator, denominator), numerator, denominator, provenance, ...extra });

/** A single allowlist boundary for both arms; labels stay in a separate object. */
export function preparePairs(records) {
  const actors = new Map();
  return records.map((record, index) => {
    const input = sanitizeInput(record);
    const history = input.reporter_hash ? [...(actors.get(input.reporter_hash) || [])] : [];
    if (input.reporter_hash) actors.set(input.reporter_hash, [...history, input]);
    return { row: index + 1, input, history };
  });
}

export function labelledMetrics(predictions, annotations = [], provenance = 'unavailable') {
  const byRow = new Map();
  for (const annotation of annotations) {
    if (!Number.isInteger(annotation.row) || annotation.row < 1 || annotation.row > predictions.length || byRow.has(annotation.row)) throw new Error('Invalid or duplicate annotation row');
    if (!annotation.labels || annotation.provenance !== provenance) throw new Error('Annotation provenance must be explicit and homogeneous');
    byRow.set(annotation.row, annotation.labels);
  }
  const rows = predictions.map((actual, index) => ({ actual, expected: byRow.get(index + 1) || {} }));
  const category = classificationMetrics(rows, 'category'), priority = classificationMetrics(rows, 'priority'), language = classificationMetrics(rows, 'lang');
  const booleans = field => rows.filter(row => typeof row.expected[field] === 'boolean');
  const human = booleans('needs_human'), risks = human.filter(row => row.expected.needs_human), auto = booleans('auto_eligible');
  const autoProposed = auto.filter(row => row.actual.needs_human === false), eligible = auto.filter(row => row.expected.auto_eligible);
  const relevant = rows.filter(row => Array.isArray(row.expected.relevant_source_ids));
  const cited = relevant.flatMap(row => (row.actual.citations || []).map(citation => ({ id: citation.id, relevant: row.expected.relevant_source_ids.includes(citation.id) })));
  return {
    annotation_count: annotations.length, provenance,
    category_accuracy: metric(category.accuracy === null ? 0 : Math.round(category.accuracy * category.labelled_count), category.labelled_count, provenance),
    priority_macro_f1: metric(priority.classes.reduce((sum, item) => sum + item.f1, 0), priority.classes.length, provenance, { labelled_count: priority.labelled_count, numerator_unit: 'sum_per_class_f1', denominator_unit: 'union_expected_predicted_classes', classes: priority.classes }),
    language_accuracy: metric(language.accuracy === null ? 0 : Math.round(language.accuracy * language.labelled_count), language.labelled_count, provenance),
    human_accuracy: metric(human.filter(row => row.actual.needs_human === row.expected.needs_human).length, human.length, provenance),
    risk_recall: metric(risks.filter(row => row.actual.needs_human === true).length, risks.length, provenance, { risk_definition: 'explicit needs_human=true label' }),
    auto_precision: metric(autoProposed.filter(row => row.expected.auto_eligible).length, autoProposed.length, provenance, { labelled_count: auto.length }),
    auto_coverage: metric(eligible.filter(row => row.actual.needs_human === false).length, eligible.length, provenance, { labelled_count: auto.length }),
    citation_relevance_precision: metric(cited.filter(item => item.relevant).length, cited.length, provenance, { labelled_rows: relevant.length }),
    language_slices: Object.fromEntries(['kk', 'uz'].map(lang => {
      const subset = rows.filter(row => row.expected.lang === lang);
      const labelledCategory = subset.filter(row => typeof row.expected.category === 'string');
      return [lang, { labelled_language_count: subset.length, category_accuracy: metric(labelledCategory.filter(row => row.expected.category === row.actual.category).length, labelledCategory.length, provenance) }];
    })),
  };
}

export function predictionChanges(baseline, v2) {
  if (baseline.length !== v2.length) throw new Error('Paired prediction counts differ');
  const fields = ['category', 'priority', 'lang', 'needs_human', 'is_spam_or_duplicate'];
  const changed = Object.fromEntries(fields.map(field => [field, baseline.filter((item, index) => item[field] !== v2[index][field]).length]));
  return { count: baseline.length, changed, auto_to_human: baseline.filter((item, index) => !item.needs_human && v2[index].needs_human).length, human_to_auto: baseline.filter((item, index) => item.needs_human && !v2[index].needs_human).length };
}

export function modes(predictions) {
  const counts = {}, fallback_reasons = {};
  for (const result of predictions) {
    const intelligence = result.analysis?.intelligence || {};
    const mode = intelligence.mode || 'baseline'; counts[mode] = (counts[mode] || 0) + 1;
    if (intelligence.fallback_reason) fallback_reasons[intelligence.fallback_reason] = (fallback_reasons[intelligence.fallback_reason] || 0) + 1;
  }
  return { counts, fallback_reasons };
}

export function retrievalMetrics(rows, sourceMap, provenance) {
  if (!rows.length) return { count: 0, provenance, hit_at_1: metric(0, 0, provenance), hit_at_3: metric(0, 0, provenance), hit_at_8: metric(0, 0, provenance), mrr_at_8: metric(0, 0, provenance), expected_recall_at_8: metric(0, 0, provenance) };
  for (const row of rows) {
    if (!Array.isArray(row.expected_source_ids) || !row.expected_source_ids.length || new Set(row.expected_source_ids).size !== row.expected_source_ids.length || row.expected_source_ids.some(id => !sourceMap.has(id))) throw new Error('Retrieval expectations must use existing unique canonical IDs');
    if (row.candidate_ids.some(id => !sourceMap.has(id))) throw new Error('Retrieval returned an unknown canonical ID');
  }
  const rank = row => row.candidate_ids.slice(0, 8).findIndex(id => row.expected_source_ids.includes(id));
  return { count: rows.length, provenance, ...Object.fromEntries([1, 3, 8].map(k => [`hit_at_${k}`, metric(rows.filter(row => row.candidate_ids.slice(0, k).some(id => row.expected_source_ids.includes(id))).length, rows.length, provenance)])), mrr_at_8: metric(rows.reduce((sum, row) => sum + (rank(row) < 0 ? 0 : 1 / (rank(row) + 1)), 0), rows.length, provenance, { numerator_unit: 'sum_reciprocal_first_relevant_rank' }), expected_recall_at_8: metric(rows.reduce((sum, row) => sum + row.expected_source_ids.filter(id => row.candidate_ids.slice(0, 8).includes(id)).length, 0), rows.reduce((sum, row) => sum + row.expected_source_ids.length, 0), provenance), misses: rows.filter(row => rank(row) < 0).map(row => row.id) };
}

export function integrity(predictions, engine) {
  return summarizePredictions(predictions, new Map(engine.sources().map(item => [item.id, item])), new Set(engine.taxonomy.categories.map(item => item.code)), engine.taxonomy.needs_human_always);
}
