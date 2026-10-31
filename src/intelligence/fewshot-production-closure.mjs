import { basename } from 'node:path';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { APP_ROOT, SELECTED17_DIRECTORY, collectProductionClosure, readTrustedJson, verifyRegularFile, exactKeys, canonicalHash, equal, isHash, requireProof } from './production-closure.mjs';

export const FEWSHOT_SOURCE_REGISTRY_VERSION = 'selected17-fewshot-production-and-helper-registry-v1';
const HELPERS = [
  {path:SELECTED17_DIRECTORY+'/linux-windows-calibration-v4-fewshot',required:['driver.mjs','trial.mjs','source-seal.mjs'],schema:'private-Linux17-Windows-fewshot-calibration-source-v4'},
  {path:SELECTED17_DIRECTORY+'/author-v7',required:['driver.mjs','trial.mjs','cohort.mjs'],schema:'private-independent-focus42-fewshot-source-v7'},
  {path:'runtime/fewshot-v7-tokenizer-preflight',required:['driver.mjs','trial.mjs'],schema:'private-fewshot-v7-tokenizer-preflight-source-v1',sha256:'6764a49dee5f54612f59e52d884c0d172f1755a794b1414f401d15a0bc16eb5c'},
];

/** Compose the unchanged old collector so the immutable compiler's canonical
 * module pin stays valid. Only this code can select the concrete extra graph;
 * no activation/HTTP file map, targets, profiles or run outputs enter it. */
export async function collectFewshotProductionClosure({rootDir=APP_ROOT,signal}={}) {
  const base=await collectProductionClosure({rootDir,signal}),names=new Set(base.records.map(row=>row.path));
  names.add('training/build-focus-demonstrations.mjs');
  for(const helper of HELPERS){
    const namespace=helper.path==='runtime/fewshot-v7-tokenizer-preflight'?helper.path:'runtime/models';
    const entries=await readdir(resolve(rootDir,helper.path),{withFileTypes:true});
    const modules=entries.filter(entry=>entry.name.endsWith('.mjs')).map(entry=>{requireProof(entry.isFile()&&!entry.isSymbolicLink(),'fewshot_helper_module_not_regular');return helper.path+'/'+entry.name;});
    for(const path of modules)names.add(path);
    for(const name of helper.required)requireProof(modules.includes(helper.path+'/'+name),'fewshot_required_helper_missing:'+name);
    const freeze=await readTrustedJson({rootDir,path:helper.path+'/source-freeze.json',namespace,expectedSha256:helper.sha256,maxBytes:1024**2,signal});
    requireProof(freeze.value.schema_version===helper.schema&&freeze.value.files&&Object.keys(freeze.value.files).length>0,'fewshot_helper_own_freeze_required');
    names.add(helper.path+'/source-freeze.json');
    for(const [name,record]of Object.entries(freeze.value.files)){
      requireProof(basename(name)===name&&(/\.(?:mjs|md|tap)$/u.test(name)||name==='request.example.json')&&exactKeys(record,['bytes','sha256']),'fewshot_helper_source_record');
      await verifyRegularFile({rootDir,path:helper.path+'/'+name,namespace,expectedBytes:record.bytes,expectedSha256:record.sha256,maxBytes:8*1024**2,signal});names.add(helper.path+'/'+name);
    }
    for(const name of ['README.md','request.example.json'])names.add(helper.path+'/'+name);
  }
  requireProof(names.size<=2048,'fewshot_source_graph_bound');
  const records=[],folded=new Set();
  for(const path of [...names].sort()){
    requireProof(!folded.has(path.toLowerCase()),'fewshot_source_case_collision');folded.add(path.toLowerCase());
    const file=await verifyRegularFile({rootDir,path,maxBytes:8*1024**2,signal});records.push({path,bytes:file.bytes,sha256:file.sha256});
  }
  return {...base,registry_version:FEWSHOT_SOURCE_REGISTRY_VERSION,records,sha256:canonicalHash(records)};
}
export function validateFewshotProductionClosure(expected,actual) {
  requireProof(exactKeys(expected,['schema_version','registry_version','records','sha256','production_source10_sha256','factory_sha256'])&&expected.schema_version==='production-generation-source-closure-v1'&&expected.registry_version===FEWSHOT_SOURCE_REGISTRY_VERSION&&Array.isArray(expected.records)&&expected.records.length>12,'fewshot_full_source_closure_required');
  requireProof(expected.records.every(row=>exactKeys(row,['path','bytes','sha256'])&&typeof row.path==='string'&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&isHash(row.sha256))&&expected.sha256===canonicalHash(expected.records)&&equal(expected,actual),'fewshot_current_full_source_changed');
  return actual;
}
