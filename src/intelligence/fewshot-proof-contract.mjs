import { buildFewshotFocusMessages, FOCUS_DEMONSTRATION_BANK_SHA256 } from './focus-fewshot.mjs';
import { buildFocusSchema, buildPlanMessages, buildPlanSchema, buildGenerationInput } from './generation-contract.mjs';
import { freezeFocusValue, FOCUS_FEWSHOT_PROTOCOL_ID, FOCUS_TRAIN_PINS } from './focus-demonstrations.mjs';
import { canonicalHash, requireProof } from './production-closure.mjs';

export const FEWSHOT_SCHEMAS = Object.freeze({
  activation: 'pretrained-fewshot-generation-activation-v1', configuration: 'pretrained-fewshot-two-phase-production-v1',
  calibration_profile: 'Linux-imported17-fewshot-Windows-memory-profile-v1', calibration_freeze: 'selected17-fewshot-calibration-freeze-v4', calibration_report: 'selected17-fewshot-calibration-report-v4', calibration_scope: 'production-matching-fewshot-calibration-v4', calibration_terminal: 'fewshot-calibration-terminal-publication-v1', calibration_source: 'private-Linux17-Windows-fewshot-calibration-source-v4',
  author_freeze: 'independent-focus42-fewshot-freeze-v7', author_report: 'independent-focus42-fewshot-report-v7', author_scope: 'independent-focus42-fewshot-v7', author_terminal: 'fewshot-author-terminal-publication-v1', author_source: 'private-independent-focus42-fewshot-source-v7',
  calibration_approval: 'root-approved-current-fewshot-calibration-source-v1', author_approval: 'root-approved-current-fewshot-author-source-v1',
  focus_preregistration: 'fewshot-focus-execution-preregistration-v1', plan_preregistration: 'fewshot-plan-execution-preregistration-v1',
});
export const FEWSHOT_LIMITS = Object.freeze({ context_tokens: 1024, focus_max_tokens: 32, plan_max_tokens: 192, threads: 2, batch: 64, ubatch: 32, seed: 42, temperature: 0, preparation_budget_ms: 4400, native_budget_ms: 55600, total_budget_ms: 60000, reserve_bytes: 268435456, scratch_bytes: 268435456, header_kv_bytes: 117440512, cohort_deadline_ms: 2520000, author_rows: 42, author_correct: 38, per_class_rows: 6, per_class_correct: 4, census_timeout_ms: 10000, census_interval_ms: 1000, memory_interval_ms: 100 });
export const FEWSHOT_MODEL_ID = 'Qwen/Qwen3-1.7B:official-pretrained-project-requant-Q4_K_M';
export const FEWSHOT_MODEL_SHA256 = '54c0f1203a724e9f33e76916beab3bdfaffef56cf7b42a93b1bc21319fc0bf97';
export const FEWSHOT_CONTROL_SHA256 = 'db0959bdc67255969ffae7c840ef21ff855f1aeb16292c0cd1e5bb2d69edb579';
export const FEWSHOT_AUTHOR_RECEIPT_SHA256 = '221f02b1f7a7955af6e6b91cb415bbee6c47a43f46ff5900d61de9660fd5a4a7';
export const FEWSHOT_FINAL_CONTROL_SHA256 = 'b1cf9c3825b2dc6274257569baf91237c82b9660e340141f2a567f99df3cbeef';
const selected = 'runtime/models/qwen3-1.7b-90862c4b-QKVU3y';
export const FEWSHOT_PATHS = Object.freeze({ calibration: selected + '/linux-windows-calibration-v4-fewshot', author: selected + '/author-v7', capacity: 'runtime/fewshot-v7-tokenizer-preflight', author_fixture: 'fixtures/focus-independent-control-v7.json' });
export const FEWSHOT_CAPACITY_PINS = freezeFocusValue({
  freeze: { path: FEWSHOT_PATHS.capacity + '/runs/tokenizer126-20261031T010900347Z-37ebce5d/freeze.json', sha256: 'a84301c409b79af60720804d22be2a732cb68f83f9936302b1314073695b91b0' },
  report: { path: FEWSHOT_PATHS.capacity + '/runs/tokenizer126-20261031T010900347Z-37ebce5d/result.json', sha256: '5e54f78f026fcf58cb96ac9b01e6760f8898f71f81e12042947c7fa8a8551db3' },
  terminal: { path: FEWSHOT_PATHS.capacity + '/runs/tokenizer126-20261031T010900347Z-37ebce5d/terminal-publication.json', sha256: '3294f4856f4597083ac6c4ff97bc3842ac5793c61f24e8a2a398cbb8d9ab92d0' },
  root_approval: { path: FEWSHOT_PATHS.capacity + '/root-approval-resource-recovery.json', sha256: 'cc89365991075093ee619d22465b6fb7e3284daa633763876240c8c761aab8fd' },
  own_source: { path: FEWSHOT_PATHS.capacity + '/source-freeze.json', sha256: '6764a49dee5f54612f59e52d884c0d172f1755a794b1414f401d15a0bc16eb5c' },
});
export const FEWSHOT_CAPACITY_PROJECTION = freezeFocusValue({
  'src/intelligence/focus-demonstrations.mjs': '7fe21c342adb516379eba5666b3b154aa60f718b39aa57e7ad643520c3ab6a2d',
  'src/intelligence/focus-fewshot.mjs': '0638747f97c8da41734f2e9fd306e14ba7c7a79f4e05be18742b213bf45f082b',
  'data/focus-demonstrations-v7.json': 'd38c885ce3a458b039fcc4c706917d5e82df07665c982d13abead5d7dd704b08',
  'training/build-focus-demonstrations.mjs': '9fdde450651a2bea9368570ff7f36c6372a2052cfc551e106758987ce26f1f64',
  'tests/focus-fewshot.test.mjs': 'b7edaa37547aad8ea4954995ab2ea1eb863219bace9e301d907f67696eee125c',
  'src/intelligence/generation-contract.mjs': '665c60f6ad374da5ce214a873a8758b48f543d919150060a4e07b745adec340a',
  'src/intelligence/native-session.mjs': '4a4c3c7278f5798c380beb9a3aebf3fa9c59daa6aac02973a8332d45f37d4416',
  'src/core/engine.mjs': '466e1bb53863ad0e82bc14e297ae6b517d85e6d08a004f5ee5a601120aff3dc6',
  'src/core/language.mjs': '6ca69a346bdd33d9af84006e9aceed8538c3799f592281e0babe83203f98222b',
  'src/core/retrieval.mjs': 'eca5b51a064377cd75b6cdaa8c0a07fdb33dcde5a4e5b87cb0db3b02d6652642',
  'training/focus-author-data.mjs': '32a7aa4d59c71a029aaf55607737fbbc8b801f802f4675fbde3bb2d9a60f3ce2',
  'notebooks/support-copilot-plan-qlora.ipynb': 'f4ff582201fc224120e52ff89d0352f7f7ebaa9a1f4972c796f351fb83e2f35d',
});
export const FEWSHOT_PROTOCOL = freezeFocusValue({ id: FOCUS_FEWSHOT_PROTOCOL_ID, bank_sha256: FOCUS_DEMONSTRATION_BANK_SHA256, prototype_sha256: 'da5f86c50b6b1e713909b064e916a0536fa3a613b3efa1d55654110ca4e77046', builder_sha256: '0638747f97c8da41734f2e9fd306e14ba7c7a79f4e05be18742b213bf45f082b', selector_sha256: '7fe21c342adb516379eba5666b3b154aa60f718b39aa57e7ad643520c3ab6a2d', compiler_sha256: '9fdde450651a2bea9368570ff7f36c6372a2052cfc551e106758987ce26f1f64', train_jsonl_sha256: FOCUS_TRAIN_PINS.train_jsonl_sha256, messages: 16 });
export const FEWSHOT_PROTOCOL_SHA256 = canonicalHash(FEWSHOT_PROTOCOL);
export const PROOF_ENVELOPE_SCOPE = 'observer-envelope-excluded-from-sampled-phases-included-in-terminal-hard-deadline';
export const PHASE_COMPONENT_KEYS = Object.freeze(['verification', 'startup', 'inference', 'cleanup', 'postchecks', 'persistence']);
export const CALIBRATION_TERMINAL_KEYS = Object.freeze(['schema_version','checked','scope_id','after_publication_native_ms','after_publication_whole_ms','profile_sha256','report_sha256','freeze_sha256','model_sha256','source_seal_sha256','protocol_sha256','bank_sha256','exit_code']);
export const AUTHOR_TERMINAL_KEYS = Object.freeze(['schema_version','checked','scope_id','after_publication_whole_ms','report_sha256','freeze_sha256','model_sha256','source_seal_sha256','cohort_sha256','protocol_sha256','bank_sha256','exit_code']);
export const FEWSHOT_MONITORING = Object.freeze({census_timeout_ms:10000,census_interval_ms:1000,memory_interval_ms:100});
export const FOCUS_PREREGISTRATION_KEYS = Object.freeze(['schema_version','root_approved','scope','created_at','model_sha256','windows_runtime_closure_sha256','production_closure_sha256','protocol','protocol_sha256','bank_sha256','capacity_proof_bindings','calibration_proof_bindings','configuration','fixture_sha256','author_receipt','denominator','minimum_correct','per_class_correct','per_class_denominator','attempts_per_case','no_resume','all_operational_gates']);

export function fewshotConfiguration(nativeBudgetMs = FEWSHOT_LIMITS.native_budget_ms) {
  requireProof(Number.isInteger(nativeBudgetMs) && nativeBudgetMs >= 1 && nativeBudgetMs <= FEWSHOT_LIMITS.native_budget_ms, 'fewshot_native_budget_invalid');
  return { schema_version: FEWSHOT_SCHEMAS.configuration, context_tokens: 1024, focus_max_tokens: 32, max_tokens: 192, threads: 2, batch: 64, ubatch: 32, gpu_layers: 0, thinking: false, temperature: 0, seed: 42, mmap: true, no_repack: true, offline: true, preparation_budget_ms: 4400, native_budget_ms: nativeBudgetMs, total_budget_ms: nativeBudgetMs + 4400, reserve_bytes: 268435456 };
}
export function fewshotAuthorConfiguration(nativeBudgetMs = 55600) {
  return {...fewshotConfiguration(nativeBudgetMs),call_deadline_ms:nativeBudgetMs,startup_deadline_ms:nativeBudgetMs,cleanup_deadline_ms:nativeBudgetMs,cohort_deadline_ms:2520000};
}
export const FOCUS_EXECUTION_BINDING_KEYS = Object.freeze(['schema_version','root_approved','scope','prepared_freeze_sha256','focus_preregistration_sha256','source_inventory_sha256','model_sha256','protocol_sha256','bank_sha256','cohort_sha256']);

/** Model first and stable property order match the actual approved tokenizer
 * preflight. No caller can substitute a model, bank, schema or sampling knob. */
function body(messages, schema, max, name) {
  return { model: FEWSHOT_MODEL_ID, messages, max_tokens: max, temperature: 0, seed: 42, stream: false, response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }, chat_template_kwargs: { enable_thinking: false }, reasoning_effort: 'none' };
}
export const fewshotFocusBody = input => body(buildFewshotFocusMessages(input), buildFocusSchema(), 32, 'support_focus_only');
export const fewshotPlanBody = context => body(buildPlanMessages(context), buildPlanSchema(context), 192, 'support_plan');
export function calibrationDiagnostic(nativeBudgetMs = 55600) {
  const input = { kind: 'report', lang: 'en', messages: [{ role: 'player', text: 'Hello!' }] };
  const context = buildGenerationInput(input, { lang: 'en', category: 'report.question', needs_human: false, citations: [] }, [], { proposedFocus: 'clarification', focusOrigin: 'predeclared_diagnostic' });
  return { input, context, bodies: { focus: fewshotFocusBody(input), conditional_plan: fewshotPlanBody(context) }, configuration: fewshotConfiguration(nativeBudgetMs) };
}
