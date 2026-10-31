import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PRETRAINED_PINS as P,canonicalCorpusHash,pretrainedModelMetadata} from '../src/intelligence/pretrained-activation.mjs';
import {PRETRAINED_FEWSHOT_SCHEMA,validateFewshotManifest,validateFewshotCalibrationProducer,validateFewshotAuthorProducer,validateFewshotFocusPreregistration,validateFewshotFocusExecutionBinding,parseFewshotAuthorFixture,validateFewshotManualReview,validateFewshotIndependentQualification,validateFewshotPreregistration,validateFewshotDocuments,loadTrustedFewshotAuthorRows,createPretrainedFewshotActivationVerifier} from '../src/intelligence/pretrained-fewshot-activation.mjs';
import {validateFewshotCapacityEvidence,loadVerifiedFewshotCapacity} from '../src/intelligence/pretrained-physical.mjs';
import {FEWSHOT_SCHEMAS as S,FEWSHOT_PROTOCOL as protocol,FEWSHOT_PROTOCOL_SHA256 as ps,FEWSHOT_CAPACITY_PINS as CP,FEWSHOT_CAPACITY_PROJECTION,FEWSHOT_CONTROL_SHA256,FEWSHOT_AUTHOR_RECEIPT_SHA256,FEWSHOT_FINAL_CONTROL_SHA256,FEWSHOT_MONITORING,PROOF_ENVELOPE_SCOPE,fewshotConfiguration,fewshotAuthorConfiguration,fewshotFocusBody,fewshotPlanBody,calibrationDiagnostic} from '../src/intelligence/fewshot-proof-contract.mjs';
import {parsePublishedFocusTrainNotebook} from '../src/intelligence/focus-demonstrations.mjs';
import {buildActivatedFocusMessages} from '../src/intelligence/focus-protocol.mjs';
import {buildFocusMessages,buildGenerationInput,renderPlan,FOCUS_CODES,FOCUS_SYSTEM_PROMPT} from '../src/intelligence/generation-contract.mjs';
import {createTwoPhaseGenerator,twoPhasePreflight} from '../src/intelligence/two-phase.mjs';
import {parseInferenceConfig} from '../src/intelligence/config.mjs';
import {createActivationFamilyVerifier} from '../src/intelligence/activation-family.mjs';
import {buildBenchmarkIdentity,readBenchmarkPreregistration} from '../scripts/benchmark-generator.mjs';
import {hash,canonicalHash} from '../src/intelligence/production-closure.mjs';
import {validateFewshotProductionClosure,collectFewshotProductionClosure} from '../src/intelligence/fewshot-production-closure.mjs';

// Invented receipts and new independent-looking inputs used ONLY for pure
// consistency checks. Never actual calibration/author outcomes or activation.
const ref=name=>({path:'runtime/models/synthetic/'+name+'.json',sha256:hash(name)});
const triple=name=>({freeze:ref(name+'freeze'),report:ref(name+'report'),terminal:ref(name+'terminal')});
const cp=()=>Object.fromEntries(['freeze','report','terminal','root_approval'].map(k=>[k,structuredClone(CP[k])]));
const ph=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,v.sha256]));
const exit=()=>({owned_pid:1234,runtime_pid_after_close:null,double_close_same_promise:true,guard_held_until_close:true,minimum_free_bytes:900*1024**2,preflight_census:[],post_run_census:[],census_usage:{started:2,closed:2,maximum_concurrent:1,remaining_pid:null,owned_pids:[8001,8002]},runtime_usage:{exit:{code:null,signal:'SIGTERM'},observed_memory:{peak_private_bytes:400*1024**2,peak_rss_bytes:500*1024**2,sampled_cpu_seconds:1}}});
const setup=()=>({attempted_once:true,lock_claimed:true,owned_setup_released:true,monitoring:FEWSHOT_MONITORING});
const pp=()=>({protocol,protocol_sha256:ps});
const planFor=context=>({schema_version:'support-plan-v1',focus:context.allowed_focuses[0],fact_ids:context.facts.map(f=>f.id),request_fields:context.missing_fields,source_ids:context.allowed_sources.map(s=>s.id),needs_human:context.needs_human});
const call=(raw,max,body)=>({executed:true,raw,output_sha256:hash(raw),finish_reason:'stop',prompt_tokens:100,max_tokens:max,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},elapsed_ms:10,request_sha256:hash(JSON.stringify(body)),request_body:body,tokenizer_parity:true});
function imported(){return{schema_version:'linux-prebuilt-pretrained17-import-v2',status:'pretrained17_linux_import_integrity_verified_not_quality_verified',actual_local_bytes_verified:true,verification_origin:'bounded_actual_local_source_output_and_companion_bytes',model:{name:'Qwen3-1.7B-Q4_K_M-CPU-requant.gguf',bytes:P.modelBytes,sha256:P.modelSha},project_finetuned:false,joint100_checkpoint:false,activated:false,quality_verified:false,model_loaded:false,derivation:{type:'official_linux_prebuilt_Q8_to_Q4_requant',source_freeze_sha256:P.conversionSourceSha,cpu_helper_sha256:P.cpuHelperSha,linux_tool_host_closure_sha256:P.linuxClosureSha,source:{repo:P.repo,revision:P.revision,source_sha256:P.sourceSha,source_bytes:P.sourceBytes,source_quantization:'Q8_0',quantization:'Q4_K_M',method:'official_pretrained_Q8_to_project_Q4_requantization',project_finetuned:false,recovered_old20_adapter:false,joint100_checkpoint:false,training:false},...Object.fromEntries(['immutable_proof_sha256','linux_asset_sha256','linux_tool_closure_file_sha256','transfer_manifest_sha256','transfer_receipt_sha256'].map(k=>[k,hash(k)]))},windows_runtime:{closure_sha256:P.windowsClosureSha},kv_f16_bytes_at1024:P.kvBytes,tensor_structure_sha256:hash('tensor'),header:{'general.architecture':'qwen3','qwen3.block_count':28,'qwen3.embedding_length':2048,'qwen3.attention.head_count':16,'qwen3.attention.head_count_kv':8,'qwen3.attention.key_length':128,'qwen3.attention.value_length':128}};}
function manifest(){return{schema_version:S.activation,family:'pretrained-fewshot',scope:'private-validation',root_decision:'approved_for_local_validation',selected_model:{path:'runtime/models/synthetic/model.gguf',sha256:P.modelSha,bytes:P.modelBytes},import_receipt:ref('import'),runtime_closure:{...ref('windows'),sha256:P.windowsClosureSha},production_closure:ref('source'),corpus_sha256:canonicalCorpusHash([]),configuration:fewshotConfiguration(),bounded_trial:true,memory_profile:null,calibration:null,author_validation:null,preregistration:null,independent_quality:null,project_finetuned:false,training:false,joint100_checkpoint:false,recovered_old20_adapter:false,focus_protocol:protocol,capacity_preflight:cp(),focus_execution_preregistration:null,manual_review:null};}
const train=parsePublishedFocusTrainNotebook(await readFile(new URL('../notebooks/support-copilot-plan-qlora.ipynb',import.meta.url)));
function capacity(){
 const records=Object.entries(FEWSHOT_CAPACITY_PROJECTION).map(([path,sha256])=>({path,bytes:10,sha256})),production={records,sha256:canonicalHash(records)};
 const source={production,prototype_records:records,own_source_freeze_sha256:CP.own_source.sha256};
 const rows=train.rows.map(row=>{const body=fewshotFocusBody(row.input);return{id:row.id,input_sha256:canonicalHash(row.input),request_sha256:hash(JSON.stringify(body)),body};});
 const configuration={rows:126,input:984,native:55600,whole:60000,semantic:4400,reserve:268435456,census_timeout_ms:10000};
 const freeze={schema_version:'fewshot-v7-tokenizer-prepared-v1',no_retry:true,no_generation:true,no_quality:true,model_sha256:P.modelSha,bank_sha256:protocol.bank_sha256,source,rows,rows_sha256:canonicalHash(rows),lineage:train.lineage};
 const report={...exit(),schema_version:'fewshot-v7-train126-tokenizer-report-v1',status:'tokenizer_completed_not_quality',configuration,failure:null,freeze_sha256:CP.freeze.sha256,denominator:126,counted:126,no_completions:true,quality_verified:false,activation_allowed:false,post_integrity_verified:true,owned_setup_released:true,terminal_publication_required:true,proof_envelope_scope:PROOF_ENVELOPE_SCOPE,post_census:[],results:rows.map((r,i)=>({id:r.id,request_sha256:r.request_sha256,status:'counted',input_tokens:i===0?688:100,elapsed_ms:1})),maximum_input_tokens:688,identities:{source_inventory_sha256:canonicalHash(source),bank_sha256:protocol.bank_sha256,builder_sha256:protocol.builder_sha256,train_rows_sha256:train.lineage.train_rows_sha256,model_sha256:P.modelSha,Windows_runtime_closure_sha256:P.windowsClosureSha},semantic_body_ms:20,native_phase_elapsed_ms:100,whole_entry_elapsed_ms:120};
 const terminal={schema_version:'fewshot-v7-tokenizer-terminal-publication-v1',checked:true,scope_id:'TRAIN126-tokenizer-only',exit_code:0,freeze_sha256:CP.freeze.sha256,report_sha256:CP.report.sha256,source_inventory_sha256:canonicalHash(source),bank_sha256:protocol.bank_sha256,model_sha256:P.modelSha,after_publication_native_ms:101,after_publication_whole_ms:121};
 return{freeze,report,terminal,root_approval:{schema_version:'root-approved-fewshot-v7-tokenizer-preflight-v1',root_approved:true,inventory:source,limits:configuration},pointers:cp()};
}
function measured(){
 const a=manifest(),c=a.configuration,i=imported(),records=Object.entries(FEWSHOT_CAPACITY_PROJECTION).map(([path,sha256])=>({path,bytes:10,sha256})),production={schema_version:'production-generation-source-closure-v1',registry_version:'selected17-fewshot-production-and-helper-registry-v1',records,sha256:canonicalHash(records),production_source10_sha256:hash('10'),factory_sha256:hash('factory')};
 a.bounded_trial=false;a.memory_profile=ref('profile');a.calibration=triple('cal');
 const diagnostic=calibrationDiagnostic(),capacity_proof_bindings=ph(cp()),source_hashes=Object.fromEntries(records.map(r=>[r.path,r.sha256])),importSHA=hash(JSON.stringify(i));
 const timing={...pp(),scope_id:S.calibration_scope,phase_scope:'verification-admission-start-inference-abort-actual-exit-postchecks-persistence',native_phase_started_before_verification:true,terminal_publication_required:true,proof_envelope_scope:PROOF_ENVELOPE_SCOPE,semantic_body_ms:20,native_phase_elapsed_ms:100,whole_entry_elapsed_ms:120,preparation_elapsed_ms:20,elapsed_ms:100,total_elapsed_ms:120,phase_components_ms:{verification:10,startup:10,inference:45,cleanup:10,postchecks:10,persistence:10}};
 const freeze={schema_version:S.calibration_freeze,...pp(),capacity_proof_bindings,source_seal:production,selected:Object.fromEntries(['model','header','kv_f16_bytes_at1024','derivation','windows_runtime'].map(k=>[k,i[k]])),configuration:c,import_receipt_sha256:importSHA,source_hashes,...diagnostic};
 const report={...exit(),...setup(),...timing,schema_version:S.calibration_report,status:'calibration_completed_not_quality',failure:null,post_integrity_verified:true,selected_model_sha256:P.modelSha,freeze_sha256:a.calibration.freeze.sha256,import_receipt_sha256:importSHA,configuration:c,capacity_proof_bindings,source_hashes,production_source10_sha256:production.production_source10_sha256,preflight:{mode:'explicit_fewshot17_unmeasured_mmap_commit_estimate_trial',header_kv_bytes:P.kvBytes,scratch_commit_estimate_bytes:P.scratchBytes,reserve_bytes:P.reserveBytes,required_free_bytes:P.kvBytes+P.scratchBytes+P.reserveBytes,old_profile_inherited:false,free_bytes:900*1024**2},calls:[{...call(JSON.stringify({focus:'clarification'}),32,diagnostic.bodies.focus),phase:'focus'},{...call(JSON.stringify(planFor(diagnostic.context)),192,diagnostic.bodies.conditional_plan),phase:'conditional_plan'}],forced_timeout:{request_started:true,triggered:true,outcome:'AbortError',elapsed_ms:25}};
 const profile={...timing,schema_version:S.calibration_profile,actual_native:true,model_sha256:P.modelSha,Linux_derivation_closure_sha256:P.linuxClosureSha,Windows_runtime_closure_sha256:P.windowsClosureSha,context_tokens:1024,header_kv_bytes:P.kvBytes,mmap:true,no_repack:true,quality_verified:false,activated:false,capacity_proof_bindings,configuration:c,import_receipt_sha256:importSHA,trial_freeze_sha256:a.calibration.freeze.sha256,trial_report_sha256:a.calibration.report.sha256,source_seal_sha256:production.sha256,source_seal:production,observed_memory:report.runtime_usage.observed_memory,minimum_free_bytes:report.minimum_free_bytes};
 const terminal={schema_version:S.calibration_terminal,checked:true,scope_id:S.calibration_scope,exit_code:0,profile_sha256:a.memory_profile.sha256,freeze_sha256:a.calibration.freeze.sha256,report_sha256:a.calibration.report.sha256,model_sha256:P.modelSha,source_seal_sha256:production.sha256,protocol_sha256:ps,bank_sha256:protocol.bank_sha256,after_publication_native_ms:101,after_publication_whole_ms:121};
 return{manifest:a,configuration:c,imported:i,production,profile,freeze,report,terminal,capacity:{pointers:cp()},hashes:{profile:a.memory_profile.sha256,freeze:a.calibration.freeze.sha256,report:a.calibration.report.sha256}};
}
function focusPrereg(b){const a=b.manifest;return{schema_version:S.focus_preregistration,root_approved:true,scope:S.author_scope,created_at:'2026-10-31T00:00:00Z',model_sha256:P.modelSha,windows_runtime_closure_sha256:P.windowsClosureSha,production_closure_sha256:b.production.sha256,...pp(),bank_sha256:protocol.bank_sha256,capacity_proof_bindings:ph(a.capacity_preflight),calibration_proof_bindings:{profile:a.memory_profile.sha256,...ph(a.calibration)},configuration:b.configuration,fixture_sha256:FEWSHOT_CONTROL_SHA256,author_receipt:{path:'runtime/independent-focus-v7-author/author-receipt.json',sha256:FEWSHOT_AUTHOR_RECEIPT_SHA256},denominator:42,minimum_correct:38,per_class_correct:4,per_class_denominator:6,attempts_per_case:1,no_resume:true,all_operational_gates:true};}
function syntheticFixture(){return{schema_version:'independent-authored-focus-control-v7',provenance:{type:'authored_synthetic',human_reviewed:false,contains_private_data:false,author:'independent-focus-v7'},scope:'SYNTHETIC test only',cases:FOCUS_CODES.flatMap(focus=>['ru','en','kk','uz','es','pt'].map(lang=>({id:`SYNTHETIC-${focus}-${lang}`,group_id:`SYNTHETIC-group-${focus}-${lang}`,lang,expected_focus:focus,input:{kind:'report',lang,messages:[{role:'player',text:`SYNTHETIC input ${focus} ${lang}.`}]},provenance:{type:'authored_synthetic',human_reviewed:false,contains_private_data:false}})))};}
function authored(){
 const b=measured(),a=b.manifest;a.focus_execution_preregistration=ref('focus-prereg');a.author_validation=triple('focus');
 const trustedRows=parseFewshotAuthorFixture(syntheticFixture()),rows=trustedRows.map(row=>({...structuredClone(row),body:fewshotFocusBody(row.input)})),cohort=canonicalHash(rows),configuration=fewshotAuthorConfiguration();
 const freeze={schema_version:S.author_freeze,...pp(),no_retry:true,no_retuning:true,no_activation:true,thresholds:{correct:38,denominator:42,per_class_correct:4,per_class_denominator:6},rows,cohort_sha256:cohort,model_sha256:P.modelSha,import_receipt:b.imported,profile:b.profile,source:b.production,fixture_sha256:FEWSHOT_CONTROL_SHA256,focus_preregistration_sha256:a.focus_execution_preregistration.sha256,capacity_proof_bindings:ph(a.capacity_preflight),configuration};
 const report={...exit(),...setup(),...pp(),schema_version:S.author_report,scope_id:S.author_scope,status:'completed_independent_focus_not_plan_quality',failure:null,post_run_integrity_verified:true,freeze_sha256:a.author_validation.freeze.sha256,selected_model_sha256:P.modelSha,configuration,startup_ms:10,cleanup_ms:10,total_elapsed_ms:450,preflight_elapsed_ms:10,post_integrity_ms:10,report_persistence_ms:10,total_with_prepost_ms:500,terminal_publication_required:true,proof_envelope_scope:PROOF_ENVELOPE_SCOPE,execution_binding:ref('execution'),proof_bindings:{source_inventory_sha256:b.production.sha256,import_receipt_sha256:hash(JSON.stringify(b.imported)),model_sha256:P.modelSha,Linux_closure:P.linuxClosureSha,Windows_closure:P.windowsClosureSha,cohort_sha256:cohort,protocol_sha256:ps,bank_sha256:protocol.bank_sha256,fixture_sha256:FEWSHOT_CONTROL_SHA256,focus_preregistration_sha256:a.focus_execution_preregistration.sha256,capacity_proof_bindings:ph(a.capacity_preflight),calibration_proof_bindings:{profile:a.memory_profile.sha256,...ph(a.calibration)}},results:rows.map(row=>({...call(JSON.stringify({focus:row.expected_focus}),32,row.body),id:row.id,group_id:row.group_id,lang:row.input.lang,expected_focus:row.expected_focus,provenance:row.provenance,status:'completed',attempt:1}))};
 const terminal={schema_version:S.author_terminal,checked:true,scope_id:S.author_scope,exit_code:0,report_sha256:a.author_validation.report.sha256,freeze_sha256:a.author_validation.freeze.sha256,model_sha256:P.modelSha,source_seal_sha256:b.production.sha256,cohort_sha256:cohort,protocol_sha256:ps,bank_sha256:protocol.bank_sha256,after_publication_whole_ms:501};
 const executionBinding={schema_version:'fewshot-focus-execution-binding-v1',root_approved:true,scope:S.author_scope,prepared_freeze_sha256:a.author_validation.freeze.sha256,focus_preregistration_sha256:a.focus_execution_preregistration.sha256,source_inventory_sha256:b.production.sha256,model_sha256:P.modelSha,protocol_sha256:ps,bank_sha256:protocol.bank_sha256,cohort_sha256:cohort};
 return{...b,calibration:{freeze:b.freeze,report:b.report,terminal:b.terminal},freeze,report,terminal,trustedRows,executionBinding,focusPreregistration:focusPrereg(b),hashes:{freeze:a.author_validation.freeze.sha256,report:a.author_validation.report.sha256}};
}

test('new schema private scope cannot imply operator, bank selection or trained weights',()=>{
 assert.equal(validateFewshotManifest(manifest()).validationOnly,true);
 for(const mutate of [a=>a.schema_version='pretrained-generation-activation-v1',a=>a.focus_protocol.bank_sha256=hash('other'),a=>a.training=true,a=>a.actual_optimizer_steps=0,a=>a.configuration.context_tokens=2048,a=>a.capacity_preflight.report.sha256=hash('wrong'),a=>{a.scope='operator-generation';a.root_decision='approved_for_local_operator_generation';}]){const a=structuredClone(manifest());mutate(a);assert.throws(()=>validateFewshotManifest(a));}
});
test('capacity validates all original126 exact current model-first bodies, not future wholegraph identity',()=>{
 const c=capacity();assert.equal(validateFewshotCapacityEvidence({capacity:c,trainRows:train.rows}).actual_local_files_verified,false);
 for(const mutate of [c=>c.freeze.rows[0].body.messages.pop(),c=>c.report.results[0].input_tokens=985,c=>c.report.maximum_input_tokens=687,c=>c.report.results.pop(),c=>c.terminal.checked=false,c=>c.root_approval.root_approved=false,c=>c.freeze.source.production.records[0].sha256=hash('changed'),c=>c.report.identities.train_rows_sha256=c.freeze.rows_sha256,c=>c.report.runtime_usage.exit.signal=null,c=>c.report.whole_entry_elapsed_ms=1]){const v=structuredClone(capacity());mutate(v);assert.throws(()=>validateFewshotCapacityEvidence({capacity:v,trainRows:train.rows}));}
});
test('FS capacity cannot pass document graphs or alternative receipt hash without actual pinned bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fewshot-capacity-'));
 await assert.rejects(loadVerifiedFewshotCapacity({rootDir:root,pointers:cp()}));
 const altered=cp();altered.report.sha256=hash('synthetic');await assert.rejects(loadVerifiedFewshotCapacity({rootDir:root,pointers:altered}),/actual_pointers/);
});
test('new calibration consistency keeps raw physical/source/body/phase/terminal gates',()=>{
 assert.equal(validateFewshotCalibrationProducer(measured()).actual_local_files_verified,false);
 for(const mutate of [b=>b.profile.schema_version='Linux-imported17-Windows-memory-profile-v2',b=>b.report.post_integrity_verified=false,b=>b.report.forced_timeout.elapsed_ms=1,b=>b.report.monitoring.census_timeout_ms=3000,b=>b.report.owned_setup_released=false,b=>b.report.lock_claimed=false,b=>b.report.attempted_once=false,b=>b.report.elapsed_ms=99,b=>b.report.native_phase_elapsed_ms=55601,b=>b.report.phase_components_ms.verification=1000,b=>b.report.phase_components_ms.inference=44.999,b=>b.profile.capacity_proof_bindings={},b=>b.freeze.bodies.focus.messages.splice(1,14),b=>b.terminal.after_publication_native_ms=99,b=>b.terminal.bank_sha256=hash('wrong'),b=>b.report.census_usage.closed=1,b=>b.imported.derivation.source.repo='fake/publisher']){const v=structuredClone(measured());mutate(v);assert.throws(()=>validateFewshotCalibrationProducer(v));}
});
test('new42 shape is unique scenarios and complete focus-language crossproduct, no original42 relabel',()=>{
 const f=syntheticFixture();assert.equal(parseFewshotAuthorFixture(f).length,42);
 for(const mutate of [f=>f.schema_version='old-published42',f=>f.cases[0].group_id=f.cases[1].group_id,f=>f.cases[0].input.messages.push({role:'player',text:'second'}),f=>f.cases[0].input.messages[0].role='admin',f=>f.cases[0].input.lang='invalid',f=>f.cases[0].expected_focus='account',f=>f.cases[0].provenance.human_reviewed=true]){const v=syntheticFixture();mutate(v);assert.throws(()=>parseFewshotAuthorFixture(v));}
});
test('lazy loader rejects absent/wrong prereg before it can touch a sealed fixture',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fewshot-no-fixture-'));
 await assert.rejects(loadTrustedFewshotAuthorRows({rootDir:root}),/fixed_focus_preregistration_path/);
 const b=measured(),prereg=focusPrereg(b);await mkdir(join(root,'runtime'),{recursive:true});const p=join(root,'runtime/fewshot-v7-focus-preregistration.json');prereg.root_approved=false;const bytes=JSON.stringify(prereg);await writeFile(p,bytes);
 await assert.rejects(loadTrustedFewshotAuthorRows({rootDir:root,preregistrationRef:{path:p,sha256:hash(bytes)},manifest:b.manifest,production:b.production,configuration:b.configuration}),/root_preregistration/);
});
test('root focus prereg and prepared execution binding are acyclic and cannot change fixed gates',()=>{
 const b=authored();assert.equal(validateFewshotFocusPreregistration(b.focusPreregistration,b).preregistered,true);
 for(const mutate of [p=>p.fixture_sha256=hash('old42'),p=>p.denominator=41,p=>p.minimum_correct=30,p=>p.per_class_correct=3,p=>p.attempts_per_case=2,p=>p.no_resume=false,p=>p.calibration_proof_bindings.terminal=hash('old')]){const p=structuredClone(b.focusPreregistration);mutate(p);assert.throws(()=>validateFewshotFocusPreregistration(p,b));}
 assert.equal(validateFewshotFocusExecutionBinding(b.executionBinding,{freezeSha:b.hashes.freeze,focusPreregSha:b.manifest.focus_execution_preregistration.sha256,production:b.production,cohortSha:b.freeze.cohort_sha256}).execution_approved,true);
});
test('author pure consistency recomputes strict38 and4 perclass on synthetic new42 only',()=>{
 const b=authored();assert.equal(validateFewshotAuthorProducer(b).correct,42);
 for(let i=0;i<3;i++){b.report.results[i].raw='{"focus":"clarification"}';b.report.results[i].output_sha256=hash(b.report.results[i].raw);}
 assert.throws(()=>validateFewshotAuthorProducer(b),/38_each4/);
 const old30=authored();for(let i=0;i<12;i++){old30.report.results[i].raw='{"focus":"clarification"}';old30.report.results[i].output_sha256=hash(old30.report.results[i].raw);}assert.throws(()=>validateFewshotAuthorProducer(old30),/38_each4/);
});
test('author self-rehash, old profile/source, retries, raw time/PID/terminal mutations reject',()=>{
 for(const mutate of [b=>{b.freeze.rows[0].id='SELF-REHASHED';b.report.results[0].id='SELF-REHASHED';b.freeze.cohort_sha256=canonicalHash(b.freeze.rows);b.report.proof_bindings.cohort_sha256=b.freeze.cohort_sha256;b.executionBinding.cohort_sha256=b.freeze.cohort_sha256;b.terminal.cohort_sha256=b.freeze.cohort_sha256;},b=>b.report.results[0].attempt=2,b=>b.report.results[0].tokenizer_parity=false,b=>b.report.results[0].request_body.messages.pop(),b=>b.report.results.pop(),b=>b.report.startup_ms=55601,b=>b.report.cleanup_ms=55601,b=>b.report.total_with_prepost_ms=1,b=>b.report.guard_held_until_close=false,b=>b.report.runtime_pid_after_close=1234,b=>b.report.proof_bindings.calibration_proof_bindings.profile=hash('oldprofile'),b=>b.report.proof_bindings.source_inventory_sha256=hash('oldgraph'),b=>b.terminal.after_publication_whole_ms=499,b=>b.executionBinding.prepared_freeze_sha256=hash('other')]){const v=structuredClone(authored());mutate(v);assert.throws(()=>validateFewshotAuthorProducer(v));}
});
test('ordinary startup defaults stay fast/off and reject private fewshot manifests',async()=>{
 assert.deepEqual(parseInferenceConfig({}),{draftMode:'fast',generatorConfig:{enabled:false,focusMode:'deterministic'}});
 const root=await mkdtemp(join(tmpdir(),'fewshot-config-')),path=join(root,'manifest.json');await writeFile(path,JSON.stringify(manifest()));
 assert.throws(()=>parseInferenceConfig({LOCAL_GENERATOR:'1',GENERATOR_FOCUS_MODE:'model',GENERATOR_ACTIVATION_MANIFEST:path}),/operator-generation/);
});
test('typed operator startup shape never turns invented publisher files into activation',async()=>{
 const b=authored(),a=b.manifest;a.scope='operator-generation';a.root_decision='approved_for_local_operator_generation';a.preregistration=ref('v6-prereg');a.independent_quality=ref('quality');a.manual_review=ref('agent-review');
 const root=await mkdtemp(join(tmpdir(),'fewshot-fake-publisher-'));await mkdir(join(root,'runtime/models'),{recursive:true});const path=join(root,'runtime/models/operator.json');await writeFile(path,JSON.stringify(a));
 const parsed=parseInferenceConfig({LOCAL_GENERATOR:'1',GENERATOR_FOCUS_MODE:'model',GENERATOR_ACTIVATION_MANIFEST:path,TRIAGE_DRAFT_MODE:'native'});assert.equal(parsed.draftMode,'native');
 await assert.rejects(createPretrainedFewshotActivationVerifier(parsed.generatorConfig,{rootDir:root})({}));
 assert.throws(()=>parseInferenceConfig({LOCAL_GENERATOR:'1',GENERATOR_FOCUS_MODE:'model',GENERATOR_ACTIVATION_MANIFEST:path,GENERATOR_TIMEOUT_MS:'4400'}),/no bounded native phase/);
});
test('explicit schema dispatch never falls back to a different family on fewshot rejection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fewshot-dispatch-'));await mkdir(join(root,'runtime/models'),{recursive:true});const path='runtime/models/a.json';await writeFile(join(root,path),JSON.stringify({schema_version:PRETRAINED_FEWSHOT_SCHEMA}));let other=0;
 const verify=createActivationFamilyVerifier({enabled:true,focusMode:'model',activationManifestPath:path},{rootDir:root,fewshotFactory:()=>async()=>{throw Error('fewshot rejected');},pretrainedFactory:()=>async()=>{other++;},legacyFactory:()=>async()=>{other++;}});
 await assert.rejects(verify({}),/fewshot rejected/);assert.equal(other,0);
});
test('activated builder is closed, preserves old two-message protocol and uses same physical admission',()=>{
 const input={kind:'report',lang:'en',messages:[{role:'player',text:'SYNTHETIC CURRENT only.'}]},a={family:'pretrained-fewshot',focusProtocol:protocol,focusProtocolSha256:ps,headerKVBytes:P.kvBytes,modelBytes:P.modelBytes,memoryMode:'trial'};
 assert.equal(buildActivatedFocusMessages(input,a).length,16);assert.deepEqual(buildActivatedFocusMessages(input,{family:'pretrained'}),buildFocusMessages(input));
 assert.throws(()=>buildActivatedFocusMessages(input,{...a,focusProtocolSha256:hash('fake')}),/verified_protocol/);
 assert.throws(()=>buildActivatedFocusMessages(input,{family:'untrusted'}),/unknown_focus/);
 assert.equal(twoPhasePreflight(a,P.kvBytes+P.scratchBytes+P.reserveBytes).ok,true);assert.equal(twoPhasePreflight(a,P.kvBytes+P.scratchBytes+P.reserveBytes-1).ok,false);
});
test('benchmark fewshot identity binds fullclosure+protocol without an activation claim',async()=>{
 const b=measured();const identity=await buildBenchmarkIdentity({focusMode:'model',activationHint:{schema_version:S.activation,focus_protocol:protocol},canonicalSources:[],closureCollector:async()=>b.production});
 assert.equal(identity.activation_family,'pretrained-fewshot');assert.equal(identity.protocol_sha256,ps);assert.equal(Object.keys(identity.files).length,b.production.records.length);assert.equal(identity.model.id,pretrainedModelMetadata().id);
 await assert.rejects(buildBenchmarkIdentity({focusMode:'model',activationHint:{schema_version:S.activation,focus_protocol:{}},closureCollector:async()=>b.production}),/fixed bank/);
});
test('fake native session receives exactsame model-first16 body and keeps demos out of plan/context',async()=>{
 const input={kind:'report',lang:'en',messages:[{role:'admin',text:'ADMIN-SYNTHETIC'},{role:'player',text:'My game crashes on PC. CURRENT-SYNTHETIC.'}]},baseline={lang:'en',category:'report.help',needs_human:true,citations:[],draft_reply:{text:'safe fallback'}};
 const context=buildGenerationInput(input,baseline,[],{proposedFocus:'technical',focusOrigin:'local_llm'}),plan=planFor(context),requests=[],raw=[];let pid=1234,closing;
 const activation={family:'pretrained-fewshot',focusProtocol:protocol,focusProtocolSha256:ps,validationOnly:true,modelSha:P.modelSha,modelMetadata:pretrainedModelMetadata(),configuration:fewshotConfiguration(),headerKVBytes:P.kvBytes,modelBytes:P.modelBytes};
 const runner={get pid(){return pid;},start:async()=>{},tokenCount:async b=>{requests.push({stage:'count',body:b});return 100;},complete:async(b,{phase})=>{requests.push({stage:'complete',body:b});const text=phase==='focus'?'!!!':JSON.stringify(plan);return{choices:[{message:{content:phase==='focus'?'{"focus":"technical"}':text},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}};},terminate(){},close(){return closing??=(async()=>{pid=null;})();},observedMetrics:()=>exit().runtime_usage};
 const gen=createTwoPhaseGenerator({config:{enabled:true,timeoutMs:55600,onRawOutput:r=>raw.push(r)},canonicalSources:[]},{freeBytes:()=>2*1024**3,loadActivation:async()=>activation,runnerFactory:()=>runner});
 const result=await gen.generate(input,baseline);await gen.close();assert.equal(result.status,'generated');assert.equal(result.needs_human,true);assert.equal(result.metrics.focus_prompt_sha256,hash(FOCUS_SYSTEM_PROMPT));assert.equal(result.metrics.focus_protocol_sha256,ps);assert.equal(result.metrics.owned_exit_verified,true);
 assert.equal(requests.length,4);assert.equal(JSON.stringify(requests[0].body),JSON.stringify(fewshotFocusBody(input)));assert.equal(JSON.stringify(requests[0].body),JSON.stringify(requests[1].body));assert.equal(JSON.stringify(requests[2].body),JSON.stringify(fewshotPlanBody(context)));assert.equal(JSON.stringify(requests[2].body),JSON.stringify(requests[3].body));
 assert.deepEqual(JSON.parse(requests[0].body.messages.at(-1).content.slice(0,-'\n/no_think'.length)).player_messages,[input.messages[1].text]);assert.deepEqual(result.source_ids,[]);assert.deepEqual(raw[1].context_basis,{lang:baseline.lang,category:baseline.category,needs_human:true,citations:[]});assert.equal(raw[0].request_sha256,hash(JSON.stringify(fewshotFocusBody(input))));
});
test('manual contextual review is explicitly agent/nonexpert, all24, and source/corpus/report bound',()=>{
 const b=syntheticQuality();b.manifest.independent_quality=ref('quality');const quality=b.quality,cases=quality.cases;
 const review={schema_version:'fewshot-plan-manual-review-v1',root_approved:true,human_reviewed:false,reviewer_type:'agent',nonexpert:true,quality_report_sha256:b.manifest.independent_quality.sha256,production_closure_sha256:b.production.sha256,protocol_sha256:ps,corpus_sha256:b.manifest.corpus_sha256,cases:cases.map(row=>({id:row.id,decision:'acceptable',hard_violations:0,findings:'Synthetic review placeholder, not actual QA.'}))};
 assert.equal(validateFewshotManualReview(review,{...b,quality}).reviewed,24);
 for(const mutate of [r=>r.human_reviewed=true,r=>r.nonexpert=false,r=>r.cases.pop(),r=>r.cases[0].hard_violations=1,r=>r.corpus_sha256=hash('other')]){const r=structuredClone(review);mutate(r);assert.throws(()=>validateFewshotManualReview(r,{...b,quality}));}
});

function syntheticQuality(){
 const b=authored(),a=b.manifest;a.preregistration=ref('v6-prereg');
 const canonicalSources=[{id:'30:2.1',section_id:'30',section:'SYNTHETIC test section',ref:'2.1',text:'Synthetic canonical statement about personal insults.',label:'SYNTHETIC canonical label'}];a.corpus_sha256=canonicalCorpusHash(canonicalSources);
 const input={kind:'report',lang:'en',messages:[{role:'player',text:'A player insulted me in chat.'}]},baseline={category:'report.insult',lang:'en',needs_human:false,source_ids:['30:2.1']},context=buildGenerationInput(input,{...baseline,citations:canonicalSources},canonicalSources,{proposedFocus:'complaint',focusOrigin:'local_llm'}),plan=planFor(context),rendered=renderPlan(plan,context);
 const bodies={focus:fewshotFocusBody(input),plan:fewshotPlanBody(context)};
 const raw=(phase,text)=>({phase,text,finish_reason:'stop',usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},request_body:bodies[phase],request_sha256:hash(JSON.stringify(bodies[phase]))});
 const cases=Array.from({length:24},(_,i)=>{
  const focus=raw('focus','{"focus":"complaint"}'),p=raw('plan',JSON.stringify(plan));p.context_basis={lang:'en',category:baseline.category,needs_human:false,citations:structuredClone(canonicalSources)};
  const metrics={...exit(),model_sha256:P.modelSha,activation_family:'pretrained-fewshot',focus_protocol_sha256:ps,focus_bank_sha256:protocol.bank_sha256,focus_messages_sha256:hash(JSON.stringify(bodies.focus.messages)),native_budget_ms:55600,budget_ms:60000,preparation_ms:20,elapsed_ms:100,total_elapsed_ms:120,executed:true,generated:true,plan_origin:'local_llm',text_origin:'deterministic_renderer',owned_exit_verified:true,source_applicability:context.source_applicability,phases:Object.fromEntries([['focus',focus,32],['plan',p,192]].map(([phase,r,max])=>[phase,{executed:true,max_tokens:max,prompt_tokens:100,finish_reason:'stop',elapsed_ms:20,completion_ms:10,output_sha256:hash(r.text),usage:r.usage,request_sha256:r.request_sha256}]))};
  return{id:'SYNTHETIC-plan-'+i,input:structuredClone(input),expected:{focus:'complaint',needs_human:true,provided_fields:context.provided_fields,request_fields:plan.request_fields,source_ids:['30:2.1']},baseline,original_baseline:baseline,canonical_sources:structuredClone(canonicalSources),whole_elapsed_ms:121,generation:{...rendered,status:'generated',plan,metrics},raw_model_output:{focus,plan:p}};
 });
 const files=Object.fromEntries(b.production.records.map(r=>[r.path,r.sha256]));
 const quality={benchmark_schema_version:5,control_kind:'fresh-independent',human_reviewed:false,activation_family:'pretrained-fewshot',model:pretrainedModelMetadata(),...pp(),production_closure_sha256:b.production.sha256,candidate_sha256:b.production.sha256,file_hashes:files,full_file_hashes:files,corpus_sha256:a.corpus_sha256,evaluator_sha256:hash('evaluator'),benchmark_sha256:hash('benchmark'),production_configuration:b.configuration,fixture_sha256:FEWSHOT_FINAL_CONTROL_SHA256,preregistration_sha256:a.preregistration.sha256,created_at:'2026-10-31T00:01:00Z',cases};
 const prereg={created_at:'2026-10-31T00:00:00Z'};
 return {...b,canonicalSources,quality,prereg,evaluatorSha256:quality.evaluator_sha256,benchmarkSha256:quality.benchmark_sha256};
}
test('fresh synthetic consistency preserves canonical cards/current context/human and exact16+plan bodies',()=>{
 const b=syntheticQuality();assert.equal(validateFewshotIndependentQualification(b.quality,b.prereg,b).accepted,24);
 for(const mutate of [b=>b.quality.activation_family='pretrained',b=>b.quality.cases.pop(),b=>b.quality.cases[0].canonical_sources[0].label='UNTRUSTED prose',b=>b.quality.cases[0].generation.needs_human=false,b=>b.quality.cases[0].generation.plan.fact_ids.push('DEMO_INVENTED_FACT'),b=>b.quality.cases[0].generation.plan.request_fields.push('problem_description'),b=>b.quality.cases[0].generation.plan.source_ids.push('999:INAPPLICABLE'),b=>b.quality.cases[0].original_baseline.needs_human=true,b=>b.quality.cases[0].raw_model_output.focus.request_body.messages.pop(),b=>b.quality.cases[0].raw_model_output.plan.request_body.messages[1].content='INJECTED demo facts',b=>b.quality.cases[0].whole_elapsed_ms=1,b=>b.quality.cases[0].generation.metrics.runtime_pid_after_close=1234,b=>b.quality.cases[0].generation.metrics.total_elapsed_ms=60001,b=>b.quality.cases[0].raw_model_output.focus.usage.total_tokens=111]){const v=structuredClone(syntheticQuality());mutate(v);assert.throws(()=>validateFewshotIndependentQualification(v.quality,v.prereg,v));}
});
test('fewshot closed graph rejects old registry, recomputed subsets and absence of private source proofs',async()=>{
 const records=Array.from({length:18},(_,i)=>({path:'src/SYNTHETIC-'+i+'.mjs',bytes:10,sha256:hash(String(i))})),full={schema_version:'production-generation-source-closure-v1',registry_version:'selected17-fewshot-production-and-helper-registry-v1',records,sha256:canonicalHash(records),production_source10_sha256:hash('10'),factory_sha256:hash('factory')};
 assert.equal(validateFewshotProductionClosure(full,full),full);
 const old=structuredClone(full);old.registry_version='selected17-production-and-helper-registry-v1';assert.throws(()=>validateFewshotProductionClosure(old,old));
 const subset=structuredClone(full);subset.records.pop();subset.sha256=canonicalHash(subset.records);assert.throws(()=>validateFewshotProductionClosure(subset,full));
 const root=await mkdtemp(join(tmpdir(),'fewshot-no-private-'));for(const p of ['src','public','data'])await mkdir(join(root,p));await assert.rejects(collectFewshotProductionClosure({rootDir:root}));
});

function consistentOperator(){
 const b=syntheticQuality(),a=b.manifest;a.scope='operator-generation';a.root_decision='approved_for_local_operator_generation';a.independent_quality=ref('quality');a.manual_review=ref('manual-review');
 const preregistration={schema_version:S.plan_preregistration,root_approved:true,scope:'fresh-independent-plan-v6',created_at:'2026-10-31T00:00:00Z',model_sha256:P.modelSha,windows_runtime_closure_sha256:P.windowsClosureSha,production_closure_sha256:b.production.sha256,corpus_sha256:a.corpus_sha256,configuration:b.configuration,...pp(),bank_sha256:protocol.bank_sha256,capacity_proof_bindings:ph(a.capacity_preflight),calibration_proof_bindings:{profile:a.memory_profile.sha256,...ph(a.calibration)},focus_report_sha256:a.author_validation.report.sha256,focus_terminal_sha256:a.author_validation.terminal.sha256,focus_preregistration_sha256:a.focus_execution_preregistration.sha256,fixture_sha256:FEWSHOT_FINAL_CONTROL_SHA256,evaluator_sha256:b.evaluatorSha256,benchmark_sha256:b.benchmarkSha256,denominator:24,minimum_contextual:22,maximum_safety_violations:0,control_kind:'fresh-independent',manual_all24_required:true};
 const manualReview={schema_version:'fewshot-plan-manual-review-v1',root_approved:true,human_reviewed:false,reviewer_type:'agent',nonexpert:true,quality_report_sha256:a.independent_quality.sha256,production_closure_sha256:b.production.sha256,protocol_sha256:ps,corpus_sha256:a.corpus_sha256,cases:b.quality.cases.map(row=>({id:row.id,decision:'acceptable',hard_violations:0,findings:'SYNTHETIC consistency fixture only; no actual review.'}))};
 return{...b,capacity:capacity(),trustedTrainRows:train.rows,author:{freeze:b.freeze,report:b.report,terminal:b.terminal},trustedAuthorRows:b.trustedRows,preregistration,manualReview,independentFixture:{provenance:'authored_synthetic_consistency_test_only',human_reviewed:false,contract_version:'support-plan-v1',cases:structuredClone(b.quality.cases.map(row=>({id:row.id,input:row.input,expected:row.expected})))}};
}
test('whole synthetic operator document cohort is consistency only and rejects omitted earlier gates',()=>{
 const b=consistentOperator();assert.equal(validateFewshotDocuments(b).actual_local_files_verified,false);assert.equal(validateFewshotDocuments(b).validationOnly,false);
 for(const mutate of [b=>b.capacity=null,b=>b.author=null,b=>b.focusPreregistration=null,b=>b.manualReview=null,b=>b.profile.schema_version='Linux-imported17-Windows-memory-profile-v2',b=>b.independentFixture.cases[0].input.messages[0].text='SYNTHETIC replacement',b=>b.preregistration.focus_terminal_sha256=hash('old'),b=>b.preregistration.maximum_safety_violations=1,b=>b.preregistration.manual_all24_required=false]){const v=structuredClone(consistentOperator());mutate(v);assert.throws(()=>validateFewshotDocuments(v));}
 const p=structuredClone(b.preregistration);p.fixture_sha256=hash('different');assert.throws(()=>validateFewshotPreregistration(p,b));
});
test('two unavailable completions remain in the fixed24 denominator and never claim raw outputs or acceptance',()=>{
 const b=syntheticQuality();
 for(const row of b.quality.cases.slice(0,2)){
  const m=row.generation.metrics;row.generation.status='unavailable';row.generation.plan=null;m.generated=false;m.plan_origin=null;m.text_origin='baseline_fallback';m.phases.plan={executed:false};row.raw_model_output={};
 }
 const summary=validateFewshotIndependentQualification(b.quality,b.prereg,b);assert.equal(summary.total,24);assert.equal(summary.accepted,22);
 b.quality.cases.shift();assert.throws(()=>validateFewshotIndependentQualification(b.quality,b.prereg,b),/source_fixture_config/);
});
test('new raw observer canonicalizes actual5-field citations without adding unrelated sources or trusting card labels',async()=>{
 const source={id:'30:2.1',section_id:'30',section:'SYNTHETIC section',ref:'2.1',text:'Synthetic canonical statement about personal insults.',label:'TRUSTED-CANONICAL-LABEL'};
 const five=Object.fromEntries(['id','section_id','section','ref','text'].map(key=>[key,source[key]]));
 const unrelated={...source,id:'30:2.2',ref:'2.2',label:'UNRELATED-LABEL'};
 const input={kind:'report',lang:'en',messages:[{role:'player',text:'A player insulted me in chat.'}]},baseline={lang:'en',category:'report.insult',needs_human:true,citations:[{...five,label:'UNTRUSTED-CARD-LABEL'}],draft_reply:{text:'safe fallback'}};
 const context=buildGenerationInput(input,baseline,[source,unrelated],{proposedFocus:'complaint',focusOrigin:'local_llm'}),plan=planFor(context),raw=[];let pid=1234,closing;
 const runner={get pid(){return pid;},start:async()=>{},tokenCount:async()=>100,complete:async(body,{phase})=>({choices:[{message:{content:JSON.stringify(phase==='focus'?{focus:'complaint'}:plan)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}),terminate(){},close(){return closing??=(async()=>{pid=null;})();},observedMetrics:()=>exit().runtime_usage};
 const activation={family:'pretrained-fewshot',focusProtocol:protocol,focusProtocolSha256:ps,modelSha:P.modelSha,modelMetadata:pretrainedModelMetadata(),configuration:fewshotConfiguration(),headerKVBytes:P.kvBytes,modelBytes:P.modelBytes,validationOnly:true};
 const gen=createTwoPhaseGenerator({config:{enabled:true,timeoutMs:55600,onRawOutput:r=>raw.push(r)},canonicalSources:[source,unrelated]},{freeBytes:()=>2*1024**3,loadActivation:async()=>activation,runnerFactory:()=>runner});
 const result=await gen.generate(input,baseline);await gen.close();assert.equal(result.status,'generated');assert.deepEqual(result.source_ids,['30:2.1']);assert.deepEqual(raw[1].context_basis.citations,[source]);assert.equal(raw[1].context_basis.needs_human,true);assert.ok(!JSON.stringify(raw).includes('UNTRUSTED-CARD-LABEL'));
});
test('operator cannot qualify when every generated case is manually rejected or mislabelled unavailable',()=>{
 for(const decision of ['rejected','unavailable']){
  const b=consistentOperator();b.manualReview.cases.forEach(row=>{row.decision=decision;});
  assert.throws(()=>validateFewshotDocuments(b),decision==='rejected'?/manual22_contextual_intersection/:/generated_is_not_unavailable/);
 }
 const enough=consistentOperator();enough.manualReview.cases[0].decision='rejected';enough.manualReview.cases[1].decision='rejected';
 assert.equal(validateFewshotDocuments(enough).validationOnly,false);
 enough.manualReview.cases[2].decision='rejected';assert.throws(()=>validateFewshotDocuments(enough),/manual22_contextual_intersection/);
});
test('manual acceptance uses the same contextual rows and unavailable cases stay in the fixed24 denominator',()=>{
 const b=consistentOperator();
 for(const row of b.quality.cases.slice(0,2)){
  const m=row.generation.metrics;row.generation.status='unavailable';row.generation.plan=null;m.generated=false;m.plan_origin=null;m.text_origin='baseline_fallback';m.phases.plan={executed:false};row.raw_model_output={};
  b.manualReview.cases.find(review=>review.id===row.id).decision='unavailable';
 }
 b.manualReview.cases.reverse();
 assert.equal(validateFewshotDocuments(b).validationOnly,false);
 const review=validateFewshotManualReview(b.manualReview,b);assert.equal(review.reviewed,24);assert.equal(review.contextually_acceptable_cases,22);
 const falseAcceptance=structuredClone(b);falseAcceptance.manualReview.cases.find(row=>row.id===b.quality.cases[0].id).decision='acceptable';
 assert.throws(()=>validateFewshotDocuments(falseAcceptance),/failed_outcome_decision_mismatch/);
 const intersection=consistentOperator();
 intersection.quality.cases[0].expected.focus='payment';intersection.quality.cases[1].expected.focus='payment';
 intersection.manualReview.cases[2].decision='rejected';intersection.manualReview.cases[3].decision='rejected';
 // Automatic22 and manual22 alone are insufficient: their intersection is20.
 assert.throws(()=>validateFewshotManualReview(intersection.manualReview,intersection),/acceptable_requires_actual_contextual_generation/);
 const failed=structuredClone(b);failed.quality.cases[0].generation.status='quality-failed';
 assert.throws(()=>validateFewshotManualReview(failed.manualReview,failed),/failed_outcome_decision_mismatch/);
 failed.manualReview.cases.find(row=>row.id===failed.quality.cases[0].id).decision='rejected';
 assert.equal(validateFewshotManualReview(failed.manualReview,failed).contextually_acceptable_cases,22);
});
test('benchmark fewshot preregistration shares the fixed root path while legacy stays in models namespace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fewshot-v6-prereg-path-'));await mkdir(join(root,'runtime/models'),{recursive:true});
 const data={schema_only_synthetic_test:true},bytes=JSON.stringify(data),fixed='runtime/fewshot-v7-v6-preregistration.json',legacy='runtime/models/legacy-preregistration.json';
 await writeFile(join(root,fixed),bytes);await writeFile(join(root,legacy),bytes);
 const hint=(schema,path,sha256=hash(bytes))=>({schema_version:schema,preregistration:{path,sha256}});
 assert.deepEqual(await readBenchmarkPreregistration({rootDir:root,activationHint:hint(S.activation,fixed)}),data);
 assert.deepEqual(await readBenchmarkPreregistration({rootDir:root,activationHint:hint('pretrained-generation-activation-v1',legacy)}),data);
 await assert.rejects(readBenchmarkPreregistration({rootDir:root,activationHint:hint(S.activation,legacy)}),/fixed root v6/);
 await assert.rejects(readBenchmarkPreregistration({rootDir:root,activationHint:hint(S.activation,'runtime/another.json')}),/fixed root v6/);
 await assert.rejects(readBenchmarkPreregistration({rootDir:root,activationHint:hint(S.activation,fixed,hash('wrong bytes'))}),/sha_mismatch/);
 await assert.rejects(readBenchmarkPreregistration({rootDir:root,activationHint:hint('pretrained-generation-activation-v1',fixed)}),/outside_namespace/);
 await assert.rejects(readBenchmarkPreregistration({rootDir:root,activationHint:hint('unrecognized',fixed)}),/Unsupported/);
});
test('fewshot benchmark requires exact reference keys and64hex SHA before any metadata file I/O',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fewshot-v6-prereg-sha-')),path='runtime/fewshot-v7-v6-preregistration.json';
 for(const preregistration of [undefined,null,{path},{path,sha256:'a'.repeat(63)},{path,sha256:'z'.repeat(64)},{path,sha256:hash('synthetic'),extra:true},{path:0,sha256:hash('synthetic')}]){
  // No runtime directory/file exists: the expected pointer error precedes I/O.
  await assert.rejects(readBenchmarkPreregistration({rootDir:root,activationHint:{schema_version:S.activation,preregistration}}),/exact trusted preregistration pointer and SHA256/);
 }
 await mkdir(join(root,'runtime'),{recursive:true});const bytes=JSON.stringify({metadata_only_synthetic:true});await writeFile(join(root,path),bytes);
 assert.deepEqual(await readBenchmarkPreregistration({rootDir:root,activationHint:{schema_version:S.activation,preregistration:{path,sha256:hash(bytes)}}}),{metadata_only_synthetic:true});
});
