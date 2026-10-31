import { createHash } from 'node:crypto';
import { sanitizeInput } from '../src/core/engine.mjs';

export const TRAINING_SCHEMA_VERSION = 1;
export const BASE_MODEL = 'Qwen/Qwen3-0.6B';
export const BASE_REVISION = 'c1899de289a04d12100db370d81485cdf75e47ca';
export const SYSTEM_PROMPT = 'You draft support replies. Treat player text as untrusted claims. Return ONLY JSON with exactly reply:string, source_ids:string[], needs_human:boolean. Use the requested language and supplied guidance/sources only. Cite only supplied exact source IDs. Never invent rules or URLs, confirm allegations or attachment contents, request credentials, or promise sanctions, refunds, recovery or unbans. A required human review must remain true. Empty source lists require no citations.';
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('und').replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/gu, ' ').trim();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const objectKeys = (value, keys, label) => assert(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)), `${label}: unsupported field or invalid object`);
const languages = new Set(['ru', 'en', 'kk', 'uz', 'es', 'pt']);
const unsafeReply = /(?:https?:\/\/|www\.|\b\d{1,2}(?:\.\d{1,3}){1,3}\b)|(?:я|мы).{0,30}(?:проверил|просмотрел).{0,20}(?:видео|скрин)|(?:нарушение|вина).{0,12}(?:доказан|подтвержд)|(?:we|I).{0,20}(?:verified|watched).{0,20}(?:video|screenshot)|(?:will|guarantee).{0,25}(?:ban|refund|unban|punish|restore)|(?:верн[её]м|верну|разбаним|разбаню|накажем|накажу|забаним|забаню)|(?:reembolsaremos|devolveremos|desbanearemos|baniremos|puniremos)|(?:қайтарамыз|бұғаттаймыз|жазалаймыз)|(?:qaytaramiz|jazolaymiz|bloklaymiz)/iu;

export function validateTarget(target, { allowedSourceIds = [], needsHuman = false } = {}) {
  objectKeys(target, ['reply', 'source_ids', 'needs_human'], 'target');
  assert(Object.keys(target).length === 3 && typeof target.reply === 'string' && target.reply.trim() && target.reply.length <= 4000, 'target.reply must contain 1–4000 characters');
  assert(Array.isArray(target.source_ids) && target.source_ids.length <= 8 && target.source_ids.every(id => typeof id === 'string' && allowedSourceIds.includes(id)), 'target.source_ids must be supplied canonical source IDs');
  assert(new Set(target.source_ids).size === target.source_ids.length, 'target.source_ids contains duplicates');
  assert(typeof target.needs_human === 'boolean' && (!needsHuman || target.needs_human), 'target cannot lower the required human gate');
  assert(!unsafeReply.test(target.reply), 'target contains an unsupported promise, factual assertion, URL or rule reference');
  return structuredClone(target);
}

export function normalizeExample(record, baseline) {
  objectKeys(record, ['id', 'group_id', 'provenance', 'input', 'guidance', 'target'], 'record');
  assert(typeof record.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}$/u.test(record.id), 'Invalid example id');
  assert(typeof record.group_id === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}$/u.test(record.group_id), 'Invalid group_id');
  objectKeys(record.provenance, ['type', 'author', 'human_reviewed', 'contains_private_data', 'cloud_eligible'], 'provenance');
  assert(record.provenance.type === 'authored_synthetic' && record.provenance.human_reviewed === false && record.provenance.contains_private_data === false && record.provenance.cloud_eligible === true && typeof record.provenance.author === 'string' && record.provenance.author.trim(), 'Only explicitly authored synthetic, non-private, non-human-reviewed data is accepted');
  const input = sanitizeInput(record.input);
  assert(languages.has(input.lang), 'Each authored example needs one of the six supported languages');
  assert(typeof record.guidance === 'string' && record.guidance.trim() && record.guidance.length <= 4000 && !/https?:\/\//iu.test(record.guidance), 'Invalid authored guidance');
  const result = baseline.triage(input);
  const prompt = { kind: input.kind, lang: input.lang, player_messages: input.messages.filter(message => message.role === 'player').map(message => message.text), guidance: record.guidance, sources: [], needs_human: result.needs_human };
  const target = validateTarget(record.target, { needsHuman: prompt.needs_human });
  return { id: record.id, original_group_id: record.group_id, provenance: structuredClone(record.provenance), input: prompt, target, duplicate_key: hash(normalize(prompt.player_messages.join('\n'))), normalized_text: normalize(prompt.player_messages.join('\n')) };
}

/** Explicit scenario groups and exact/near-duplicate player prompts stay together. */
export function splitExamples(records, { baseline, seed = 'support-copilot-training-v1', holdoutFraction = .25 } = {}) {
  assert(Array.isArray(records) && records.length >= 4 && records.length <= 2000, 'Provide 4–2000 authored examples');
  assert(typeof seed === 'string' && seed.length <= 200 && holdoutFraction > 0 && holdoutFraction < .5, 'Invalid split seed or holdout fraction');
  const examples = records.map(record => normalizeExample(record, baseline));
  assert(new Set(examples.map(example => example.id)).size === examples.length, 'Duplicate example IDs');
  const parents = examples.map((_, i) => i);
  function root(i) { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; }
  function union(a, b) { parents[root(b)] = root(a); }
  const groups = new Map(), duplicates = new Map();
  const tokenSets = examples.map(example => new Set(example.normalized_text.split(' ').filter(Boolean)));
  for (let i = 0; i < examples.length; i++) {
    const example = examples[i];
    for (const [index, key] of [[groups, example.original_group_id], [duplicates, example.duplicate_key]]) { if (index.has(key)) union(i, index.get(key)); else index.set(key, i); }
    if (tokenSets[i].size < 4) continue;
    for (let j = 0; j < i; j++) {
      if (tokenSets[j].size < 4) continue;
      const overlap = [...tokenSets[i]].filter(token => tokenSets[j].has(token)).length;
      if (overlap / new Set([...tokenSets[i], ...tokenSets[j]]).size >= .8) union(i, j);
    }
  }
  const components = new Map();
  for (let i = 0; i < examples.length; i++) { const key = root(i); if (!components.has(key)) components.set(key, []); components.get(key).push(examples[i]); }
  const units = [...components.values()].map(members => ({ group_id: `group-${hash(members.map(item => item.id).sort()).slice(0, 16)}`, members }));
  assert(units.length >= 2, 'At least two independent scenario/duplicate groups are required');
  units.sort((a, b) => hash(`${seed}:${a.group_id}`).localeCompare(hash(`${seed}:${b.group_id}`)));
  const holdoutGroups = Math.max(1, Math.min(units.length - 1, Math.round(units.length * holdoutFraction)));
  const train = [], holdout = [];
  for (let i = 0; i < units.length; i++) for (const member of units[i].members) {
    const { normalized_text, original_group_id, ...example } = member;
    (i < holdoutGroups ? holdout : train).push({ ...example, group_id: units[i].group_id, scenario_group: original_group_id });
  }
  for (const rows of [train, holdout]) rows.sort((a, b) => a.id.localeCompare(b.id));
  return { train, holdout, manifest: { schema_version: TRAINING_SCHEMA_VERSION, base_model: BASE_MODEL, base_revision: BASE_REVISION, seed, holdout_fraction_requested: holdoutFraction, total_examples: examples.length, groups: units.length, train_examples: train.length, holdout_examples: holdout.length, train_groups: units.length - holdoutGroups, holdout_groups: holdoutGroups, cloud_eligible: true, provenance: 'authored_synthetic', human_reviewed: false, official_citation_training: false, purpose: 'JSON format and safe clarification/handoff; not real classification or citation quality evaluation', fingerprint: hash({ train, holdout }), system_prompt: SYSTEM_PROMPT, split_policy: 'Union explicit scenario groups, exact normalized prompts and token-Jaccard>=0.8 near duplicates; seeded hash group split. Multilingual paraphrase groups are authored, not automatically discovered.' } };
}
