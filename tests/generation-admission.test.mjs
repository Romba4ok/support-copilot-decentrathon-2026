import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {validateAuthoredPlanControl} from '../src/intelligence/generation-evaluation.mjs';
import {admitRoutedBenchmarkAttempt} from '../scripts/benchmark-generator.mjs';
import {routedPlanAttemptPath} from '../src/intelligence/routed-contract.mjs';
import {hash} from '../src/intelligence/production-closure.mjs';

// Invented DTO/label shapes only. Never imports an actual control or model.
const fixture=()=>({provenance:'authored_synthetic',human_reviewed:false,contract_version:'support-plan-v1',cases:Array.from({length:24},(_,index)=>({id:'synthetic-admission-'+index,input:{kind:'report',lang:'en',messages:[{role:'player',text:'Artificial contract sample '+index}]},expected:{focus:'question',needs_human:true,provided_fields:[],request_fields:[],source_ids:[]}}))});

test('valid authored DTO admission returns original24 without coercing/rewriting messages or labels',()=>{const value=fixture(),before=JSON.stringify(value);assert.equal(validateAuthoredPlanControl(value),value);assert.equal(JSON.stringify(value),before);});

test('ALL24 production DTOs are checked even when early kind and late server are invalid; no coercion',()=>{const value=fixture(),seen=new Set();value.cases[0].input.kind='question';value.cases[23].input.server=7;for(const [index,row]of value.cases.entries())row.input=new Proxy(row.input,{get(target,key,receiver){if(key==='kind')seen.add(index);return Reflect.get(target,key,receiver);}});assert.throws(()=>validateAuthoredPlanControl(value),error=>/2\/24/.test(error.message)&&/synthetic-admission-0: kind must be complaint or report/.test(error.message)&&/synthetic-admission-23: Invalid server/.test(error.message));assert.equal(seen.size,24);assert.equal(value.cases[0].input.kind,'question');assert.equal(value.cases[23].input.server,7);});

test('invalid production message/timestamp shapes fail before a model; label overlap still rejected',()=>{for(const mutate of [value=>value.cases[5].input.messages[0].role='system',value=>value.cases[20].input.messages[0].attachments=-1,value=>value.cases[23].input.created_at='NOT-A-DATE']){const value=fixture();mutate(value);assert.throws(()=>validateAuthoredPlanControl(value),/Invalid control input DTO/);}const overlap=fixture();overlap.cases[0].expected.provided_fields=['server'];overlap.cases[0].expected.request_fields=['server'];assert.throws(()=>validateAuthoredPlanControl(overlap),/required missing field/);});

test('prospective routed marker follows fullfixture and DTO admission, then remains one-shot/replay-safe',async()=>{const rootDir=await mkdtemp(resolve(tmpdir(),'routed-admission-')),preregistrationSha=hash('invented preregistration'),candidateSha=hash('invented candidate'),path=resolve(rootDir,routedPlanAttemptPath(preregistrationSha));for(const mutate of [value=>value.cases[0].input.kind='question',value=>value.cases[23].input.server=4,value=>value.cases[23].expected.request_fields=['unknown_field']]){const value=fixture();mutate(value);await assert.rejects(admitRoutedBenchmarkAttempt({fixture:value,rootDir,preregistrationSha,candidateSha}));await assert.rejects(lstat(path),error=>error.code==='ENOENT');}const admitted=await admitRoutedBenchmarkAttempt({fixture:fixture(),rootDir,preregistrationSha,candidateSha}),before=await readFile(path);assert.equal(hash(before),admitted.sha256);assert.equal(JSON.parse(before).attempt,1);await assert.rejects(admitRoutedBenchmarkAttempt({fixture:fixture(),rootDir,preregistrationSha,candidateSha}),error=>error.code==='EEXIST');assert.deepEqual(await readFile(path),before);});
