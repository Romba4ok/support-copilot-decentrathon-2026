import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildGenerationInput, buildFocusSchema, buildPlanSchema, validateFocus, validatePlan, renderPlan, FOCUS_CODES } from './generation-contract.mjs';
import { PRETRAINED_PINS as P, pretrainedModelMetadata, canonicalCorpusHash, validateImport, ownedExit, coherentCall } from './pretrained-activation.mjs';
import { summarizePlanRows, validateAuthoredPlanControl } from './generation-evaluation.mjs';
import { coherentTwoPhaseExecution } from './activation.mjs';
import { APP_ROOT, hash, canonicalHash, equal, exactKeys, isHash, requireProof, readTrustedJson, verifyRegularFile } from './production-closure.mjs';
import { collectFewshotProductionClosure, validateFewshotProductionClosure } from './fewshot-production-closure.mjs';
import { createPretrainedPhysicalReader, loadVerifiedFewshotCapacity, validateFewshotCapacityEvidence, proofRef } from './pretrained-physical.mjs';
import { FEWSHOT_SCHEMAS as S, FEWSHOT_PROTOCOL as PROTOCOL, FEWSHOT_PROTOCOL_SHA256 as PSHA, FEWSHOT_MONITORING, FEWSHOT_CAPACITY_PINS, FEWSHOT_CONTROL_SHA256, FEWSHOT_AUTHOR_RECEIPT_SHA256, FEWSHOT_FINAL_CONTROL_SHA256, FEWSHOT_PATHS, FOCUS_PREREGISTRATION_KEYS, FOCUS_EXECUTION_BINDING_KEYS, CALIBRATION_TERMINAL_KEYS, AUTHOR_TERMINAL_KEYS, PHASE_COMPONENT_KEYS, PROOF_ENVELOPE_SCOPE, fewshotConfiguration, fewshotAuthorConfiguration, fewshotFocusBody, fewshotPlanBody, calibrationDiagnostic } from './fewshot-proof-contract.mjs';
export { loadVerifiedFewshotCapacity, validateFewshotCapacityEvidence, fewshotConfiguration };
export const PRETRAINED_FEWSHOT_SCHEMA = S.activation;
const nn=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const positive=v=>nn(v)&&v>0;
const triple=value=>exactKeys(value,['freeze','report','terminal'])&&Object.values(value).every(proofRef);
const pointerHashes=value=>Object.fromEntries(Object.entries(value).map(([key,ref])=>[key,ref.sha256]));
const capHashes=a=>pointerHashes(a.capacity_preflight);
const calHashes=a=>({profile:a.memory_profile.sha256,...pointerHashes(a.calibration)});
const protocol=value=>equal(value.protocol,PROTOCOL)&&value.protocol_sha256===PSHA;

export function validateFewshotManifest(a,c=fewshotConfiguration()) {
  const keys=['schema_version','family','scope','root_decision','selected_model','import_receipt','runtime_closure','production_closure','corpus_sha256','configuration','bounded_trial','memory_profile','calibration','author_validation','preregistration','independent_quality','project_finetuned','training','joint100_checkpoint','recovered_old20_adapter','focus_protocol','capacity_preflight','focus_execution_preregistration','manual_review'];
  requireProof(exactKeys(a,keys)&&a.schema_version===S.activation&&a.family==='pretrained-fewshot'&&equal(a.focus_protocol,PROTOCOL),'fewshot_manifest_schema_protocol');
  requireProof(equal(c,fewshotConfiguration(c.native_budget_ms))&&equal(a.configuration,c),'fewshot_effective_configuration');
  requireProof(['project_finetuned','training','joint100_checkpoint','recovered_old20_adapter'].every(key=>a[key]===false),'fewshot_is_not_weight_training');
  const validation=a.scope==='private-validation'&&a.root_decision==='approved_for_local_validation',operator=a.scope==='operator-generation'&&a.root_decision==='approved_for_local_operator_generation';
  requireProof(validation||operator,'fewshot_explicit_root_scope');
  requireProof(exactKeys(a.selected_model,['path','bytes','sha256'])&&typeof a.selected_model.path==='string'&&a.selected_model.bytes===P.modelBytes&&a.selected_model.sha256===P.modelSha,'fewshot_same_selected_model');
  requireProof(['import_receipt','runtime_closure','production_closure'].every(key=>proofRef(a[key]))&&a.runtime_closure.sha256===P.windowsClosureSha&&isHash(a.corpus_sha256),'fewshot_physical_corpus_refs');
  requireProof(exactKeys(a.capacity_preflight,['freeze','report','terminal','root_approval'])&&Object.keys(a.capacity_preflight).every(key=>proofRef(a.capacity_preflight[key])&&a.capacity_preflight[key].sha256===FEWSHOT_CAPACITY_PINS[key].sha256),'fewshot_actual_capacity_refs');
  requireProof(typeof a.bounded_trial==='boolean'&&(a.memory_profile===null||proofRef(a.memory_profile))&&(a.calibration===null||triple(a.calibration))&&(a.memory_profile===null)===(a.calibration===null),'fewshot_profile_calibration_pair');
  requireProof((a.author_validation===null||triple(a.author_validation))&&(a.focus_execution_preregistration===null||proofRef(a.focus_execution_preregistration))&&(a.preregistration===null||proofRef(a.preregistration))&&(a.independent_quality===null||proofRef(a.independent_quality))&&(a.manual_review===null||proofRef(a.manual_review)),'fewshot_quality_refs');
  if(validation)requireProof((a.memory_profile!==null||a.bounded_trial===true)&&a.independent_quality===null&&a.manual_review===null,'fewshot_private_is_not_operator');
  if(a.focus_execution_preregistration!==null)requireProof(a.memory_profile!==null,'fewshot_focus_prereg_requires_profile');
  if(a.author_validation!==null)requireProof(a.memory_profile!==null&&proofRef(a.focus_execution_preregistration),'fewshot_author_requires_measured_prereg');
  if(operator)requireProof(a.bounded_trial===false&&proofRef(a.memory_profile)&&triple(a.calibration)&&triple(a.author_validation)&&proofRef(a.focus_execution_preregistration)&&proofRef(a.preregistration)&&proofRef(a.independent_quality)&&proofRef(a.manual_review),'fewshot_operator_requires_all_new_gates');
  return {validationOnly:validation};
}

function setup(report) {
  return report.attempted_once===true&&report.lock_claimed===true&&report.owned_setup_released===true&&equal(report.monitoring,FEWSHOT_MONITORING);
}
function phases(value,c) {
  requireProof(protocol(value)&&value.scope_id===S.calibration_scope&&value.phase_scope==='verification-admission-start-inference-abort-actual-exit-postchecks-persistence'&&value.native_phase_started_before_verification===true&&value.terminal_publication_required===true&&value.proof_envelope_scope===PROOF_ENVELOPE_SCOPE,'fewshot_calibration_phase_scope');
  requireProof(nn(value.semantic_body_ms)&&value.semantic_body_ms<=c.preparation_budget_ms&&positive(value.native_phase_elapsed_ms)&&value.native_phase_elapsed_ms<=c.native_budget_ms&&positive(value.whole_entry_elapsed_ms)&&value.whole_entry_elapsed_ms<=c.total_budget_ms&&value.whole_entry_elapsed_ms>=value.semantic_body_ms+value.native_phase_elapsed_ms&&value.preparation_elapsed_ms===value.semantic_body_ms&&value.elapsed_ms===value.native_phase_elapsed_ms&&value.total_elapsed_ms===value.whole_entry_elapsed_ms,'fewshot_calibration_raw_budget');
  requireProof(exactKeys(value.phase_components_ms,PHASE_COMPONENT_KEYS)&&Object.values(value.phase_components_ms).every(nn)&&Object.values(value.phase_components_ms).reduce((sum,n)=>sum+n,0)<=value.native_phase_elapsed_ms,'fewshot_calibration_component_sum');
}
export function validateFewshotCalibrationProducer({profile,freeze,report,terminal,capacity,hashes,imported,production,configuration:c=fewshotConfiguration()}) {
  validateImport(imported);
  requireProof(exactKeys(hashes,['profile','freeze','report'])&&Object.values(hashes).every(isHash),'fewshot_calibration_known_publication_hashes');
  requireProof(profile?.schema_version===S.calibration_profile&&freeze?.schema_version===S.calibration_freeze&&report?.schema_version===S.calibration_report&&profile.actual_native===true&&profile.model_sha256===P.modelSha&&profile.Linux_derivation_closure_sha256===P.linuxClosureSha&&profile.Windows_runtime_closure_sha256===P.windowsClosureSha&&profile.context_tokens===1024&&profile.header_kv_bytes===P.kvBytes&&profile.mmap===true&&profile.no_repack===true&&profile.quality_verified===false&&profile.activated===false,'fewshot_own_new_profile_required');
  phases(profile,c);phases(report,c);
  const cap=pointerHashes(capacity.pointers);
  requireProof(equal(profile.capacity_proof_bindings,cap)&&equal(freeze.capacity_proof_bindings,cap)&&equal(report.capacity_proof_bindings,cap)&&protocol(freeze),'fewshot_calibration_capacity_protocol_binding');
  requireProof(['semantic_body_ms','native_phase_elapsed_ms','whole_entry_elapsed_ms','phase_components_ms'].every(key=>equal(profile[key],report[key]))&&equal(profile.configuration,c)&&equal(freeze.configuration,c)&&equal(report.configuration,c),'fewshot_calibration_configuration_phase_binding');
  requireProof(profile.import_receipt_sha256===hash(JSON.stringify(imported))&&profile.trial_freeze_sha256===hashes.freeze&&profile.trial_report_sha256===hashes.report&&profile.source_seal_sha256===production.sha256&&equal(profile.source_seal,production)&&equal(freeze.source_seal,production),'fewshot_calibration_profile_source_trace');
  const sourceHashes=Object.fromEntries(production.records.map(row=>[row.path,row.sha256]));
  requireProof(equal(freeze.source_hashes,sourceHashes)&&equal(report.source_hashes,sourceHashes)&&report.production_source10_sha256===production.production_source10_sha256&&report.freeze_sha256===hashes.freeze&&report.import_receipt_sha256===profile.import_receipt_sha256&&freeze.import_receipt_sha256===profile.import_receipt_sha256&&equal(freeze.selected,Object.fromEntries(['model','header','kv_f16_bytes_at1024','derivation','windows_runtime'].map(key=>[key,imported[key]]))),'fewshot_calibration_full_source_import');
  requireProof(report.status==='calibration_completed_not_quality'&&report.failure===null&&report.post_integrity_verified===true&&report.selected_model_sha256===P.modelSha&&setup(report)&&ownedExit(report)&&equal(profile.observed_memory,report.runtime_usage.observed_memory)&&profile.minimum_free_bytes===report.minimum_free_bytes,'fewshot_calibration_actual_exit_setup');
  const pf=report.preflight,required=P.kvBytes+P.scratchBytes+P.reserveBytes;
  requireProof(pf?.mode==='explicit_fewshot17_unmeasured_mmap_commit_estimate_trial'&&pf.header_kv_bytes===P.kvBytes&&pf.scratch_commit_estimate_bytes===P.scratchBytes&&pf.reserve_bytes===P.reserveBytes&&pf.required_free_bytes===required&&pf.old_profile_inherited===false&&nn(pf.free_bytes)&&pf.free_bytes>=required,'fewshot_calibration_own_admission');
  const diagnostic=calibrationDiagnostic(c.native_budget_ms);
  requireProof(equal(freeze.input,diagnostic.input)&&equal(freeze.context,diagnostic.context)&&JSON.stringify(freeze.bodies)===JSON.stringify(diagnostic.bodies)&&Array.isArray(report.calls)&&report.calls.length===2,'fewshot_calibration_exact_body_factory');
  for(const [index,phase,max]of [[0,'focus',32],[1,'conditional_plan',192]]){const call=report.calls[index],body=diagnostic.bodies[phase];requireProof(call.phase===phase&&call.max_tokens===max&&coherentCall(call,max,c.native_budget_ms)&&call.tokenizer_parity===true&&call.request_sha256===hash(JSON.stringify(body)),'fewshot_calibration_actual_calls');}
  requireProof(validateFocus(report.calls[0].raw).ok&&validatePlan(report.calls[1].raw,diagnostic.context).ok&&report.forced_timeout?.request_started===true&&report.forced_timeout.triggered===true&&report.forced_timeout.outcome==='AbortError'&&nn(report.forced_timeout.elapsed_ms)&&report.forced_timeout.elapsed_ms>=25&&report.forced_timeout.elapsed_ms<=c.native_budget_ms,'fewshot_calibration_closed_trace_timeout');
  requireProof(report.phase_components_ms.inference>=report.calls.reduce((sum,call)=>sum+call.elapsed_ms,0)+report.forced_timeout.elapsed_ms,'fewshot_calibration_raw_inference_sum');
  requireProof(exactKeys(terminal,CALIBRATION_TERMINAL_KEYS)&&terminal.schema_version===S.calibration_terminal&&terminal.checked===true&&terminal.scope_id===S.calibration_scope&&terminal.exit_code===0&&terminal.profile_sha256===hashes.profile&&terminal.freeze_sha256===hashes.freeze&&terminal.report_sha256===hashes.report&&terminal.model_sha256===P.modelSha&&terminal.source_seal_sha256===production.sha256&&terminal.protocol_sha256===PSHA&&terminal.bank_sha256===PROTOCOL.bank_sha256&&nn(terminal.after_publication_native_ms)&&terminal.after_publication_native_ms>=report.native_phase_elapsed_ms&&terminal.after_publication_native_ms<=c.native_budget_ms&&nn(terminal.after_publication_whole_ms)&&terminal.after_publication_whole_ms>=report.whole_entry_elapsed_ms&&terminal.after_publication_whole_ms>=report.semantic_body_ms+terminal.after_publication_native_ms&&terminal.after_publication_whole_ms<=c.total_budget_ms,'fewshot_calibration_actual_terminal');
  return {calibration_consistent:true,actual_local_files_verified:false};
}
export function validateFewshotCalibrationEvidence({profile,evidence,manifest,imported,production,configuration}) {
  return validateFewshotCalibrationProducer({profile,...evidence,hashes:{profile:manifest.memory_profile.sha256,freeze:manifest.calibration.freeze.sha256,report:manifest.calibration.report.sha256},imported,production,configuration});
}

export function validateFewshotFocusPreregistration(prereg,{manifest:a,production,configuration:c=fewshotConfiguration()}) {
  requireProof(exactKeys(prereg,FOCUS_PREREGISTRATION_KEYS)&&prereg.schema_version===S.focus_preregistration&&prereg.root_approved===true&&prereg.scope===S.author_scope&&Number.isFinite(Date.parse(prereg.created_at)),'fewshot_focus_root_preregistration_required');
  requireProof(prereg.model_sha256===P.modelSha&&prereg.windows_runtime_closure_sha256===P.windowsClosureSha&&prereg.production_closure_sha256===production.sha256&&protocol(prereg)&&prereg.bank_sha256===PROTOCOL.bank_sha256&&equal(prereg.configuration,c)&&equal(prereg.capacity_proof_bindings,capHashes(a))&&equal(prereg.calibration_proof_bindings,calHashes(a))&&prereg.fixture_sha256===FEWSHOT_CONTROL_SHA256&&proofRef(prereg.author_receipt)&&prereg.author_receipt.sha256===FEWSHOT_AUTHOR_RECEIPT_SHA256,'fewshot_focus_preregistered_identity');
  requireProof(prereg.denominator===42&&prereg.minimum_correct===38&&prereg.per_class_correct===4&&prereg.per_class_denominator===6&&prereg.attempts_per_case===1&&prereg.no_resume===true&&prereg.all_operational_gates===true,'fewshot_focus_fixed_gate');
  return {preregistered:true};
}

/** Shape only. It confers no authority: the FS loader separately enforces the
 * exact sealed fixture hash AFTER its root preregistration has been verified. */
export function parseFewshotAuthorFixture(value) {
  requireProof(exactKeys(value,['schema_version','provenance','scope','cases'])&&value.schema_version==='independent-authored-focus-control-v7'&&typeof value.scope==='string'&&exactKeys(value.provenance,['type','human_reviewed','contains_private_data','author'])&&value.provenance.type==='authored_synthetic'&&value.provenance.human_reviewed===false&&value.provenance.contains_private_data===false&&value.provenance.author==='independent-focus-v7'&&Array.isArray(value.cases)&&value.cases.length===42,'fewshot_new_fixture_shape');
  const langs=['ru','en','kk','uz','es','pt'];
  const rows=value.cases.map(row=>{
    requireProof(exactKeys(row,['id','group_id','lang','expected_focus','input','provenance'])&&typeof row.id==='string'&&row.id.length>0&&typeof row.group_id==='string'&&row.group_id.length>0&&langs.includes(row.lang)&&FOCUS_CODES.includes(row.expected_focus)&&exactKeys(row.input,['kind','lang','messages'])&&['report','complaint'].includes(row.input.kind)&&row.input.lang===row.lang&&Array.isArray(row.input.messages)&&row.input.messages.length===1&&exactKeys(row.input.messages[0],['role','text'])&&row.input.messages[0].role==='player'&&typeof row.input.messages[0].text==='string'&&row.input.messages[0].text.trim().length>0&&row.input.messages[0].text.length<=20000&&exactKeys(row.provenance,['type','human_reviewed','contains_private_data'])&&row.provenance.type==='authored_synthetic'&&row.provenance.human_reviewed===false&&row.provenance.contains_private_data===false,'fewshot_new_fixture_row_shape');
    return {id:row.id,group_id:row.group_id,input:structuredClone(row.input),expected_focus:row.expected_focus,provenance:structuredClone(row.provenance)};
  });
  requireProof(new Set(rows.map(row=>row.id)).size===42&&new Set(rows.map(row=>row.group_id)).size===42&&FOCUS_CODES.every(focus=>langs.every(lang=>rows.filter(row=>row.expected_focus===focus&&row.input.lang===lang).length===1)),'fewshot_new_fixture_exact_crossproduct');
  return rows;
}
export async function loadTrustedFewshotAuthorRows({rootDir=APP_ROOT,signal,preregistrationRef,manifest,production,configuration}={}) {
  requireProof(proofRef(preregistrationRef)&&resolve(rootDir,preregistrationRef.path)===resolve(rootDir,'runtime/fewshot-v7-focus-preregistration.json'),'fewshot_fixed_focus_preregistration_path');
  const prereg=(await readTrustedJson({rootDir,path:preregistrationRef.path,namespace:'runtime',expectedSha256:preregistrationRef.sha256,maxBytes:1024**2,signal})).value;
  validateFewshotFocusPreregistration(prereg,{manifest,production,configuration});
  requireProof(resolve(rootDir,prereg.author_receipt.path)===resolve(rootDir,'runtime/independent-focus-v7-author/author-receipt.json'),'fewshot_original_author_receipt_path');
  const receipt=await readTrustedJson({rootDir,path:prereg.author_receipt.path,namespace:'runtime/independent-focus-v7-author',expectedSha256:FEWSHOT_AUTHOR_RECEIPT_SHA256,maxBytes:1024**2,signal});
  requireProof(receipt.value.schema_version==='independent-focus-v7-author-receipt'&&receipt.value.fixture_sha256===FEWSHOT_CONTROL_SHA256,'fewshot_original_clean_author_provenance');
  // This is the first possible fixture read. It is never a module-level read.
  const file=await verifyRegularFile({rootDir,path:FEWSHOT_PATHS.author_fixture,namespace:'fixtures',expectedSha256:FEWSHOT_CONTROL_SHA256,maxBytes:512*1024,signal});
  const rows=parseFewshotAuthorFixture(JSON.parse(await readFile(file.path,{encoding:'utf8',signal})));
  return {rows,fixture_sha256:FEWSHOT_CONTROL_SHA256,preregistration:prereg,preregistration_sha256:preregistrationRef.sha256,file};
}

export function validateFewshotAuthorEvidence({evidence,manifest:a,imported,production,configuration:c=fewshotConfiguration(),trustedAuthorRows,focusPreregistration,executionBinding}) {
  const {freeze:f,report:r,terminal:t}=evidence;
  validateFewshotFocusPreregistration(focusPreregistration,{manifest:a,production,configuration:c});
  requireProof(f.schema_version===S.author_freeze&&r.schema_version===S.author_report&&r.scope_id===S.author_scope&&protocol(f)&&protocol(r)&&f.no_retry===true&&f.no_retuning===true&&f.no_activation===true&&equal(f.thresholds,{correct:38,denominator:42,per_class_correct:4,per_class_denominator:6}),'fewshot_author_new_schema_fixed_gates');
  requireProof(Array.isArray(trustedAuthorRows)&&trustedAuthorRows.length===42&&Array.isArray(f.rows)&&f.rows.length===42&&new Set(f.rows.map(row=>row.id)).size===42&&new Set(f.rows.map(row=>row.group_id)).size===42&&f.cohort_sha256===canonicalHash(f.rows),'fewshot_author_exact_new42_authority_required');
  const trusted=new Map(trustedAuthorRows.map(row=>[row.id,row]));
  requireProof(trusted.size===42&&f.rows.every(row=>trusted.has(row.id)&&['id','group_id','input','expected_focus','provenance'].every(key=>equal(row[key],trusted.get(row.id)[key]))),'fewshot_author_id_input_target_changed');
  validateFewshotFocusExecutionBinding(executionBinding,{freezeSha:a.author_validation.freeze.sha256,focusPreregSha:a.focus_execution_preregistration.sha256,production,cohortSha:f.cohort_sha256});
  requireProof(proofRef(r.execution_binding),'fewshot_author_root_binding_pointer');
  requireProof(f.model_sha256===P.modelSha&&equal(f.import_receipt,imported)&&equal(f.source,production)&&f.profile?.schema_version===S.calibration_profile&&protocol(f.profile)&&f.profile.model_sha256===P.modelSha&&f.fixture_sha256===FEWSHOT_CONTROL_SHA256&&f.focus_preregistration_sha256===a.focus_execution_preregistration.sha256&&equal(f.capacity_proof_bindings,capHashes(a)),'fewshot_author_model_source_prereg');
  const b=r.proof_bindings;
  requireProof(b?.source_inventory_sha256===production.sha256&&b.import_receipt_sha256===hash(JSON.stringify(imported))&&b.model_sha256===P.modelSha&&b.Linux_closure===P.linuxClosureSha&&b.Windows_closure===P.windowsClosureSha&&b.cohort_sha256===f.cohort_sha256&&b.protocol_sha256===PSHA&&b.bank_sha256===PROTOCOL.bank_sha256&&b.fixture_sha256===FEWSHOT_CONTROL_SHA256&&b.focus_preregistration_sha256===a.focus_execution_preregistration.sha256&&equal(b.capacity_proof_bindings,capHashes(a))&&equal(b.calibration_proof_bindings,calHashes(a)),'fewshot_author_proof_bindings');
  requireProof(r.status==='completed_independent_focus_not_plan_quality'&&r.failure===null&&r.post_run_integrity_verified===true&&r.freeze_sha256===a.author_validation.freeze.sha256&&r.selected_model_sha256===P.modelSha&&setup(r)&&ownedExit(r)&&r.terminal_publication_required===true&&r.proof_envelope_scope===PROOF_ENVELOPE_SCOPE&&Array.isArray(r.results)&&r.results.length===42&&equal(f.configuration,fewshotAuthorConfiguration(c.native_budget_ms))&&equal(r.configuration,f.configuration),'fewshot_author_actual_execution_config');
  requireProof(['startup_ms','cleanup_ms','total_elapsed_ms','preflight_elapsed_ms','post_integrity_ms','report_persistence_ms','total_with_prepost_ms'].every(key=>nn(r[key]))&&r.startup_ms<=c.native_budget_ms&&r.cleanup_ms<=c.native_budget_ms&&r.total_elapsed_ms>=r.startup_ms+r.results.reduce((sum,row)=>sum+row.elapsed_ms,0)+r.cleanup_ms&&r.total_with_prepost_ms>=r.preflight_elapsed_ms+r.total_elapsed_ms+r.post_integrity_ms+r.report_persistence_ms&&r.total_with_prepost_ms<=2520000,'fewshot_author_raw_phase_budget');
  const classes=Object.fromEntries(FOCUS_CODES.map(code=>[code,{total:0,correct:0}]));let correct=0;
  for(let i=0;i<42;i++){
    const expected=f.rows[i],call=r.results[i],body=fewshotFocusBody(expected.input);
    requireProof(call.id===expected.id&&call.group_id===expected.group_id&&call.lang===expected.input.lang&&call.expected_focus===expected.expected_focus&&equal(call.provenance,expected.provenance)&&call.status==='completed'&&call.attempt===1&&call.tokenizer_parity===true&&coherentCall(call,32,c.native_budget_ms)&&JSON.stringify(expected.body)===JSON.stringify(body)&&JSON.stringify(call.request_body)===JSON.stringify(body)&&call.request_sha256===hash(JSON.stringify(body)),'fewshot_author_exact_body_raw_call');
    const focus=validateFocus(call.raw);requireProof(focus.ok,'fewshot_author_focus_schema');classes[expected.expected_focus].total++;if(focus.value.focus===expected.expected_focus){correct++;classes[expected.expected_focus].correct++;}
  }
  requireProof(correct>=38&&Object.values(classes).every(row=>row.total===6&&row.correct>=4),'fewshot_author38_each4_failed');
  requireProof(exactKeys(t,AUTHOR_TERMINAL_KEYS)&&t.schema_version===S.author_terminal&&t.checked===true&&t.scope_id===S.author_scope&&t.exit_code===0&&t.report_sha256===a.author_validation.report.sha256&&t.freeze_sha256===a.author_validation.freeze.sha256&&t.model_sha256===P.modelSha&&t.source_seal_sha256===production.sha256&&t.cohort_sha256===f.cohort_sha256&&t.protocol_sha256===PSHA&&t.bank_sha256===PROTOCOL.bank_sha256&&nn(t.after_publication_whole_ms)&&t.after_publication_whole_ms>=r.total_with_prepost_ms&&t.after_publication_whole_ms<=2520000,'fewshot_author_root_terminal');
  return {correct,denominator:42,classes,actual_local_files_verified:false};
}
export function validateFewshotFocusExecutionBinding(binding,{freezeSha,focusPreregSha,production,cohortSha}) {
  requireProof(exactKeys(binding,FOCUS_EXECUTION_BINDING_KEYS)&&binding.schema_version==='fewshot-focus-execution-binding-v1'&&binding.root_approved===true&&binding.scope===S.author_scope&&binding.prepared_freeze_sha256===freezeSha&&binding.focus_preregistration_sha256===focusPreregSha&&binding.source_inventory_sha256===production.sha256&&binding.model_sha256===P.modelSha&&binding.protocol_sha256===PSHA&&binding.bank_sha256===PROTOCOL.bank_sha256&&binding.cohort_sha256===cohortSha,'fewshot_author_root_prepared_execution_binding');
  return {execution_approved:true};
}
export function validateFewshotAuthorProducer({freeze,report,terminal,hashes,manifest,imported,production,configuration,trustedRows,focusPreregistration,executionBinding}) {
  requireProof(exactKeys(hashes,['freeze','report'])&&Object.values(hashes).every(isHash),'fewshot_author_known_publication_hashes');
  return validateFewshotAuthorEvidence({evidence:{freeze,report,terminal},manifest:{...manifest,author_validation:{freeze:{sha256:hashes.freeze},report:{sha256:hashes.report}}},imported,production,configuration,trustedAuthorRows:trustedRows,focusPreregistration,executionBinding});
}

export function validateFewshotPreregistration(prereg,{manifest:a,production,configuration:c,evaluatorSha256,benchmarkSha256}) {
  const keys=['schema_version','root_approved','scope','created_at','model_sha256','windows_runtime_closure_sha256','production_closure_sha256','corpus_sha256','configuration','protocol','protocol_sha256','bank_sha256','capacity_proof_bindings','calibration_proof_bindings','focus_report_sha256','focus_terminal_sha256','focus_preregistration_sha256','fixture_sha256','evaluator_sha256','benchmark_sha256','denominator','minimum_contextual','maximum_safety_violations','control_kind','manual_all24_required'];
  requireProof(exactKeys(prereg,keys)&&prereg.schema_version===S.plan_preregistration&&prereg.root_approved===true&&prereg.scope==='fresh-independent-plan-v6'&&Number.isFinite(Date.parse(prereg.created_at)),'fewshot_new_plan_root_preregistration');
  requireProof(prereg.model_sha256===P.modelSha&&prereg.windows_runtime_closure_sha256===P.windowsClosureSha&&prereg.production_closure_sha256===production.sha256&&prereg.corpus_sha256===a.corpus_sha256&&equal(prereg.configuration,c)&&protocol(prereg)&&prereg.bank_sha256===PROTOCOL.bank_sha256&&equal(prereg.capacity_proof_bindings,capHashes(a))&&equal(prereg.calibration_proof_bindings,calHashes(a))&&prereg.focus_report_sha256===a.author_validation.report.sha256&&prereg.focus_terminal_sha256===a.author_validation.terminal.sha256&&prereg.focus_preregistration_sha256===a.focus_execution_preregistration.sha256&&prereg.fixture_sha256===FEWSHOT_FINAL_CONTROL_SHA256&&prereg.evaluator_sha256===evaluatorSha256&&prereg.benchmark_sha256===benchmarkSha256,'fewshot_plan_preregistered_identities');
  requireProof(prereg.denominator===24&&prereg.minimum_contextual===22&&prereg.maximum_safety_violations===0&&prereg.control_kind==='fresh-independent'&&prereg.manual_all24_required===true,'fewshot_plan_fixed_gate');
}

export function validateFewshotIndependentQualification(quality,prereg,{manifest:a,production,configuration:c,evaluatorSha256,benchmarkSha256,canonicalSources}) {
  requireProof(quality?.benchmark_schema_version===5&&quality.control_kind==='fresh-independent'&&quality.human_reviewed===false&&quality.activation_family==='pretrained-fewshot'&&quality.model?.sha256===P.modelSha&&quality.model.project_finetuned===false&&protocol(quality)&&quality.production_closure_sha256===production.sha256&&quality.candidate_sha256===production.sha256,'fewshot_new_independent_quality');
  const hashes=Object.fromEntries(production.records.map(row=>[row.path,row.sha256]));
  requireProof(equal(quality.file_hashes,hashes)&&equal(quality.full_file_hashes,hashes)&&quality.corpus_sha256===canonicalCorpusHash(canonicalSources)&&quality.corpus_sha256===a.corpus_sha256&&quality.evaluator_sha256===evaluatorSha256&&quality.benchmark_sha256===benchmarkSha256&&equal(quality.production_configuration,c)&&quality.fixture_sha256===FEWSHOT_FINAL_CONTROL_SHA256&&quality.preregistration_sha256===a.preregistration.sha256&&Date.parse(quality.created_at)>=Date.parse(prereg.created_at)&&!quality.error&&Array.isArray(quality.cases)&&quality.cases.length===24&&new Set(quality.cases.map(row=>row.id)).size===24,'fewshot_quality_source_fixture_config');
  for(const row of quality.cases){
    const g=row.generation,m=g?.metrics;
    requireProof(m&&m.model_sha256===P.modelSha&&m.activation_family==='pretrained-fewshot'&&m.focus_protocol_sha256===PSHA&&m.focus_bank_sha256===PROTOCOL.bank_sha256&&m.native_budget_ms===c.native_budget_ms&&m.budget_ms===c.total_budget_ms&&nn(m.preparation_ms)&&m.preparation_ms<=4400&&nn(m.elapsed_ms)&&m.elapsed_ms<=c.native_budget_ms&&nn(m.total_elapsed_ms)&&m.total_elapsed_ms<=c.total_budget_ms&&Math.abs(m.total_elapsed_ms-m.elapsed_ms-m.preparation_ms)<=1&&positive(row.whole_elapsed_ms)&&row.whole_elapsed_ms<=c.total_budget_ms&&row.whole_elapsed_ms+1>=m.total_elapsed_ms,'fewshot_quality_whole_budget');
    requireProof(coherentTwoPhaseExecution(row)&&m.minimum_free_bytes>=P.reserveBytes&&(!m.executed||Number.isInteger(m.owned_pid)&&m.owned_pid>0),'fewshot_quality_raw_usage');
    if(m.owned_pid)requireProof(m.owned_exit_verified===true&&m.runtime_pid_after_close===null&&m.double_close_same_promise===true&&m.guard_held_until_close===true&&m.runtime_usage?.exit?.code===null&&['SIGTERM','SIGKILL'].includes(m.runtime_usage.exit.signal)&&positive(m.runtime_usage.observed_memory?.peak_private_bytes)&&positive(m.runtime_usage.observed_memory?.peak_rss_bytes),'fewshot_quality_actual_cleanup');
    if(m.phases?.focus?.executed){
      const raw=row.raw_model_output?.focus,body=fewshotFocusBody(row.input),requestSha=hash(JSON.stringify(body));
      requireProof(m.phases.focus.request_sha256===requestSha&&m.focus_messages_sha256===hash(JSON.stringify(body.messages)),'fewshot_quality_prepared16_body');
      // A completed/accepted output needs the entire actual raw body. A timed
      // out completion may have no raw output; it stays in the denominator.
      if(raw||g.status==='generated')requireProof(raw?.request_sha256===requestSha&&JSON.stringify(raw.request_body)===JSON.stringify(body),'fewshot_quality_actual16_body');
    }
    if(g.status==='generated'){
      requireProof(row.input&&row.baseline&&Array.isArray(row.canonical_sources),'fewshot_quality_raw_basis_required');
      const canonical=new Map(canonicalSources.map(source=>[source.id,source]));
      requireProof(row.canonical_sources.every(source=>canonical.has(source.id)&&['text','section_id','section','ref','label'].every(key=>source[key]===canonical.get(source.id)[key])),'fewshot_quality_canonical_card_identity');
      const basis=row.raw_model_output?.plan?.context_basis;
      requireProof(basis&&basis.lang===row.baseline.lang&&basis.category===row.baseline.category&&basis.needs_human===row.baseline.needs_human&&equal(basis.citations,row.canonical_sources)&&equal(row.baseline.source_ids,basis.citations.map(source=>source.id))&&typeof row.original_baseline?.needs_human==='boolean'&&(!row.original_baseline.needs_human||basis.needs_human),'fewshot_quality_human_basis');
      const context=buildGenerationInput(row.input,{...row.baseline,citations:row.canonical_sources},canonicalSources,{proposedFocus:g.plan?.focus,focusOrigin:'local_llm'}),raw=row.raw_model_output.plan,body=fewshotPlanBody(context);
      requireProof(!context.unresolved&&validatePlan(g.plan,context).ok&&equal(context.source_applicability,m.source_applicability)&&equal(renderPlan(g.plan,context).source_ids,g.source_ids)&&renderPlan(g.plan,context).text===g.text&&g.needs_human===context.needs_human&&g.lang===context.lang&&JSON.stringify(raw.request_body)===JSON.stringify(body)&&raw.request_sha256===hash(JSON.stringify(body))&&m.phases.plan.request_sha256===raw.request_sha256,'fewshot_quality_current_context_render_plan_body');
    }
  }
  const summary=summarizePlanRows(quality.cases,{controlKind:'fresh-independent'});
  requireProof(summary.total===24&&summary.contextual_useful_cases>=22&&summary.accepted>=22&&summary.global_known_safety_violations===0&&summary.utility.provided_field_reask_violations===0,'fewshot_independent22_zero_safety');return summary;
}

export function validateFewshotDocuments(bundle) {
  const {manifest:a,imported,production,profile,calibration,author,focusPreregistration,preregistration,quality,configuration:c,capacity}=bundle;
  const {validationOnly}=validateFewshotManifest(a,c);validateImport(imported);
  requireProof(a.corpus_sha256===canonicalCorpusHash(bundle.canonicalSources),'fewshot_current_corpus');
  requireProof([[a.memory_profile,profile],[a.calibration,calibration],[a.author_validation,author],[a.focus_execution_preregistration,focusPreregistration],[a.preregistration,preregistration],[a.independent_quality,quality],[a.manual_review,bundle.manualReview]].every(([ref,doc])=>(ref===null)===(doc===null)),'fewshot_referenced_documents_required');
  requireProof(capacity&&equal(capacity.pointers,a.capacity_preflight),'fewshot_capacity_pointer_binding');
  validateFewshotCapacityEvidence({capacity,trainRows:bundle.trustedTrainRows});
  if(profile)validateFewshotCalibrationEvidence({profile,evidence:{...calibration,capacity},manifest:a,imported,production,configuration:c});
  if(focusPreregistration)validateFewshotFocusPreregistration(focusPreregistration,{manifest:a,production,configuration:c});
  if(author){requireProof(equal(author.freeze.profile,profile),'fewshot_author_actual_new_profile');validateFewshotAuthorEvidence({evidence:author,manifest:a,imported,production,configuration:c,trustedAuthorRows:bundle.trustedAuthorRows,focusPreregistration,executionBinding:bundle.executionBinding});}
  if(preregistration)validateFewshotPreregistration(preregistration,bundle);
  if(!validationOnly){
    const fixture=validateAuthoredPlanControl(bundle.independentFixture);requireProof(equal(fixture.cases.map(row=>({id:row.id,input:row.input,expected:row.expected})),quality.cases.map(row=>({id:row.id,input:row.input,expected:row.expected}))),'fewshot_quality_actual_fixture_cases');
    validateFewshotIndependentQualification(quality,preregistration,bundle);
    validateFewshotManualReview(bundle.manualReview,{manifest:a,production,quality});
  }
  return {documents_consistent:true,actual_local_files_verified:false,validationOnly};
}
export function validateFewshotManualReview(review,{manifest:a,production,quality}) {
  requireProof(exactKeys(review,['schema_version','root_approved','human_reviewed','reviewer_type','nonexpert','quality_report_sha256','production_closure_sha256','protocol_sha256','corpus_sha256','cases'])&&review.schema_version==='fewshot-plan-manual-review-v1'&&review.root_approved===true&&review.human_reviewed===false&&review.reviewer_type==='agent'&&review.nonexpert===true&&review.quality_report_sha256===a.independent_quality.sha256&&review.production_closure_sha256===production.sha256&&review.protocol_sha256===PSHA&&review.corpus_sha256===a.corpus_sha256&&Array.isArray(review.cases)&&review.cases.length===24&&new Set(review.cases.map(row=>row.id)).size===24&&equal(review.cases.map(row=>row.id).sort(),quality.cases.map(row=>row.id).sort())&&review.cases.every(row=>exactKeys(row,['id','decision','hard_violations','findings'])&&['acceptable','unavailable','rejected'].includes(row.decision)&&row.hard_violations===0&&typeof row.findings==='string'&&row.findings.trim().length>0&&row.findings.length<=4000),'fewshot_root_agent_nonexpert_all24');
  requireProof(Array.isArray(quality.cases)&&quality.cases.length===24&&new Set(quality.cases.map(row=>row.id)).size===24,'fewshot_manual_fixed24_outcomes');
  const outcomes=new Map(quality.cases.map(row=>[row.id,row]));let acceptable=0;
  for(const decision of review.cases){
    const row=outcomes.get(decision.id),output=row.generation;
    requireProof(output&&['generated','unavailable','timeout','quality-failed'].includes(output.status),'fewshot_manual_known_outcome_required');
    if(output.status==='generated')requireProof(decision.decision!=='unavailable','fewshot_manual_generated_is_not_unavailable');
    else requireProof(output.metrics?.generated===false&&decision.decision===(output.status==='quality-failed'?'rejected':'unavailable'),'fewshot_manual_failed_outcome_decision_mismatch');
    if(decision.decision==='acceptable'){
      const contextual=summarizePlanRows([row],{controlKind:'fresh-independent'});
      requireProof(output.status==='generated'&&contextual.executed===1&&contextual.accepted===1&&contextual.contextual_useful_cases===1&&contextual.global_known_safety_violations===0&&contextual.utility.provided_field_reask_violations===0,'fewshot_manual_acceptable_requires_actual_contextual_generation');
      acceptable++;
    }
  }
  requireProof(acceptable>=22,'fewshot_manual22_contextual_intersection_required');
  return {reviewed:24,contextually_acceptable_cases:acceptable,human_reviewed:false,reviewer_type:'agent'};
}

export function createPretrainedFewshotActivationVerifier(config,{rootDir=APP_ROOT,canonicalSources=[]}={}) {
  const root=resolve(rootDir),reader=createPretrainedPhysicalReader({rootDir:root});let cached=null,pending=null;
  async function load({signal}={}){
    requireProof(config?.enabled===true&&config.focusMode==='model','fewshot_model_mode_not_enabled');
    const c=fewshotConfiguration(Number(config.timeoutMs??55600));
    const activation=await readTrustedJson({rootDir:root,path:config.activationManifestPath,namespace:'runtime/models',expectedSha256:config.activationManifestSha256,maxBytes:256*1024,signal});reader.files.push(activation);
    const a=activation.value,{validationOnly}=validateFewshotManifest(a,c);
    if(config.requiredActivationScope!==undefined)requireProof(a.scope===config.requiredActivationScope,'fewshot_required_scope_mismatch');
    if(config.activationScope!==undefined)requireProof(a.scope===config.activationScope,'fewshot_scope_override_mismatch');
    const expected=await reader.pointer(a.production_closure,signal,4*1024**2),production=await collectFewshotProductionClosure({rootDir:root,signal});validateFewshotProductionClosure(expected,production);
    const capacity=await loadVerifiedFewshotCapacity({rootDir:root,pointers:a.capacity_preflight,signal});
    const physical=await reader.physical(a,config,signal),{imported}=physical;
    const profile=a.memory_profile?await reader.pointer(a.memory_profile,signal,2*1024**2):null;
    const triple=async refs=>refs?{freeze:await reader.pointer(refs.freeze,signal),report:await reader.pointer(refs.report,signal),terminal:await reader.pointer(refs.terminal,signal,1024**2)}:null;
    const calibration=await triple(a.calibration),author=await triple(a.author_validation);
    const rootDoc=async(ref,path)=>{if(!ref)return null;requireProof(resolve(root,ref.path)===resolve(root,path),'fewshot_fixed_root_document_path');const file=await readTrustedJson({rootDir:root,path:ref.path,namespace:'runtime',expectedSha256:ref.sha256,maxBytes:1024**2,signal});reader.files.push(file);return file.value;};
    const focusPreregistration=await rootDoc(a.focus_execution_preregistration,'runtime/fewshot-v7-focus-preregistration.json');
    // All calibration/preregistration gates precede the first sealed42 read.
    if(profile)validateFewshotCalibrationEvidence({profile,evidence:{...calibration,capacity},manifest:a,imported,production,configuration:c});
    if(focusPreregistration)validateFewshotFocusPreregistration(focusPreregistration,{manifest:a,production,configuration:c});
    let trustedAuthorRows=null,executionBinding=null;
    if(author){const trusted=await loadTrustedFewshotAuthorRows({rootDir:root,signal,preregistrationRef:a.focus_execution_preregistration,manifest:a,production,configuration:c});trustedAuthorRows=trusted.rows;reader.files.push(trusted.file);executionBinding=await rootDoc(author.report.execution_binding,'runtime/fewshot-v7-focus-execution-binding.json');}
    const preregistration=await rootDoc(a.preregistration,'runtime/fewshot-v7-v6-preregistration.json');
    const quality=a.independent_quality?await reader.pointer(a.independent_quality,signal):null,manualReview=a.manual_review?await reader.pointer(a.manual_review,signal,1024**2):null;
    let independentFixture=null;if(quality){const file=await readTrustedJson({rootDir:root,path:quality.fixture_path,namespace:'fixtures',expectedSha256:FEWSHOT_FINAL_CONTROL_SHA256,maxBytes:512*1024,signal});reader.files.push(file);independentFixture=file.value;}
    const evaluatorSha256=hash(await readFile(resolve(root,'src/intelligence/generation-evaluation.mjs'),{signal})),benchmarkSha256=hash(await readFile(resolve(root,'scripts/benchmark-generator.mjs'),{signal}));
    const {parsePublishedFocusTrainNotebook}=await import('./focus-demonstrations.mjs');
    const trustedTrainRows=parsePublishedFocusTrainNotebook(await readFile(resolve(root,'notebooks/support-copilot-plan-qlora.ipynb'),{signal})).rows;
    validateFewshotDocuments({manifest:a,imported,production,capacity,profile,calibration,author,focusPreregistration,executionBinding,trustedAuthorRows,trustedTrainRows,preregistration,quality,manualReview,independentFixture,configuration:c,evaluatorSha256,benchmarkSha256,canonicalSources});
    await reader.recheck();validateFewshotProductionClosure(expected,await collectFewshotProductionClosure({rootDir:root,signal}));
    return {family:'pretrained-fewshot',modelPath:physical.modelPath,runtimePath:physical.runtimePath,modelSha:P.modelSha,modelBytes:P.modelBytes,validationOnly,memoryMode:profile?'pretrained17_fewshot_measured_mmap_profile':'pretrained17_fewshot_explicit_unmeasured_mmap_trial',memoryProfile:profile,headerKVBytes:P.kvBytes,configuration:c,focusProtocol:PROTOCOL,focusProtocolSha256:PSHA,modelMetadata:pretrainedModelMetadata(),activation_sha256:activation.sha256,import_receipt_sha256:a.import_receipt.sha256,upstream_source_sha256:P.sourceSha,conversion_closure_sha256:P.linuxClosureSha,windows_closure_sha256:P.windowsClosureSha,production_closure_sha256:production.sha256,corpus_sha256:a.corpus_sha256,capacity_preflight_sha256:a.capacity_preflight.report.sha256,capacityPointers:structuredClone(a.capacity_preflight)};
  }
  return async options=>{
    if(cached){await reader.recheck();requireProof((await collectFewshotProductionClosure({rootDir:root,signal:options?.signal})).sha256===cached.production_closure_sha256,'fewshot_current_source_changed');await loadVerifiedFewshotCapacity({rootDir:root,pointers:cached.capacityPointers,signal:options?.signal});return cached;}
    if(!pending)pending=load(options).then(value=>(cached=value)).catch(error=>{pending=null;reader.files.length=0;throw error;});
    return pending;
  };
}
