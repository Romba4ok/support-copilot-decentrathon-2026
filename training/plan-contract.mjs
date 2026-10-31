import { createHash } from 'node:crypto';
import { sanitizeInput } from '../src/core/engine.mjs';
import { PLAN_SCHEMA_VERSION, buildGenerationInput, buildPlanSchema, buildPlanMessages, validatePlan } from '../src/intelligence/generation-contract.mjs';
export const BASE_MODEL = 'Qwen/Qwen3-0.6B';
export const BASE_REVISION = 'c1899de289a04d12100db370d81485cdf75e47ca';
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/gu, ' ').trim();
export const canonicalPlayerKey = input => hash(normalize(input.messages.filter(message => message.role === 'player').map(message => message.text).join('\n')));
export function preparePlanExamples(records, { baseline, seed = 'support-plan-pilot-v1', proposeAuthoredFocus = false }) {
  if (!Array.isArray(records) || records.length < 12 || records.length > 500) throw new Error('Expected 12–500 small authored plan examples');
  const rows = records.map(record => {
    if (record.provenance?.type !== 'authored_synthetic' || record.provenance.human_reviewed !== false || record.provenance.contains_private_data !== false || record.provenance.cloud_eligible !== true) throw new Error('Only authored synthetic data is accepted');
    if (typeof record.id !== 'string' || typeof record.group_id !== 'string' || !record.intent || typeof record.expected_needs_human !== 'boolean') throw new Error('Invalid authored scenario');
    const input = sanitizeInput(record.input), result = baseline.triage(input);
    if (result.needs_human !== record.expected_needs_human) throw new Error(`${record.id}: authored human gate differs from baseline`);
    const context = buildGenerationInput(input, result, [], proposeAuthoredFocus ? { proposedFocus: record.intent.focus, focusOrigin: 'authored_synthetic' } : {});
    if (context.allowed_sources.length) throw new Error('Private rule sources must not enter the cloud bundle');
    if (context.original_human_gate !== result.needs_human || context.needs_human !== (result.needs_human || context.contextual_human)) throw new Error(`${record.id}: inconsistent code-owned effective human gate`);
    const schema = buildPlanSchema(context), messages = buildPlanMessages(context);
    if (result.needs_human && !context.needs_human) throw new Error(`${record.id}: factory lowered the original human gate`);
    const target = { schema_version: PLAN_SCHEMA_VERSION, focus: record.intent.focus, fact_ids: context.facts.filter(fact => record.intent.fact_fields.includes(fact.field)).map(fact => fact.id), request_fields: record.intent.request_fields.filter(field => context.missing_fields.includes(field)), source_ids: [], needs_human: context.needs_human };
    const checked = validatePlan(target, context);
    if (!checked.ok) throw new Error(`${record.id}: target rejected by shared factory: ${checked.reason}`);
    const duplicate_key = canonicalPlayerKey(input);
    return { id: record.id, group_id: record.group_id, provenance: record.provenance, baseline_needs_human: result.needs_human, context, schema, messages, target, duplicate_key };
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate author IDs');
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.group_id)) groups.set(row.group_id, []); groups.get(row.group_id).push(row); }
  const duplicateGroups = new Map();
  for (const row of rows) { if (duplicateGroups.has(row.duplicate_key) && duplicateGroups.get(row.duplicate_key) !== row.group_id) throw new Error('Exact duplicate spans scenario groups; merge groups before splitting'); duplicateGroups.set(row.duplicate_key, row.group_id); }
  const heldOut = new Set();
  for (const gate of [true, false]) {
    const eligible = [...groups].filter(([, members]) => members.every(row => row.target.needs_human === gate));
    if (eligible.length < 2) throw new Error('Need independent train/holdout groups for both human gates');
    eligible.sort((a, b) => hash(`${seed}:${a[0]}`).localeCompare(hash(`${seed}:${b[0]}`)));
    heldOut.add(eligible[0][0]);
  }
  const train = rows.filter(row => !heldOut.has(row.group_id)), holdout = rows.filter(row => heldOut.has(row.group_id));
  for (const [name, part] of [['train', train], ['holdout', holdout]]) for (const lang of ['ru', 'en', 'kk', 'uz', 'es', 'pt']) for (const gate of [true, false]) if (!part.some(row => row.context.lang === lang && row.target.needs_human === gate)) throw new Error(`${name} lacks ${lang}/${gate} coverage`);
  const describe = part => ({ total: part.length, human_true: part.filter(row => row.target.needs_human).length, human_false: part.filter(row => !row.target.needs_human).length, languages: Object.fromEntries(['ru','en','kk','uz','es','pt'].map(lang => { const members = part.filter(row => row.context.lang === lang); return [lang, { total: members.length, human_true: members.filter(row => row.target.needs_human).length, human_false: members.filter(row => !row.target.needs_human).length }]; })) });
  const split_counts = { train: describe(train), holdout: describe(holdout) };
  const contract_sha256 = hash(rows.map(row => ({ context: row.context, messages: row.messages, schema: row.schema })));
  return { train, holdout, manifest: { schema_version: 2, plan_schema_version: PLAN_SCHEMA_VERSION, base_model: BASE_MODEL, base_revision: BASE_REVISION, seed, provenance: 'authored_synthetic', human_reviewed: false, cloud_eligible: true, contains_private_data: false, official_citation_training: false, fingerprint: hash({ train, holdout }), contract_sha256, total_examples: rows.length, train_examples: train.length, holdout_examples: holdout.length, groups: groups.size, split_counts, train_groups: groups.size - heldOut.size, holdout_groups: heldOut.size, holdout_scenarios: [...heldOut], split_policy: 'Whole multilingual authored scenario groups; exact duplicates across groups rejected. One human and one safe scenario held out by unchanged seeded group hash; both gates covered in every language, not equal class counts.', actual_training: 'not_run', purpose: 'Small authored support-plan format/grounding pilot, not expert gold or real category evaluation' } };
}
