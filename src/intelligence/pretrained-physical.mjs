import { readFile, open, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, basename } from 'node:path';
import { PRETRAINED_PINS as P, validateImport, validateWindowsRuntimeMembership, ownedExit } from './pretrained-activation.mjs';
import { APP_ROOT, readTrustedJson, verifyRegularFile, verifyFingerprint, hash, canonicalHash, equal, exactKeys, requireProof, isHash } from './production-closure.mjs';
import { parsePublishedFocusTrainNotebook } from './focus-demonstrations.mjs';
import { FEWSHOT_CAPACITY_PINS as C, FEWSHOT_CAPACITY_PROJECTION, FEWSHOT_MODEL_SHA256, FEWSHOT_PROTOCOL, FEWSHOT_PROTOCOL_SHA256, PROOF_ENVELOPE_SCOPE, fewshotFocusBody } from './fewshot-proof-contract.mjs';
const nn = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const proofRef = value => exactKeys(value, ['path','sha256']) && typeof value.path === 'string' && value.path.length > 0 && isHash(value.sha256);

/** Concrete local physical proof reader. Paths remain bounded, symlink checked,
 * hash pinned and fingerprint checked. Never starts a process or reads Q8. */
export function createPretrainedPhysicalReader({ rootDir = APP_ROOT } = {}) {
  const root = resolve(rootDir), files = [];
  const namespaceFor = path => {
    const absolute = resolve(root,path);
    const namespace = ['runtime/models','runtime/recovery-17-cpu/prebuilt-v2/inbound','runtime/fewshot-v7-tokenizer-preflight'].find(name => {
      const nested = relative(resolve(root,name),absolute); return nested !== '' && !isAbsolute(nested) && nested.split(/[\\/]/u)[0] !== '..';
    });
    requireProof(namespace, 'fewshot_proof_outside_concrete_namespaces'); return namespace;
  };
  async function pointer(reference, signal, maxBytes = 16 * 1024 ** 2) {
    requireProof(proofRef(reference),'fewshot_exact_pointer_required');
    const file=await readTrustedJson({rootDir:root,path:reference.path,namespace:namespaceFor(reference.path),expectedSha256:reference.sha256,maxBytes,signal});files.push(file);return file.value;
  }
  async function physical(manifest, config, signal) {
    const imported = await pointer(manifest.import_receipt,signal,4*1024**2);validateImport(imported);
    const receipt=await pointer(manifest.runtime_closure,signal,1024**2),directory='runtime/tools/llama-b11960-cpu';
    const names=(await readdir(resolve(root,directory))).filter(name=>/\.(?:exe|dll)$/iu.test(name)).sort();validateWindowsRuntimeMembership(receipt,names);
    for(const name of names){const record=receipt.files[name];files.push(await verifyRegularFile({rootDir:root,path:directory+'/'+name,namespace:'runtime/tools',expectedSha256:record.sha256,expectedBytes:record.bytes,maxBytes:128*1024**2,signal}));}
    const model=await verifyRegularFile({rootDir:root,path:manifest.selected_model.path,namespace:namespaceFor(manifest.selected_model.path),expectedSha256:P.modelSha,expectedBytes:P.modelBytes,maxBytes:P.modelBytes,signal});files.push(model);
    const handle=await open(model.path,'r');try{const b=Buffer.alloc(8);await handle.read(b,0,8,0);requireProof(b.subarray(0,4).toString()==='GGUF'&&b.readUInt32LE(4)===3,'fewshot_selected_gguf_header');}finally{await handle.close();}
    const runtimePath=resolve(root,directory,'llama-server.exe');
    if(config.modelPath!==undefined)requireProof(resolve(root,config.modelPath)===model.path,'fewshot_model_override');
    if(config.runtimePath!==undefined)requireProof(resolve(root,config.runtimePath)===runtimePath,'fewshot_runtime_override');
    return {imported,modelPath:model.path,runtimePath};
  }
  async function recheck() {
    for(const file of files)await verifyFingerprint(file);
    const names=(await readdir(resolve(root,'runtime/tools/llama-b11960-cpu'))).filter(name=>/\.(?:exe|dll)$/iu.test(name));
    requireProof(names.length===51&&names.every(name=>files.some(file=>basename(file.path)===name)),'fewshot_runtime_membership_changed');
  }
  return {pointer,physical,recheck,files};
}

/** Consistency only, not physical attestation. The FS entry below hashes every
 * historically pinned receipt and current code-owned dependency projection. */
export function validateFewshotCapacityEvidence({ capacity, trainRows }) {
  const {freeze:f,report:r,terminal:t,root_approval:a}=capacity||{};
  requireProof(f?.schema_version==='fewshot-v7-tokenizer-prepared-v1'&&r?.schema_version==='fewshot-v7-train126-tokenizer-report-v1'&&t?.schema_version==='fewshot-v7-tokenizer-terminal-publication-v1'&&a?.schema_version==='root-approved-fewshot-v7-tokenizer-preflight-v1','fewshot_actual_capacity_schemas');
  requireProof(f.no_retry===true&&f.no_generation===true&&f.no_quality===true&&f.model_sha256===P.modelSha&&f.bank_sha256===FEWSHOT_PROTOCOL.bank_sha256&&f.source?.own_source_freeze_sha256===C.own_source.sha256&&a.root_approved===true&&equal(a.inventory,f.source)&&equal(a.limits,r.configuration),'fewshot_capacity_root_identity');
  const production=f.source.production,prototype=f.source.prototype_records;
  requireProof(Array.isArray(production?.records)&&production.sha256===canonicalHash(production.records)&&Array.isArray(prototype),'fewshot_capacity_historical_graph');
  for(const [path,sha]of Object.entries(FEWSHOT_CAPACITY_PROJECTION))requireProof([...production.records,...prototype].some(row=>row.path===path&&row.sha256===sha),'fewshot_capacity_projection_missing:'+path);
  requireProof(Array.isArray(trainRows)&&trainRows.length===126&&Array.isArray(f.rows)&&f.rows.length===126&&new Set(f.rows.map(row=>row.id)).size===126&&f.rows_sha256===canonicalHash(f.rows),'fewshot_capacity_exact_train126');
  trainRows.forEach((row,index)=>{const got=f.rows[index],body=fewshotFocusBody(row.input);requireProof(got.id===row.id&&got.input_sha256===canonicalHash(row.input)&&got.request_sha256===hash(JSON.stringify(body))&&JSON.stringify(got.body)===JSON.stringify(body),'fewshot_capacity_actual_body_changed');});
  requireProof(r.status==='tokenizer_completed_not_quality'&&r.failure===null&&r.freeze_sha256===C.freeze.sha256&&r.denominator===126&&r.counted===126&&r.no_completions===true&&r.quality_verified===false&&r.activation_allowed===false&&r.post_integrity_verified===true&&r.owned_setup_released===true&&r.terminal_publication_required===true&&r.proof_envelope_scope===PROOF_ENVELOPE_SCOPE&&Array.isArray(r.results)&&r.results.length===126,'fewshot_capacity_actual_complete_required');
  r.results.forEach((row,index)=>requireProof(row.id===f.rows[index].id&&row.request_sha256===f.rows[index].request_sha256&&row.status==='counted'&&Number.isInteger(row.input_tokens)&&row.input_tokens>0&&row.input_tokens+32+8<=1024&&nn(row.elapsed_ms),'fewshot_capacity_token_counts'));
  requireProof(r.maximum_input_tokens===Math.max(...r.results.map(row=>row.input_tokens))&&r.maximum_input_tokens===688&&r.identities?.source_inventory_sha256===canonicalHash(f.source)&&r.identities.bank_sha256===FEWSHOT_PROTOCOL.bank_sha256&&r.identities.builder_sha256===FEWSHOT_PROTOCOL.builder_sha256&&r.identities.train_rows_sha256===f.lineage?.train_rows_sha256&&r.identities.model_sha256===P.modelSha&&r.identities.Windows_runtime_closure_sha256===P.windowsClosureSha,'fewshot_capacity_bound_measurement');
  requireProof(ownedExit({...r,post_run_census:r.post_census})&&nn(r.semantic_body_ms)&&r.semantic_body_ms<=4400&&nn(r.native_phase_elapsed_ms)&&r.native_phase_elapsed_ms<=55600&&nn(r.whole_entry_elapsed_ms)&&r.whole_entry_elapsed_ms<=60000&&r.whole_entry_elapsed_ms>=r.semantic_body_ms+r.native_phase_elapsed_ms,'fewshot_capacity_actual_phase_exit');
  requireProof(t.checked===true&&t.scope_id==='TRAIN126-tokenizer-only'&&t.exit_code===0&&t.freeze_sha256===C.freeze.sha256&&t.report_sha256===C.report.sha256&&t.source_inventory_sha256===canonicalHash(f.source)&&t.bank_sha256===FEWSHOT_PROTOCOL.bank_sha256&&t.model_sha256===FEWSHOT_MODEL_SHA256&&nn(t.after_publication_native_ms)&&t.after_publication_native_ms>=r.native_phase_elapsed_ms&&t.after_publication_native_ms<=55600&&nn(t.after_publication_whole_ms)&&t.after_publication_whole_ms>=r.whole_entry_elapsed_ms&&t.after_publication_whole_ms>=r.semantic_body_ms+t.after_publication_native_ms&&t.after_publication_whole_ms<=60000,'fewshot_capacity_root_terminal');
  return {capacity_consistent:true,actual_local_files_verified:false,protocol_sha256:FEWSHOT_PROTOCOL_SHA256,maximum_input_tokens:r.maximum_input_tokens};
}

export async function loadVerifiedFewshotCapacity({rootDir=APP_ROOT,pointers,signal}={}) {
  requireProof(exactKeys(pointers,['freeze','report','terminal','root_approval'])&&Object.keys(pointers).every(key=>proofRef(pointers[key])&&pointers[key].sha256===C[key].sha256),'fewshot_capacity_exact_actual_pointers');
  const capacity={};
  for(const key of Object.keys(pointers))capacity[key]=(await readTrustedJson({rootDir,path:pointers[key].path,namespace:'runtime/fewshot-v7-tokenizer-preflight',expectedSha256:C[key].sha256,maxBytes:8*1024**2,signal})).value;
  const own=await readTrustedJson({rootDir,path:C.own_source.path,namespace:'runtime/fewshot-v7-tokenizer-preflight',expectedSha256:C.own_source.sha256,maxBytes:1024**2,signal});
  requireProof(own.value.schema_version==='private-fewshot-v7-tokenizer-preflight-source-v1'&&equal(Object.keys(own.value.files).sort(),['README.md','driver.mjs','driver.test.mjs','request.example.json','trial.mjs']),'fewshot_capacity_own_package');
  for(const [name,record]of Object.entries(own.value.files))await verifyRegularFile({rootDir,path:'runtime/fewshot-v7-tokenizer-preflight/'+name,namespace:'runtime/fewshot-v7-tokenizer-preflight',expectedSha256:record.sha256,expectedBytes:record.bytes,maxBytes:8*1024**2,signal});
  for(const [path,sha]of Object.entries(FEWSHOT_CAPACITY_PROJECTION))await verifyRegularFile({rootDir,path,expectedSha256:sha,maxBytes:8*1024**2,signal});
  const train=parsePublishedFocusTrainNotebook(await readFile(resolve(rootDir,'notebooks/support-copilot-plan-qlora.ipynb'),{signal}));
  validateFewshotCapacityEvidence({capacity,trainRows:train.rows});
  return {...capacity,pointers:structuredClone(pointers),actual_local_files_verified:true};
}
