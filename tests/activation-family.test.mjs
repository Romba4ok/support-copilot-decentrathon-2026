import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivationFamilyVerifier } from '../src/intelligence/activation-family.mjs';
import { PRETRAINED_SCHEMA } from '../src/intelligence/pretrained-activation.mjs';
import { verifyRegularFile, verifyFingerprint, readTrustedJson, hash, validateProductionClosure, canonicalHash, enumerateSourceFiles, collectProductionClosure } from '../src/intelligence/production-closure.mjs';

async function local(schema='joint-generation-activation-v1') {
 const root=await mkdtemp(join(tmpdir(),'support-activation-family-'));await mkdir(join(root,'runtime/models'),{recursive:true});
 const path='runtime/models/activation.json';await writeFile(join(root,path),JSON.stringify({schema_version:schema}));
 return{root,path,config:{enabled:true,focusMode:'model',activationManifestPath:path}};
}

test('local schema dispatch preserves joint and pretrained identity without speculative fallback',async()=>{
 for(const schema of ['joint-generation-activation-v1',PRETRAINED_SCHEMA]){
  const f=await local(schema),calls=[];
  const verifier=createActivationFamilyVerifier(f.config,{rootDir:f.root,legacyFactory:()=>async()=>{calls.push('joint');return{validationOnly:true};},pretrainedFactory:()=>async()=>{calls.push('pretrained');return{validationOnly:true};}});
  const family=schema===PRETRAINED_SCHEMA?'pretrained':'joint';assert.equal((await verifier({})).family,family);assert.deepEqual(calls,[family]);
 }
});
test('pretrained verification failure never invokes the joint verifier',async()=>{
 const f=await local(PRETRAINED_SCHEMA);let joint=0;
 const verify=createActivationFamilyVerifier(f.config,{rootDir:f.root,legacyFactory:()=>async()=>{joint++;},pretrainedFactory:()=>async()=>{throw Error('proof rejected');}});
 await assert.rejects(verify({}),/proof rejected/);assert.equal(joint,0);
});
test('unknown and changed manifest families fail closed',async()=>{
 const f=await local('publisher-invented-schema');let calls=0;
 const verify=createActivationFamilyVerifier(f.config,{rootDir:f.root,legacyFactory:()=>async()=>{calls++;return{};}});
 await assert.rejects(verify({}),/unsupported_activation_family/);assert.equal(calls,0);
 await writeFile(join(f.root,f.path),JSON.stringify({schema_version:'joint-generation-activation-v1'}));await verify({});
 await writeFile(join(f.root,f.path),JSON.stringify({schema_version:PRETRAINED_SCHEMA}));await assert.rejects(verify({}),/activation_family_changed/);
});
test('bounded JSON pins actual bytes and refuses external namespace paths',async()=>{
 const f=await local();const sha=hash(await readFile(join(f.root,f.path)));
 assert.equal((await readTrustedJson({rootDir:f.root,path:f.path,namespace:'runtime/models',expectedSha256:sha})).sha256,sha);
 await assert.rejects(readTrustedJson({rootDir:f.root,path:f.path,namespace:'runtime/models',expectedSha256:'0'.repeat(64)}),/sha_mismatch/);
 await assert.rejects(verifyRegularFile({rootDir:f.root,path:'../outside.json',namespace:'runtime/models'}),/outside_namespace/);
 const controller=new AbortController();controller.abort();await assert.rejects(verifyRegularFile({rootDir:f.root,path:f.path,signal:controller.signal}),{name:'AbortError'});
});
test('cached verified file detects replacement and symbolic ancestor redirects',async()=>{
 const f=await local();const file=await verifyRegularFile({rootDir:f.root,path:f.path,namespace:'runtime/models'});
 await verifyFingerprint(file);await writeFile(join(f.root,f.path),'{}');await assert.rejects(verifyFingerprint(file),/file_changed/);
 const g=await local();const before=await verifyRegularFile({rootDir:g.root,path:g.path,namespace:'runtime/models'});
 await rename(join(g.root,'runtime/models'),join(g.root,'runtime/real-models'));await symlink(join(g.root,'runtime/real-models'),join(g.root,'runtime/models'),'junction');
 await assert.rejects(verifyFingerprint(before),/symbolic_ancestor/);
 await assert.rejects(verifyRegularFile({rootDir:g.root,path:g.path,namespace:'runtime/models'}),/symbolic_ancestor/);
});
test('full closure rejects an old subset even when the publisher recomputes its hash',()=>{
 const records=Array.from({length:14},(_,i)=>({path:`src/source-${i}.mjs`,bytes:7,sha256:hash(String(i))}));
 const full={schema_version:'production-generation-source-closure-v1',registry_version:'selected17-production-and-helper-registry-v1',records,sha256:canonicalHash(records),production_source10_sha256:hash('10'),factory_sha256:hash('factory')};
 assert.equal(validateProductionClosure(full,full),full);
 const subset=structuredClone(full);subset.records.pop();subset.sha256=canonicalHash(subset.records);assert.throws(()=>validateProductionClosure(subset,full),/closure_changed/);
 const changed=structuredClone(full);changed.records[0].bytes++;changed.sha256=canonicalHash(changed.records);assert.throws(()=>validateProductionClosure(changed,full),/closure_changed/);
});
test('actual source tree inventory includes new transitive helper code and rejects ancestor redirects',async()=>{
 const f=await local();await mkdir(join(f.root,'src/nested'),{recursive:true});await mkdir(join(f.root,'helpers/package'),{recursive:true});
 await writeFile(join(f.root,'src/main.mjs'),'source');await writeFile(join(f.root,'src/nested/imported.mjs'),'dependency');await writeFile(join(f.root,'helpers/package/driver.mjs'),'helper');await writeFile(join(f.root,'helpers/package/report.json'),'not source');
 assert.deepEqual(await enumerateSourceFiles({rootDir:f.root,folders:['src']}),['src/main.mjs','src/nested/imported.mjs']);
 assert.deepEqual(await enumerateSourceFiles({rootDir:f.root,folders:['helpers'],onlyModules:true}),['helpers/package/driver.mjs']);
 await writeFile(join(f.root,'helpers/package/new-import.mjs'),'new helper');assert.equal((await enumerateSourceFiles({rootDir:f.root,folders:['helpers'],onlyModules:true})).length,2);
 await rename(join(f.root,'helpers'),join(f.root,'real-helpers'));await symlink(join(f.root,'real-helpers'),join(f.root,'helpers'),'junction');
 await assert.rejects(enumerateSourceFiles({rootDir:f.root,folders:['helpers/package']}),/symbolic_directory/);
 await assert.rejects(enumerateSourceFiles({rootDir:f.root,folders:['../outside']}),/inventory_bounds/);
});
test('a public-only package cannot claim a complete selected17 production closure without private helper proofs',async()=>{
 const f=await local();for(const folder of ['src','public','data'])await mkdir(join(f.root,folder));
 await assert.rejects(collectProductionClosure({rootDir:f.root}),/ENOENT/);
});
