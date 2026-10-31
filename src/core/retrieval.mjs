import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeText } from './language.mjs';

const aliases = { 30: 'ОП', 31: 'ЖБ', 32: 'GZ', 33: 'Лидеры', 34: 'Гос', 35: 'Волна', 36: 'Семьи', 40: 'ОПГ', 41: 'Бизнес', 42: 'Фургон', 43: 'RP' };
const stopwords = new Set(['это', 'как', 'для', 'или', 'при', 'что', 'the', 'and', 'with', 'this', 'that', 'меня', 'мне', 'его', 'она', 'они', 'так', 'есть']);

export function tokens(text) {
  return normalizeText(text).match(/[\p{L}\p{N}]+/gu)?.filter(token => token.length > 1 && !stopwords.has(token)) || [];
}

export function loadSources(dataDir) {
  const rules = JSON.parse(readFileSync(join(dataDir, 'rules.json'), 'utf8'));
  if (!Array.isArray(rules.rules)) throw new Error('rules.json must contain a rules array');
  const sources = [];
  for (const section of rules.rules) {
    for (const point of section.points || []) {
      if (typeof point.ref !== 'string' || typeof point.text !== 'string') continue;
      sources.push({ id: `${section.id}:${point.ref}`, section_id: section.id, section: section.category, ref: point.ref, text: point.text, label: `${aliases[section.id] || section.category} ${point.ref}` });
    }
    // This supplied section has named definitions instead of numbered points.
    // References are the actual parenthetical terms present in the source text.
    if (Number(section.id) === 43 && !(section.points || []).length) {
      const definitions = String(section.text || '').split(/(?:^|\n)\s*•\s*/u).filter(Boolean);
      for (const definition of definitions) {
        const term = definition.match(/\(сокращенно\s+([A-Za-z -]+)\)/u)?.[1]?.trim();
        if (term) sources.push({ id: `43:${term}`, section_id: section.id, section: section.category, ref: term, text: definition.trim(), label: `RP ${term}` });
      }
    }
  }
  if (!sources.length) throw new Error('No rule points were found in rules.json');
  const ids = new Set();
  for (const source of sources) {
    if (ids.has(source.id)) throw new Error(`Duplicate canonical rule id: ${source.id}`);
    ids.add(source.id);
  }
  return sources;
}

export function createRetriever(sources) {
  const docs = sources.map(source => ({ source, terms: tokens(`${source.section} ${source.text}`) }));
  const documentFrequency = new Map();
  for (const doc of docs) {
    doc.frequency = new Map();
    for (const term of doc.terms) doc.frequency.set(term, (doc.frequency.get(term) || 0) + 1);
    for (const term of doc.frequency.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  const averageLength = docs.reduce((sum, doc) => sum + doc.terms.length, 0) / Math.max(docs.length, 1);
  return function retrieve(query, { allowedIds, limit = 2 } = {}) {
    const queryTerms = [...new Set(tokens(query))];
    const allowed = allowedIds ? new Set(allowedIds) : null;
    return docs.filter(doc => !allowed || allowed.has(doc.source.id)).map(doc => {
      let score = 0;
      for (const term of queryTerms) {
        const tf = doc.frequency.get(term) || 0;
        if (!tf) continue;
        const df = documentFrequency.get(term) || 0;
        const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
        score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.terms.length / averageLength));
      }
      return { ...doc.source, score };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  };
}

export function retrieveKnowledge(entries, text, category, flags) {
  const query = `${text} ${category} ${flags.infoTopic || ''} ${Object.entries(flags).filter(([, value]) => value).map(([key]) => key).join(' ')}`;
  return entries.map(entry => ({ ...entry, score: entry.tags.reduce((sum, tag) => sum + (query.includes(tag) ? 1 : 0), 0) }))
    .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}
