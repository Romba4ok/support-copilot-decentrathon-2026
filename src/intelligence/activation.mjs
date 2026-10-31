import {readFile,lstat,realpath,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {FOCUS_SCHEMA_VERSION,PLAN_SCHEMA_VERSION,FOCUS_SYSTEM_PROMPT,PLAN_SYSTEM_PROMPT,validateFocus} from './generation-contract.mjs';
import {summarizePlanRows} from './generation-evaluation.mjs';
const APP_ROOT=fileURLToPath(new URL('../../',import.meta.url));
const BASE='Qwen/Qwen3-0.6B',REVISION='c1899de289a04d12100db370d81485cdf75e47ca';
const FACTORY_SHA='6bc4d60353c0eaaabb4d70894aa15eb1b42602be0025211c4e97056cedbf721b';
const PINNED_RUNTIME_SHA='81f65c6681d66099e5d48757aa2c050ba958dc43816e584f0bb4181eb7c910d8';
const RUNTIME_FILES=['src/intelligence/generation-contract.mjs','src/intelligence/generator.mjs','src/intelligence/two-phase.mjs','src/intelligence/native-session.mjs','src/intelligence/activation.mjs'];
const WEIGHTS=['baseline-Q4_K_M.gguf','adapter-Q4_K_M.gguf'];
const DOCUMENTS=['export-progress.json','run-manifest.json','baseline-holdout.json','adapter-holdout.json'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const validSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const requireProof=(condition,reason)=>{if(!condition)throw new Error(reason);};
const within=(root,path)=>{const value=relative(root,path);return value!==''&&!value.startsWith('..')&&!isAbsolute(value);};
const sameSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&b.every(v=>a.includes(v));
const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** Coherence of an already hash-bound local receipt, not proof from a client. */
export function coherentTwoPhaseExecution(row){
  const g=row?.generation,m=g?.metrics,phases=m?.phases;
  if(!m||!phases||typeof m.executed!=='boolean'||m.generated!==(g.status==='generated'))return false;
  if(m.executed!==(phases.focus?.executed===true||phases.plan?.executed===true))return false;
  if(g.status!=='generated')return true;
  if(m.executed!==true||m.plan_origin!=='local_llm'||m.text_origin!=='deterministic_renderer'||!finite(m.elapsed_ms)||m.elapsed_ms<0)return false;
  for(const [phase,max]of [['focus',32],['plan',192]]){
    const p=phases[phase],raw=row.raw_model_output?.[phase],usage=p?.usage;
    if(p?.executed!==true||p.max_tokens!==max||!Number.isInteger(p.prompt_tokens)||p.prompt_tokens<1||p.prompt_tokens+max+8>1024)return false;
    if(p.finish_reason!=='stop'||!finite(p.elapsed_ms)||p.elapsed_ms<0||p.elapsed_ms>m.elapsed_ms||!finite(p.completion_ms)||p.completion_ms<0||p.completion_ms>p.elapsed_ms)return false;
    if(!raw||raw.phase!==phase||raw.finish_reason!=='stop'||typeof raw.text!=='string'||!raw.text.length||raw.text.length>65536||!validSha(p.output_sha256)||sha(raw.text)!==p.output_sha256)return false;
    if(!usage||usage.prompt_tokens!==p.prompt_tokens||!Number.isInteger(usage.completion_tokens)||usage.completion_tokens<1||usage.completion_tokens>max)return false;
    if(raw.usage?.prompt_tokens!==usage.prompt_tokens||raw.usage?.completion_tokens!==usage.completion_tokens)return false;
    for(const u of [usage,raw.usage])if(u.total_tokens!==undefined&&u.total_tokens!==u.prompt_tokens+u.completion_tokens)return false;
  }
  const focus=validateFocus(row.raw_model_output.focus.text);if(!focus.ok||focus.value.focus!==g.plan?.focus)return false;
  try{if(JSON.stringify(JSON.parse(row.raw_model_output.plan.text))!==JSON.stringify(g.plan))return false;}catch{return false;}
  return true;
}

export function createActivationVerifier(config,{rootDir=APP_ROOT,runtimeSha256=PINNED_RUNTIME_SHA}={}){
  const root=resolve(rootDir),models=resolve(root,'runtime/models'),tools=resolve(root,'runtime/tools');
  let cached=null,loading=null;
  const fingerprints=[];
  async function regular(path,space,maxBytes){
    const resolved=resolve(path),stat=await lstat(resolved);
    requireProof(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=maxBytes,'activation_file_not_regular_or_bounded');
    const actual=await realpath(resolved),spaceActual=await realpath(space);
    requireProof(within(spaceActual,actual),'activation_path_outside_project_namespace');
    fingerprints.push({path:resolved,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,ino:stat.ino});
    return{path:actual,stat};
  }
  async function hashed(path,space,maxBytes,expected,signal){
    requireProof(validSha(expected),'activation_expected_sha_required');
    const item=await regular(path,space,maxBytes),hash=createHash('sha256');
    for await(const chunk of createReadStream(item.path,{highWaterMark:1024*1024,signal}))hash.update(chunk);
    requireProof(hash.digest('hex')===expected,'activation_file_sha_mismatch');
    return item;
  }
  async function json(path,space,maxBytes,expected,signal){const item=await hashed(path,space,maxBytes,expected,signal);const value=JSON.parse(await readFile(item.path,'utf8'));requireProof(value&&typeof value==='object'&&!Array.isArray(value),'activation_json_object_required');return value;}
  async function load({signal}={}){
    requireProof(config?.enabled===true&&config.focusMode==='model','model_mode_not_enabled');
    requireProof(typeof config.activationManifestPath==='string'&&config.activationManifestPath.length>0,'Model focus is not activated: an explicit trusted startup activation manifest is required');
    const activationFile=await regular(resolve(root,config.activationManifestPath),models,256*1024);
    const activationBytes=await readFile(activationFile.path),activationSha=sha(activationBytes);
    if(config.activationManifestSha256!==undefined)requireProof(validSha(config.activationManifestSha256)&&activationSha===config.activationManifestSha256,'activation_manifest_sha_mismatch');
    const a=JSON.parse(activationBytes.toString('utf8'));
    requireProof(a&&typeof a==='object'&&!Array.isArray(a),'activation_json_object_required');
    if(config.requiredActivationScope!==undefined)requireProof(['private-validation','operator-generation'].includes(config.requiredActivationScope)&&config.requiredActivationScope===a.scope,'required_activation_scope_mismatch');
    if(config.activationScope!==undefined)requireProof(config.activationScope===a.scope,'activation_scope_override_mismatch');
    const validation=a.scope==='private-validation'&&a.root_decision==='approved_for_local_validation';
    const operator=a.scope==='operator-generation'&&a.root_decision==='approved_for_local_experiment';
    requireProof(a.schema_version==='joint-generation-activation-v1'&&(validation||operator),'explicit_root_scope_decision_required');
    requireProof(['baseline','adapter'].includes(a.selected_variant),'paired_model_variant_required');
    const imported=await json(resolve(root,a.import_manifest?.path||''),models,8*1024**2,a.import_manifest?.sha256,signal);
    requireProof(imported.status==='imported_integrity_verified_not_quality_verified'&&imported.integrity_verified===true&&imported.archive_integrity_verified===true&&imported.activated===false&&imported.published===false,'verified_unactivated_pair_import_required');
    requireProof(imported.base_model===BASE&&imported.base_revision===REVISION&&imported.provenance==='authored_synthetic','paired_base_provenance_mismatch');
    const pairDir=await realpath(dirname(resolve(root,a.import_manifest.path)));
    requireProof(resolve(imported.destination)===pairDir&&sameSet(Object.keys(imported.files||{}),[...WEIGHTS,...DOCUMENTS]),'paired_import_layout_mismatch');
    const docs={},actualPaths={};
    for(const name of [...WEIGHTS,...DOCUMENTS]){
      const record=imported.files[name],path=resolve(pairDir,name);
      requireProof(record&&Number.isInteger(record.bytes)&&record.bytes>0,'paired_file_record_invalid');
      const item=await hashed(path,models,WEIGHTS.includes(name)?1024**3:8*1024**2,record.sha256,signal);
      requireProof(item.stat.size===record.bytes&&resolve(record.local_path)===item.path,'paired_file_size_or_path_mismatch');actualPaths[name]=item.path;
      if(WEIGHTS.includes(name)){const handle=await open(item.path,'r');try{const magic=Buffer.alloc(4);await handle.read(magic,0,4,0);requireProof(magic.toString()==='GGUF','paired_weight_magic_invalid');}finally{await handle.close();}}
      else docs[name]=JSON.parse(await readFile(item.path,'utf8'));
    }
    const run=docs['run-manifest.json'],proof=docs['export-progress.json'],identity=run.identity||{};
    requireProof(run.status==='completed'&&run.actual_training===true&&run.weights_saved===true&&run.weights_changed===true&&run.cloud_eligible===true&&run.provenance==='authored_synthetic','completed_changed_joint_training_required');
    requireProof(run.base_model===BASE&&run.base_revision===REVISION&&identity.base_model===BASE&&identity.base_revision===REVISION,'exact_float_base_revision_required');
    requireProof(Number.isInteger(run.optimizer_steps)&&run.optimizer_steps>=20&&run.optimizer_steps<=100&&proof.actual_optimizer_steps===run.optimizer_steps&&imported.actual_optimizer_steps===run.optimizer_steps,'bounded_optimizer_step_proof_mismatch');
    requireProof(run.optimizer_steps===100&&run.optimizer_attempts===100&&run.skipped_optimizer_updates===0&&identity.joint_steps===100&&identity.optimizer_accounting==='underlying_nonfused_step_post_hook_v1'&&run.optimizer_step_hook==='torch_optimizer_register_step_post_hook'&&run.underlying_optimizer_class==='AdamW'&&run.adapter_weights_finite===true&&run.finite_training_loss===true,'actual_joint_optimizer_updates_and_finite_weights_required');
    requireProof(validSha(run.initial_adapter_sha256)&&validSha(run.adapter_sha256)&&run.initial_adapter_sha256!==run.adapter_sha256&&finite(run.trainer_metrics?.train_loss),'changed_finite_adapter_proof_required');
    requireProof(identity.dataset_schema_version===3&&identity.focus_schema_version===FOCUS_SCHEMA_VERSION&&identity.plan_schema_version===PLAN_SCHEMA_VERSION,'joint_classification_and_plan_identity_required');
    requireProof(validSha(identity.source_identity_sha256)&&identity.source_identity_sha256===sha(JSON.stringify(identity.source_sha256))&&identity.source_identity_sha256===a.expected_source_identity_sha256,'joint_source_identity_mismatch');
    const currentFactory=await readFile(resolve(root,'src/intelligence/generation-contract.mjs'));
    requireProof(sha(currentFactory)===FACTORY_SHA&&identity.factory_source_sha256===FACTORY_SHA&&identity.source_sha256?.['src/intelligence/generation-contract.mjs']===FACTORY_SHA&&imported.factory_source_sha256===FACTORY_SHA&&proof.factory_source_sha256===FACTORY_SHA,'frozen_factory_identity_mismatch');
    // Training's generator hash is historical provenance, not the later runtime.
    requireProof(validSha(a.expected_training_generator_sha256)&&identity.runtime_generator_sha256===a.expected_training_generator_sha256&&identity.source_sha256?.['src/intelligence/generator.mjs']===a.expected_training_generator_sha256,'historical_training_generator_identity_mismatch');
    requireProof(identity.prompt_sha256?.[FOCUS_SCHEMA_VERSION]===sha(FOCUS_SYSTEM_PROMPT)&&identity.prompt_sha256?.[PLAN_SCHEMA_VERSION]===sha(PLAN_SYSTEM_PROMPT),'joint_prompt_identity_mismatch');
    requireProof(validSha(a.expected_dataset_fingerprint)&&run.dataset_fingerprint===a.expected_dataset_fingerprint&&identity.dataset_fingerprint===a.expected_dataset_fingerprint&&imported.dataset_fingerprint===a.expected_dataset_fingerprint&&proof.dataset_fingerprint===a.expected_dataset_fingerprint,'paired_dataset_identity_mismatch');
    requireProof(proof.status==='paired_gguf_ready_not_quality_verified'&&proof.base_model===BASE&&proof.base_revision===REVISION&&proof.provenance==='authored_synthetic'&&proof.human_reviewed===false&&proof.activated===false&&proof.published===false&&proof.llama_tag==='b11960'&&proof.quantization==='Q4_K_M'&&proof.run_manifest_sha256===imported.files['run-manifest.json'].sha256&&imported.run_manifest_sha256===proof.run_manifest_sha256,'paired_export_identity_mismatch');
    requireProof(/^[a-f0-9]{40}$/u.test(proof.llama_commit||'')&&validSha(proof.quantizer_sha256)&&sameSet(Object.keys(proof.files||{}),[...WEIGHTS,'baseline-F16.gguf','adapter-F16.gguf']),'paired_float_export_lineage_required');
    for(const name of ['baseline-F16.gguf','adapter-F16.gguf'])requireProof(validSha(proof.files[name].sha256)&&Number.isInteger(proof.files[name].bytes)&&proof.files[name].bytes>0&&proof.files[name].bytes<=4*1024**3,'bounded_remote_float_proof_required');
    requireProof(imported.derivation?.safe_adapter_merge===true&&imported.derivation?.float_base_revision===REVISION&&imported.derivation?.intermediate_type==='F16'&&imported.derivation?.quantization==='Q4_K_M'&&imported.derivation?.llama_tag==='b11960'&&imported.derivation?.remote_f16_content_verified_locally===false,'safe_float_merge_derivation_required');
    for(const name of WEIGHTS)requireProof(proof.files?.[name]?.sha256===imported.files[name].sha256&&proof.files[name].bytes===imported.files[name].bytes,'paired_quantized_weight_lineage_mismatch');
    let pairedIds;
    for(const variant of ['baseline','adapter']){
      const h=docs[`${variant}-holdout.json`];
      requireProof(h.variant===variant&&h.provenance==='authored_synthetic'&&h.human_reviewed===false&&h.denominator===54&&Array.isArray(h.rows)&&h.rows.length===54,'paired_joint_holdout_required');
      const ids=h.rows.map(row=>`${row.id}:${row.lang}:${row.task_type}`);
      requireProof(new Set(ids).size===54&&h.rows.filter(row=>row.task_type===FOCUS_SCHEMA_VERSION).length===42&&h.rows.filter(row=>row.task_type===PLAN_SCHEMA_VERSION).length===12&&h.tasks?.[FOCUS_SCHEMA_VERSION]?.denominator===42&&h.tasks?.[PLAN_SCHEMA_VERSION]?.denominator===12,'separate_joint_task_reports_required');
      if(pairedIds)requireProof(JSON.stringify(ids)===JSON.stringify(pairedIds),'holdout_pairs_do_not_match');pairedIds=ids;
    }
    const selectedName=`${a.selected_variant}-Q4_K_M.gguf`,modelPath=actualPaths[selectedName],modelSha=imported.files[selectedName].sha256;
    requireProof(typeof a.selected_model_path==='string'&&await realpath(resolve(root,a.selected_model_path))===modelPath&&a.selected_model_sha256===modelSha,'explicit_selected_model_mismatch');
    if(config.modelPath!==undefined)requireProof(typeof config.modelPath==='string'&&await realpath(resolve(root,config.modelPath))===modelPath,'model_path_override_mismatch');
    requireProof(a.runtime?.tag==='b11960'&&typeof a.runtime.path==='string','pinned_project_runtime_required');
    requireProof(a.runtime.sha256===runtimeSha256,'official_pinned_runtime_sha_required');
    const runtimePath=resolve(root,a.runtime.path);
    if(config.runtimePath!==undefined)requireProof(resolve(root,config.runtimePath)===runtimePath,'runtime_path_override_mismatch');
    await hashed(runtimePath,tools,100*1024**2,a.runtime.sha256,signal);
    let measured=false,memoryProfile=null;
    if(a.memory_profile){
      memoryProfile=await json(resolve(root,a.memory_profile.path),models,2*1024**2,a.memory_profile.sha256,signal);
      requireProof(memoryProfile.schema_version==='generation-memory-profile-v1'&&memoryProfile.actual_native===true&&memoryProfile.model_sha256===modelSha&&memoryProfile.runtime_sha256===a.runtime.sha256&&memoryProfile.context_tokens===1024&&memoryProfile.no_repack===true&&finite(memoryProfile.minimum_free_bytes)&&memoryProfile.minimum_free_bytes>=256*1024**2&&finite(memoryProfile.observed_memory?.peak_rss_bytes)&&memoryProfile.observed_memory.peak_rss_bytes>0&&finite(memoryProfile.observed_memory?.peak_private_bytes)&&memoryProfile.observed_memory.peak_private_bytes>0,'selected_model_memory_profile_mismatch');measured=true;
    }
    requireProof(measured||validation&&a.bounded_mmap_trial===true,'selected_model_memory_measurement_or_root_trial_required');
    if(operator){
      requireProof(a.local_quality&&typeof a.local_quality.path==='string','operator_quality_receipt_required');
      const quality=await json(resolve(root,a.local_quality.path),models,16*1024**2,a.local_quality.sha256,signal);
      requireProof(quality.evaluator_sha256===sha(await readFile(resolve(root,'src/intelligence/generation-evaluation.mjs')))&&quality.benchmark_sha256===sha(await readFile(resolve(root,'scripts/benchmark-generator.mjs'))),'local_quality_evaluation_source_mismatch');
      requireProof(quality.control_kind==='fresh-independent'&&quality.human_reviewed===false&&quality.model?.sha256===modelSha&&quality.file_hashes?.['src/intelligence/generation-contract.mjs']===FACTORY_SHA&&Array.isArray(quality.cases)&&quality.cases.length===24,'independent_local_joint_quality_required');
      const settings=quality.configuration;
      requireProof(settings?.focus_mode==='model'&&settings.context_tokens===1024&&settings.focus_max_tokens===32&&settings.max_tokens===192&&settings.threads===2&&finite(settings.timeout_ms)&&settings.timeout_ms>=1&&settings.timeout_ms<=60000&&settings.thinking===false&&settings.mmap===true&&settings.no_repack===true,'actual_two_phase_quality_configuration_required');
      for(const source of RUNTIME_FILES)requireProof(quality.file_hashes?.[source]===sha(await readFile(resolve(root,source))),'local_quality_runtime_source_mismatch');
      requireProof(quality.candidate_sha256===sha(JSON.stringify(Object.fromEntries(RUNTIME_FILES.map(source=>[source,quality.file_hashes[source]])))),'local_quality_candidate_identity_mismatch');
      requireProof(quality.cases.every(row=>row.generation?.metrics?.model_sha256===modelSha&&(row.generation.status!=='generated'||row.generation.metrics?.phases?.focus?.executed===true&&row.generation.metrics?.phases?.plan?.executed===true)),'actual_two_phase_local_quality_required');
      requireProof(quality.cases.every(coherentTwoPhaseExecution),'actual_two_phase_execution_evidence_incoherent');
      const summary=summarizePlanRows(quality.cases,{controlKind:'fresh-independent'});requireProof(summary.contextual_passed===true&&summary.schema_acceptance_passed===true&&summary.global_known_safety_violations===0,'local_joint_quality_failed');
    }
    return{modelPath,runtimePath,modelSha,modelBytes:imported.files[selectedName].bytes,validationOnly:validation,memoryMode:measured?'measured_selected_model':'explicit_private_mmap_trial',memoryProfile,modelMetadata:{id:`${BASE}:joint-${a.selected_variant}-Q4_K_M`,sha256:modelSha,quantization:'Q4_K_M',provenance:'verified_own_paired_float_to_Q4'},activation_sha256:activationSha,pair_manifest_sha256:a.import_manifest.sha256,training_source_identity_sha256:identity.source_identity_sha256,training_generator_sha256:identity.runtime_generator_sha256,actual_optimizer_steps:run.optimizer_steps};
  }
  return async options=>{
    if(cached){for(const before of fingerprints){const after=await lstat(before.path);requireProof(after.isFile()&&!after.isSymbolicLink()&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&after.ino===before.ino,'verified_activation_files_changed');}return cached;}
    if(!loading)loading=load(options).then(value=>(cached=value)).catch(error=>{loading=null;fingerprints.length=0;throw error;});return loading;
  };
}
