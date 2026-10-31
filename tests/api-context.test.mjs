import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/core/engine.mjs';
import { createIntelligence } from '../src/intelligence/index.mjs';
import { createApp } from '../src/server.mjs';
import { parseInferenceConfig } from '../src/intelligence/config.mjs';
import { buildFieldStates, buildGenerationInput, buildFocusMessages, renderPlan } from '../src/intelligence/generation-contract.mjs';
import { codeContextDraft, applyGenerationProjection } from '../src/intelligence/draft.mjs';

// Independently authored generic contract probes. No control/train/gold data or models.
const categories = ['report.payment','report.account','report.help','report.question','report.complaint','report.offtopic','complaint.admin','complaint.insult','complaint.cheat','complaint.dm','complaint.scam','complaint.rmt_ads','complaint.invalid','complaint.other'];
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'support-api-context-'));
  const dataDir = join(directory,'data'); mkdirSync(dataDir);
  writeFileSync(join(dataDir,'rules.json'), JSON.stringify({rules:[{id:30,category:'Authored synthetic support policy',points:[{ref:'1.4',text:'AUTHORED SYNTHETIC: access requests are reviewed by support.'}]}]}));
  writeFileSync(join(dataDir,'taxonomy.json'), JSON.stringify({categories:categories.map(code=>({code})),priorities:['p0','p1','p2','p3'].map(code=>({code})),needs_human_always:['report.payment','report.account','complaint.admin']}));
  const engine = createEngine({dataDir});
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return {directory,dataDir,engine};
}
const raw = (text,lang='en')=>({kind:'report',lang,messages:[{role:'player',text}]});
const prepared = (engine,input)=>{const result=engine.triage(input);result.analysis.intelligence={version:'v2',mode:'baseline-fallback',candidates:[],baseline_category:result.category};return result;};

test('fast multilingual payment drafts acknowledge concrete ISO dates and credits without re-asking them', async t=>{
  const {engine,directory}=fixture(t);
  const intelligence=createIntelligence({baseline:engine,modelDir:join(directory,'missing')});t.after(()=>intelligence.close());
  for (const [lang,text] of [
    ['en','My payment of 37 credits on 2026-09-14 did not arrive.'],
    ['ru','Я оплатил 71 кредит 2026-09-14. Покупка не появилась.'],
    ['kk','Менің төлемім 83 кредит, 2026-09-14.'],
    ['uz','Mening to‘lovim 47 kredit, 2026-09-14.'],
    ['es','Mi pago de 56 créditos del 2026-09-14 no llegó.'],
    ['pt','Meu pagamento de 91 créditos em 2026-09-14 não chegou.'],
  ]) {
    const result=await intelligence.triage(raw(text,lang)),draft=result.analysis.intelligence.draft;
    assert.equal(result.lang,lang);assert.equal(result.draft_reply.lang,lang);
    assert.match(result.draft_reply.text,/2026-09-14/);
    assert.ok(draft.used_fact_ids.includes('fact_amount'));
    assert.ok(!draft.requested_fields.includes('payment_date'));assert.ok(!draft.requested_fields.includes('amount'));
    assert.equal(draft.metrics.generated,false);assert.equal(draft.metrics.executed,false);assert.equal(draft.metrics.plan_origin,'code_context');
    assert.equal(result.needs_human,true);assert.equal(result.priority,'p0');
  }
});

test('field roles distinguish date/decimal amount, event time, wallet balance and self nickname', t=>{
  fixture(t);
  const observed=buildFieldStates(raw('I paid 14.50 USD on 14.09.2026. My wallet balance is 100 USD. The incident happened at 17:42. My nickname is Lily_Spring. Player Birch_River insulted me.'));
  const values=Object.fromEntries(observed.facts.map(fact=>[fact.field,fact.value]));
  assert.equal(values.amount,'14.50 USD');assert.equal(values.payment_date,'14.09.2026');assert.equal(values.event_time,'17:42');assert.equal(values.participant,'Birch_River');
  for (const fact of observed.facts) if(fact.provenance.kind==='player_span') assert.equal(raw('I paid 14.50 USD on 14.09.2026. My wallet balance is 100 USD. The incident happened at 17:42. My nickname is Lily_Spring. Player Birch_River insulted me.').messages[0].text.slice(fact.provenance.start,fact.provenance.end),fact.value);
  for (const text of ['I paid 18 USD on 2026-09-09 and my wallet balance is 120 USD.', 'My wallet balance is 120 USD, payment amount 18 USD.']) assert.equal(buildFieldStates(raw(text)).facts.find(fact=>fact.field==='amount')?.value,'18 USD');
  const mixed=buildFieldStates(raw('I paid 18 USD on 2026-09-09 and the incident happened on 2026-09-11 at 19:41.'));
  assert.equal(mixed.facts.find(fact=>fact.field==='payment_date')?.value,'2026-09-09');assert.equal(mixed.facts.find(fact=>fact.field==='event_time')?.value,'19:41');
  for (const text of ['Player Aster insulted me.','Игрок Берег оскорбил меня.','Ойыншы Қанат мені балағаттады.','O‘yinchi Sardor meni haqorat qildi.','Jugador Estrella me insultó.','Jogador Oliveira me insultou.']) assert.ok(buildFieldStates(raw(text)).facts.some(fact=>fact.field==='participant'));
  assert.ok(!buildFieldStates(raw('Player Unknown insulted me.')).facts.some(fact=>fact.field==='participant'));
});

test('unavailable and uncertain fields never become repeated questions or established material facts',t=>{
  const {engine}=fixture(t);
  for(const text of ['I paid 19 credits. Payment date is unknown. Platform is unavailable. I cannot provide evidence.', 'I paid 19 credits. Payment date mentioned in a receipt. Platform unspecified. I have a recording.']) {
    const input=raw(text),result=codeContextDraft(input,prepared(engine,input),engine.sources()),draft=result.analysis.intelligence.draft;
    assert.ok(!draft.requested_fields.includes('payment_date'));assert.ok(!draft.requested_fields.includes('platform'));assert.ok(!draft.requested_fields.includes('evidence'));
    assert.match(result.draft_reply.text,/has not established|have not been verified|have not been inspected/);
    assert.doesNotMatch(result.draft_reply.text,/no materials|materials have not been provided/i);
  }
});

test('conflicting field values produce a localized conservative draft without questions or canonical claims',t=>{
  const {engine}=fixture(t),input=raw('I paid 11 USD. I paid 12 USD.','kk'),result=codeContextDraft(input,prepared(engine,input),engine.sources());
  assert.equal(result.analysis.intelligence.draft.status,'context-unresolved');assert.equal(result.lang,'kk');assert.equal(result.draft_reply.lang,'kk');
  assert.equal(result.needs_human,true);assert.deepEqual(result.citations,[]);assert.doesNotMatch(result.draft_reply.text,/11|12|Please provide/);
});

test('initial help and unknown FAQ avoid technical questions; technical UI questions omit map location',t=>{
  const {engine}=fixture(t);
  for(const text of ['Hello','I need help','What are the opening hours of this support desk?','The menu crashes when I open settings.']) {
    const input=raw(text),result=codeContextDraft(input,prepared(engine,input),engine.sources()),draft=result.analysis.intelligence.draft;
    if(text==='Hello') assert.deepEqual(draft.requested_fields,[]);
    if(text==='I need help') assert.deepEqual(draft.requested_fields,['problem_description']);
    if(text.startsWith('What')) {assert.deepEqual(draft.requested_fields,[]);assert.equal(result.needs_human,true);assert.equal(draft.intent_mode,'knowledge_gap');}
    if(text.startsWith('The')) {assert.ok(!draft.requested_fields.includes('location'));assert.ok(draft.requested_fields.length<=3);}
  }
  const exhausted=raw('The menu crashes. Server and platform are unknown. Event time is unknown. Reproduction steps are unknown.');
  const result=codeContextDraft(exhausted,prepared(engine,exhausted),engine.sources());
  assert.equal(result.analysis.intelligence.draft.status,'context-unresolved');assert.equal(result.needs_human,true);assert.doesNotMatch(result.draft_reply.text,/Please provide/);
});

test('shared startup config rejects ignored/invalid modes and missing operator activation before inference',t=>{
  const {directory}=fixture(t);
  assert.equal(parseInferenceConfig({}).draftMode,'fast');assert.equal(parseInferenceConfig({LOCAL_GENERATOR:'1'}).draftMode,'fast');
  for(const env of [{LOCAL_GENERATOR:'true'},{TRIAGE_DRAFT_MODE:'auto'},{TRIAGE_DRAFT_MODE:'native'},{LOCAL_GENERATOR:'1',TRIAGE_DRAFT_MODE:'native'},{GENERATOR_TIMEOUT_MS:'NaN'},{GENERATOR_TIMEOUT_MS:'60001'},{GENERATOR_FOCUS_MODE:'automatic'},{LOCAL_GENERATOR:'1',GENERATOR_FOCUS_MODE:'model'},{LOCAL_GENERATOR:'1',GENERATOR_FOCUS_MODE:'model',GENERATOR_ACTIVATION_MANIFEST:join(directory,'missing')}]) assert.throws(()=>parseInferenceConfig(env));
  const path=join(directory,'activation.json');
  writeFileSync(path,JSON.stringify({schema_version:'joint-generation-activation-v1',scope:'private-validation'}));
  assert.throws(()=>parseInferenceConfig({LOCAL_GENERATOR:'1',GENERATOR_FOCUS_MODE:'model',GENERATOR_ACTIVATION_MANIFEST:path}));
  writeFileSync(path,JSON.stringify({schema_version:'joint-generation-activation-v1',scope:'operator-generation'}));
  const config=parseInferenceConfig({LOCAL_GENERATOR:'1',TRIAGE_DRAFT_MODE:'native',GENERATOR_FOCUS_MODE:'model',GENERATOR_ACTIVATION_MANIFEST:path});
  assert.equal(config.generatorConfig.requiredActivationScope,'operator-generation');
});

async function serve(t,engine,intelligence,directory) {
  const app=createApp({engine,intelligence,runtimeDir:join(directory,'runtime'),seed:false});app.listen(0,'127.0.0.1');await once(app,'listening');
  t.after(async()=>{app.closeAllConnections();if(app.listening)await new Promise(resolve=>app.close(resolve));});
  return async(path,method='GET',body)=>{const response=await fetch(`http://127.0.0.1:${app.address().port}${path}`,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};
}

test('fast HTTP and CLI share explicit kk contextual draft and sanitize historical outcomes',async t=>{
  const {engine,directory,dataDir}=fixture(t),modelDir=join(directory,'missing');
  let generateCalls=0;
  const intelligence=createIntelligence({baseline:engine,modelDir,generatorFactory:()=>({status:()=>({enabled:false}),generate:async()=>{generateCalls++;throw Error('fast must not call generator');},close:async()=>{}})});t.after(()=>intelligence.close());
  const call=await serve(t,engine,intelligence,directory),input={...raw('My payment of 64 credits on 2026-08-13 did not arrive. Transaction ID OP-619. Windows.','kk'),outcome:'PRIVATE_OUTCOME',messages:[{role:'player',text:'My payment of 64 credits on 2026-08-13 did not arrive. Transaction ID OP-619. Windows.'},{role:'admin',text:'PRIVATE_ADMIN'}]};
  const http=(await call('/triage','POST',input)).data;
  const inputPath=join(directory,'input.jsonl'),outputPath=join(directory,'output.jsonl');writeFileSync(inputPath,JSON.stringify(input)+'\n');
  const env={...process.env,LOCAL_GENERATOR:'0',TRIAGE_DRAFT_MODE:'fast',GENERATOR_FOCUS_MODE:'deterministic',MODEL_DIR:modelDir};delete env.GENERATOR_ACTIVATION_MANIFEST;delete env.GENERATOR_TIMEOUT_MS;
  execFileSync(process.execPath,[fileURLToPath(new URL('../src/cli/predict.mjs',import.meta.url)),'--in',inputPath,'--out',outputPath,'--data-dir',dataDir,'--mode','v2'],{env,stdio:['ignore','pipe','pipe']});
  const cli=JSON.parse(readFileSync(outputPath,'utf8'));cli.analysis.intelligence.elapsed_ms=http.analysis.intelligence.elapsed_ms=0;
  assert.deepEqual(cli,http);assert.equal(generateCalls,0);assert.equal(cli.lang,'kk');assert.equal(cli.draft_reply.lang,'kk');assert.deepEqual(cli.analysis.intelligence.draft.requested_fields,[]);
  assert.doesNotMatch(JSON.stringify(cli),/PRIVATE_OUTCOME|PRIVATE_ADMIN/);
  assert.equal((await call('/api/intelligence/initialize','POST',{draftMode:'native'})).status,400);
});

test('native HTTP and UI share projection while rejected native attempts preserve code fallback and human/operator gates',async t=>{
  const {engine,directory}=fixture(t);let attempt=0;
  const intelligence=createIntelligence({baseline:engine,modelDir:join(directory,'missing'),draftMode:'native',generatorConfig:{enabled:true,focusMode:'model',activationManifestPath:'injected-test-only',requiredActivationScope:'operator-generation'},generatorFactory:()=>({status:()=>({enabled:true}),close:async()=>{},generate:async(input,result)=>{
    attempt++;if(attempt===2)return{status:'quality-failed',text:'REJECTED',lang:'es',needs_human:false,metrics:{generated:false,executed:true}};
    const context=buildGenerationInput(input,result,engine.sources()),plan={schema_version:'support-plan-v1',focus:context.allowed_focuses[0],fact_ids:context.facts.map(f=>f.id),request_fields:context.missing_fields,source_ids:context.allowed_sources.map(s=>s.id),needs_human:context.needs_human};
    return{status:'generated',...renderPlan(plan,context),plan,metrics:{generated:true,executed:true}};
  }})});t.after(()=>intelligence.close());
  const call=await serve(t,engine,intelligence,directory),input=raw('My payment of 38 credits on 2026-08-12 did not arrive.','uz');
  const http=(await call('/triage','POST',input)).data;
  assert.equal(attempt,1);assert.equal(http.analysis.intelligence.generation.metrics.generated,true);assert.equal(http.lang,'uz');assert.equal(http.needs_human,true);
  const ticket=(await call('/api/tickets','POST',input)).data.ticket;
  assert.equal(attempt,2);assert.equal(ticket.triage.analysis.intelligence.generation.status,'quality-failed');assert.equal(ticket.triage.analysis.intelligence.draft.status,'code-context');assert.doesNotMatch(ticket.triage.draft_reply.text,/REJECTED/);
  await call(`/api/tickets/${ticket.id}`,'PATCH',{action:'save',draft_reply:'Operator text'});await call(`/api/tickets/${ticket.id}`,'PATCH',{action:'escalate'});
  const ui=(await call(`/api/tickets/${ticket.id}/generate`,'POST',{})).data;
  assert.equal(ui.ticket.triage.draft_reply.text,http.draft_reply.text);assert.equal(ui.ticket.triage.lang,http.lang);assert.deepEqual(ui.ticket.triage.citations,http.citations);
  assert.equal(ui.ticket.edited_reply,'Operator text');assert.equal(ui.ticket.status,'escalated');assert.equal(ui.ticket.triage.needs_human,true);
});

test('projection only accepts prior canonical sources and code-owned safety signals',t=>{
  const {engine}=fixture(t),input=raw('Hello'),result=prepared(engine,input),source=engine.sources()[0];result.citations=[source];
  applyGenerationProjection(result,{status:'quality-failed',needs_human:true,safety_context:{schema_version:'generation-safety-v1',origin:'model',needs_human:true,reason:'no_verified_answer'},metrics:{generated:false}},[source]);assert.equal(result.needs_human,false);
  applyGenerationProjection(result,{status:'generated',text:'Accepted code renderer text',lang:'kk',needs_human:false,source_ids:[source.id,'invented:7'],plan:{schema_version:'support-plan-v1'},metrics:{generated:true}},[source]);
  assert.deepEqual(result.analysis.intelligence.generation.source_ids,[source.id]);assert.deepEqual(result.draft_reply.cited,[source.label]);
  applyGenerationProjection(result,{status:'unavailable',safety_context:{schema_version:'generation-safety-v1',origin:'code_context',needs_human:true,reason:'no_verified_answer'},metrics:{generated:false}},[source]);assert.equal(result.needs_human,true);
});

test('CLI refuses native misconfiguration rather than silently completing with generic drafts',t=>{
  const {directory,dataDir}=fixture(t),inputPath=join(directory,'input.jsonl'),outputPath=join(directory,'output.jsonl');writeFileSync(inputPath,JSON.stringify(raw('Hello'))+'\n');
  const args=[fileURLToPath(new URL('../src/cli/predict.mjs',import.meta.url)),'--in',inputPath,'--out',outputPath,'--data-dir',dataDir,'--mode','v2'];
  assert.throws(()=>execFileSync(process.execPath,args,{env:{...process.env,LOCAL_GENERATOR:'1',GENERATOR_FOCUS_MODE:'model',GENERATOR_ACTIVATION_MANIFEST:join(directory,'missing')},stdio:['ignore','pipe','pipe']}),error=>error.status===1&&/GENERATOR_ACTIVATION_MANIFEST/.test(error.stderr.toString()));
});

test('native and later UI generation retain original canonical basis when fast focus excluded its rule',async t=>{
  const {engine,directory}=fixture(t);
  const source={id:'30:2.1',section_id:30,section:'Authored synthetic support policy',ref:'2.1',label:'Authored synthetic 2.1',text:'AUTHORED SYNTHETIC: insults require a staff review.'};
  const baseline={...engine,sources:()=>[...engine.sources(),source],triage(input,options){const result=engine.triage(input,options);result.category='report.payment';result.priority='p0';result.needs_human=true;result.citations=[structuredClone(source)];result.draft_reply.cited=[source.label];return result;}};
  let calls=0;
  const options={baseline,modelDir:join(directory,'missing'),generatorConfig:{enabled:true,focusMode:'model',activationManifestPath:'injected-test-only',requiredActivationScope:'operator-generation'},generatorFactory:()=>({status:()=>({enabled:true}),close:async()=>{},generate:async(input,result)=>{
    calls++;assert.deepEqual(result.citations.map(item=>item.id),[source.id]);assert.equal(result.needs_human,true);
    assert.doesNotMatch(JSON.stringify(input),/IGNORED_ADMIN|IGNORED_OUTCOME/);
    const context=buildGenerationInput(input,result,baseline.sources(),{proposedFocus:'complaint',focusOrigin:'local_llm'});
    assert.deepEqual(context.allowed_sources.map(item=>item.id),[source.id]);
    const plan={schema_version:'support-plan-v1',focus:'complaint',fact_ids:context.facts.map(f=>f.id),request_fields:context.missing_fields,source_ids:[source.id],needs_human:true};
    return{status:'generated',...renderPlan(plan,context),text:'MODEL TEXT WITH UNVERIFIED PROMISE',plan,metrics:{generated:true,executed:true}};
  }})};
  const native=createIntelligence({...options,draftMode:'native'});t.after(()=>native.close());
  const input={...raw('Player Rowan_Lake insulted me.','en'),outcome:'IGNORED_OUTCOME',messages:[{role:'player',text:'Player Rowan_Lake insulted me.'},{role:'admin',text:'IGNORED_ADMIN'}]},result=await native.triage(input);
  assert.deepEqual(result.citations.map(item=>item.id),[source.id]);assert.deepEqual(result.draft_reply.cited,[source.label]);assert.match(result.draft_reply.text,/Authored synthetic 2\.1/);
  assert.deepEqual(result.analysis.intelligence.generation.source_ids,[source.id]);
  const fast=createIntelligence(options);t.after(()=>fast.close());
  const call=await serve(t,baseline,fast,directory),ticket=(await call('/api/tickets','POST',input)).data.ticket;
  assert.deepEqual(ticket.triage.citations,[],'fast deterministic payment focus excludes the insult rule');
  await call(`/api/tickets/${ticket.id}`,'PATCH',{action:'save',draft_reply:'Operator original'});
  await call(`/api/tickets/${ticket.id}`,'PATCH',{action:'escalate'});
  const generated=(await call(`/api/tickets/${ticket.id}/generate`,'POST',{})).data;
  assert.equal(calls,2);assert.equal(generated.generation.status,'generated');assert.deepEqual(generated.generation.source_ids,[source.id]);
  assert.deepEqual(generated.ticket.triage.citations.map(item=>item.id),[source.id]);assert.deepEqual(generated.ticket.triage.draft_reply.cited,[source.label]);assert.equal(generated.ticket.triage.draft_reply.text,result.draft_reply.text);
  assert.equal(generated.ticket.triage.needs_human,true);assert.equal(generated.ticket.edited_reply,'Operator original');assert.equal(generated.ticket.status,'escalated');
  assert.doesNotMatch(generated.ticket.triage.draft_reply.text,/UNVERIFIED PROMISE/,'accepted text is rerendered from the checked plan');
  const unbound=JSON.parse(JSON.stringify(generated.generation));
  const other=await fast.triage(input),fallback=other.draft_reply.text;
  applyGenerationProjection(other,unbound,baseline.sources());
  assert.equal(unbound.status,'quality-failed','serialization cannot carry private citation eligibility');assert.equal(unbound.metrics.generated,false);
  assert.equal(other.draft_reply.text,fallback);assert.deepEqual(other.citations,[]);
});

test('forged generation source metadata cannot widen the private raw canonical basis',async t=>{
  const {engine,directory}=fixture(t),source=engine.sources()[0];
  const intelligence=createIntelligence({baseline:engine,modelDir:join(directory,'missing'),generatorConfig:{enabled:true},generatorFactory:()=>({status:()=>({enabled:true}),close:async()=>{},generate:async(input,result)=>{
    const context=buildGenerationInput(input,result,engine.sources(),{proposedFocus:'complaint'});
    const plan={schema_version:'support-plan-v1',focus:'complaint',fact_ids:context.facts.map(f=>f.id),request_fields:context.missing_fields,source_ids:[source.id],needs_human:context.needs_human};
    return{status:'generated',text:'Forged rule promise',source_ids:[source.id],trusted_basis:[source],prior_citations:[source],safety_context:{schema_version:'generation-safety-v1',origin:'code_context',needs_human:false,reason:'not_required'},plan,metrics:{generated:true,executed:true}};
  }})});t.after(()=>intelligence.close());
  const input=raw('Player Alder_Moon insulted me.'),result=await intelligence.triage(input),fallback=result.draft_reply.text;
  assert.deepEqual(result.citations,[]);
  const generation=await intelligence.generate(input,result);
  applyGenerationProjection(result,generation,engine.sources());
  assert.equal(generation.status,'quality-failed');assert.equal(generation.metrics.generated,false);assert.equal(generation.metrics.executed,true);
  assert.equal(result.draft_reply.text,fallback);assert.deepEqual(result.citations,[]);assert.equal(result.needs_human,true);
});

test('shared preparation reserve bounds native and experimental UI budgets and skips insufficient budgets honestly',async t=>{
  const {engine,directory}=fixture(t),input=raw('My payment of 43 credits did not arrive.');
  for(const [focusMode,budget,expectedCalls] of [['model',60000,1],['model',3000,0],['deterministic',6000,1],['deterministic',1000,0]]) {
    let nativeCalls=0,effective;
    const intelligence=createIntelligence({baseline:engine,modelDir:join(directory,'missing'),draftMode:'fast',generatorConfig:{enabled:true,focusMode,timeoutMs:budget,...(focusMode==='model'?{activationManifestPath:'injected-only',requiredActivationScope:'operator-generation'}:{})},generatorFactory:({config})=>{
      effective=config.timeoutMs;
      return{status:()=>({enabled:true}),close:async()=>{},generate:async()=>{nativeCalls++;return{status:'unavailable',reason:'Injected unavailable',metrics:{generated:false,executed:false}};}};
    }});t.after(()=>intelligence.close());
    const current=await intelligence.triage(input),generation=await intelligence.generate(input,current);
    assert.equal(nativeCalls,expectedCalls);assert.equal(effective,Math.max(1,budget-4400));assert.equal(generation.metrics.budget_ms,budget);assert.equal(generation.metrics.native_budget_ms,effective);
    assert.equal(generation.metrics.executed,false);assert.ok(generation.metrics.total_elapsed_ms>=generation.metrics.preparation_ms);assert.ok(generation.metrics.total_elapsed_ms<budget);
    if(!expectedCalls)assert.match(generation.reason,/no remaining native budget/);
  }
});

test('a concurrent human gate is reflected in the bound plan, localized text and safety metadata together',async t=>{
  const {engine,directory}=fixture(t),input=raw('Hello','kk');let entered,release;
  const reached=new Promise(resolve=>{entered=resolve;}),continueGeneration=new Promise(resolve=>{release=resolve;});
  const intelligence=createIntelligence({baseline:engine,modelDir:join(directory,'missing'),generatorConfig:{enabled:true},generatorFactory:()=>({status:()=>({enabled:true}),close:async()=>{},generate:async(input,result)=>{
    const context=buildGenerationInput(input,result,engine.sources()),plan={schema_version:'support-plan-v1',focus:context.allowed_focuses[0],fact_ids:[],request_fields:[],source_ids:[],needs_human:context.needs_human};
    assert.equal(plan.needs_human,false);entered();await continueGeneration;
    return{status:'generated',...renderPlan(plan,context),plan,safety_context:{schema_version:'generation-safety-v1',origin:'code_context',needs_human:false,reason:'not_required'},metrics:{generated:true,executed:true}};
  }})});t.after(()=>intelligence.close());
  const current=await intelligence.triage(input),pending=intelligence.generate(input,current);await reached;
  current.needs_human=true;release();const generation=await pending;applyGenerationProjection(current,generation,engine.sources());
  assert.equal(generation.status,'generated');assert.equal(generation.plan.needs_human,true);assert.equal(generation.needs_human,true);assert.equal(generation.safety_context.needs_human,true);
  assert.equal(current.needs_human,true);assert.equal(current.lang,'kk');assert.equal(current.draft_reply.lang,'kk');assert.match(current.draft_reply.text,/маманы тексеруі/u);
});

test('canonical identity changes or divergent plan/source ids reject the whole bound projection',async t=>{
  const {engine,directory}=fixture(t),input=raw('My account was hacked.'),source=engine.sources()[0];
  const intelligence=createIntelligence({baseline:engine,modelDir:join(directory,'missing'),generatorConfig:{enabled:true},generatorFactory:()=>({status:()=>({enabled:true}),close:async()=>{},generate:async(input,result)=>{
    const context=buildGenerationInput(input,result,engine.sources()),plan={schema_version:'support-plan-v1',focus:context.allowed_focuses[0],fact_ids:context.facts.map(f=>f.id),request_fields:context.missing_fields,source_ids:context.allowed_sources.map(s=>s.id),needs_human:context.needs_human};
    return{status:'generated',...renderPlan(plan,context),plan,metrics:{generated:true,executed:true}};
  }})});t.after(()=>intelligence.close());
  for(const changedCanonical of [false,true]) {
    const current=await intelligence.triage(input),fallback=structuredClone(current.draft_reply),generation=await intelligence.generate(input,current);
    assert.deepEqual(generation.source_ids,[source.id]);
    if(!changedCanonical)generation.source_ids=[];
    applyGenerationProjection(current,generation,changedCanonical?[{...source,section:'Changed canonical namespace'}]:engine.sources());
    assert.equal(generation.status,'quality-failed');assert.equal(generation.metrics.generated,false);assert.equal(generation.metrics.executed,true);
    assert.deepEqual(current.draft_reply,fallback);assert.equal(current.needs_human,true);
  }
});

test('English name-calling and verbal-abuse allegations preserve a prior verified rule across idiom families',t=>{
  const {engine}=fixture(t),source={id:'30:2.1',section_id:30,section:'Authored synthetic support policy',ref:'2.1',label:'Authored synthetic 2.1',text:'AUTHORED SYNTHETIC: insulting a participant requires staff review.'};
  for(const text of [
    'She repeatedly called my parents horrible names.',
    'Another player keeps calling my sister nasty names in chat.',
    'He was verbally abusing my family.',
    'They bad-mouthed my mother during the game.',
    'I was called disgusting names by another player.',
    'A player hurled insults at my brother.',
    'He made derogatory remarks about my relatives.',
    'She insulted me in chat.',
    'He called my father "worthless".',
    'He called me names. How can I report this?',
    'He did not stop calling my parents nasty names.',
    'No one else helped when he called my family horrible names.',
    'When she called my sister disgusting names, I left the chat.',
    'He keeps name-calling my younger brother.',
    'My relatives suffered verbal abuse from another player.',
    'He used derogatory language about my grandparents.',
    'They talked trash about my parents.',
    'He started to call my parents nasty names after joining the chat.',
  ]) {
    const input=raw(text),result=prepared(engine,input);result.category='complaint.insult';result.citations=[source];result.analysis.intelligence.source_application={status:'semantic_category_context_verified',selected_ids:[source.id]};
    const context=buildGenerationInput(input,result,[source]);
    assert.deepEqual(context.allowed_sources.map(item=>item.id),[source.id],text);assert.equal(context.intent_mode,'actual_incident',text);
    const projected=codeContextDraft(input,result,[source]);assert.deepEqual(projected.citations.map(item=>item.id),[source.id],text);assert.deepEqual(projected.draft_reply.cited,[source.label],text);assert.match(projected.draft_reply.text,/Authored synthetic 2\.1/);assert.equal(projected.needs_human,true);
    const neutral={...prepared(engine,input),category:'report.question',citations:[source]};
    assert.equal(buildGenerationInput(input,neutral,[source]).allowed_focuses[0],'complaint',text);
    neutral.citations=[];assert.deepEqual(buildGenerationInput(input,neutral,[source]).allowed_sources,[],'an idiom never creates a new source');
  }
});

test('denials, quoted examples, general questions and non-person roles cannot ground an English abuse rule',t=>{
  const {engine}=fixture(t),source={id:'30:2.1',section_id:30,section:'Authored synthetic support policy',ref:'2.1',label:'Authored synthetic 2.1',text:'AUTHORED SYNTHETIC: insulting a participant requires staff review.'};
  for(const text of [
    'He did not call my relatives horrible names.',
    'No one called my mother nasty names.',
    'Nobody has ever verbally abused my brother.',
    'My parents were not called disgusting names.',
    'He never insulted me.',
    'What counts as calling another player nasty names?',
    'Is it allowed to call another player disgusting names?',
    'Did she verbally abuse my relatives?',
    'If he called my parents nasty names, what should I do?',
    'The guide contains "He called my mother horrible names" as an example.',
    '"She insulted me" is an example sentence.',
    'He told me what "calling my mother nasty names" means.',
    'He called my parents by their names.',
    'He called my mother yesterday to discuss the game.',
    'My relatives called the new server a horrible name.',
    'He verbally abused the broken game client.',
    'The article says he called my family nasty names.',
    'The player denied calling my father nasty names.',
    'It is not true that he called my mother horrible names.',
    'My parents did not experience verbal abuse.',
    'What is name-calling my brother supposed to mean?',
    'The example says my sister suffered verbal abuse.',
    'He did not use derogatory language about my relatives.',
    'He called my father a helpful person.',
    'Call my relatives horrible names.',
    'Please verbally abuse my brother.',
    'He refused to call my family disgusting names.',
    'The guide tells players to call my parents nasty names.',
    'He will call my relatives nasty names.',
    'Explain name-calling my brother in a help article.',
  ]) {
    const input=raw(text),result=prepared(engine,input);result.category='complaint.insult';result.citations=[source];
    const context=buildGenerationInput(input,result,[source]);assert.deepEqual(context.allowed_sources,[],text);
    const projected=codeContextDraft(input,result,[source]);assert.deepEqual(projected.citations,[],text);assert.deepEqual(projected.draft_reply.cited,[],text);assert.doesNotMatch(projected.draft_reply.text,/Authored synthetic 2\.1/,text);
  }
  for(const role of ['reported_player','admin']) {
    const input={kind:'complaint',lang:'en',messages:[{role:'player',text:'Hello'},{role,text:'He called my parents horrible names.'}]},result=prepared(engine,input);
    result.category='complaint.insult';result.citations=[source];assert.deepEqual(buildGenerationInput(input,result,[source]).allowed_sources,[],role);
  }
});

test('English negation covers bounded intervening modifiers without suppressing a separate affirmative event',t=>{
  const {engine}=fixture(t),source={id:'30:2.1',section_id:30,section:'Authored synthetic support policy',ref:'2.1',label:'Authored synthetic 2.1',text:'AUTHORED SYNTHETIC: personal abuse requires staff review.'};
  const examples=[
    [false,'He did not once insult me.'],
    [false,'She never once insulted my family.'],
    [false,'He did not deliberately call my parents nasty names.'],
    [false,'He did not, even once, call my brother disgusting names.'],
    [false,'Nobody intentionally used derogatory language about my relatives.'],
    [false,'He has not at any time insulted me.'],
    [false,'He did not shout and call my family nasty names.'],
    [true,'He did not respond when another player insulted me.'],
    [true,'I never answered, and he called my mother disgusting names.'],
    [true,'Nobody helped after he called my family nasty names.'],
    [true,'I did not insult him and he called my relatives horrible names.'],
    [true,'He did not stop calling my parents nasty names.'],
    [true,'He never stopped insulting me.'],
    [true,'He not only insulted me but also used derogatory language about my parents.'],
    [true,'He insulted me. What should I do if he does not stop?'],
  ];
  for(const [allowed,text] of examples) {
    const input=raw(text),result=prepared(engine,input);result.category='complaint.insult';result.citations=[source];
    const context=buildGenerationInput(input,result,[source]);assert.equal(context.allowed_sources.some(item=>item.id===source.id),allowed,text);
    const projected=codeContextDraft(input,result,[source]);assert.equal(projected.citations.some(item=>item.id===source.id),allowed,text);
    assert.equal(projected.draft_reply.cited.includes(source.label),allowed,text);
  }
});

test('semantic features share existing normalization across clean and legacy Kazakh topics without rewriting claims',t=>{
  const {engine}=fixture(t);
  const pairs=[
    ['technical','Көлігім қабырғаның ішінде тұрып қалды.','Кјлігім ќабырґаныѕ ішінде тўрып ќалды.','actual_incident'],
    ['account','Құпиясөзім өзгерді, аккаунтыма кіре алмаймын.','Ќўпиясјзім јзгерді, аккаунтыма кіре алмаймын.','actual_incident'],
    ['payment','Төлемімді төледім, сатып алғаным келмеді.','Тјлемімді тјледім, сатып алґаным келмеді.','actual_incident'],
    ['question','Қандай анықтама құжаты қажет','Ќандай аныќтама ќўжаты ќажет','knowledge_gap'],
    ['clarification','Сәлеметсіз бе!','Сєлеметсіз бе!','initial_clarification'],
    ['clarification','Маған көмек қажет.','Маґан кјмек ќажет.','initial_clarification'],
  ];
  for(const [focus,clean,legacy,intent]of pairs)for(const text of [clean,legacy]) {
    const input=raw(text,'kk'),original=structuredClone(input),result=prepared(engine,input);result.category='report.question';
    const context=buildGenerationInput(input,result,engine.sources());
    assert.equal(context.allowed_focuses[0],focus,text);assert.equal(context.intent_mode,intent,text);assert.equal(context.player_claim_unverified,text);assert.deepEqual(input,original);
    const projected=codeContextDraft(input,result,engine.sources());assert.equal(projected.lang,'kk');assert.equal(projected.draft_reply.lang,'kk');
    if(intent==='actual_incident'){assert.equal(context.field_states.problem_description.state,'supplied');assert.ok(!projected.analysis.intelligence.draft.requested_fields.includes('problem_description'));}
    const payload=JSON.parse(buildFocusMessages(input)[1].content.replace(/\n\/no_think$/u,''));assert.deepEqual(payload.player_messages,[text],'native classifier payload keeps original authored text');
  }
});

test('Uzbek apostrophe variants and normalized denials keep the same bounded semantic context',t=>{
  const {engine}=fixture(t);
  for(const apostrophe of ["'",'‘','’','ʻ','ʼ','`'])for(const [focus,template]of [['payment',"Men to'ladim, lekin xaridim kelmadi."],['account',"Kimdir parolimni o'zgartirdi."],['question',"Men to'lov qilmadim. Qanday hujjat kerak?"]]) {
    const text=template.replaceAll("'",apostrophe),input=raw(text,'uz'),result=prepared(engine,input);result.category='report.question';
    const context=buildGenerationInput(input,result,engine.sources());assert.equal(context.allowed_focuses[0],focus,text);assert.equal(context.player_claim_unverified,text);
    if(focus==='question')assert.equal(context.intent_mode,'knowledge_gap');
  }
  for(const text of ['Мен төлем жасаған жоқпын. Қандай анықтама қажет?','Мен тјлем жасаґан жоќпын. Ќандай аныќтама ќажет?']) {
    const input=raw(text,'kk'),result=prepared(engine,input);result.category='report.question';const context=buildGenerationInput(input,result,engine.sources());assert.equal(context.allowed_focuses[0],'question');assert.equal(context.intent_mode,'knowledge_gap');
  }
});

test('semantic normalization preserves raw fact values/spans, quoted-event boundaries and negation source guards',t=>{
  const {engine}=fixture(t),text='Кјлігім ќабырґаныѕ ішінде тўрып ќалды. Server Oriole-62. Windows. Оқиға уақыты 19:24.',input={...raw(text,'kk'),reported_nick:'Moss_River'},result=prepared(engine,input);
  const context=buildGenerationInput(input,result,engine.sources());assert.equal(context.allowed_focuses[0],'technical');assert.equal(context.player_claim_unverified,text);
  for(const fact of buildFieldStates(input).facts) {
    if(fact.field==='server')assert.equal(fact.value,'Oriole-62');if(fact.field==='platform')assert.equal(fact.value,'Windows');if(fact.field==='participant')assert.equal(fact.value,'Moss_River');
    if(fact.provenance.kind==='player_span')assert.equal(text.slice(fact.provenance.start,fact.provenance.end),fact.value);
  }
  const source={id:'30:2.1',section_id:30,section:'Authored synthetic support policy',ref:'2.1',label:'Authored synthetic 2.1',text:'AUTHORED SYNTHETIC: personal abuse requires review.'};
  for(const [allowed,text]of [[false,'He didnʼt deliberately insult me.'],[false,'The guide says "She insulted me"\nI need help.'],[true,'The guide says "She insulted me"\nAnother player called my mother nasty names.'],[true,'He called my brother ‘worthless’.']]) {
    const input=raw(text),result=prepared(engine,input);result.category='complaint.insult';result.citations=[source];const context=buildGenerationInput(input,result,[source]);assert.equal(context.allowed_sources.some(s=>s.id===source.id),allowed,text);assert.equal(context.player_claim_unverified,text);
  }
});

test('HTTP fast projection handles legacy Kazakh and Uzbek feature equivalents while retaining original player claims',async t=>{
  const {engine,directory}=fixture(t),intelligence=createIntelligence({baseline:engine,modelDir:join(directory,'missing')});t.after(()=>intelligence.close());
  const call=await serve(t,engine,intelligence,directory);
  for(const [lang,focus,clean,legacy]of [
    ['kk','technical','Көлігім қозғала алмай тұр.','Кјлігім ќозґала алмай тўр.'],
    ['kk','account','Құпиясөзім өзгерді.','Ќўпиясјзім јзгерді.'],
    ['kk','payment','Төледім, бірақ сатып алғаным жоқ.','Тјледім, біраќ сатып алґаным жоќ.'],
    ['kk','question','Қандай құжат қажет','Ќандай ќўжат ќажет'],
    ['kk','clarification','Сәлем!','Сєлем!'],
    ['uz','payment',"Men to'ladim, lekin xarid kelmadi.",'Men toʼladim, lekin xarid kelmadi.'],
  ])for(const text of [clean,legacy]) {
    const response=await call('/triage','POST',raw(text,lang));assert.equal(response.status,200,text);
    const result=response.data,draft=result.analysis.intelligence.draft;
    assert.equal(draft.plan.focus,focus,text);assert.equal(result.lang,lang);assert.equal(result.draft_reply.lang,lang);assert.equal(result.analysis.claims[0].text,text);
    assert.equal(draft.metrics.generated,false);assert.equal(draft.metrics.executed,false);
    if(['technical','account','payment'].includes(focus)){assert.equal(draft.metrics.field_states.problem_description.state,'supplied');assert.ok(!draft.requested_fields.includes('problem_description'));assert.equal(result.needs_human,true);}
  }
});
