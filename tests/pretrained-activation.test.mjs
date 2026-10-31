import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRETRAINED_SCHEMA, PRETRAINED_PINS as P, AUTHOR42_LINEAGE_PINS, parsePublishedAuthor42Notebook, pretrainedConfiguration, pretrainedModelMetadata, canonicalCorpusHash, validatePretrainedManifest, validatePretrainedDocuments, validateAuthorQualification, validateIndependentQualification, validateWindowsRuntimeMembership, createPretrainedActivationVerifier } from '../src/intelligence/pretrained-activation.mjs';
import { hash, canonicalHash } from '../src/intelligence/production-closure.mjs';
import { FOCUS_CODES, buildGenerationInput, buildFocusMessages, buildFocusSchema, buildPlanMessages, buildPlanSchema, renderPlan } from '../src/intelligence/generation-contract.mjs';
import { twoPhasePreflight, createTwoPhaseGenerator } from '../src/intelligence/two-phase.mjs';
import { parseInferenceConfig } from '../src/intelligence/config.mjs';

// Invented document-consistency fixtures. They are never local-byte proof,
// calibration measurements, author outcomes or independent quality evidence.
const ref=name=>({path:`runtime/models/synthetic/${name}.json`,sha256:hash(name)});
const pair=name=>({freeze:ref(name+'-freeze'),report:ref(name+'-report'),terminal:ref(name+'-terminal')});
const body=(messages,schema,max,name)=>({model:'synthetic-test-model',messages,max_tokens:max,temperature:0,seed:42,stream:false,response_format:{type:'json_schema',json_schema:{name,strict:true,schema}},chat_template_kwargs:{enable_thinking:false},reasoning_effort:'none'});
const exit=()=>({owned_pid:12345,runtime_pid_after_close:null,double_close_same_promise:true,guard_held_until_close:true,minimum_free_bytes:900*1024**2,preflight_census:[],post_run_census:[],census_usage:{started:2,closed:2,maximum_concurrent:1,owned_pids:[9001,9002],remaining_pid:null},runtime_usage:{exit:{code:null,signal:'SIGTERM'},observed_memory:{peak_private_bytes:400*1024**2,peak_rss_bytes:500*1024**2,sampled_cpu_seconds:1}}});
const planFor=context=>({schema_version:'support-plan-v1',focus:context.allowed_focuses[0],fact_ids:context.facts.map(f=>f.id),request_fields:context.missing_fields,source_ids:context.allowed_sources.map(s=>s.id),needs_human:context.needs_human});
function call(raw,max,request){return{executed:true,raw,output_sha256:hash(raw),finish_reason:'stop',prompt_tokens:100,max_tokens:max,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},elapsed_ms:10,request_sha256:hash(JSON.stringify(request)),tokenizer_parity:true};}
function bundle(){
 const configuration=pretrainedConfiguration(),records=[{path:'src/intelligence/generation-contract.mjs',bytes:10,sha256:hash('factory')}],production={sha256:canonicalHash(records),records};
 const manifest={schema_version:PRETRAINED_SCHEMA,family:'official_pretrained_Q8_to_project_Q4_requantization',scope:'private-validation',root_decision:'approved_for_local_validation',selected_model:{path:'runtime/models/synthetic/model.gguf',sha256:P.modelSha,bytes:P.modelBytes},import_receipt:ref('import'),runtime_closure:{path:'runtime/models/synthetic/windows.json',sha256:P.windowsClosureSha},production_closure:ref('closure'),corpus_sha256:canonicalCorpusHash([]),configuration,bounded_trial:true,memory_profile:null,calibration:null,author_validation:null,preregistration:null,independent_quality:null,project_finetuned:false,training:false,joint100_checkpoint:false,recovered_old20_adapter:false};
 const imported={schema_version:'linux-prebuilt-pretrained17-import-v2',status:'pretrained17_linux_import_integrity_verified_not_quality_verified',actual_local_bytes_verified:true,verification_origin:'bounded_actual_local_source_output_and_companion_bytes',model:{name:'Qwen3-1.7B-Q4_K_M-CPU-requant.gguf',bytes:P.modelBytes,sha256:P.modelSha},project_finetuned:false,joint100_checkpoint:false,activated:false,quality_verified:false,model_loaded:false,derivation:{type:'official_linux_prebuilt_Q8_to_Q4_requant',source_freeze_sha256:P.conversionSourceSha,cpu_helper_sha256:P.cpuHelperSha,linux_tool_host_closure_sha256:P.linuxClosureSha,source:{repo:P.repo,revision:P.revision,source_sha256:P.sourceSha,source_bytes:P.sourceBytes,source_quantization:'Q8_0',quantization:'Q4_K_M',method:'official_pretrained_Q8_to_project_Q4_requantization',project_finetuned:false,recovered_old20_adapter:false,joint100_checkpoint:false,training:false},...Object.fromEntries(['immutable_proof_sha256','linux_asset_sha256','linux_tool_closure_file_sha256','transfer_manifest_sha256','transfer_receipt_sha256'].map(k=>[k,hash(k)]))},windows_runtime:{closure_sha256:P.windowsClosureSha},kv_f16_bytes_at1024:P.kvBytes,tensor_structure_sha256:hash('tensor'),header:{'general.architecture':'qwen3','qwen3.block_count':28,'qwen3.embedding_length':2048,'qwen3.attention.head_count':16,'qwen3.attention.head_count_kv':8,'qwen3.attention.key_length':128,'qwen3.attention.value_length':128}};
 return{manifest,imported,production,configuration,canonicalSources:[],profile:null,calibration:null,author:null,preregistration:null,quality:null,evaluatorSha256:hash('evaluator'),benchmarkSha256:hash('benchmark')};
}
function measured(){
 const b=bundle(),a=b.manifest,c=b.configuration;a.bounded_trial=false;a.memory_profile=ref('profile');a.calibration=pair('calibration');
 const configuration={...c,plan_max_tokens:c.max_tokens,deadline_ms:c.native_budget_ms,total_deadline_ms:c.total_budget_ms,scratch_commit_estimate_bytes:P.scratchBytes};
 const input={kind:'report',lang:'en',messages:[{role:'player',text:'Hello!'}]},context=buildGenerationInput(input,{lang:'en',category:'report.question',needs_human:false,citations:[]},[],{proposedFocus:'clarification',focusOrigin:'predeclared_diagnostic'});
 const bodies={focus:body(buildFocusMessages(input),buildFocusSchema(),32,'support_focus_only'),conditional_plan:body(buildPlanMessages(context),buildPlanSchema(context),192,'support_plan')};
 const source_hashes=Object.fromEntries(b.production.records.map(r=>[r.path,r.sha256])),importSHA=hash(JSON.stringify(b.imported));
 const freeze={source_seal:b.production,selected:Object.fromEntries(['model','header','kv_f16_bytes_at1024','derivation','windows_runtime'].map(key=>[key,b.imported[key]])),configuration,import_receipt_sha256:importSHA,source_hashes,input,context,bodies};
 const phaseTiming={scope_id:'production-matching-calibration-v3',phase_scope:'verification-admission-start-inference-abort-actual-exit-postchecks-persistence',native_phase_started_before_verification:true,terminal_publication_required:true,proof_envelope_scope:'observer-envelope-excluded-from-sampled-phases-included-in-terminal-hard-deadline',semantic_body_ms:20,native_phase_elapsed_ms:100,whole_entry_elapsed_ms:120,preparation_elapsed_ms:20,elapsed_ms:100,total_elapsed_ms:120,phase_components_ms:{verification:10,startup:10,inference:20,cleanup:10,postchecks:10,persistence:10}};
 const report={...exit(),status:'calibration_completed_not_quality',failure:null,selected_model_sha256:P.modelSha,freeze_sha256:a.calibration.freeze.sha256,import_receipt_sha256:importSHA,configuration,source_hashes,elapsed_ms:100,preparation_elapsed_ms:20,total_elapsed_ms:120,preflight:{mode:'explicit_unmeasured_selected1.7_mmap_commit_estimate_trial',header_kv_bytes:P.kvBytes,scratch_commit_estimate_bytes:P.scratchBytes,reserve_bytes:P.reserveBytes,required_free_bytes:P.kvBytes+P.scratchBytes+P.reserveBytes,old_profile_inherited:false,free_bytes:900*1024**2},calls:[{...call(JSON.stringify({focus:'clarification'}),32,bodies.focus),phase:'focus'},{...call(JSON.stringify(planFor(context)),192,bodies.conditional_plan),phase:'conditional_plan'}],forced_timeout:{request_started:true,triggered:true,outcome:'AbortError',elapsed_ms:25}};
 Object.assign(report,structuredClone(phaseTiming),{post_integrity_verified:true});
 const profile={...structuredClone(phaseTiming),schema_version:'Linux-imported17-Windows-memory-profile-v2',actual_native:true,model_sha256:P.modelSha,Linux_derivation_closure_sha256:P.linuxClosureSha,Windows_runtime_closure_sha256:P.windowsClosureSha,context_tokens:1024,mmap:true,no_repack:true,header_kv_bytes:P.kvBytes,quality_verified:false,activated:false,configuration,import_receipt_sha256:importSHA,source_seal_sha256:b.production.sha256,trial_freeze_sha256:a.calibration.freeze.sha256,trial_report_sha256:a.calibration.report.sha256,observed_memory:report.runtime_usage.observed_memory,minimum_free_bytes:report.minimum_free_bytes};
 profile.source_seal=structuredClone(b.production);
 const terminal={schema_version:'calibration-terminal-publication-v1',checked:true,scope_id:'production-matching-calibration-v3',after_publication_native_ms:101,after_publication_whole_ms:121,profile_sha256:a.memory_profile.sha256,report_sha256:a.calibration.report.sha256,freeze_sha256:a.calibration.freeze.sha256,model_sha256:P.modelSha,source_seal_sha256:b.production.sha256,exit_code:0};
 return{...b,profile,calibration:{freeze,report,terminal}};
}
function authored(){
 const b=measured(),a=b.manifest;a.author_validation=pair('author');
 const rows=FOCUS_CODES.flatMap(focus=>Array.from({length:6},(_,i)=>{const input={kind:'report',lang:'en',messages:[{role:'player',text:`Synthetic topic document ${focus} ${i}`}]} ;return{id:`${focus}-${i}`,group_id:`synthetic-${focus}`,provenance:{type:'authored_synthetic',human_reviewed:false,contains_private_data:false},input,expected_focus:focus,body:body(buildFocusMessages(input),buildFocusSchema(),32,'support_focus_only')};}));
 const configuration={context_tokens:1024,threads:2,call_deadline_ms:55600,startup_deadline_ms:55600,cleanup_deadline_ms:55600,cohort_deadline_ms:2520000};
 const freeze={schema_version:'author42-predeclared-focus-only-freeze-v1',no_retry:true,no_retuning:true,no_activation:true,thresholds:{correct:38,denominator:42,per_class_correct:4,per_class_denominator:6},rows,cohort_sha256:canonicalHash(rows),model_sha256:P.modelSha,import_receipt:b.imported,profile:b.profile,source:structuredClone(b.production),configuration};
 const report={...exit(),schema_version:'author42-focus-report-v2',scope_id:'authored-focus42-v2',status:'completed_authored_focus_not_quality',failure:null,post_run_integrity_verified:true,freeze_sha256:a.author_validation.freeze.sha256,selected_model_sha256:P.modelSha,configuration,startup_ms:10,cleanup_ms:10,total_elapsed_ms:450,preflight_elapsed_ms:10,post_integrity_ms:10,report_persistence_ms:10,total_with_prepost_ms:500,proof_bindings:{source_inventory_sha256:freeze.source.sha256,import_receipt_sha256:hash(JSON.stringify(b.imported)),calibration_profile_sha256:a.memory_profile.sha256,calibration_freeze_sha256:a.calibration.freeze.sha256,calibration_report_sha256:a.calibration.report.sha256,Linux_closure:P.linuxClosureSha,Windows_closure:P.windowsClosureSha,model_sha256:P.modelSha,cohort_sha256:freeze.cohort_sha256},results:rows.map(row=>({...call(JSON.stringify({focus:row.expected_focus}),32,row.body),id:row.id,group_id:row.group_id,lang:row.input.lang,provenance:row.provenance,expected_focus:row.expected_focus,status:'completed',attempt:1,request_body:row.body}))};
 const trustedAuthorRows=structuredClone(rows.map(({body,...row})=>row));
 Object.assign(report,{terminal_publication_required:true,proof_envelope_scope:'observer-envelope-excluded-from-sampled-phases-included-in-terminal-hard-deadline'});
 report.proof_bindings.calibration_terminal_sha256=a.calibration.terminal.sha256;
 const terminal={schema_version:'author-terminal-publication-v1',checked:true,scope_id:'authored-focus42-v2',after_publication_whole_ms:501,report_sha256:a.author_validation.report.sha256,freeze_sha256:a.author_validation.freeze.sha256,model_sha256:P.modelSha,source_seal_sha256:b.production.sha256,cohort_sha256:freeze.cohort_sha256,exit_code:0};
 return{...b,author:{freeze,report,terminal},trustedAuthorRows};
}
function qualified({grounded=false}={}){
 const b=authored(),a=b.manifest,c=b.configuration;a.scope='operator-generation';a.root_decision='approved_for_local_operator_generation';a.preregistration=ref('preregistration');a.independent_quality=ref('quality');
 const canonicalSources=grounded?[{id:'30:2.1',section_id:'30',section:'Synthetic canonical test section',ref:'2.1',text:'Synthetic local canonical statement about personal insults.',label:'Synthetic canonical 2.1'}]:[];
 b.canonicalSources=canonicalSources;a.corpus_sha256=canonicalCorpusHash(canonicalSources);
 const preregistration={schema_version:'pretrained-generation-preregistration-v1',root_approved:true,root_decision:'approved_for_one_fresh_independent_run',created_at:'2026-10-31T00:00:00Z',model_sha256:P.modelSha,production_closure_sha256:b.production.sha256,corpus_sha256:a.corpus_sha256,configuration:c,author_report_sha256:a.author_validation.report.sha256,fixture_sha256:hash('invented-24-cases'),evaluator_sha256:b.evaluatorSha256,benchmark_sha256:b.benchmarkSha256,denominator:24,minimum_contextual:22,maximum_safety_violations:0,control_kind:'fresh-independent'};
 const focus=grounded?'complaint':'technical';
 const input={kind:'report',lang:'en',messages:[{role:'player',text:grounded?'A player insulted me in chat.':'My game crashes on PC.'}]},baseline={category:grounded?'report.insult':'report.help',lang:'en',needs_human:false,source_ids:canonicalSources.map(s=>s.id)},context=buildGenerationInput(input,{...baseline,citations:canonicalSources},canonicalSources,{proposedFocus:focus,focusOrigin:'local_llm'}),plan=planFor(context),rendered=renderPlan(plan,context);
 const raw=(phase,text)=>({phase,text,finish_reason:'stop',usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}});
 const cases=Array.from({length:24},(_,i)=>{
  const focusRaw=raw('focus',JSON.stringify({focus})),p=raw('plan',JSON.stringify(plan));p.context_basis={lang:'en',category:baseline.category,needs_human:false,citations:structuredClone(canonicalSources)};
  const metrics={...exit(),model_sha256:P.modelSha,activation_family:'pretrained',native_budget_ms:55600,budget_ms:60000,preparation_ms:20,elapsed_ms:100,total_elapsed_ms:120,executed:true,generated:true,plan_origin:'local_llm',text_origin:'deterministic_renderer',owned_exit_verified:true,source_applicability:context.source_applicability,phases:Object.fromEntries([['focus',focusRaw,32],['plan',p,192]].map(([phase,r,max])=>[phase,{executed:true,max_tokens:max,prompt_tokens:100,finish_reason:'stop',elapsed_ms:20,completion_ms:10,output_sha256:hash(r.text),usage:r.usage}]))};
  return{id:`invented-${i}`,input:structuredClone(input),expected:{focus,needs_human:true,provided_fields:context.provided_fields,request_fields:plan.request_fields,source_ids:plan.source_ids},baseline,original_baseline:baseline,canonical_sources:structuredClone(canonicalSources),whole_elapsed_ms:121,generation:{...rendered,status:'generated',plan,metrics},raw_model_output:{focus:focusRaw,plan:p}};
 });
 const hashes=Object.fromEntries(b.production.records.map(r=>[r.path,r.sha256]));
 const quality={benchmark_schema_version:4,control_kind:'fresh-independent',human_reviewed:false,model:pretrainedModelMetadata(),activation_family:'pretrained',production_closure_sha256:b.production.sha256,candidate_sha256:b.production.sha256,file_hashes:hashes,full_file_hashes:hashes,corpus_sha256:a.corpus_sha256,evaluator_sha256:b.evaluatorSha256,benchmark_sha256:b.benchmarkSha256,production_configuration:c,fixture_sha256:preregistration.fixture_sha256,preregistration_sha256:a.preregistration.sha256,created_at:'2026-10-31T00:01:00Z',cases};
 const independentFixture={provenance:'new_authored_synthetic_consistency_test_only',human_reviewed:false,contract_version:'support-plan-v1',cases:structuredClone(cases.map(row=>({id:row.id,input:row.input,expected:row.expected})))};
 return{...b,preregistration,quality,independentFixture};
}

test('synthetic document consistency is explicitly not proof of actual local bytes',()=>{const b=bundle();assert.deepEqual(validatePretrainedDocuments(b),{documents_consistent:true,actual_local_files_verified:false,validationOnly:true});});
test('pretrained model family has no joint optimizer or fine-tuning assertions',()=>{const m=pretrainedModelMetadata();assert.equal(m.project_finetuned,false);assert.equal(m.training,false);assert.equal(Object.hasOwn(m,'actual_optimizer_steps'),false);assert.equal(P.modelBytes,1107408544);});
test('private bounded trial cannot become ordinary operator activation',()=>{
 const b=bundle();b.manifest.scope='operator-generation';b.manifest.root_decision='approved_for_local_operator_generation';assert.throws(()=>validatePretrainedDocuments(b),/operator_requires_real_qualification/);
 b.manifest.scope='private-validation';b.manifest.root_decision='approved_for_local_validation';b.manifest.bounded_trial=false;assert.throws(()=>validatePretrainedManifest(b.manifest),/bounded_trial_required/);
});
test('wrong model, fake joint fields, proof properties and foreign family reject',()=>{
 for(const change of [a=>a.selected_model.sha256=hash('wrong-model'),a=>a.selected_model.bytes--,a=>a.actual_optimizer_steps=100,a=>a.training=true,a=>a.import_receipt.untrusted=true,a=>a.family='joint100',a=>a.configuration.batch=128]){const b=bundle();change(b.manifest);assert.throws(()=>validatePretrainedDocuments(b));}
 for(const change of [i=>i.derivation.source.repo='fake/publisher',i=>i.derivation.source.project_finetuned=true,i=>i.derivation.cpu_helper_sha256=hash('wrong-helper'),i=>i.header['qwen3.block_count']=16,i=>i.actual_local_bytes_verified=false]){const b=bundle();change(b.imported);assert.throws(()=>validatePretrainedDocuments(b));}
});
test('memory preflight uses selected1.7 header plus256MiB scratch and own measured peak',()=>{
 const a={family:'pretrained',headerKVBytes:P.kvBytes,modelBytes:P.modelBytes,memoryMode:'trial'};const exact=P.kvBytes+P.scratchBytes+P.reserveBytes;
 assert.equal(twoPhasePreflight(a,exact).ok,true);assert.equal(twoPhasePreflight(a,exact-1).ok,false);assert.equal(twoPhasePreflight(a,exact).old_profile_inherited,false);
 a.memoryProfile={observed_memory:{peak_private_bytes:700*1024**2}};assert.equal(twoPhasePreflight(a,1024**3).required_bytes,700*1024**2+P.reserveBytes);
 assert.throws(()=>twoPhasePreflight({...a,headerKVBytes:1}),/header_geometry/);
});
test('own calibration pins raw calls, full source and strict unrounded total budget',()=>{
 assert.equal(validatePretrainedDocuments(measured()).documents_consistent,true);
 for(const change of [b=>b.profile.model_sha256=hash('old06'),b=>b.profile.configuration.ubatch=64,b=>b.calibration.freeze.source_hashes={},b=>b.calibration.report.calls[1].raw='{}',b=>b.calibration.report.total_elapsed_ms=119.999,b=>b.calibration.report.preparation_elapsed_ms=4400.001,b=>b.calibration.report.elapsed_ms=55600.001,b=>b.calibration.report.forced_timeout.triggered=false,b=>b.calibration.report.runtime_usage.exit.signal=null]){const b=measured();change(b);assert.throws(()=>validatePretrainedDocuments(b));}
});
test('author gate recomputes42 raw rows,38 total and4 of6 for every class',()=>{
 const b=authored();assert.equal(validateAuthorQualification(b.author,b.manifest,b.imported,b.production,b.configuration,b.trustedAuthorRows).correct,42);
 for(let i=0;i<3;i++){const c=b.author.report.results[i];c.raw=JSON.stringify({focus:'clarification'});c.output_sha256=hash(c.raw);}assert.throws(()=>validatePretrainedDocuments(b),/every_class4/);
});
test('author copied summaries, missing denominator, usage or full graph cannot qualify',()=>{
 for(const change of [b=>b.author.report.results.pop(),b=>b.author.report.results[0].usage.completion_tokens=0,b=>b.author.freeze.source.records=[],b=>b.author.report.post_run_integrity_verified=false,b=>b.author.report.results[0].request_body.messages[1].content='publisher supplied',b=>b.author.report.results[0].attempt=2]){const b=authored();change(b);assert.throws(()=>validatePretrainedDocuments(b));}
});
test('coherently rehashed author IDs, inputs and targets cannot replace the trusted published42',()=>{
 for(const change of [b=>{b.author.freeze.rows[0].id='invented-outside-published42';b.author.report.results[0].id='invented-outside-published42';},b=>{const row=b.author.freeze.rows[0],result=b.author.report.results[0];row.input.messages[0].text='A newly substituted synthetic input';row.body=body(buildFocusMessages(row.input),buildFocusSchema(),32,'support_focus_only');result.request_body=row.body;result.request_sha256=hash(JSON.stringify(row.body));},b=>{b.author.freeze.rows[0].expected_focus='account';b.author.report.results[0].expected_focus='account';}]){
  const b=authored();change(b);b.author.freeze.cohort_sha256=canonicalHash(b.author.freeze.rows);b.author.report.proof_bindings.cohort_sha256=b.author.freeze.cohort_sha256;b.author.terminal.cohort_sha256=b.author.freeze.cohort_sha256;b.manifest.author_validation.freeze.sha256=hash(JSON.stringify(b.author.freeze));b.author.report.freeze_sha256=b.manifest.author_validation.freeze.sha256;b.author.terminal.freeze_sha256=b.manifest.author_validation.freeze.sha256;b.manifest.author_validation.report.sha256=hash(JSON.stringify(b.author.report));b.author.terminal.report_sha256=b.manifest.author_validation.report.sha256;
  assert.throws(()=>validatePretrainedDocuments(b),/published_identity_input_or_target_changed/);
 }
 const missing=authored();delete missing.trustedAuthorRows;assert.throws(()=>validatePretrainedDocuments(missing),/trusted_published_author42_identity_required/);
});
test('author raw startup, cleanup and complete duration sums are finite, capped and unrounded',()=>{
 for(const change of [r=>{r.startup_ms=55601;r.total_elapsed_ms=60000;r.total_with_prepost_ms=60100;},r=>{r.cleanup_ms=55601;r.total_elapsed_ms=60000;r.total_with_prepost_ms=60100;},r=>r.total_with_prepost_ms=1,r=>r.total_elapsed_ms=439.999,r=>r.preflight_elapsed_ms=1000,r=>r.cleanup_ms=-1,r=>r.startup_ms=NaN]){const b=authored();change(b.author.report);assert.throws(()=>validatePretrainedDocuments(b),/author_raw_phase_budget_or_sum_mismatch/);}
 const exact=authored();exact.author.report.total_elapsed_ms=440;exact.author.report.total_with_prepost_ms=470;assert.equal(validatePretrainedDocuments(exact).documents_consistent,true);
});
test('public fresh whole time covers rounded generator time within at most1ms, with strict caps',()=>{
 const exact=qualified();exact.quality.cases[0].whole_elapsed_ms=119;assert.equal(validatePretrainedDocuments(exact).documents_consistent,true);
 for(const value of [1,118.999,60000.001]){const b=qualified();b.quality.cases[0].whole_elapsed_ms=value;assert.throws(()=>validatePretrainedDocuments(b),/actual_whole_budget_required/);}
});
test('calibration-v3 rejects old phase meanings, alias edits and component overruns without rounding tolerance',()=>{
 for(const change of [b=>b.profile.schema_version='Linux-imported17-Windows-memory-profile-v1',b=>b.calibration.report.native_phase_started_before_verification=false,b=>b.calibration.report.elapsed_ms=99.999,b=>b.profile.semantic_body_ms=21,b=>b.calibration.report.phase_components_ms.verification=100,b=>b.calibration.report.phase_components_ms.persistence=-1,b=>b.calibration.report.whole_entry_elapsed_ms=119.999,b=>b.calibration.report.proof_envelope_scope='all final writes magically sampled']){const b=measured();change(b);assert.throws(()=>validatePretrainedDocuments(b));}
});
test('calibration requires verified post-integrity and an exercised25ms forced timeout',()=>{
 assert.equal(validatePretrainedDocuments(measured()).documents_consistent,true);
 for(const value of [false,undefined]){const b=measured();b.calibration.report.post_integrity_verified=value;assert.throws(()=>validatePretrainedDocuments(b),/calibration_operational_budget_failed/);}
 for(const value of [1,24.999]){const b=measured();b.calibration.report.forced_timeout.elapsed_ms=value;assert.throws(()=>validatePretrainedDocuments(b),/calibration_actual_forced_timeout_required/);}
 const exact=measured();exact.calibration.report.forced_timeout.elapsed_ms=25;assert.equal(validatePretrainedDocuments(exact).documents_consistent,true);
});
test('calibration requires exact separately captured terminal bytes and postpublication hard caps',()=>{
 for(const change of [b=>delete b.manifest.calibration.terminal,b=>b.calibration.terminal=null,b=>b.profile.terminal_publication_required=false,b=>b.calibration.terminal.checked=false,b=>b.calibration.terminal.profile_sha256=hash('other-profile'),b=>b.calibration.terminal.source_seal_sha256=hash('old-subset'),b=>b.calibration.terminal.after_publication_native_ms=55600.001,b=>b.calibration.terminal.after_publication_whole_ms=60000.001,b=>b.calibration.terminal.after_publication_native_ms=99,b=>b.calibration.terminal.exit_code=1]){const b=measured();change(b);assert.throws(()=>validatePretrainedDocuments(b));}
});
test('author terminal capture and serialized census lifecycle are mandatory qualifications',()=>{
 for(const change of [b=>b.author.terminal.after_publication_whole_ms=499,b=>b.author.terminal.after_publication_whole_ms=2520000.001,b=>b.author.terminal.cohort_sha256=hash('different-cohort'),b=>b.author.terminal.checked=false,b=>delete b.manifest.author_validation.terminal,b=>b.author.report.census_usage.maximum_concurrent=2,b=>b.author.report.census_usage.closed=1,b=>b.author.report.census_usage.remaining_pid=9002,b=>b.calibration.report.census_usage.owned_pids=[],b=>b.author.report.proof_bindings.calibration_terminal_sha256=hash('other-capture'),b=>b.profile.source_seal.records=[]]){const b=authored();change(b);assert.throws(()=>validatePretrainedDocuments(b));}
});
test('published author parser is hash pinned and never accepts executable notebook substitutions',()=>{
 assert.ok(Object.values(AUTHOR42_LINEAGE_PINS).every(pin=>/^[a-f0-9]{64}$/u.test(pin)));
 assert.equal(AUTHOR42_LINEAGE_PINS.bundle_sha256,'fe6f1ca67b32eef2568beee84091c0196372e91d6b4eb586e5367f7c9e44cc15');
 for(const bytes of [Buffer.from('{}'),JSON.stringify({nbformat:4,cells:[{cell_type:'code',source:'BUNDLE_JSON = __import__("os").system("do-not-execute")'}]})])assert.throws(()=>parsePublishedAuthor42Notebook(bytes),/notebook_pin_required/);
});
test('operator consistency requires complete fresh24 evidence after author and root preregistration',()=>{const b=qualified();assert.equal(validatePretrainedDocuments(b).validationOnly,false);assert.equal(validateIndependentQualification(b.quality,b.preregistration,b).contextual_useful_cases,24);});
test('fresh quality rejects fake summary, source subset, wrong model, copied raw output and human reduction',()=>{
 for(const change of [b=>b.quality.cases.pop(),b=>b.quality.candidate_sha256=hash('old5'),b=>b.quality.full_file_hashes={},b=>b.quality.cases[0].raw_model_output.plan.text='{}',b=>b.quality.cases[0].generation.metrics.executed=false,b=>b.quality.cases[0].original_baseline.needs_human=true,b=>b.quality.cases[0].generation.text+=' rule999',b=>b.preregistration.author_report_sha256=hash('other-author'),b=>b.quality.cases[0].generation.metrics.runtime_pid_after_close=999,b=>b.quality.cases[0].expected.focus='payment']){const b=qualified();change(b);assert.throws(()=>validatePretrainedDocuments(b));}
});
test('rounded production timing permits1ms sum error but never a cap overrun',()=>{
 const b=qualified();b.quality.cases[0].generation.metrics.total_elapsed_ms=121;assert.equal(validatePretrainedDocuments(b).documents_consistent,true);
 for(const change of [m=>m.total_elapsed_ms=122,m=>m.elapsed_ms=55601,m=>m.preparation_ms=4401,m=>m.budget_ms=60001]){const b=qualified();change(b.quality.cases[0].generation.metrics);assert.throws(()=>validatePretrainedDocuments(b));}
});
test('a report card cannot replace trusted canonical labels or widen applicability',()=>{
 const valid=qualified({grounded:true});assert.equal(valid.quality.cases[0].generation.source_ids[0],'30:2.1');assert.equal(validatePretrainedDocuments(valid).documents_consistent,true);
 for(const field of ['label','text','section','section_id','ref']){const b=qualified({grounded:true}),row=b.quality.cases[0];row.canonical_sources[0][field]='publisher-invented';row.raw_model_output.plan.context_basis.citations[0][field]='publisher-invented';assert.throws(()=>validatePretrainedDocuments(b),/not_in_trusted_live_corpus/);}
 const b=qualified({grounded:true}),row=b.quality.cases[0];row.input.messages[0].text='He did not insult me.';b.independentFixture.cases[0].input=structuredClone(row.input);assert.throws(()=>validatePretrainedDocuments(b),/closed_context_or_render_mismatch/);
});
test('all51 Windows binary members are required including siblings beyond llama-server',async()=>{
 const files=Object.fromEntries(Array.from({length:50},(_,i)=>[`synthetic-${i}.dll`,{bytes:100,sha256:hash(String(i))}]));files['llama-server.exe']={bytes:100,sha256:P.runtimeSha};
 const receipt={schema_version:'official-toolkit-file-closure-v1',archive_sha256:P.windowsArchiveSha,release:'b11960',all_binary_files_match_archive:true,files},names=Object.keys(receipt.files);validateWindowsRuntimeMembership(receipt,names);
 assert.throws(()=>validateWindowsRuntimeMembership(receipt,names.slice(1)),/membership/);assert.throws(()=>validateWindowsRuntimeMembership(receipt,[...names,'unapproved.dll']),/membership/);
 const bad=structuredClone(receipt);bad.files['llama-server.exe'].sha256=hash('fake');assert.throws(()=>validateWindowsRuntimeMembership(bad,names),/pinned_pretrained_server/);
});
test('ordinary startup accepts typed operator schema only with its effective whole budget',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pretrained-parser-')),file=join(directory,'manifest.json'),b=qualified();await writeFile(file,JSON.stringify(b.manifest));
 const env={LOCAL_GENERATOR:'1',GENERATOR_FOCUS_MODE:'model',TRIAGE_DRAFT_MODE:'native',GENERATOR_ACTIVATION_MANIFEST:file};assert.equal(parseInferenceConfig(env).generatorConfig.requiredActivationScope,'operator-generation');
 assert.throws(()=>parseInferenceConfig({...env,GENERATOR_TIMEOUT_MS:'4400'}),/no bounded native phase/);assert.throws(()=>parseInferenceConfig({...env,GENERATOR_TIMEOUT_MS:'50000'}),/configuration_mismatch/);
 b.manifest.scope='private-validation';await writeFile(file,JSON.stringify(b.manifest));assert.throws(()=>parseInferenceConfig(env),/operator-generation/);
});
test('fabricated publisher documents cannot activate a runtime without actual frozen bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pretrained-no-bytes-'));await mkdir(join(root,'runtime/models'),{recursive:true});const b=bundle();await writeFile(join(root,'runtime/models/activation.json'),JSON.stringify(b.manifest));
 const verify=createPretrainedActivationVerifier({enabled:true,focusMode:'model',timeoutMs:55600,activationManifestPath:'runtime/models/activation.json'},{rootDir:root});await assert.rejects(verify({}),/ENOENT/);
});

function injectedRuntime({badClose=false,wrongBudget=false}={}){
 let pid=12345,closing;const events=[],observations=[];
 const activation={family:'pretrained',validationOnly:true,modelSha:P.modelSha,modelBytes:P.modelBytes,modelMetadata:pretrainedModelMetadata(),configuration:pretrainedConfiguration(wrongBudget?50000:55600),headerKVBytes:P.kvBytes,memoryMode:'synthetic_injected_only',production_closure_sha256:hash('test-source')};
 const runner={get pid(){return pid;},start:async()=>events.push('start'),tokenCount:async()=>100,complete:async(value,{phase})=>{
  events.push(phase);let content;
  if(phase==='focus')content={focus:'technical'};else{const c=JSON.parse(value.messages[1].content.split('\n/no_think')[0]);content={schema_version:'support-plan-v1',focus:c.allowed_focus,fact_ids:c.facts.map(f=>f.id),request_fields:c.missing_fields,source_ids:c.source_ids,needs_human:c.needs_human};}
  return{choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}};
 },terminate:()=>events.push('terminate'),close:()=>{if(badClose){pid=null;return Promise.resolve();}return closing||=(async()=>{events.push('exit');pid=null;})();},observedMetrics:()=>exit().runtime_usage};
 const generator=createTwoPhaseGenerator({config:{enabled:true,focusMode:'model',timeoutMs:55600,onRawOutput:event=>observations.push(event)},canonicalSources:[],releaseResources:async()=>events.push('restore')},{loadActivation:async()=>activation,freeBytes:()=>1024**3,runnerFactory:()=>runner});
 return{generator,events,observations};
}
test('injected pretrained runtime keeps actual raw basis, closes once and emits no joint metadata',async()=>{
 const f=injectedRuntime(),input={kind:'report',lang:'kk',messages:[{role:'player',text:'My game crashes on PC.'}]},baseline={lang:'kk',category:'report.help',needs_human:true,citations:[],draft_reply:{text:'safe baseline'}};
 try{const out=await f.generator.generate(input,baseline);assert.equal(out.status,'generated');assert.equal(out.lang,'kk');assert.equal(out.needs_human,true);assert.equal(out.metrics.activation_family,'pretrained');assert.equal(out.metrics.model_metadata.project_finetuned,false);assert.equal(Object.hasOwn(out.metrics,'actual_optimizer_steps'),false);assert.equal(out.metrics.owned_exit_verified,true);assert.ok(f.events.indexOf('exit')<f.events.indexOf('restore'));assert.equal(f.observations[0].context_basis,undefined);assert.deepEqual(f.observations[1].context_basis,{lang:'kk',category:'report.help',needs_human:true,citations:[]});}finally{await f.generator.close();}
});
test('injected pretrained rejects budget mismatch before spawn and unverified close before acceptance',async()=>{
 const input={kind:'report',lang:'en',messages:[{role:'player',text:'My game crashes.'}]},baseline={lang:'en',category:'report.help',needs_human:false,citations:[],draft_reply:{text:'safe fallback'}};
 for(const options of [{wrongBudget:true},{badClose:true}]){const f=injectedRuntime(options);try{const out=await f.generator.generate(input,baseline);assert.equal(out.status,'unavailable');assert.equal(out.text,'safe fallback');assert.equal(out.metrics.generated,false);assert.equal(Object.hasOwn(out,'plan'),false);if(options.wrongBudget){assert.equal(f.events.includes('start'),false);assert.equal(out.metrics.executed,false);}else assert.equal(out.metrics.owned_exit_verified,false);}finally{await f.generator.close();}}
});
