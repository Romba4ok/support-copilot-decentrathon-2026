import { readdir, readFile, open } from 'node:fs/promises';
import { resolve, basename, relative, isAbsolute } from 'node:path';
import { FOCUS_CODES, validateFocus, validatePlan, buildGenerationInput, renderPlan, buildFocusMessages, buildFocusSchema, buildPlanMessages, buildPlanSchema } from './generation-contract.mjs';
import { coherentTwoPhaseExecution } from './activation.mjs';
import { summarizePlanRows, validateAuthoredPlanControl } from './generation-evaluation.mjs';
import { APP_ROOT, SELECTED17_DIRECTORY, IMPORT_SOURCE_FREEZE_SHA, hash, isHash, equal, canonicalHash, exactKeys, requireProof, verifyRegularFile, readTrustedJson, verifyFingerprint, collectProductionClosure, validateProductionClosure } from './production-closure.mjs';

export const PRETRAINED_SCHEMA = 'pretrained-generation-activation-v1';
export const PRETRAINED_PINS = Object.freeze({
  repo: 'Qwen/Qwen3-1.7B-GGUF', revision: '90862c4b9d2787eaed51d12237eafdfe7c5f6077',
  sourceSha: '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a', sourceBytes: 1834426016,
  modelSha: '54c0f1203a724e9f33e76916beab3bdfaffef56cf7b42a93b1bc21319fc0bf97', modelBytes: 1107408544,
  conversionSourceSha: '769146f8071e5bacf63f7d7a3bfa8e32742a3af7bd8aeb7aede75a42818f36c4',
  cpuHelperSha: 'e476c6632d9da5337164dd9edd33c2e2a8d84bef60e0d0d3825d9ddea087bac2',
  linuxClosureSha: '8594406c9a477e3b8f7b77a6484f286c4ce75a8dd9625ad134e88d1b2e069c1a',
  windowsClosureSha: 'c5f958db77802ad0c9abd0aa35aefa947becfc3209a160d3acfe863c39380f5e',
  windowsArchiveSha: '73f962f82850d244db47eaacb9d913637027b82399124324298576d58c5f4287',
  runtimeSha: '81f65c6681d66099e5d48757aa2c050ba958dc43816e584f0bb4181eb7c910d8',
  kvBytes: 117440512, reserveBytes: 256 * 1024 ** 2, scratchBytes: 256 * 1024 ** 2,
});
const P = PRETRAINED_PINS;
export const AUTHOR42_LINEAGE_PINS = Object.freeze({
  notebook_sha256: 'f4ff582201fc224120e52ff89d0352f7f7ebaa9a1f4972c796f351fb83e2f35d',
  bundle_sha256: 'fe6f1ca67b32eef2568beee84091c0196372e91d6b4eb586e5367f7c9e44cc15',
  manifest_sha256: 'd1599db986a777b7d5438d1ef09ab898c11b14084d07c91c019b36fcf3c1322c',
  holdout_jsonl_sha256: '6891158258de8579f9979137d0b37f210c3d20c10c95689e8c18813136f6b6eb',
});
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const REF_KEYS = ['path', 'sha256'];
const ref = value => exactKeys(value, REF_KEYS) && typeof value.path === 'string' && value.path.length > 0 && isHash(value.sha256);
const pairRef = value => exactKeys(value, ['freeze', 'report', 'terminal']) && ref(value.freeze) && ref(value.report) && ref(value.terminal);

/** Opaque published author identity only. Parse a JSON string assignment;
 * never execute notebook/Python or use these labels as generation input. */
export function parsePublishedAuthor42Notebook(bytes) {
  requireProof((Buffer.isBuffer(bytes) || typeof bytes === 'string') && Buffer.byteLength(bytes) <= 8 * 1024 ** 2 && hash(bytes) === AUTHOR42_LINEAGE_PINS.notebook_sha256, 'published_author_notebook_pin_required');
  const notebook = JSON.parse(bytes.toString());
  requireProof(notebook.nbformat === 4 && Array.isArray(notebook.cells), 'published_author_notebook_contract');
  const assignments = notebook.cells.filter(cell => cell.cell_type === 'code').flatMap(cell => (Array.isArray(cell.source) ? cell.source.join('') : String(cell.source)).split(/\r?\n/u)).filter(line => /^\s*BUNDLE_JSON\s*=/u.test(line));
  const prefix = 'BUNDLE_JSON = ';
  requireProof(assignments.length === 1 && assignments[0].startsWith(prefix), 'single_literal_author_bundle_required');
  const bundle = JSON.parse(assignments[0].slice(prefix.length));
  requireProof(typeof bundle === 'string' && hash(bundle) === AUTHOR42_LINEAGE_PINS.bundle_sha256, 'published_author_bundle_pin_required');
  const files = JSON.parse(bundle), manifestText = files['data/manifest.json'], heldText = files['data/holdout.jsonl'];
  requireProof(typeof manifestText === 'string' && typeof heldText === 'string' && hash(manifestText) === AUTHOR42_LINEAGE_PINS.manifest_sha256 && hash(heldText) === AUTHOR42_LINEAGE_PINS.holdout_jsonl_sha256, 'published_author_manifest_or_holdout_pin_required');
  const manifest = JSON.parse(manifestText);
  requireProof(manifest.schema_version === 3 && manifest.provenance === 'authored_synthetic' && manifest.human_reviewed === false && manifest.contains_private_data === false, 'published_author_provenance_required');
  const rows = heldText.trim().split('\n').map(line => JSON.parse(line)).filter(row => row.task_type === 'focus-v1').map(row => {
    const user = row.messages?.[1], suffix = '\n/no_think';
    requireProof(row.messages?.length === 2 && row.messages[0].role === 'system' && user?.role === 'user' && typeof user.content === 'string' && user.content.endsWith(suffix), 'published_author_focus_payload_required');
    const payload = JSON.parse(user.content.slice(0, -suffix.length));
    requireProof(exactKeys(payload, ['language','player_messages']) && payload.language === row.context?.lang && ['ru','en','kk','uz','es','pt'].includes(payload.language) && Array.isArray(payload.player_messages) && payload.player_messages.length > 0 && payload.player_messages.length <= 100 && payload.player_messages.every(text => typeof text === 'string' && text.length <= 20000) && validateFocus(row.target).ok && row.provenance?.type === 'authored_synthetic' && row.provenance.human_reviewed === false && row.provenance.contains_private_data === false, 'published_author_identity_payload_invalid');
    return {id:row.id,group_id:row.group_id,input:{kind:'report',lang:payload.language,messages:payload.player_messages.map(text=>({role:'player',text}))},expected_focus:row.target.focus,provenance:row.provenance};
  });
  requireProof(rows.length === 42 && new Set(rows.map(row => row.id)).size === 42 && Array.isArray(manifest.focus_holdout_groups) && manifest.focus_holdout_groups.length === 7 && rows.every(row => typeof row.id === 'string' && manifest.focus_holdout_groups.includes(row.group_id)), 'published_author_exact42_required');
  return {rows,manifest_fingerprint:manifest.fingerprint,validation_groups:manifest.focus_holdout_groups};
}

function validateAuthorLineage(lineage, published) {
  requireProof(lineage.schema_version === 'existing-authored-focus42-cohort-lineage-v2' && Object.entries(AUTHOR42_LINEAGE_PINS).every(([key,value]) => lineage[key] === value) && lineage.fingerprint === published.manifest_fingerprint && lineage.frozen_training_factory_sha256 === '6bc4d60353c0eaaabb4d70894aa15eb1b42602be0025211c4e97056cedbf721b' && lineage.current_factory_payload_rebuilt_at_prepare === true && lineage.count === 42 && lineage.human_reviewed === false && lineage.contains_private_data === false && lineage.real_gold === false && Array.isArray(lineage.validation_groups) && equal([...lineage.validation_groups].sort(), [...published.validation_groups].sort()) && Array.isArray(lineage.records) && lineage.records.length === 42 && new Set(lineage.records.map(row => row.id)).size === 42, 'published_author_lineage_required');
  const trusted = new Map(published.rows.map(row => [row.id,row]));
  requireProof(lineage.records.every(row => exactKeys(row,['id','group_id','expected_focus','input_sha256']) && trusted.has(row.id) && row.group_id === trusted.get(row.id).group_id && row.expected_focus === trusted.get(row.id).expected_focus && row.input_sha256 === canonicalHash(trusted.get(row.id).input)), 'published_author_lineage_input_identity_changed');
}
export function canonicalCorpusHash(sources) {
  requireProof(Array.isArray(sources) && sources.length <= 10000 && new Set(sources.map(source => source.id)).size === sources.length, 'canonical_corpus_identity_invalid');
  return canonicalHash(sources.map(source => Object.fromEntries(['id', 'section_id', 'section', 'ref', 'text', 'label'].map(key => [key, source[key] ?? null]))).sort((a, b) => a.id.localeCompare(b.id, 'en')));
}
export function pretrainedConfiguration(nativeBudgetMs = 55600) {
  requireProof(Number.isInteger(nativeBudgetMs) && nativeBudgetMs >= 1 && nativeBudgetMs <= 55600, 'pretrained_native_budget_invalid');
  return { schema_version: 'pretrained-two-phase-production-v1', context_tokens: 1024, focus_max_tokens: 32, max_tokens: 192, threads: 2, batch: 64, ubatch: 32, gpu_layers: 0, thinking: false, temperature: 0, seed: 42, mmap: true, no_repack: true, offline: true, preparation_budget_ms: 4400, native_budget_ms: nativeBudgetMs, total_budget_ms: nativeBudgetMs + 4400, reserve_bytes: P.reserveBytes };
}
export function validatePretrainedManifest(a, configuration = pretrainedConfiguration()) {
  requireProof(equal(configuration, pretrainedConfiguration(configuration?.native_budget_ms)), 'pretrained_effective_configuration_mismatch');
  const keys = ['schema_version', 'family', 'scope', 'root_decision', 'selected_model', 'import_receipt', 'runtime_closure', 'production_closure', 'corpus_sha256', 'configuration', 'bounded_trial', 'memory_profile', 'calibration', 'author_validation', 'preregistration', 'independent_quality', 'project_finetuned', 'training', 'joint100_checkpoint', 'recovered_old20_adapter'];
  requireProof(exactKeys(a, keys) && a.schema_version === PRETRAINED_SCHEMA && a.family === 'official_pretrained_Q8_to_project_Q4_requantization', 'pretrained_manifest_contract');
  requireProof(['project_finetuned', 'training', 'joint100_checkpoint', 'recovered_old20_adapter'].every(key => a[key] === false), 'pretrained_is_not_joint_or_training');
  const validation = a.scope === 'private-validation' && a.root_decision === 'approved_for_local_validation';
  const operator = a.scope === 'operator-generation' && a.root_decision === 'approved_for_local_operator_generation';
  requireProof(validation || operator, 'pretrained_explicit_root_scope_required');
  requireProof(exactKeys(a.selected_model, ['path', 'sha256', 'bytes']) && typeof a.selected_model.path === 'string' && a.selected_model.sha256 === P.modelSha && a.selected_model.bytes === P.modelBytes, 'pretrained_selected_model_mismatch');
  requireProof(['import_receipt', 'runtime_closure', 'production_closure'].every(key => ref(a[key])) && a.runtime_closure.sha256 === P.windowsClosureSha, 'pretrained_trusted_proof_references_required');
  requireProof(equal(a.configuration, configuration), 'pretrained_effective_configuration_mismatch');
  requireProof(isHash(a.corpus_sha256), 'trusted_canonical_corpus_identity_required');
  requireProof(typeof a.bounded_trial === 'boolean' && (a.memory_profile === null || ref(a.memory_profile)) && (a.calibration === null || pairRef(a.calibration)), 'pretrained_profile_reference_invalid');
  requireProof((a.memory_profile === null) === (a.calibration === null), 'pretrained_profile_calibration_pair_required');
  if (validation) requireProof(a.memory_profile !== null || a.bounded_trial === true, 'pretrained_root_bounded_trial_required');
  if (operator) requireProof(a.bounded_trial === false && ref(a.memory_profile) && pairRef(a.calibration) && pairRef(a.author_validation) && ref(a.preregistration) && ref(a.independent_quality), 'pretrained_operator_requires_real_qualification');
  else requireProof((a.author_validation === null || pairRef(a.author_validation)) && (a.preregistration === null || ref(a.preregistration)) && a.independent_quality === null, 'private_validation_is_not_operator_quality');
  return { validationOnly: validation };
}

export function validateImport(imported) {
  requireProof(imported.schema_version === 'linux-prebuilt-pretrained17-import-v2' && imported.status === 'pretrained17_linux_import_integrity_verified_not_quality_verified' && imported.actual_local_bytes_verified === true && imported.verification_origin === 'bounded_actual_local_source_output_and_companion_bytes', 'actual_typed_pretrained_import_required');
  requireProof(equal(imported.model, { name: 'Qwen3-1.7B-Q4_K_M-CPU-requant.gguf', bytes: P.modelBytes, sha256: P.modelSha }), 'pretrained_import_model_mismatch');
  requireProof(['project_finetuned', 'joint100_checkpoint', 'activated', 'quality_verified', 'model_loaded'].every(key => imported[key] === false), 'import_not_activation_or_training');
  const d = imported.derivation, source = d?.source;
  requireProof(d?.type === 'official_linux_prebuilt_Q8_to_Q4_requant' && d.source_freeze_sha256 === P.conversionSourceSha && d.cpu_helper_sha256 === P.cpuHelperSha && d.linux_tool_host_closure_sha256 === P.linuxClosureSha, 'pretrained_derivation_pin_mismatch');
  requireProof(source?.repo === P.repo && source.revision === P.revision && source.source_sha256 === P.sourceSha && source.source_bytes === P.sourceBytes && source.source_quantization === 'Q8_0' && source.quantization === 'Q4_K_M' && source.method === 'official_pretrained_Q8_to_project_Q4_requantization' && ['project_finetuned', 'recovered_old20_adapter', 'joint100_checkpoint', 'training'].every(key => source[key] === false), 'pretrained_upstream_provenance_mismatch');
  for (const key of ['immutable_proof_sha256', 'linux_asset_sha256', 'linux_tool_closure_file_sha256', 'transfer_manifest_sha256', 'transfer_receipt_sha256']) requireProof(isHash(d[key]), 'pretrained_import_companion_hash_missing');
  requireProof(imported.windows_runtime?.closure_sha256 === P.windowsClosureSha && imported.kv_f16_bytes_at1024 === P.kvBytes && isHash(imported.tensor_structure_sha256), 'selected_runtime_or_header_identity_mismatch');
  for (const [key, value] of Object.entries({ 'general.architecture': 'qwen3', 'qwen3.block_count': 28, 'qwen3.embedding_length': 2048, 'qwen3.attention.head_count': 16, 'qwen3.attention.head_count_kv': 8, 'qwen3.attention.key_length': 128, 'qwen3.attention.value_length': 128 })) requireProof(imported.header?.[key] === value, 'pretrained_selected_header_geometry');
}
export function calibrationSettings(value, c) {
  return value && ['context_tokens', 'threads', 'batch', 'ubatch', 'focus_max_tokens', 'thinking', 'temperature', 'seed', 'mmap', 'no_repack', 'offline', 'reserve_bytes'].every(key => value[key] === c[key]) && value.plan_max_tokens === c.max_tokens && value.deadline_ms === c.native_budget_ms && value.total_deadline_ms === c.total_budget_ms && value.preparation_budget_ms === c.preparation_budget_ms && value.scratch_commit_estimate_bytes === P.scratchBytes;
}
export function ownedExit(report) {
  const usage = report?.runtime_usage, memory = usage?.observed_memory;
  const census = report?.census_usage;
  return Number.isInteger(report.owned_pid) && report.owned_pid > 0 && report.runtime_pid_after_close === null && report.double_close_same_promise === true && report.guard_held_until_close === true && usage?.exit?.code === null && ['SIGTERM', 'SIGKILL'].includes(usage.exit.signal) && positive(memory?.peak_rss_bytes) && positive(memory?.peak_private_bytes) && positive(report.minimum_free_bytes) && report.minimum_free_bytes >= P.reserveBytes && Array.isArray(report.preflight_census) && report.preflight_census.length === 0 && Array.isArray(report.post_run_census) && report.post_run_census.length === 0 && Number.isInteger(census?.started) && census.started > 0 && census.closed === census.started && census.maximum_concurrent === 1 && census.remaining_pid === null && Array.isArray(census.owned_pids) && census.owned_pids.length === census.started && new Set(census.owned_pids).size === census.started && census.owned_pids.every(pid=>Number.isInteger(pid)&&pid>0);
}
export function coherentCall(call, max, limit) {
  const u = call?.usage;
  return call?.executed === true && typeof call.raw === 'string' && call.raw.length > 0 && call.raw.length <= 65536 && call.output_sha256 === hash(call.raw) && call.finish_reason === 'stop' && Number.isInteger(call.prompt_tokens) && call.prompt_tokens > 0 && call.prompt_tokens + max + 8 <= 1024 && u?.prompt_tokens === call.prompt_tokens && Number.isInteger(u.completion_tokens) && u.completion_tokens > 0 && u.completion_tokens <= max && u.total_tokens === u.prompt_tokens + u.completion_tokens && nonnegative(call.elapsed_ms) && call.elapsed_ms <= limit;
}
export function promptPayload(body, messages, schema, max, name) {
  return exactKeys(body, ['model', 'messages', 'max_tokens', 'temperature', 'seed', 'stream', 'response_format', 'chat_template_kwargs', 'reasoning_effort']) && typeof body.model === 'string' && body.model.length > 0 && equal(body.messages, messages) && body.max_tokens === max && body.temperature === 0 && body.seed === 42 && body.stream === false && equal(body.response_format, { type: 'json_schema', json_schema: { name, strict: true, schema } }) && equal(body.chat_template_kwargs, { enable_thinking: false }) && body.reasoning_effort === 'none';
}
function sourceRecords(records, production) {
  return Array.isArray(records) && equal([...records].sort((a, b) => a.path.localeCompare(b.path, 'en')), [...production.records].sort((a, b) => a.path.localeCompare(b.path, 'en')));
}
function validateCalibration(profile, evidence, a, imported, production, c) {
  const { freeze, report, terminal } = evidence;
  requireProof(profile.schema_version === 'Linux-imported17-Windows-memory-profile-v2' && profile.actual_native === true && profile.model_sha256 === P.modelSha && profile.Linux_derivation_closure_sha256 === P.linuxClosureSha && profile.Windows_runtime_closure_sha256 === P.windowsClosureSha && profile.context_tokens === 1024 && profile.mmap === true && profile.no_repack === true && profile.header_kv_bytes === P.kvBytes && profile.quality_verified === false && profile.activated === false, 'own_selected17_memory_profile_required');
  const phaseKeys = ['verification','startup','inference','cleanup','postchecks','persistence'];
  for (const value of [report,profile]) {
    requireProof(value.scope_id === 'production-matching-calibration-v3' && value.phase_scope === 'verification-admission-start-inference-abort-actual-exit-postchecks-persistence' && value.native_phase_started_before_verification === true && value.terminal_publication_required === true && value.proof_envelope_scope === 'observer-envelope-excluded-from-sampled-phases-included-in-terminal-hard-deadline', 'calibration_v3_explicit_phase_scope_required');
    requireProof(nonnegative(value.semantic_body_ms) && value.semantic_body_ms <= c.preparation_budget_ms && positive(value.native_phase_elapsed_ms) && value.native_phase_elapsed_ms <= c.native_budget_ms && positive(value.whole_entry_elapsed_ms) && value.whole_entry_elapsed_ms <= c.total_budget_ms && value.whole_entry_elapsed_ms >= value.semantic_body_ms + value.native_phase_elapsed_ms && value.preparation_elapsed_ms === value.semantic_body_ms && value.elapsed_ms === value.native_phase_elapsed_ms && value.total_elapsed_ms === value.whole_entry_elapsed_ms, 'calibration_v3_raw_phase_budget_or_alias_mismatch');
    requireProof(exactKeys(value.phase_components_ms,phaseKeys) && phaseKeys.every(key => nonnegative(value.phase_components_ms[key])) && phaseKeys.reduce((sum,key) => sum+value.phase_components_ms[key],0) <= value.native_phase_elapsed_ms, 'calibration_v3_raw_component_sum_mismatch');
  }
  requireProof(['semantic_body_ms','native_phase_elapsed_ms','whole_entry_elapsed_ms','phase_components_ms'].every(key=>equal(profile[key],report[key])), 'calibration_v3_profile_phase_binding_mismatch');
  requireProof(exactKeys(terminal,['schema_version','checked','scope_id','after_publication_native_ms','after_publication_whole_ms','profile_sha256','report_sha256','freeze_sha256','model_sha256','source_seal_sha256','exit_code']) && terminal.schema_version === 'calibration-terminal-publication-v1' && terminal.checked === true && terminal.scope_id === 'production-matching-calibration-v3' && terminal.exit_code === 0 && terminal.profile_sha256 === a.memory_profile.sha256 && terminal.report_sha256 === a.calibration.report.sha256 && terminal.freeze_sha256 === a.calibration.freeze.sha256 && terminal.model_sha256 === P.modelSha && terminal.source_seal_sha256 === production.sha256 && nonnegative(terminal.after_publication_native_ms) && terminal.after_publication_native_ms >= report.native_phase_elapsed_ms && terminal.after_publication_native_ms <= c.native_budget_ms && nonnegative(terminal.after_publication_whole_ms) && terminal.after_publication_whole_ms >= report.whole_entry_elapsed_ms && terminal.after_publication_whole_ms >= report.semantic_body_ms+terminal.after_publication_native_ms && terminal.after_publication_whole_ms <= c.total_budget_ms, 'calibration_actual_root_terminal_publication_required');
  requireProof(calibrationSettings(profile.configuration, c) && profile.import_receipt_sha256 === hash(JSON.stringify(imported)) && profile.source_seal_sha256 === production.sha256 && equal(profile.source_seal,production) && profile.trial_freeze_sha256 === a.calibration.freeze.sha256 && profile.trial_report_sha256 === a.calibration.report.sha256, 'memory_profile_source_config_or_trace_mismatch');
  const selected = Object.fromEntries(['model','header','kv_f16_bytes_at1024','derivation','windows_runtime'].map(key => [key, imported[key]]));
  requireProof(equal(freeze.source_seal, production) && sourceRecords(freeze.source_seal.records, production) && equal(freeze.selected, selected) && calibrationSettings(freeze.configuration, c) && freeze.import_receipt_sha256 === profile.import_receipt_sha256 && report.freeze_sha256 === a.calibration.freeze.sha256 && report.import_receipt_sha256 === profile.import_receipt_sha256, 'calibration_freeze_binding_mismatch');
  const hashes = Object.fromEntries(production.records.map(record => [record.path, record.sha256]));
  requireProof(equal(freeze.source_hashes, hashes) && equal(report.source_hashes, hashes) && calibrationSettings(report.configuration, c), 'calibration_full_source_configuration_mismatch');
  requireProof(report.status === 'calibration_completed_not_quality' && report.failure === null && report.post_integrity_verified === true && report.selected_model_sha256 === P.modelSha && positive(report.elapsed_ms) && report.elapsed_ms <= c.native_budget_ms && nonnegative(report.preparation_elapsed_ms) && report.preparation_elapsed_ms <= 4400 && positive(report.total_elapsed_ms) && report.total_elapsed_ms <= c.total_budget_ms && report.elapsed_ms + report.preparation_elapsed_ms <= report.total_elapsed_ms, 'calibration_operational_budget_failed');
  requireProof(ownedExit(report) && equal(profile.observed_memory, report.runtime_usage.observed_memory) && profile.minimum_free_bytes === report.minimum_free_bytes, 'calibration_owned_exit_or_memory_failed');
  const preflight = report.preflight, required = P.kvBytes + P.scratchBytes + P.reserveBytes;
  requireProof(preflight?.mode === 'explicit_unmeasured_selected1.7_mmap_commit_estimate_trial' && preflight.header_kv_bytes === P.kvBytes && preflight.scratch_commit_estimate_bytes === P.scratchBytes && preflight.reserve_bytes === P.reserveBytes && preflight.required_free_bytes === required && preflight.old_profile_inherited === false && positive(preflight.free_bytes) && preflight.free_bytes >= required, 'calibration_selected_model_preflight_required');
  requireProof(Array.isArray(report.calls) && report.calls.length === 2, 'calibration_two_phase_trace_required');
  requireProof(equal(freeze.input, { kind: 'report', lang: 'en', messages: [{ role: 'player', text: 'Hello!' }] }), 'predeclared_calibration_input_required');
  const expectedContext = buildGenerationInput(freeze.input, { lang: 'en', category: 'report.question', needs_human: false, citations: [] }, [], { proposedFocus: 'clarification', focusOrigin: 'predeclared_diagnostic' });
  requireProof(equal(freeze.context, expectedContext), 'calibration_current_factory_context_mismatch');
  for (const [index, phase, max] of [[0, 'focus', 32], [1, 'conditional_plan', 192]]) {
    const call = report.calls[index], body = freeze.bodies?.[phase];
    const messages = index === 0 ? buildFocusMessages(freeze.input) : buildPlanMessages(expectedContext), schema = index === 0 ? buildFocusSchema() : buildPlanSchema(expectedContext);
    requireProof(call.phase === phase && coherentCall(call, max, c.native_budget_ms) && call.max_tokens === max && call.tokenizer_parity === true && call.request_sha256 === hash(JSON.stringify(body)) && promptPayload(body, messages, schema, max, index === 0 ? 'support_focus_only' : 'support_plan'), 'calibration_raw_usage_trace_mismatch');
  }
  requireProof(validateFocus(report.calls[0].raw).ok && validatePlan(report.calls[1].raw, freeze.context).ok, 'calibration_closed_output_failed');
  requireProof(report.forced_timeout?.request_started === true && report.forced_timeout.triggered === true && report.forced_timeout.outcome === 'AbortError' && positive(report.forced_timeout.elapsed_ms) && report.forced_timeout.elapsed_ms >= 25 && report.forced_timeout.elapsed_ms <= c.native_budget_ms, 'calibration_actual_forced_timeout_required');
}

export function validateAuthorQualification(author, a, imported, production, c, trustedAuthorRows) {
  const { freeze, report, terminal } = author;
  requireProof(freeze.schema_version === 'author42-predeclared-focus-only-freeze-v1' && freeze.no_retry === true && freeze.no_retuning === true && freeze.no_activation === true && equal(freeze.thresholds, { correct: 38, denominator: 42, per_class_correct: 4, per_class_denominator: 6 }), 'author_predeclared_fixed_gate_required');
  requireProof(Array.isArray(freeze.rows) && freeze.rows.length === 42 && new Set(freeze.rows.map(row => row.id)).size === 42 && freeze.cohort_sha256 === canonicalHash(freeze.rows), 'author_exact42_frozen_cases_required');
  requireProof(Array.isArray(trustedAuthorRows) && trustedAuthorRows.length === 42 && new Set(trustedAuthorRows.map(row=>row.id)).size === 42, 'trusted_published_author42_identity_required');
  const trusted = new Map(trustedAuthorRows.map(row=>[row.id,row]));
  requireProof(freeze.rows.every(row=>trusted.has(row.id) && ['id','group_id','input','expected_focus','provenance'].every(key=>equal(row[key],trusted.get(row.id)[key])) && canonicalHash(row.input) === canonicalHash(trusted.get(row.id).input)), 'author_published_identity_input_or_target_changed');
  requireProof(report.schema_version === 'author42-focus-report-v2' && report.scope_id === 'authored-focus42-v2' && report.status === 'completed_authored_focus_not_quality' && report.failure === null && report.post_run_integrity_verified === true && report.freeze_sha256 === a.author_validation.freeze.sha256 && report.selected_model_sha256 === P.modelSha && ownedExit(report), 'author_actual_current_execution_required');
  requireProof(freeze.model_sha256 === P.modelSha && equal(freeze.import_receipt, imported) && freeze.profile?.model_sha256 === P.modelSha && equal(freeze.source, production) && sourceRecords(freeze.source.records, production) && freeze.source.sha256 === canonicalHash(freeze.source.records), 'author_model_profile_full_source_mismatch');
  const bindings = report.proof_bindings;
  requireProof(bindings?.source_inventory_sha256 === freeze.source.sha256 && bindings.import_receipt_sha256 === hash(JSON.stringify(imported)) && bindings.calibration_profile_sha256 === a.memory_profile.sha256 && bindings.calibration_freeze_sha256 === a.calibration.freeze.sha256 && bindings.calibration_report_sha256 === a.calibration.report.sha256 && bindings.calibration_terminal_sha256 === a.calibration.terminal.sha256 && bindings.Linux_closure === P.linuxClosureSha && bindings.Windows_closure === P.windowsClosureSha && bindings.model_sha256 === P.modelSha && bindings.cohort_sha256 === freeze.cohort_sha256, 'author_proof_binding_mismatch');
  requireProof(Array.isArray(report.results) && report.results.length === 42 && equal(report.configuration, freeze.configuration) && report.configuration.context_tokens === 1024 && report.configuration.threads === 2 && report.configuration.cohort_deadline_ms === 2520000 && ['call_deadline_ms','startup_deadline_ms','cleanup_deadline_ms'].every(key => report.configuration[key] === c.native_budget_ms) && positive(report.total_with_prepost_ms) && report.total_with_prepost_ms <= report.configuration.cohort_deadline_ms, 'author_configuration_or_budget_mismatch');
  requireProof(['startup_ms','cleanup_ms','total_elapsed_ms','preflight_elapsed_ms','post_integrity_ms','report_persistence_ms'].every(key=>nonnegative(report[key])) && report.startup_ms <= c.native_budget_ms && report.cleanup_ms <= c.native_budget_ms && report.total_elapsed_ms >= report.startup_ms + report.results.reduce((sum,row)=>sum+row.elapsed_ms,0) + report.cleanup_ms && report.total_with_prepost_ms >= report.preflight_elapsed_ms + report.total_elapsed_ms + report.post_integrity_ms + report.report_persistence_ms, 'author_raw_phase_budget_or_sum_mismatch');
  requireProof(report.terminal_publication_required === true && report.proof_envelope_scope === 'observer-envelope-excluded-from-sampled-phases-included-in-terminal-hard-deadline' && exactKeys(terminal,['schema_version','checked','scope_id','after_publication_whole_ms','report_sha256','freeze_sha256','model_sha256','source_seal_sha256','cohort_sha256','exit_code']) && terminal.schema_version === 'author-terminal-publication-v1' && terminal.checked === true && terminal.scope_id === 'authored-focus42-v2' && terminal.exit_code === 0 && terminal.report_sha256 === a.author_validation.report.sha256 && terminal.freeze_sha256 === a.author_validation.freeze.sha256 && terminal.model_sha256 === P.modelSha && terminal.source_seal_sha256 === production.sha256 && terminal.cohort_sha256 === freeze.cohort_sha256 && nonnegative(terminal.after_publication_whole_ms) && terminal.after_publication_whole_ms >= report.total_with_prepost_ms && terminal.after_publication_whole_ms <= report.configuration.cohort_deadline_ms, 'author_actual_root_terminal_publication_required');
  const classes = Object.fromEntries(FOCUS_CODES.map(code => [code, { total: 0, correct: 0 }]));
  let correct = 0;
  for (let index = 0; index < 42; index++) {
    const expected = freeze.rows[index], call = report.results[index], body = expected.body;
    requireProof(FOCUS_CODES.includes(expected.expected_focus) && call.id === expected.id && call.expected_focus === expected.expected_focus && call.group_id === expected.group_id && call.lang === expected.input.lang && equal(call.provenance,expected.provenance) && call.status === 'completed' && call.attempt === 1 && coherentCall(call, 32, c.native_budget_ms) && call.request_sha256 === hash(JSON.stringify(body)) && equal(call.request_body, body) && promptPayload(body, buildFocusMessages(expected.input), buildFocusSchema(), 32, 'support_focus_only'), 'author_raw_request_usage_mismatch');
    const parsed = validateFocus(call.raw); requireProof(parsed.ok, 'author_focus_contract_invalid');
    classes[expected.expected_focus].total++;
    if (parsed.value.focus === expected.expected_focus) { correct++; classes[expected.expected_focus].correct++; }
  }
  requireProof(correct >= 38 && Object.values(classes).every(item => item.total === 6 && item.correct >= 4), 'author38_and_every_class4_gate_failed');
  return { correct, denominator: 42, classes };
}

export function validatePretrainedPreregistration(preregistration, { manifest: a, production, author, configuration: c, evaluatorSha256, benchmarkSha256 }) {
  const required = ['schema_version', 'root_approved', 'root_decision', 'created_at', 'model_sha256', 'production_closure_sha256', 'corpus_sha256', 'configuration', 'author_report_sha256', 'fixture_sha256', 'evaluator_sha256', 'benchmark_sha256', 'denominator', 'minimum_contextual', 'maximum_safety_violations', 'control_kind'];
  requireProof(exactKeys(preregistration, required) && preregistration.schema_version === 'pretrained-generation-preregistration-v1' && preregistration.root_approved === true && preregistration.root_decision === 'approved_for_one_fresh_independent_run' && Number.isFinite(Date.parse(preregistration.created_at)), 'new_root_preregistration_required');
  requireProof(preregistration.model_sha256 === P.modelSha && preregistration.production_closure_sha256 === production.sha256 && preregistration.corpus_sha256 === a.corpus_sha256 && equal(preregistration.configuration, c) && preregistration.author_report_sha256 === a.author_validation.report.sha256 && isHash(preregistration.fixture_sha256) && preregistration.evaluator_sha256 === evaluatorSha256 && preregistration.benchmark_sha256 === benchmarkSha256 && preregistration.denominator === 24 && preregistration.minimum_contextual === 22 && preregistration.maximum_safety_violations === 0 && preregistration.control_kind === 'fresh-independent', 'preregistered_model_source_config_or_gate_mismatch');
  requireProof(author.report.post_run_integrity_verified === true, 'author_must_pass_before_fresh_preregistration');
}
export function validateIndependentQualification(quality, preregistration, { manifest: a, production, configuration: c, evaluatorSha256, benchmarkSha256, canonicalSources }) {
  requireProof(quality.benchmark_schema_version === 4 && quality.control_kind === 'fresh-independent' && quality.human_reviewed === false && quality.model?.sha256 === P.modelSha && quality.model?.project_finetuned === false && quality.activation_family === 'pretrained' && quality.production_closure_sha256 === production.sha256 && quality.candidate_sha256 === production.sha256, 'current_pretrained_independent_quality_required');
  const hashes = Object.fromEntries(production.records.map(record => [record.path, record.sha256]));
  requireProof(equal(quality.file_hashes, hashes) && equal(quality.full_file_hashes, hashes) && quality.corpus_sha256 === canonicalCorpusHash(canonicalSources) && quality.corpus_sha256 === a.corpus_sha256 && quality.evaluator_sha256 === evaluatorSha256 && quality.benchmark_sha256 === benchmarkSha256 && equal(quality.production_configuration, c) && quality.fixture_sha256 === preregistration.fixture_sha256 && quality.preregistration_sha256 === a.preregistration.sha256 && Date.parse(quality.created_at) >= Date.parse(preregistration.created_at), 'quality_full_source_preregistration_or_configuration_mismatch');
  requireProof(!quality.error && Array.isArray(quality.cases) && quality.cases.length === 24 && new Set(quality.cases.map(row => row.id)).size === 24, 'quality_exact24_denominator_required');
  for (const row of quality.cases) {
    const g = row.generation, m = g?.metrics;
    requireProof(m && m.model_sha256 === P.modelSha && m.activation_family === 'pretrained' && m.native_budget_ms === c.native_budget_ms && m.budget_ms === c.total_budget_ms && nonnegative(m.preparation_ms) && m.preparation_ms <= 4400 && nonnegative(m.elapsed_ms) && m.elapsed_ms <= c.native_budget_ms && nonnegative(m.total_elapsed_ms) && m.total_elapsed_ms <= c.total_budget_ms && Math.abs(m.total_elapsed_ms - (m.elapsed_ms + m.preparation_ms)) <= 1 && positive(row.whole_elapsed_ms) && row.whole_elapsed_ms <= c.total_budget_ms && row.whole_elapsed_ms + 1 >= m.total_elapsed_ms, 'quality_actual_whole_budget_required');
    requireProof(coherentTwoPhaseExecution(row), 'quality_raw_usage_execution_incoherent');
    requireProof(m.minimum_free_bytes >= P.reserveBytes && (!m.executed || Number.isInteger(m.owned_pid) && m.owned_pid > 0), 'quality_native_memory_or_owned_pid_missing');
    if (m.owned_pid) requireProof(m.owned_exit_verified === true && m.runtime_pid_after_close === null && m.double_close_same_promise === true && m.guard_held_until_close === true && m.runtime_usage?.exit?.code === null && ['SIGTERM', 'SIGKILL'].includes(m.runtime_usage.exit.signal) && positive(m.runtime_usage.observed_memory?.peak_private_bytes) && positive(m.runtime_usage.observed_memory?.peak_rss_bytes), 'quality_owned_cleanup_trace_missing');
    if (g.status === 'generated') {
      requireProof(row.input && row.baseline && Array.isArray(row.canonical_sources), 'quality_context_source_basis_required');
      const canonical = new Map(canonicalSources.map(source => [source.id, source]));
      requireProof(row.canonical_sources.every(source => canonical.has(source.id) && ['text', 'section_id', 'section', 'ref', 'label'].every(key => source[key] === canonical.get(source.id)[key])), 'quality_citation_not_in_trusted_live_corpus');
      const basis = row.raw_model_output?.plan?.context_basis;
      requireProof(basis && basis.lang === row.baseline.lang && basis.category === row.baseline.category && basis.needs_human === row.baseline.needs_human && equal(basis.citations, row.canonical_sources) && equal(row.baseline.source_ids, basis.citations.map(source => source.id)) && typeof row.original_baseline?.needs_human === 'boolean' && (!row.original_baseline.needs_human || basis.needs_human), 'quality_actual_raw_basis_or_human_gate_mismatch');
      const context = buildGenerationInput(row.input, { ...row.baseline, citations: row.canonical_sources }, canonicalSources, { proposedFocus: g.plan?.focus, focusOrigin: 'local_llm' });
      requireProof(!context.unresolved && validatePlan(g.plan, context).ok && equal(context.source_applicability, m.source_applicability) && equal(renderPlan(g.plan, context).source_ids, g.source_ids) && renderPlan(g.plan, context).text === g.text && g.needs_human === context.needs_human && g.lang === context.lang, 'quality_closed_context_or_render_mismatch');
    }
  }
  const summary = summarizePlanRows(quality.cases, { controlKind: 'fresh-independent' });
  requireProof(summary.total === 24 && summary.contextual_useful_cases >= 22 && summary.accepted >= 22 && summary.global_known_safety_violations === 0 && summary.utility.provided_field_reask_violations === 0, 'independent22_zero_violation_gate_failed');
  return summary;
}

/** Pure document consistency only. Filesystem verifier below proves actual
 * bytes; this function alone never constitutes model activation. */
export function validatePretrainedDocuments(bundle) {
  const { manifest: a, imported, production, profile, calibration, author, preregistration, quality, configuration: c, evaluatorSha256, benchmarkSha256 } = bundle;
  const { validationOnly } = validatePretrainedManifest(a, c); validateImport(imported);
  requireProof([[a.memory_profile,profile],[a.calibration,calibration],[a.author_validation,author],[a.preregistration,preregistration],[a.independent_quality,quality]].every(([reference,document]) => (reference === null) === (document === null)), 'referenced_pretrained_documents_required');
  requireProof(a.corpus_sha256 === canonicalCorpusHash(bundle.canonicalSources), 'pretrained_current_corpus_mismatch');
  if (profile) validateCalibration(profile, calibration, a, imported, production, c);
  if (author) { requireProof(equal(author.freeze.profile, profile), 'author_actual_measured_profile_mismatch'); validateAuthorQualification(author, a, imported, production, c, bundle.trustedAuthorRows); }
  if (preregistration) validatePretrainedPreregistration(preregistration, bundle);
  if (!validationOnly) {
    const fixture = validateAuthoredPlanControl(bundle.independentFixture);
    requireProof(equal(fixture.cases.map(row => ({id:row.id,input:row.input,expected:row.expected})), quality.cases.map(row => ({id:row.id,input:row.input,expected:row.expected}))), 'quality_cases_differ_from_actual_frozen_fixture');
    validateIndependentQualification(quality, preregistration, bundle);
  }
  return { documents_consistent: true, actual_local_files_verified: false, validationOnly };
}

export function pretrainedModelMetadata() {
  return { id: 'Qwen/Qwen3-1.7B:official-pretrained-project-requant-Q4_K_M', sha256: P.modelSha, quantization: 'Q4_K_M', source_quantization: 'Q8_0', provenance: 'verified_official_pretrained_Q8_to_project_Q4_requantization', pretrained: true, requantized: true, project_finetuned: false, training: false, joint100_checkpoint: false, recovered_old20_adapter: false };
}

export function validateWindowsRuntimeMembership(receipt, names) {
  requireProof(receipt.schema_version === 'official-toolkit-file-closure-v1' && receipt.archive_sha256 === P.windowsArchiveSha && receipt.release === 'b11960' && receipt.all_binary_files_match_archive === true && receipt.files && Object.keys(receipt.files).length === 51, 'full_official_windows51_closure_required');
  requireProof(equal([...names].sort(), Object.keys(receipt.files).sort()) && names.length === 51, 'windows_runtime_membership_changed');
  requireProof(receipt.files['llama-server.exe']?.sha256 === P.runtimeSha, 'pinned_pretrained_server_required');
  for (const [name, record] of Object.entries(receipt.files)) requireProof(basename(name) === name && exactKeys(record, ['bytes', 'sha256']) && isHash(record.sha256) && Number.isInteger(record.bytes) && record.bytes > 0, 'windows_runtime_record_invalid');
}

/** No writes, downloads or model initialization. A successful return proves
 * actual local bytes plus the exact trusted family-specific qualification. */
export function createPretrainedActivationVerifier(config, { rootDir = APP_ROOT, canonicalSources = [] } = {}) {
  const root = resolve(rootDir), files = [];
  let cached = null, pending = null;
  const namespaces = ['runtime/models', 'runtime/recovery-17-cpu/prebuilt-v2/inbound'];
  const namespaceFor = path => {
    const absolute = resolve(root, path);
    const namespace = namespaces.find(name => { const nested = relative(resolve(root, name), absolute); return nested !== '' && !isAbsolute(nested) && nested.split(/[\\/]/u)[0] !== '..'; });
    requireProof(namespace, 'pretrained_proof_outside_concrete_runtime_namespaces'); return namespace;
  };
  async function pointer(reference, maxBytes = 16 * 1024 ** 2, signal) {
    requireProof(ref(reference), 'pretrained_exact_proof_pointer_required');
    const file = await readTrustedJson({ rootDir: root, path: reference.path, namespace: namespaceFor(reference.path), expectedSha256: reference.sha256, maxBytes, signal }); files.push(file); return file.value;
  }
  async function runtimeClosure(a, signal) {
    const receipt = await pointer(a.runtime_closure, 1024 ** 2, signal), directory = 'runtime/tools/llama-b11960-cpu';
    const actual = (await readdir(resolve(root, directory))).filter(name => /\.(?:exe|dll)$/iu.test(name)).sort();
    validateWindowsRuntimeMembership(receipt, actual);
    for (const name of actual) {
      const record = receipt.files[name]; requireProof(basename(name) === name && exactKeys(record, ['bytes', 'sha256']), 'windows_runtime_record_invalid');
      files.push(await verifyRegularFile({ rootDir: root, path: directory + '/' + name, namespace: 'runtime/tools', maxBytes: 128 * 1024 ** 2, expectedSha256: record.sha256, expectedBytes: record.bytes, signal }));
    }
    requireProof(receipt.files['llama-server.exe']?.sha256 === P.runtimeSha, 'pinned_pretrained_server_required');
    return resolve(root, directory, 'llama-server.exe');
  }
  async function load({ signal } = {}) {
    requireProof(config?.enabled === true && config.focusMode === 'model', 'pretrained_model_mode_not_enabled');
    const native = Number(config.timeoutMs ?? 55600), configuration = pretrainedConfiguration(native);
    const activation = await readTrustedJson({ rootDir: root, path: config.activationManifestPath, namespace: 'runtime/models', maxBytes: 256 * 1024, expectedSha256: config.activationManifestSha256, signal }); files.push(activation);
    const a = activation.value, { validationOnly } = validatePretrainedManifest(a, configuration);
    if (config.requiredActivationScope !== undefined) requireProof(config.requiredActivationScope === a.scope, 'required_activation_scope_mismatch');
    if (config.activationScope !== undefined) requireProof(config.activationScope === a.scope, 'activation_scope_override_mismatch');
    requireProof(a.corpus_sha256 === canonicalCorpusHash(canonicalSources), 'pretrained_current_corpus_mismatch');
    const expectedProduction = await pointer(a.production_closure, 4 * 1024 ** 2, signal), production = await collectProductionClosure({ rootDir: root, signal }); validateProductionClosure(expectedProduction, production);
    const imported = await pointer(a.import_receipt, 4 * 1024 ** 2, signal);
    const runtimePath = await runtimeClosure(a, signal);
    if (config.runtimePath !== undefined) requireProof(resolve(root, config.runtimePath) === runtimePath, 'runtime_path_override_mismatch');
    const profile = a.memory_profile ? await pointer(a.memory_profile, 2 * 1024 ** 2, signal) : null;
    const calibration = a.calibration ? { freeze: await pointer(a.calibration.freeze, 8 * 1024 ** 2, signal), report: await pointer(a.calibration.report, 8 * 1024 ** 2, signal), terminal: await pointer(a.calibration.terminal,1024**2,signal) } : null;
    const author = a.author_validation ? { freeze: await pointer(a.author_validation.freeze, 16 * 1024 ** 2, signal), report: await pointer(a.author_validation.report, 16 * 1024 ** 2, signal), terminal: await pointer(a.author_validation.terminal,1024**2,signal) } : null;
    let trustedAuthorRows = null;
    if (author) {
      const notebook = await verifyRegularFile({rootDir:root,path:'notebooks/support-copilot-plan-qlora.ipynb',namespace:'notebooks',maxBytes:8*1024**2,expectedSha256:AUTHOR42_LINEAGE_PINS.notebook_sha256,signal});files.push(notebook);
      const published = parsePublishedAuthor42Notebook(await readFile(notebook.path,{signal}));
      const lineage = await readTrustedJson({rootDir:root,path:SELECTED17_DIRECTORY+'/author42-focus-v2/cohort-lineage.json',namespace:'runtime/models',maxBytes:1024**2,signal});files.push(lineage);validateAuthorLineage(lineage.value,published);trustedAuthorRows=published.rows;
    }
    const preregistration = a.preregistration ? await pointer(a.preregistration, 1024 ** 2, signal) : null;
    const quality = a.independent_quality ? await pointer(a.independent_quality, 16 * 1024 ** 2, signal) : null;
    let independentFixture = null;
    if (quality) { const file = await readTrustedJson({ rootDir: root, path: quality.fixture_path, namespace: 'fixtures', maxBytes: 512 * 1024, expectedSha256: preregistration?.fixture_sha256, signal }); files.push(file); independentFixture = file.value; }
    const evaluatorSha256 = hash(await readFile(resolve(root, 'src/intelligence/generation-evaluation.mjs'))), benchmarkSha256 = hash(await readFile(resolve(root, 'scripts/benchmark-generator.mjs')));
    validatePretrainedDocuments({ manifest: a, imported, production, profile, calibration, author, trustedAuthorRows, preregistration, quality, independentFixture, configuration, evaluatorSha256, benchmarkSha256, canonicalSources });
    const model = await verifyRegularFile({ rootDir: root, path: a.selected_model.path, namespace: namespaceFor(a.selected_model.path), maxBytes: P.sourceBytes, expectedBytes: P.modelBytes, expectedSha256: P.modelSha, signal }); files.push(model);
    const handle = await open(model.path, 'r'); try { const magic = Buffer.alloc(8); await handle.read(magic, 0, 8, 0); requireProof(magic.subarray(0, 4).toString() === 'GGUF' && magic.readUInt32LE(4) === 3, 'selected_pretrained_gguf_header_invalid'); } finally { await handle.close(); }
    if (config.modelPath !== undefined) requireProof(resolve(root, config.modelPath) === resolve(root, a.selected_model.path), 'model_path_override_mismatch');
    for (const file of files) await verifyFingerprint(file);
    validateProductionClosure(expectedProduction, await collectProductionClosure({ rootDir: root, signal }));
    return { family: 'pretrained', modelPath: model.path, runtimePath, modelSha: P.modelSha, modelBytes: P.modelBytes, validationOnly, memoryMode: profile ? 'pretrained17_measured_mmap_profile' : 'pretrained17_explicit_unmeasured_mmap_trial', memoryProfile: profile, headerKVBytes: P.kvBytes, configuration, modelMetadata: pretrainedModelMetadata(), activation_sha256: activation.sha256, import_receipt_sha256: a.import_receipt.sha256, upstream_source_sha256: P.sourceSha, conversion_closure_sha256: P.linuxClosureSha, windows_closure_sha256: P.windowsClosureSha, production_closure_sha256: production.sha256, corpus_sha256: a.corpus_sha256 };
  }
  return async options => {
    if (cached) {
      for (const file of files) await verifyFingerprint(file);
      const current = await collectProductionClosure({ rootDir: root, signal: options?.signal });
      requireProof(current.sha256 === cached.production_closure_sha256, 'current_production_source_closure_changed');
      const names = (await readdir(resolve(root, 'runtime/tools/llama-b11960-cpu'))).filter(name => /\.(?:exe|dll)$/iu.test(name));
      requireProof(names.length === 51 && names.every(name => files.some(file => basename(file.path) === name)), 'windows_runtime_membership_changed');
      return cached;
    }
    if (!pending) pending = load(options).then(value => (cached = value)).catch(error => { pending = null; files.length = 0; throw error; });
    return pending;
  };
}
