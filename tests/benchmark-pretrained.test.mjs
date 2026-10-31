import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildBenchmarkIdentity } from '../scripts/benchmark-generator.mjs';
import { canonicalHash, hash } from '../src/intelligence/production-closure.mjs';
import { PRETRAINED_SCHEMA, PRETRAINED_PINS as P } from '../src/intelligence/pretrained-activation.mjs';

test('importing benchmark helpers performs no benchmark run or model initialization',()=>{assert.equal(typeof buildBenchmarkIdentity,'function');});
test('pretrained benchmark identity binds every full-closure member instead of the old five',async()=>{
 const records=Array.from({length:18},(_,i)=>({path:`src/graph-node-${i}.mjs`,bytes:20,sha256:hash(String(i))}));records.push({path:'runtime/models/synthetic-helper/driver.mjs',bytes:30,sha256:hash('driver')});
 let production={records,sha256:canonicalHash(records)};
 const options={focusMode:'model',activationHint:{schema_version:PRETRAINED_SCHEMA},modelPath:'unused.gguf',canonicalSources:[],closureCollector:async()=>production};
 const first=await buildBenchmarkIdentity(options);assert.equal(first.candidate_sha256,production.sha256);assert.equal(first.production_closure_sha256,production.sha256);assert.equal(Object.keys(first.files).length,19);assert.equal(first.files[records.at(-1).path],hash('driver'));assert.equal(first.model.sha256,P.modelSha);assert.equal(first.production_configuration.native_budget_ms,55600);assert.equal(first.production_configuration.total_budget_ms,60000);
 production={records:[...records,{path:'src/new-transitive-module.mjs',bytes:1,sha256:hash('new')}],sha256:canonicalHash([...records,{path:'src/new-transitive-module.mjs',bytes:1,sha256:hash('new')}])};
 const second=await buildBenchmarkIdentity(options);assert.notEqual(second.candidate_sha256,first.candidate_sha256);assert.equal(Object.keys(second.files).length,20);
});
test('legacy deterministic and joint diagnostic identities keep their five-file behavior',async()=>{
 const root=await mkdtemp(join(tmpdir(),'benchmark-legacy-'));const names=['generation-contract','generator','two-phase','native-session','activation'].map(n=>`src/intelligence/${n}.mjs`);
 for(const name of names){await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),name);}
 for(const focusMode of ['deterministic','model']){const info=await buildBenchmarkIdentity({rootDir:root,focusMode,activationHint:{schema_version:'joint-generation-activation-v1'},modelPath:'synthetic.gguf'});assert.equal(Object.keys(info.files).length,5);assert.equal(info.production_closure_sha256,undefined);assert.equal(info.activation_family,focusMode==='model'?'joint':'deterministic');}
 await assert.rejects(buildBenchmarkIdentity({rootDir:root,focusMode:'model',activationHint:{schema_version:'unrecognized'},modelPath:'synthetic.gguf'}),/Unsupported trusted activation schema/);
});
