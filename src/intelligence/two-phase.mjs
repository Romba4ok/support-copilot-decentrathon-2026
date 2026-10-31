import {performance} from 'node:perf_hooks';
import {freemem} from 'node:os';
import {createHash} from 'node:crypto';
import {createActivationFamilyVerifier} from './activation-family.mjs';
import {createNativeSession} from './native-session.mjs';
import {isPretrainedFamily,buildActivatedFocusMessages,focusProtocolForVerifiedActivation} from './focus-protocol.mjs';
import {fewshotFocusBody,fewshotPlanBody,FEWSHOT_PROTOCOL_SHA256} from './fewshot-proof-contract.mjs';
import {buildFocusMessages,buildFocusSchema,validateFocus,FOCUS_SYSTEM_PROMPT,FOCUS_SCHEMA_VERSION,PLAN_SYSTEM_PROMPT,PLAN_SCHEMA_VERSION,GENERATION_PIPELINE_VERSION,buildGenerationInput,buildPlanMessages,buildPlanSchema,validatePlan,renderPlan} from './generation-contract.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
export const TWO_PHASE_RUNTIME_VERSION='one-process-two-phase-v1';
export const RESERVE_BYTES=256*1024**2;

function codeSafety(context){
  if(!context)return undefined;
  return{schema_version:'generation-safety-v1',origin:'code_context',needs_human:context.needs_human,reason:context.original_human_gate?'baseline_required':context.unresolved?'unresolved_context':context.intent_mode==='knowledge_gap'?'no_verified_answer':context.intent_mode==='actual_incident'?'incident_requires_verification':'not_required'};
}
function problem(reason,status='unavailable'){return Object.assign(new Error(reason),{status});}
function canonicalObserverCitations(prior,sources){
  const canonical=new Map(sources.map(source=>[source.id,source]));
  return(prior||[]).flatMap(source=>{const original=canonical.get(source.id);return original&&['section_id','section','ref','text'].every(key=>source[key]===original[key])?[Object.fromEntries(['id','section_id','section','ref','text','label'].map(key=>[key,original[key]]))]:[];});
}
const rawContent=response=>response?.choices?.[0]?.message?.content||'';
const stopped=response=>response?.choices?.[0]?.finish_reason==='stop';
function payload(messages,schema,maxTokens,name){return{messages,max_tokens:maxTokens,temperature:0,seed:42,stream:false,response_format:{type:'json_schema',json_schema:{name,strict:true,schema}},chat_template_kwargs:{enable_thinking:false},reasoning_effort:'none'};}

/** Adapter boundary for moving the proven existing spawn/health/kill code into
 * a session. Exactly one runnerFactory call creates one owned model process.
 * start/tokenCount/complete receive the SAME abort signal and deadline. close
 * must kill that process and resolve only after actual child exit. */
export function twoPhasePreflight(activation,freeBytes=freemem()){
  if(isPretrainedFamily(activation.family)){
    const kv_bytes=activation.headerKVBytes,scratch_bytes=256*1024**2;
    if(kv_bytes!==117440512)throw new Error('selected_pretrained_header_geometry_required');
    const own=activation.memoryProfile?.observed_memory?.peak_private_bytes||0;
    const committed=Math.max(kv_bytes+scratch_bytes,own),required_bytes=committed+RESERVE_BYTES;
    return{ok:freeBytes>=required_bytes,free_bytes:freeBytes,required_bytes,required_new_committed_bytes:committed,kv_bytes,scratch_bytes,reserve_bytes:RESERVE_BYTES,context_tokens:1024,model_bytes:activation.modelBytes,file_backed_weight_bytes:activation.modelBytes,full_file_required_bytes:activation.modelBytes+kv_bytes+scratch_bytes+RESERVE_BYTES,mode:activation.memoryMode,old_profile_inherited:false};
  }
  const kv_bytes=117440512,scratch_bytes=128*1024**2;
  const committed=Math.max(kv_bytes+scratch_bytes,activation.memoryProfile?.observed_memory?.peak_private_bytes||0);
  const required_bytes=committed+RESERVE_BYTES;
  return{ok:freeBytes>=required_bytes,free_bytes:freeBytes,required_bytes,required_new_committed_bytes:committed,kv_bytes,scratch_bytes,reserve_bytes:RESERVE_BYTES,context_tokens:1024,model_bytes:activation.modelBytes,file_backed_weight_bytes:activation.modelBytes,full_file_required_bytes:activation.modelBytes+kv_bytes+scratch_bytes+RESERVE_BYTES,mode:activation.memoryMode};
}
export function createTwoPhaseGenerator({config={},canonicalSources=[],acquireResources=async()=>{},releaseResources=async()=>{}},deps={}){
  const freeBytes=deps.freeBytes||freemem,now=deps.now||(()=>performance.now()),monitorMs=deps.monitorMs||250;
  const loadActivation=deps.loadActivation||createActivationFamilyVerifier(config,{canonicalSources});
  const preflight=deps.preflight||(({activation})=>twoPhasePreflight(activation,freeBytes()));
  const runnerFactory=deps.runnerFactory||(({activation,signal})=>createNativeSession({modelPath:activation.modelPath,runtimePath:activation.runtimePath,signal,observeMemory:config.observeMemory!==false}));
  let active=null,closed=false,closing=null;
  let state={status:'unavailable',enabled:config.enabled===true,focus_mode:'model',runtime_version:TWO_PHASE_RUNTIME_VERSION,contract_version:PLAN_SCHEMA_VERSION,classifier_contract_version:FOCUS_SCHEMA_VERSION,context_tokens:1024,max_tokens:192,thinking:false,operator_activation:false,reason:'Model identity has not been verified'};
  const status=()=>({...state,busy:Boolean(active),closed,runtime_pid:active?.runner?.pid||null});
  function generate(input,result){
    const started=now(),configuredTimeout=Number(config.timeoutMs),timeout=Math.max(1,Math.min(60000,Number.isFinite(configuredTimeout)?configuredTimeout:60000)),deadline=started+timeout;
    let context;
    try{context=buildGenerationInput(input,result,canonicalSources);}catch{}
    const metrics={generated:false,executed:false,pipeline_version:GENERATION_PIPELINE_VERSION,runtime_version:TWO_PHASE_RUNTIME_VERSION,contract_version:PLAN_SCHEMA_VERSION,classifier_contract_version:FOCUS_SCHEMA_VERSION,focus_prompt_sha256:sha(FOCUS_SYSTEM_PROMPT),plan_prompt_sha256:sha(PLAN_SYSTEM_PROMPT),output_mode:'model_plan',plan_origin:null,text_origin:'baseline_fallback',elapsed_ms:0,phases:{focus:{executed:false},plan:{executed:false}},minimum_free_bytes:freeBytes(),context_tokens:1024,timeout_ms:timeout};
    const fallback=(reason,status='unavailable')=>({status,text:result?.draft_reply?.text||'',reason,...(context?{safety_context:codeSafety(context)}:{}),metrics:{...metrics,generated:false,plan_origin:null,text_origin:'baseline_fallback',elapsed_ms:Math.round(now()-started)}});
    if(config.enabled!==true)return Promise.resolve(fallback('Local generator is disabled'));
    if(closed)return Promise.resolve(fallback('closed'));
    if(active)return Promise.resolve(fallback('busy'));
    if(!context)return Promise.resolve(fallback('context_preparation_failed'));
    if(now()>=deadline)return Promise.resolve(fallback('timeout','timeout'));
    const controller=new AbortController();
    let abortReason=null,acquired=false,acquiring=null,timer,monitor,deadlineResult;
    const request={runner:null,cleanup:null};active=request;
    const abort=reason=>{if(controller.signal.aborted)return;abortReason=reason;controller.abort();request.runner?.terminate();};request.abort=abort;
    const stopResult=new Promise(resolve=>{deadlineResult=resolve;});
    const operation=async task=>{
      if(now()>=deadline)abort('timeout');
      if(controller.signal.aborted)throw problem(abortReason,abortReason==='timeout'?'timeout':'unavailable');
      let onAbort;
      const cancellation=new Promise((_,reject)=>{onAbort=()=>reject(problem(abortReason,abortReason==='timeout'?'timeout':'unavailable'));controller.signal.addEventListener('abort',onAbort,{once:true});});
      try{return await Promise.race([Promise.resolve().then(task),cancellation]);}finally{controller.signal.removeEventListener('abort',onAbort);}
    };
    timer=setTimeout(()=>{abort('timeout');state={...state,status:'timeout',reason:'timeout',cleanup_pending:true};deadlineResult(fallback('timeout','timeout'));},Math.max(0,deadline-now()));
    const job=(async()=>{
      let response;
      try{
        const activation=await operation(()=>loadActivation({signal:controller.signal,deadline}));
        metrics.validation_only=activation.validationOnly;metrics.model_sha256=activation.modelSha;metrics.model=activation.modelMetadata.id;metrics.model_metadata=activation.modelMetadata;metrics.activation_sha256=activation.activation_sha256;metrics.activation_family=activation.family||'joint';
        if(isPretrainedFamily(activation.family)){
          if(timeout>55600||timeout!==activation.configuration?.native_budget_ms)throw problem('pretrained_production_budget_mismatch');
          Object.assign(metrics,{import_receipt_sha256:activation.import_receipt_sha256,production_closure_sha256:activation.production_closure_sha256,corpus_sha256:activation.corpus_sha256,upstream_source_sha256:activation.upstream_source_sha256,conversion_closure_sha256:activation.conversion_closure_sha256,windows_closure_sha256:activation.windows_closure_sha256});
        }else Object.assign(metrics,{pair_manifest_sha256:activation.pair_manifest_sha256,training_source_identity_sha256:activation.training_source_identity_sha256,training_generator_sha256:activation.training_generator_sha256,actual_optimizer_steps:activation.actual_optimizer_steps});
        const focusProtocol=focusProtocolForVerifiedActivation(activation);
        if(focusProtocol)Object.assign(metrics,{focus_protocol_id:focusProtocol.id,focus_protocol_sha256:FEWSHOT_PROTOCOL_SHA256,focus_bank_sha256:focusProtocol.bank_sha256,focus_builder_sha256:focusProtocol.builder_sha256});
        state={...state,status:'running',activation_family:metrics.activation_family,...(focusProtocol?{focus_protocol_id:focusProtocol.id,focus_protocol_sha256:FEWSHOT_PROTOCOL_SHA256,focus_bank_sha256:focusProtocol.bank_sha256}:{}),model:metrics.model,model_metadata:metrics.model_metadata,operator_activation:!activation.validationOnly,activation_scope:activation.validationOnly?'private-validation':'operator-generation',reason:undefined};
        const acquireStart=now();acquiring=Promise.resolve().then(()=>acquireResources({signal:controller.signal,deadline})).then(()=>{acquired=true;});await operation(()=>acquiring);metrics.resource_acquire_ms=Math.round(now()-acquireStart);
        const pf=await operation(()=>preflight({activation,contextSize:1024,reserveBytes:RESERVE_BYTES}));metrics.preflight=pf;if(!pf.ok||pf.reserve_bytes!==RESERVE_BYTES||pf.context_tokens!==1024)throw problem('memory_preflight');
        monitor=setInterval(()=>{const currentFree=freeBytes();metrics.minimum_free_bytes=Math.min(metrics.minimum_free_bytes,currentFree);if(currentFree<RESERVE_BYTES)abort('memory_pressure');},activation.family==='pretrained-fewshot'?100:monitorMs);
        monitor.unref?.();
        request.runner=runnerFactory({activation,signal:controller.signal,deadline,contextSize:1024,threads:2,batchSize:64,microBatchSize:32,mmap:true,noRepack:true,offline:true});
        const boot=now();await operation(()=>request.runner.start({signal:controller.signal,deadline}));metrics.startup_ms=Math.round(now()-boot);
        if(isPretrainedFamily(activation.family)){metrics.owned_pid=request.runner.pid;if(!Number.isInteger(metrics.owned_pid)||metrics.owned_pid<=0)throw problem('pretrained_owned_pid_missing');}
        const call=async(phase,messages,schema,maxTokens)=>{
          const phaseStart=now(),m=metrics.phases[phase];
          const body=activation.family==='pretrained-fewshot'?(phase==='focus'?fewshotFocusBody(input):fewshotPlanBody(context)):{...payload(messages,schema,maxTokens,phase==='focus'?'support_focus_only':'support_plan'),model:metrics.model};
          if(focusProtocol)m.request_sha256=sha(JSON.stringify(body));
          if(phase==='focus'&&focusProtocol)metrics.focus_messages_sha256=sha(JSON.stringify(body.messages));
          const count=await operation(()=>request.runner.tokenCount(body,{signal:controller.signal,deadline}));
          m.prompt_tokens=count;m.max_tokens=maxTokens;
          if(!Number.isInteger(count)||count<1||count+maxTokens+8>1024)throw problem(`${phase}_context_budget`,'quality-failed');
          m.executed=true;metrics.executed=true;
          const completionStart=now();const value=await operation(()=>request.runner.complete(body,{phase,signal:controller.signal,deadline}));
          Object.assign(m,{elapsed_ms:Math.round(now()-phaseStart),finish_reason:value?.choices?.[0]?.finish_reason||null,output_sha256:sha(rawContent(value)),usage:value?.usage||null});
          m.completion_ms=Math.round(now()-completionStart);
          try{config.onRawOutput?.({phase,text:rawContent(value),usage:value?.usage,finish_reason:m.finish_reason,...(activation.family==='pretrained-fewshot'?{request_body:structuredClone(body),request_sha256:sha(JSON.stringify(body))}:{}),...(isPretrainedFamily(metrics.activation_family)&&phase==='plan'?{context_basis:{lang:result.lang,category:result.category,needs_human:result.needs_human,citations:activation.family==='pretrained-fewshot'?canonicalObserverCitations(result.citations,canonicalSources):structuredClone(result.citations||[])}}:{})});}catch{}
          if(!Number.isInteger(value?.usage?.prompt_tokens)||value.usage.prompt_tokens!==count)throw problem(`${phase}_tokenizer_mismatch`,'quality-failed');
          if(value.usage.prompt_tokens+maxTokens+8>1024||value.truncated===true)throw problem(`${phase}_server_context_budget`,'quality-failed');
          return value;
        };
        const focusResponse=await call('focus',buildActivatedFocusMessages(input,activation),buildFocusSchema(),32);
        if(!stopped(focusResponse))throw problem('focus_incomplete','quality-failed');
        const focus=validateFocus(rawContent(focusResponse));if(!focus.ok)throw problem(focus.reason,'quality-failed');
        context=buildGenerationInput(input,result,canonicalSources,{proposedFocus:focus.value.focus,focusOrigin:'local_llm'});
        metrics.focus_proposal=focus.value.focus;metrics.focus_changed=context.focus_changed;
        if(context.unresolved)throw problem(context.unresolved_reason,'quality-failed');
        const planResponse=await call('plan',buildPlanMessages(context),buildPlanSchema(context),192);
        if(!stopped(planResponse))throw problem('plan_incomplete','quality-failed');
        const plan=validatePlan(rawContent(planResponse),context);if(!plan.ok)throw problem(plan.reason,'quality-failed');
        const rendered=renderPlan(plan.value,context);
        metrics.plan_origin='local_llm';metrics.text_origin='deterministic_renderer';metrics.requested_fields=rendered.requested_fields;metrics.used_fact_ids=rendered.used_fact_ids;metrics.source_applicability=context.source_applicability;
        response={status:'generated',pipeline_version:GENERATION_PIPELINE_VERSION,intent_mode:context.intent_mode,focus_changed:context.focus_changed,text:rendered.text,lang:context.lang,language_origin:context.language_origin,original_human_gate:context.original_human_gate,contextual_human:context.contextual_human,human_escalation:context.human_escalation,source_ids:rendered.source_ids,needs_human:rendered.needs_human,plan:plan.value,plan_origin:'local_llm',text_origin:'deterministic_renderer',focus_origin:'local_llm',safety_context:codeSafety(context),metrics};
      }catch(error){response=fallback(error.message,error.status||'unavailable');}
      finally{
        if(!isPretrainedFamily(metrics.activation_family))clearInterval(monitor);
        // Cleanup remains tracked if an adapter violates its bounded exit
        // contract. The deadline returns fallback, never a half-applied draft;
        // no second job or embedding restore is allowed before actual exit.
        let exited=!request.runner;const cleanupStart=now();
        try{if(acquiring)await acquiring.catch(()=>{});if(request.runner){if(isPretrainedFamily(metrics.activation_family)&&!metrics.owned_pid&&request.runner.pid)metrics.owned_pid=request.runner.pid;const one=request.runner.close();if(isPretrainedFamily(metrics.activation_family))metrics.double_close_same_promise=one===request.runner.close();await one;exited=true;if(request.runner.observedMetrics)metrics.runtime_usage=request.runner.observedMetrics();if(isPretrainedFamily(metrics.activation_family)){metrics.runtime_pid_after_close=request.runner.pid;metrics.guard_held_until_close=Boolean(active);metrics.owned_exit_verified=metrics.double_close_same_promise===true&&request.runner.pid===null&&metrics.runtime_usage?.exit?.code===null&&['SIGTERM','SIGKILL'].includes(metrics.runtime_usage.exit.signal);if(!metrics.owned_exit_verified){exited=false;throw Error('owned_exit_not_verified');}}}if(exited)clearInterval(monitor);if(acquired){const restoreStart=now();await releaseResources({closing:closed,deadline});metrics.resource_restore_ms=Math.round(now()-restoreStart);}}
        catch(error){metrics.cleanup_error=String(error.message);response=fallback(exited?'resource_restore_failed':'owned_exit_not_verified');}
        metrics.cleanup_ms=Math.round(now()-cleanupStart);
        metrics.elapsed_ms=Math.round(now()-started);if(exited)active=null;clearTimeout(timer);
      }
      if(now()>=deadline)abort('timeout');
      if(controller.signal.aborted)response=fallback(abortReason,abortReason==='timeout'?'timeout':'unavailable');
      response.metrics={...response.metrics,...metrics,generated:response.status==='generated',plan_origin:response.status==='generated'?'local_llm':null,text_origin:response.status==='generated'?'deterministic_renderer':'baseline_fallback'};state={...state,status:response.status,reason:response.reason,cleanup_pending:Boolean(active),last_metrics:response.metrics};return response;
    })();
    request.cleanup=job;
    job.catch(()=>{});
    return Promise.race([job,stopResult]);
  }
  function close(){
    if(closing)return closing;closed=true;
    closing=(async()=>{active?.abort('closed');if(active?.cleanup)await active.cleanup;if(active?.runner){active.runner.terminate();await active.runner.close();active=null;}})();return closing;
  }
  return{generate,close,status};
}
