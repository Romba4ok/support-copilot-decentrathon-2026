const ratio = (numerator, denominator) => ({ value: denominator ? numerator / denominator : null, numerator, denominator });
const pct = (values, fraction) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;

export function evaluateRows(rows, variant, sourceMap) {
  const labelled = key => rows.filter(row => row.labels[key] !== undefined);
  const category = labelled('category'), priority = labelled('priority'), risks = rows.filter(row => row.labels.needs_human === true);
  const autoKnown = labelled('auto_eligible'), auto = autoKnown.filter(row => !row[variant].needs_human), eligible = autoKnown.filter(row => row.labels.auto_eligible === true);
  const f1 = ['p0', 'p1', 'p2', 'p3'].map(code => {
    const tp = priority.filter(row => row.labels.priority === code && row[variant].priority === code).length;
    const fp = priority.filter(row => row.labels.priority !== code && row[variant].priority === code).length;
    const fn = priority.filter(row => row.labels.priority === code && row[variant].priority !== code).length;
    return 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : null;
  }).filter(value => value !== null);
  const citations = rows.flatMap(row => row[variant].citations || []);
  const relevantRows = labelled('relevant_source_ids');
  const relevantCitations = relevantRows.flatMap(row => (row[variant].citations || []).map(source => row.labels.relevant_source_ids.includes(source.id)));
  const latency = rows.map(row => row[`${variant}_elapsed_ms`]).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    category_accuracy: ratio(category.filter(row => row[variant].category === row.labels.category).length, category.length),
    priority_macro_f1: { value: f1.length ? f1.reduce((a, b) => a + b, 0) / f1.length : null, numerator: f1.reduce((a, b) => a + b, 0), denominator: f1.length, labelled_count: priority.length, classes: f1.length },
    language_accuracy: ratio(labelled('lang').filter(row => row[variant].lang === row.labels.lang).length, labelled('lang').length),
    risk_recall: ratio(risks.filter(row => row[variant].needs_human).length, risks.length),
    auto_precision: ratio(auto.filter(row => row.labels.auto_eligible).length, auto.length),
    auto_coverage: ratio(eligible.filter(row => !row[variant].needs_human).length, eligible.length),
    citation_integrity: ratio(citations.filter(source => {
      const canonical = sourceMap.get(source.id);
      return canonical && ['text', 'section_id', 'section', 'ref'].every(key => canonical[key] === source[key]);
    }).length, citations.length),
    source_relevance: ratio(relevantCitations.filter(Boolean).length, relevantCitations.length),
    latency_ms: { value: latency.length ? latency.reduce((a, b) => a + b, 0) / latency.length : null, p50: pct(latency, .5), p95: pct(latency, .95), denominator: latency.length },
  };
}

export function comparisonMetrics(rows, sources) {
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const evaluate = subset => ({ sample_count: subset.length, human_labelled_count: subset.filter(row => Object.keys(row.labels).length).length, baseline: evaluateRows(subset, 'baseline', sourceMap), v2: evaluateRows(subset, 'v2', sourceMap) });
  return { ...evaluate(rows), slices: Object.fromEntries(['kk', 'uz'].map(lang => [lang, evaluate(rows.filter(row => (row.labels.lang || row.input.lang || row.v2.lang) === lang))])) };
}
