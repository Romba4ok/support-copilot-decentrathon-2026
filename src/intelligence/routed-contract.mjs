import {resolve} from 'node:path';
import {sanitizeInput} from '../core/engine.mjs';
import {FOCUS_CODES,buildGenerationInput,buildPlanMessages,buildPlanSchema} from './generation-contract.mjs';
import {APP_ROOT,canonicalHash,hash,equal,exactKeys,isHash,requireProof,readTrustedJson} from './production-closure.mjs';

export const ROUTED_FAMILY='trained-router-plan';
export const ROUTED_PLAN_SCOPE='fresh-independent-plan-v12';
export const ROUTED_TRAINING_ROWS=1134;
export const ROUTED_SCHEMAS=Object.freeze({
 activation:'trained-router-plan-activation-v1',configuration:'trained-router-plan-production-v8',
 calibration_profile:'trained-router-plan-memory-profile-v8',calibration_freeze:'trained-router-plan-calibration-freeze-v8',calibration_report:'trained-router-plan-calibration-report-v8',calibration_scope:'production-matching-trained-router-plan-calibration-v8',calibration_terminal:'trained-router-plan-calibration-terminal-v8',calibration_source:'private-trained-router-plan-calibration-source-v8',calibration_approval:'root-approved-current-routed-calibration-source-v8',
 author_freeze:'independent-focus42-trained-router-freeze-v8',author_report:'independent-focus42-trained-router-report-v8',author_scope:'independent-focus42-trained-router-v8',author_terminal:'trained-router-focus-terminal-v8',author_source:'private-independent-focus42-trained-router-source-v8',author_approval:'root-approved-current-routed-focus-source-v8',
 focus_preregistration:'routed-focus-execution-preregistration-v8',focus_execution_binding:'routed-focus-execution-binding-v8',plan_preregistration:'routed-plan-execution-preregistration-v8',manual_review:'root-agent-routed-plan-contextual-review-v8',
});
export const ROUTED_LIMITS=Object.freeze({dimensions:384,context_tokens:1024,plan_max_tokens:192,threads:2,batch:64,ubatch:32,seed:42,temperature:0,preparation_budget_ms:4400,native_budget_ms:55600,total_budget_ms:60000,reserve_bytes:268435456,scratch_bytes:268435456,header_kv_bytes:117440512,calibration_cohort_ms:180000,cohort_deadline_ms:2520000,author_rows:42,author_correct:38,per_class_rows:6,per_class_correct:4,plan_rows:24,plan_accepted:22,census_timeout_ms:10000,census_interval_ms:1000,memory_interval_ms:100,cleanup_reserve_ms:1500});
export const ROUTED_PATHS=Object.freeze({
 plan:'runtime/models/routed-v8/plan-model.gguf',head:'runtime/models/routed-v9/head-runtime.json',encoder:'runtime/models/multilingual-e5-small',runtime:'runtime/tools/llama-b11960-cpu/llama-server.exe',
 calibration:'runtime/models/routed-v8/calibration-v8',author:'runtime/models/routed-v8/focus-v8',
 focus_preregistration:'runtime/routed-v15-focus-preregistration.json',focus_execution_binding:'runtime/routed-v15-focus-execution-binding.json',plan_preregistration:'runtime/routed-v15-plan-preregistration.json',
 author_fixture:'fixtures/focus-independent-control-v15.json',author_receipt:'runtime/independent-focus-v15-author/author-receipt.json',plan_fixture:'fixtures/generation-plan-control-v12.json',
});
export const ROUTED_PINS=Object.freeze({
 plan_sha256:'eb9000457afb58d527d5523a118b84edfdd7ae43588d0e13c001e987ced7e782',plan_bytes:396704608,plan_training_steps:20,
 head_sha256:'db9eaeaa92d0d566a54b2a20ba82dca2cd7f4488638281413383e79a0a9b97e7',head_bytes:71979,
 encoder_manifest_sha256:'699d5e90416afa97818ffb58549e05b988ca304122d8e2fa29365a03db1e01d8',encoder_revision:'761b726dd34fb83930e26aab4e9ac3899aa1fa78',worker_sha256:'647895b4ae4b3b77a1ba8909487b19af6ea90b91842e6a64b2c25335abf31295',
 windows_closure_sha256:'c5f958db77802ad0c9abd0aa35aefa947becfc3209a160d3acfe863c39380f5e',runtime_sha256:'81f65c6681d66099e5d48757aa2c050ba958dc43816e584f0bb4181eb7c910d8',
 // TRAIN source is the frozen v9 runner/config, not this production graph.
 // Its immutable69 feature graph and exact reused966 provenance are in the head.
 dataset_sha256:'0830792eab85d429edabb6f27a0fabcdcfe68bcfe91502a53fd46d8183613ec0',historical_training_source_sha256:'34256034d4c41931d6fbdfd485d07965a0368f92c3a3b3579be2cf0a17a5d343',
 factory_sha256:'0036d492705c3b9fea60c31bc80b8d3b861de39dc921f3130f37ee4ae5be8637',native_session_sha256:'4a4c3c7278f5798c380beb9a3aebf3fa9c59daa6aac02973a8332d45f37d4416',
 plan_control_sha256:'58002f3592019b0c7f87834ff4571f6c2a9be10b62c84cb195ecc4bb7fbf7b05',
});
// Opaque clean-author metadata only. The fixture is lazily decoded solely after
// current root preregistration, current measured calibration and full-source pin.
export const ROUTED_FOCUS_AUTHORITY=Object.freeze({fixture_sha256:'5f8df2565c9034b4a1a938c9f9662b386f80e36e70b3037629c9391a5d3932bd',fixture_bytes:28432,author_receipt_sha256:'b8e4ffd266fc88ebc1070cb529cd6c92b86e717e181fdb2b9539857ce12bdc34',fixture_schema:'independent-authored-focus-control-v15',author_receipt_format:'hash-pinned-file-metadata-v15',author:'independent-focus-v15'});
export const ROUTED_CLASSIFIER=Object.freeze({type:'class_balanced_L2_multinomial_linear',weights_initialization:'zero',bias_initialization:'zero',l2_lambda:.01,learning_rate:.5,full_batch_steps:600,class_weight:'n_train/(7*class_count_training_fold_only)',objective:'weighted_mean_negative_log_likelihood_plus_lambda_over2_times_squared_weights',regularize_bias:false,hyperparameter_grid:false,early_stopping:false,randomness:'none'});
export const ROUTED_SERIALIZER=Object.freeze({id:'original-player-LF-query-12000-v8',prefix:'query: ',max_text_chars:12000,description:'player role texts in original order joined by LF, prefix query: , then JS slice(0,12000); no language/category/target appended'});
export const ROUTED_PROTOCOL=Object.freeze({id:'e5-q8-expanded1134-linearC-old20-plan-v9',family:ROUTED_FAMILY,training_rows:ROUTED_TRAINING_ROWS,head_sha256:ROUTED_PINS.head_sha256,dataset_sha256:ROUTED_PINS.dataset_sha256,encoder_manifest_sha256:ROUTED_PINS.encoder_manifest_sha256,encoder_revision:ROUTED_PINS.encoder_revision,worker_sha256:ROUTED_PINS.worker_sha256,serializer:ROUTED_SERIALIZER,class_order:Object.freeze([...FOCUS_CODES]),dimensions:384,plan_sha256:ROUTED_PINS.plan_sha256,plan_training_steps:20,router_is_llm:false,probabilities_calibrated:false});
export const ROUTED_PROTOCOL_SHA256=canonicalHash(ROUTED_PROTOCOL);
export const ROUTED_MODEL_ID='Qwen/Qwen3-0.6B:recovered-authored-plan-20step-Q4_K_M';
export const ROUTED_MONITORING=Object.freeze({census_timeout_ms:10000,census_interval_ms:1000,memory_interval_ms:100});
export const ROUTED_PROOF_ENVELOPE_SCOPE='durable-case-payloads-within-case-deadlines-final-qualification-envelope-within180000ms-cohort';
export const ROUTED_AUTHOR_PROOF_ENVELOPE_SCOPE='durable-row-payloads-within-row-deadlines-final-qualification-envelope-within2520000ms-cohort';
export const ROUTED_PHASE_COMPONENT_KEYS=Object.freeze(['verification','pause','routing','startup','inference','cleanup','restore','postchecks','persistence']);
export const ROUTED_CALIBRATION_TERMINAL_KEYS=Object.freeze(['schema_version','checked','scope_id','case_clocks','after_publication_cohort_ms','profile_sha256','report_sha256','freeze_sha256','plan_sha256','head_sha256','source_seal_sha256','protocol_sha256','exit_code']);
export const ROUTED_AUTHOR_TERMINAL_KEYS=Object.freeze(['schema_version','checked','scope_id','after_publication_whole_ms','report_sha256','freeze_sha256','plan_sha256','head_sha256','source_seal_sha256','cohort_sha256','protocol_sha256','exit_code']);
export const ROUTED_FOCUS_PREREGISTRATION_KEYS=Object.freeze(['schema_version','root_approved','scope','created_at','physical_identity','production_closure_sha256','protocol','protocol_sha256','calibration_proof_bindings','configuration','fixture_sha256','author_receipt','denominator','minimum_correct','per_class_correct','per_class_denominator','attempts_per_case','no_resume','all_operational_gates']);
export const ROUTED_FOCUS_EXECUTION_BINDING_KEYS=Object.freeze(['schema_version','root_approved','scope','prepared_freeze_sha256','focus_preregistration_sha256','source_inventory_sha256','physical_identity','protocol_sha256','cohort_sha256']);
export const ROUTED_SOURCE_APPROVAL_KEYS=Object.freeze(['schema_version','root_approved','scope','created_at','production_closure_sha256','protocol_sha256','physical_identity','configuration']);
export const routedProofRef=value=>exactKeys(value,['path','sha256'])&&typeof value.path==='string'&&value.path.length>0&&isHash(value.sha256);
export const routedProofHashes=value=>Object.fromEntries(Object.entries(value).map(([key,ref])=>{requireProof(routedProofRef(ref),'routed_proof_ref_required');return[key,ref.sha256];}));
export function routedPlanAttemptPath(preregistrationSha){requireProof(isHash(preregistrationSha),'routed_plan_preregistration_sha_required');return'runtime/models/routed-v8/plan-attempt-'+preregistrationSha+'.json';}
export const routedPhysicalIdentity=()=>({plan_sha256:ROUTED_PINS.plan_sha256,plan_bytes:ROUTED_PINS.plan_bytes,head_sha256:ROUTED_PINS.head_sha256,head_bytes:ROUTED_PINS.head_bytes,encoder_manifest_sha256:ROUTED_PINS.encoder_manifest_sha256,worker_sha256:ROUTED_PINS.worker_sha256,windows_closure_sha256:ROUTED_PINS.windows_closure_sha256});
export function routedConfiguration(nativeBudgetMs=55600){requireProof(Number.isInteger(nativeBudgetMs)&&nativeBudgetMs>=1&&nativeBudgetMs<=55600,'routed_native_budget_invalid');return{schema_version:ROUTED_SCHEMAS.configuration,context_tokens:1024,max_tokens:192,threads:2,batch:64,ubatch:32,gpu_layers:0,thinking:false,temperature:0,seed:42,mmap:true,no_repack:true,offline:true,preparation_budget_ms:4400,native_budget_ms:nativeBudgetMs,total_budget_ms:4400+nativeBudgetMs,reserve_bytes:268435456,encoder:{dimensions:384,repo:'Xenova/multilingual-e5-small',revision:ROUTED_PINS.encoder_revision,dtype:'q8',pooling:'mean',normalize:true,max_length:256,threads:2,inter_threads:1,execution_mode:'sequential',enable_cpu_mem_arena:false},cleanup_reserve_ms:1500};}
export const routedAuthorConfiguration=(nativeBudgetMs=55600)=>({...routedConfiguration(nativeBudgetMs),call_deadline_ms:nativeBudgetMs,startup_deadline_ms:nativeBudgetMs,cleanup_deadline_ms:nativeBudgetMs,cohort_deadline_ms:2520000});
export function routedPreflightEstimate({profile=null,freeBytes}){const base=ROUTED_LIMITS.header_kv_bytes+ROUTED_LIMITS.scratch_bytes,measured=profile!==null,committed=measured?Math.max(base,profile.observed_memory?.peak_private_bytes||0,profile.encoder_peak_rpc_rss_bytes||0):Math.max(ROUTED_PINS.plan_bytes+base,118308185+ROUTED_LIMITS.scratch_bytes),required=committed+ROUTED_LIMITS.reserve_bytes;return{ok:Number.isFinite(freeBytes)&&freeBytes>=required,mode:measured?'measured_routed_v8_own_profile':'explicit_routed_v8_unmeasured_cold_mmap_trial',old_profile_inherited:false,required_free_bytes:required,free_bytes:freeBytes,reserve_bytes:ROUTED_LIMITS.reserve_bytes,header_kv_bytes:ROUTED_LIMITS.header_kv_bytes,scratch_commit_estimate_bytes:ROUTED_LIMITS.scratch_bytes,plan_sha256:ROUTED_PINS.plan_sha256,head_sha256:ROUTED_PINS.head_sha256};}
export function routedPlanBody(context){return{model:ROUTED_MODEL_ID,messages:buildPlanMessages(context),max_tokens:192,temperature:0,seed:42,stream:false,response_format:{type:'json_schema',json_schema:{name:'support_plan',strict:true,schema:buildPlanSchema(context)}},chat_template_kwargs:{enable_thinking:false},reasoning_effort:'none'};}
/** No examples/metadata/admin messages become classifier features. The encoder
 * session receives playerText and adds query prefix exactly ONCE itself. */
export function routedPlayerText(raw){const input=sanitizeInput(raw);return input.messages.filter(m=>m.role==='player').map(m=>m.text).join('\n');}
export const routedQueryText=raw=>('query: '+routedPlayerText(raw)).slice(0,12000);
export function routedContext(input,basis,sources,focus){requireProof(FOCUS_CODES.includes(focus),'routed_closed_focus');return buildGenerationInput(input,basis,sources,{proposedFocus:focus,focusOrigin:'learned_e5_router'});}
export function routedCalibrationDiagnostic(){return{input:{kind:'report',lang:'en',messages:[{role:'player',text:'Hello!'}]},basis:{lang:'en',category:'report.question',needs_human:false,citations:[]},configuration:routedConfiguration()};}
export function routedModelMetadata(){return{id:ROUTED_MODEL_ID,quantization:'Q4_K_M',sha256:ROUTED_PINS.plan_sha256,provenance:'recovered_actual_20step_authored_plan_finetune',project_finetuned:true,optimizer_steps:20,joint100_checkpoint:false,lost100_restored:false,router:{kind:'learned_E5_linear_head',sha256:ROUTED_PINS.head_sha256,encoder_finetuned:false,probabilities_calibrated:false}};}

/** One path/namespace policy for producers, benchmark and operator consumer.
 * The exact64hex pointer is checked BEFORE any filesystem access. */
export async function readRoutedProof({rootDir=APP_ROOT,kind,ref,signal,maxBytes=16*1024**2,preregistrationSha}){
 requireProof(routedProofRef(ref),'routed_exact_proof_ref_required');
 const fixed=['focus_preregistration','focus_execution_binding','plan_preregistration','author_receipt'].includes(kind),namespace=fixed?'runtime':kind==='author_fixture'?'fixtures':kind==='calibration' ? ROUTED_PATHS.calibration:kind==='author'?ROUTED_PATHS.author:'runtime/models';
 requireProof(fixed||['author_fixture','calibration','author','profile','production','runtime_closure','plan_attempt'].includes(kind),'routed_proof_kind');
 if(kind==='plan_attempt')requireProof(resolve(rootDir,ref.path)===resolve(rootDir,routedPlanAttemptPath(preregistrationSha)),'routed_fixed_plan_attempt_path');
 if(fixed||kind==='author_fixture')requireProof(resolve(rootDir,ref.path)===resolve(rootDir,ROUTED_PATHS[kind]),'routed_fixed_'+kind+'_path');
 return readTrustedJson({rootDir,path:ref.path,namespace,expectedSha256:ref.sha256,maxBytes,signal});
}
export function validateRoutedFocusExecutionBinding(value,{freezeSha,focusPreregSha,production,cohortSha}){
 requireProof(exactKeys(value,ROUTED_FOCUS_EXECUTION_BINDING_KEYS)&&value.schema_version===ROUTED_SCHEMAS.focus_execution_binding&&value.root_approved===true&&value.scope===ROUTED_SCHEMAS.author_scope&&value.prepared_freeze_sha256===freezeSha&&value.focus_preregistration_sha256===focusPreregSha&&value.source_inventory_sha256===production.sha256&&equal(value.physical_identity,routedPhysicalIdentity())&&value.protocol_sha256===ROUTED_PROTOCOL_SHA256&&value.cohort_sha256===cohortSha,'routed_root_focus_execution_binding');return{execution_approved:true};
}
export function validateRoutedSourceApproval(value,{scope,production,configuration}){const schema=scope===ROUTED_SCHEMAS.calibration_scope?ROUTED_SCHEMAS.calibration_approval:scope===ROUTED_SCHEMAS.author_scope?ROUTED_SCHEMAS.author_approval:null;requireProof(schema&&exactKeys(value,ROUTED_SOURCE_APPROVAL_KEYS)&&value.schema_version===schema&&value.root_approved===true&&value.scope===scope&&Number.isFinite(Date.parse(value.created_at))&&value.production_closure_sha256===production.sha256&&value.protocol_sha256===ROUTED_PROTOCOL_SHA256&&equal(value.physical_identity,routedPhysicalIdentity())&&equal(value.configuration,configuration),'routed_current_root_source_approval');return{approved:true};}
