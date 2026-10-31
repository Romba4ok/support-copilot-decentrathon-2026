import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkAuthoredRoutingPart,checkPackagePaths} from '../scripts/package-check.mjs';
const path='data/routing-training-v9-role.json';
const bytes=()=>readFileSync(new URL('../'+path,import.meta.url));
const changed=fn=>{const value=JSON.parse(bytes());fn(value);return Buffer.from(JSON.stringify(value));};
test('explicitly pinned authored role TRAIN is admitted with all seven classes and six languages',()=>{
 assert.deepEqual(checkAuthoredRoutingPart(path,bytes()),[]);
 for(const old of ['alpha','beta']){const p=`data/routing-training-v8-${old}.json`;assert.deepEqual(checkAuthoredRoutingPart(p,readFileSync(new URL('../'+p,import.meta.url))),[]);}
});
test('routing TRAIN requires frozen bytes, false human provenance and full grouped coverage',()=>{
 const codes=b=>checkAuthoredRoutingPart(path,b).map(e=>e.code);
 assert(codes(changed(d=>{d.scenarios[0].texts.ru+='!';})).includes('authored_routing_integrity'));
 assert(codes(changed(d=>{d.provenance.human_reviewed=true;})).includes('non_authored_routing_data'));
 assert(codes(changed(d=>{delete d.scenarios[0].texts.uz;})).includes('invalid_authored_routing_coverage'));
 assert(codes(changed(d=>{d.scenarios[0].focus='other';})).includes('invalid_authored_routing_coverage'));
 assert(codes(changed(d=>{d.scenarios[1].group_id=d.scenarios[0].group_id;})).includes('invalid_authored_routing_coverage'));
 assert(checkAuthoredRoutingPart('data/unapproved-routing.json',bytes()).some(e=>e.code==='outside_authored_routing_parts'));
 assert(checkPackagePaths(['data/unapproved-routing.json']).some(e=>e.path==='data/unapproved-routing.json'&&e.code==='outside_public_allowlist'));
});
