import { buildFocusMessages, buildFocusSchema, FOCUS_CODES, FOCUS_SYSTEM_PROMPT, validateFocus } from './generation-contract.mjs';
import { canonical, canonicalHash, equal, exactKeys, hash, requireProof } from './production-closure.mjs';

export const FOCUS_FEWSHOT_PROTOCOL_ID = 'focus-train126-seven-en-shortest-canonical-v7';
export const FOCUS_TRAIN_PINS = Object.freeze({
  notebook_sha256: 'f4ff582201fc224120e52ff89d0352f7f7ebaa9a1f4972c796f351fb83e2f35d',
  bundle_sha256: 'fe6f1ca67b32eef2568beee84091c0196372e91d6b4eb586e5367f7c9e44cc15',
  manifest_sha256: 'd1599db986a777b7d5438d1ef09ab898c11b14084d07c91c019b36fcf3c1322c',
  train_jsonl_sha256: '651881d9307ee32d717a02b53710239ab8d1b41141f6a8dc3a6c1bc94323e188',
  author_source_sha256: '32a7aa4d59c71a029aaf55607737fbbc8b801f802f4675fbde3bb2d9a60f3ce2',
  original_factory_sha256: '6bc4d60353c0eaaabb4d70894aa15eb1b42602be0025211c4e97056cedbf721b',
});
const SUFFIX = '\n/no_think';
const LANGUAGES = ['ru', 'en', 'kk', 'uz', 'es', 'pt'];
export function freezeFocusValue(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeFocusValue(child);
    Object.freeze(value);
  }
  return value;
}

/** Exact pinned public TRAIN only. JSON literals are parsed, never evaluated.
 * The holdout JSONL is neither parsed nor returned. It supplies no examples. */
export function parsePublishedFocusTrainNotebook(bytes) {
  requireProof((Buffer.isBuffer(bytes) || typeof bytes === 'string') && Buffer.byteLength(bytes) <= 8 * 1024 ** 2 && hash(bytes) === FOCUS_TRAIN_PINS.notebook_sha256, 'focus_train_notebook_pin_required');
  const notebook = JSON.parse(bytes.toString());
  requireProof(notebook.nbformat === 4 && Array.isArray(notebook.cells), 'focus_train_notebook_invalid');
  const assignments = notebook.cells.filter(cell => cell.cell_type === 'code').flatMap(cell => (Array.isArray(cell.source) ? cell.source.join('') : String(cell.source)).split(/\r?\n/u)).filter(line => /^\s*BUNDLE_JSON\s*=/u.test(line));
  const prefix = 'BUNDLE_JSON = ';
  requireProof(assignments.length === 1 && assignments[0].startsWith(prefix), 'focus_train_single_json_literal_required');
  const bundle = JSON.parse(assignments[0].slice(prefix.length));
  requireProof(typeof bundle === 'string' && hash(bundle) === FOCUS_TRAIN_PINS.bundle_sha256, 'focus_train_bundle_pin_required');
  const files = JSON.parse(bundle), manifestText = files['data/manifest.json'], trainText = files['data/train.jsonl'];
  requireProof(typeof manifestText === 'string' && hash(manifestText) === FOCUS_TRAIN_PINS.manifest_sha256 && typeof trainText === 'string' && hash(trainText) === FOCUS_TRAIN_PINS.train_jsonl_sha256, 'focus_train_manifest_or_train_pin_required');
  const manifest = JSON.parse(manifestText);
  requireProof(manifest.schema_version === 3 && manifest.provenance === 'authored_synthetic' && manifest.human_reviewed === false && manifest.contains_private_data === false && manifest.files?.['train.jsonl'] === FOCUS_TRAIN_PINS.train_jsonl_sha256 && manifest.sources?.['training/focus-author-data.mjs'] === FOCUS_TRAIN_PINS.author_source_sha256 && manifest.factory_source_sha256 === FOCUS_TRAIN_PINS.original_factory_sha256 && manifest.prompt_sha256?.['focus-v1'] === hash(FOCUS_SYSTEM_PROMPT), 'focus_train_manifest_contract_invalid');
  const excluded = manifest.focus_holdout_groups;
  requireProof(Array.isArray(excluded) && excluded.length === 7 && new Set(excluded).size === 7 && excluded.every(group => typeof group === 'string'), 'focus_train_holdout_membership_missing');
  const allTrain = trainText.trim().split('\n').map(line => JSON.parse(line));
  requireProof(allTrain.length === 174, 'focus_train_original_total_required');
  const rows = allTrain.filter(row => row.task_type === 'focus-v1').map(row => {
    requireProof(typeof row.id === 'string' && typeof row.group_id === 'string' && !excluded.includes(row.group_id) && row.messages?.length === 2 && row.messages[0].role === 'system' && row.messages[0].content === FOCUS_SYSTEM_PROMPT && row.messages[1].role === 'user' && typeof row.messages[1].content === 'string' && row.messages[1].content.endsWith(SUFFIX) && equal(row.schema, buildFocusSchema()) && validateFocus(row.target).ok, 'focus_train_original_row_invalid');
    const payload = JSON.parse(row.messages[1].content.slice(0, -SUFFIX.length));
    requireProof(exactKeys(payload, ['language', 'player_messages']) && LANGUAGES.includes(payload.language) && payload.language === row.context?.lang && Array.isArray(payload.player_messages) && payload.player_messages.length > 0 && payload.player_messages.length <= 100 && payload.player_messages.every(text => typeof text === 'string' && text.length <= 20000) && row.provenance?.type === 'authored_synthetic' && row.provenance.human_reviewed === false && row.provenance.contains_private_data === false && row.provenance.cloud_eligible === true, 'focus_train_player_payload_invalid');
    const input = { kind: 'report', lang: payload.language, messages: payload.player_messages.map(text => ({ role: 'player', text })) };
    requireProof(equal(buildFocusMessages(input), row.messages), 'focus_train_formatter_parity_required');
    return { id: row.id, group_id: row.group_id, input, payload, target: row.target, original_row_sha256: canonicalHash(row), provenance: row.provenance };
  });
  validateFocusTrainRows(rows, excluded);
  return freezeFocusValue({ rows, lineage: { ...FOCUS_TRAIN_PINS, manifest_fingerprint: manifest.fingerprint, count: 126, excluded_holdout_groups: [...excluded], train_groups: [...new Set(rows.map(row => row.group_id))].sort(), train_rows_sha256: canonicalHash(rows) } });
}

function validateFocusTrainRows(rows, excluded) {
  requireProof(Array.isArray(rows) && rows.length === 126 && new Set(rows.map(row => row.id)).size === 126 && new Set(rows.map(row => row.group_id)).size === 21, 'focus_train_exact126_required');
  for (const focus of FOCUS_CODES) {
    const members = rows.filter(row => row.target?.focus === focus);
    requireProof(members.length === 18 && new Set(members.map(row => row.group_id)).size === 3 && LANGUAGES.every(lang => members.filter(row => row.input?.lang === lang).length === 3), 'focus_train_fixed_class_membership_required');
  }
  for (const group of new Set(rows.map(row => row.group_id))) {
    const members = rows.filter(row => row.group_id === group);
    requireProof(!excluded.includes(group) && members.length === 6 && new Set(members.map(row => row.input.lang)).size === 6 && new Set(members.map(row => row.target.focus)).size === 1, 'focus_train_group_leakage');
  }
}

/** Pure deterministic policy. No score, prediction, target text length or locale
 * enters ordering. Synthetic inputs may exercise this function in unit tests. */
export function selectFocusDemonstrations(published) {
  requireProof(published?.lineage && equal(Object.fromEntries(Object.keys(FOCUS_TRAIN_PINS).map(key => [key, published.lineage[key]])), FOCUS_TRAIN_PINS), 'focus_train_selection_lineage_required');
  validateFocusTrainRows(published.rows, published.lineage.excluded_holdout_groups);
  requireProof(canonicalHash(published.rows) === published.lineage.train_rows_sha256, 'focus_train_membership_digest_changed');
  const selected = FOCUS_CODES.map(focus => {
    const eligible = published.rows.filter(row => row.input.lang === 'en' && row.target.focus === focus).map(row => {
      const payload = JSON.parse(buildFocusMessages(row.input).at(-1).content.slice(0, -SUFFIX.length));
      requireProof(equal(payload, row.payload) && row.input.messages.every(message => message.role === 'player'), 'focus_train_selection_payload_changed');
      return { row, bytes: Buffer.byteLength(canonical(payload), 'utf8') };
    });
    eligible.sort((left, right) => left.bytes - right.bytes || (left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0));
    const { row, bytes } = eligible[0];
    return { ...structuredClone(row), canonical_player_payload_bytes: bytes, input_sha256: canonicalHash(row.input), player_payload_sha256: canonicalHash(row.payload), target_sha256: canonicalHash(row.target) };
  });
  return freezeFocusValue(selected);
}
