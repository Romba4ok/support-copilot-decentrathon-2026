import { sanitizeInput } from '../src/core/engine.mjs';
import { FOCUS_CODES, FOCUS_SCHEMA_VERSION, PLAN_SCHEMA_VERSION, buildFocusMessages, buildFocusSchema, validateFocus } from '../src/intelligence/generation-contract.mjs';
import { BASE_MODEL, BASE_REVISION, hash, canonicalPlayerKey, preparePlanExamples } from './plan-contract.mjs';
import { focusAuthorRecords, FOCUS_AUTHOR_LANGUAGES } from './focus-author-data.mjs';

function publicAuthor(row) {
  if (row.provenance?.type !== 'authored_synthetic' || row.provenance.human_reviewed !== false || row.provenance.contains_private_data !== false || row.provenance.cloud_eligible !== true) throw new Error('Only authored synthetic focus data is accepted');
}
function noCrossGroupCopies(rows) {
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate joint author ID');
  const seen = new Map();
  for (const row of rows) {
    if (seen.has(row.duplicate_key) && seen.get(row.duplicate_key) !== row.group_id) throw new Error('Canonical duplicate crosses joint scenario groups/tasks');
    seen.set(row.duplicate_key, row.group_id);
  }
}
export function prepareFocusExamples(records = focusAuthorRecords(), { seed = 'focus-author-joint-v1' } = {}) {
  if (!Array.isArray(records) || records.length !== 168) throw new Error('Focus pilot requires 168 authored rows');
  const schema = buildFocusSchema();
  const rows = records.map(record => {
    publicAuthor(record);
    const input = sanitizeInput(record.input), target = { focus: record.expected_focus };
    if (typeof record.id !== 'string' || typeof record.group_id !== 'string' || !FOCUS_AUTHOR_LANGUAGES.includes(input.lang) || !validateFocus(target).ok) throw new Error('Invalid authored focus row');
    return { id: record.id, group_id: record.group_id, task_type: FOCUS_SCHEMA_VERSION, provenance: record.provenance, context: { schema_version: FOCUS_SCHEMA_VERSION, lang: input.lang }, messages: buildFocusMessages(input), schema: structuredClone(schema), target, duplicate_key: canonicalPlayerKey(input) };
  });
  noCrossGroupCopies(rows);
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.group_id)) groups.set(row.group_id, []); groups.get(row.group_id).push(row); }
  for (const members of groups.values()) if (members.length !== 6 || new Set(members.map(row => row.context.lang)).size !== 6 || new Set(members.map(row => row.target.focus)).size !== 1) throw new Error('Focus scenario must keep six translations and one authored topic together');
  const held = new Set();
  for (const focus of FOCUS_CODES) {
    const eligible = [...groups].filter(([, members]) => members[0].target.focus === focus);
    if (eligible.length !== 4) throw new Error('Focus requires four independent groups per class');
    eligible.sort((a, b) => hash(`${seed}:${a[0]}`).localeCompare(hash(`${seed}:${b[0]}`)));
    held.add(eligible[0][0]);
  }
  return { train: rows.filter(row => !held.has(row.group_id)), holdout: rows.filter(row => held.has(row.group_id)), seed, holdout_groups: [...held], groups: groups.size };
}

export function prepareJointExamples({ baseline, planRecords, focusRecords = focusAuthorRecords(), planSeed, focusSeed } = {}) {
  const plan = preparePlanExamples(planRecords, { baseline, ...(planSeed ? { seed: planSeed } : {}), proposeAuthoredFocus: true });
  const focus = prepareFocusExamples(focusRecords, focusSeed ? { seed: focusSeed } : {});
  const tag = row => ({ ...row, task_type: PLAN_SCHEMA_VERSION });
  const train = [...focus.train, ...plan.train.map(tag)].sort((a, b) => hash(`joint-order-v1:${a.id}`).localeCompare(hash(`joint-order-v1:${b.id}`)));
  const holdout = [...focus.holdout, ...plan.holdout.map(tag)].sort((a, b) => a.id.localeCompare(b.id));
  noCrossGroupCopies([...train, ...holdout]);
  const heldGroups = new Set(holdout.map(row => row.group_id));
  if (train.some(row => heldGroups.has(row.group_id))) throw new Error('Joint group split leakage');
  const describe = rows => Object.fromEntries([FOCUS_SCHEMA_VERSION, PLAN_SCHEMA_VERSION].map(task => {
    const part = rows.filter(row => row.task_type === task);
    return [task, { total: part.length, languages: Object.fromEntries(FOCUS_AUTHOR_LANGUAGES.map(lang => [lang, part.filter(row => row.context.lang === lang).length])), focus_classes: Object.fromEntries(FOCUS_CODES.map(code => [code, part.filter(row => row.target.focus === code).length])), ...(task === PLAN_SCHEMA_VERSION ? { human_true: part.filter(row => row.target.needs_human).length, human_false: part.filter(row => !row.target.needs_human).length } : {}) }];
  }));
  return { train, holdout, manifest: { schema_version: 3, plan_schema_version: PLAN_SCHEMA_VERSION, focus_schema_version: FOCUS_SCHEMA_VERSION, tasks: [FOCUS_SCHEMA_VERSION, PLAN_SCHEMA_VERSION], base_model: BASE_MODEL, base_revision: BASE_REVISION, provenance: 'authored_synthetic', human_reviewed: false, contains_private_data: false, cloud_eligible: true, official_citation_training: false, total_examples: train.length + holdout.length, train_examples: train.length, holdout_examples: holdout.length, groups: focus.groups + plan.manifest.groups, fingerprint: hash({ train, holdout }), contract_sha256: hash([...train, ...holdout].map(row => ({ task_type: row.task_type, context: row.context, schema: row.schema, messages: row.messages }))), split_counts: { train: describe(train), holdout: describe(holdout) }, focus_seed: focus.seed, plan_seed: plan.manifest.seed, focus_holdout_groups: focus.holdout_groups, plan_holdout_groups: plan.manifest.holdout_scenarios, split_policy: 'One whole multilingual group per focus class held out by fixed seed; three train groups/class. Original plan grouped seed retained. Cross-task canonical copies rejected. No score-driven split selection.', actual_training: 'not_run', purpose: 'One bounded author-only joint topic/plan pilot; labels are authored intent, not expert gold; tasks evaluated separately' } };
}
