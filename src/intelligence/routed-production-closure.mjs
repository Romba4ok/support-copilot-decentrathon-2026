import {basename,resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {APP_ROOT,enumerateSourceFiles,verifyRegularFile,readTrustedJson,canonicalHash,exactKeys,equal,isHash,requireProof} from './production-closure.mjs';
import {ROUTED_PATHS,ROUTED_SCHEMAS,ROUTED_PINS} from './routed-contract.mjs';
export const ROUTED_SOURCE_REGISTRY_VERSION='trained-router-plan-public-and-qualification-source-registry-v8';
export const ROUTED_SOURCE_HELPERS=Object.freeze([
 Object.freeze({path:ROUTED_PATHS.calibration,schema:ROUTED_SCHEMAS.calibration_source,required:Object.freeze(['driver.mjs','trial.mjs','source-seal.mjs'])}),
 Object.freeze({path:ROUTED_PATHS.author,schema:ROUTED_SCHEMAS.author_source,required:Object.freeze(['driver.mjs','trial.mjs','cohort.mjs'])}),
]);
const ROOT_FILES=['package.json','npm-shrinkwrap.json','.env.example','Makefile','start-support.cmd','start-local-ai.cmd','notebooks/support-copilot-plan-qlora.ipynb','scripts/benchmark-generator.mjs'];
const SOURCE10=['src/cli/predict.mjs','src/intelligence/activation.mjs','src/intelligence/config.mjs','src/intelligence/draft.mjs','src/intelligence/generation-contract.mjs','src/intelligence/generator.mjs','src/intelligence/index.mjs','src/intelligence/native-session.mjs','src/intelligence/two-phase.mjs','src/server.mjs'];
/** Code-selected graph only. Training artifact's historical7f3 provenance is
 * distinct from THIS current production/qualification graph. No outputs, model
 * weights, profiles, target fixtures, preregistrations or root approvals enter it.
 * Own producer freezes hash only their flat source, avoiding a source cycle. */
export async function collectRoutedProductionClosure({rootDir=APP_ROOT,signal}={}){
 const names=new Set(ROOT_FILES);for(const path of await enumerateSourceFiles({rootDir,folders:['src','public','data'],signal}))names.add(path);
 for(const path of await enumerateSourceFiles({rootDir,folders:['training'],onlyModules:true,signal}))names.add(path);
 for(const helper of ROUTED_SOURCE_HELPERS){
  const entries=await readdir(resolve(rootDir,helper.path),{withFileTypes:true}),modules=entries.filter(e=>e.name.endsWith('.mjs'));
  requireProof(modules.every(e=>e.isFile()&&!e.isSymbolicLink()),'routed_helper_module_not_regular');
  const own=await readTrustedJson({rootDir,path:helper.path+'/source-freeze.json',namespace:helper.path,maxBytes:1024**2,signal});
  requireProof(own.value.schema_version===helper.schema&&own.value.files&&Object.keys(own.value.files).length>0,'routed_helper_own_source_freeze');
  names.add(helper.path+'/source-freeze.json');
  for(const[name,record]of Object.entries(own.value.files)){
   requireProof(basename(name)===name&&(/\.(?:mjs|md)$/u.test(name)||name==='request.example.json')&&exactKeys(record,['bytes','sha256']),'routed_helper_flat_source_record');
   await verifyRegularFile({rootDir,path:helper.path+'/'+name,namespace:helper.path,expectedBytes:record.bytes,expectedSha256:record.sha256,maxBytes:8*1024**2,signal});names.add(helper.path+'/'+name);
  }
  for(const name of [...helper.required,'README.md','request.example.json'])requireProof(names.has(helper.path+'/'+name),'routed_required_helper_missing:'+name);
  requireProof(modules.every(e=>names.has(helper.path+'/'+e.name)),'routed_unfrozen_helper_module');
 }
 const records=[],folded=new Set();requireProof(names.size<=2048,'routed_source_bound');for(const path of [...names].sort()){
  requireProof(!folded.has(path.toLowerCase()),'routed_source_case_collision');folded.add(path.toLowerCase());const f=await verifyRegularFile({rootDir,path,maxBytes:8*1024**2,signal});records.push({path,bytes:f.bytes,sha256:f.sha256});
 }
 const source10=SOURCE10.map(path=>records.find(r=>r.path===path));requireProof(source10.every(Boolean),'routed_source10_missing');
 for(const[path,expected]of [['src/intelligence/generation-contract.mjs',ROUTED_PINS.factory_sha256],['src/intelligence/native-session.mjs',ROUTED_PINS.native_session_sha256],['src/intelligence/routing-worker.mjs',ROUTED_PINS.worker_sha256]])requireProof(records.find(r=>r.path===path)?.sha256===expected,'routed_protected_dependency_changed:'+path);
 return{schema_version:'production-generation-source-closure-v1',registry_version:ROUTED_SOURCE_REGISTRY_VERSION,records,sha256:canonicalHash(records),production_source10_sha256:canonicalHash(source10),factory_sha256:ROUTED_PINS.factory_sha256};
}
export function validateRoutedProductionClosure(expected,actual){
 requireProof(exactKeys(expected,['schema_version','registry_version','records','sha256','production_source10_sha256','factory_sha256'])&&expected.schema_version==='production-generation-source-closure-v1'&&expected.registry_version===ROUTED_SOURCE_REGISTRY_VERSION&&expected.factory_sha256===ROUTED_PINS.factory_sha256&&Array.isArray(expected.records)&&expected.records.length>SOURCE10.length&&expected.records.every(r=>exactKeys(r,['path','bytes','sha256'])&&typeof r.path==='string'&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&isHash(r.sha256))&&expected.sha256===canonicalHash(expected.records)&&equal(expected,actual),'routed_full_current_source_closure');return actual;
}
