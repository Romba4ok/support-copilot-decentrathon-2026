import {spawn,execFile} from 'node:child_process';
import {createServer} from 'node:net';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

async function reservePort(){const server=createServer();await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});const port=server.address().port;await new Promise(ok=>server.close(ok));return port;}
async function boundedJson(response){
  if(!response.ok)throw new Error(`native_http_${response.status}`);
  const reader=response.body.getReader();let size=0;const parts=[];
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>2*1024**2)throw new Error('native_response_too_large');parts.push(Buffer.from(item.value));}}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

/** One owned b11960 CPU process. No resource restoration occurs in this class. */
export function createNativeSession({modelPath,runtimePath,signal,observeMemory=true},deps={}){
  const spawnProcess=deps.spawnProcess||spawn,fetchHttp=deps.fetchHttp||fetch,portProvider=deps.portProvider||reservePort;
  let child=null,starting=null,closing=null,closed=false,error=null,exitPromise=null,url,key,sampler=null,sampling=null,forceTimer=null;
  const usage={peak_rss_bytes:0,peak_private_bytes:0,sampled_cpu_seconds:0},allocation=[];let exit=null;
  const terminate=()=>{if(child?.pid&&child.exitCode===null&&child.signalCode===null)child.kill();};
  const emergency=()=>terminate();
  const onAbort=()=>terminate();
  function sample(){
    if(sampling||!child?.pid)return sampling;
    const pid=child.pid;
    sampling=new Promise(ok=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-Process -Id ([int]$env:SUPPORT_NATIVE_SESSION_PID) -ErrorAction Stop | Select-Object WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress'],{windowsHide:true,timeout:1000,killSignal:'SIGKILL',env:{...process.env,SUPPORT_NATIVE_SESSION_PID:String(pid)}},(failure,text)=>{if(!failure)try{const value=JSON.parse(text);usage.peak_rss_bytes=Math.max(usage.peak_rss_bytes,Number(value.WorkingSet64)||0);usage.peak_private_bytes=Math.max(usage.peak_private_bytes,Number(value.PrivateMemorySize64)||0);usage.sampled_cpu_seconds=Math.max(usage.sampled_cpu_seconds,Number(value.CPU)||0);}catch{}ok();})).finally(()=>{sampling=null;});return sampling;
  }
  async function request(path,payload,options={}){
    if(closed||error)throw error||new Error('native_session_closed');
    const response=await fetchHttp(`${url}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(payload),signal:options.signal||signal});
    return boundedJson(response);
  }
  function start(options={}){
    if(starting)return starting;
    starting=(async()=>{
      if(closed||signal?.aborted)throw new Error('native_session_closed');
      const port=await portProvider();if(closed||signal?.aborted)throw new Error('native_session_closed');
      key=randomBytes(24).toString('hex');url=`http://127.0.0.1:${port}`;
      const args=['--model',modelPath,'--host','127.0.0.1','--port',String(port),'--api-key',key,'--ctx-size','1024','--parallel','1','--threads','2','--threads-batch','2','--batch-size','64','--ubatch-size','32','--gpu-layers','0','--reasoning','off','--reasoning-budget','0','--jinja','--offline','--no-webui','--load-mode','mmap','--no-repack',...(observeMemory?['--log-verbosity','4']:['--log-disable'])];
      child=spawnProcess(runtimePath,args,{windowsHide:true,stdio:['ignore',observeMemory?'pipe':'ignore',observeMemory?'pipe':'ignore'],cwd:dirname(runtimePath),env:{...process.env,HF_HUB_OFFLINE:'1'}});
      child.once('error',value=>{error=value;});
      exitPromise=new Promise(ok=>child.once('close',(code,termination)=>{exit={code,signal:termination};ok();}));
      process.once('exit',emergency);signal?.addEventListener('abort',onAbort,{once:true});
      if(observeMemory){for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>{for(const line of data.toString().split(/\r?\n/u))if(/CPU_Mapped|KV.*(?:cache|size)|(?:CPU|host|model|compute).*buffer size|load_tensors.*(?:mmap|mapped)|memory breakdown/iu.test(line)&&allocation.length<80)allocation.push(line.slice(0,500));});if(!deps.disableSampling)sampler=setInterval(sample,1000);}
      while(true){
        if(closed||signal?.aborted||options.signal?.aborted)throw new Error('native_session_aborted');
        if(error)throw error;if(child.exitCode!==null||child.signalCode!==null)throw new Error('native_session_exited');
        try{const response=await fetchHttp(`${url}/health`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.any([options.signal||signal||new AbortController().signal,AbortSignal.timeout(500)])});if(response.ok)return;}catch(failure){if(signal?.aborted)throw failure;}
        await delay(100,undefined,{signal:options.signal||signal});
      }
    })();return starting;
  }
  function close(){
    if(closing)return closing;closed=true;
    closing=(async()=>{
      clearInterval(sampler);signal?.removeEventListener('abort',onAbort);
      if(child?.pid&&child.exitCode===null&&child.signalCode===null){terminate();forceTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1000);}
      if(exitPromise)await exitPromise;clearTimeout(forceTimer);if(sampling)await sampling;process.removeListener('exit',emergency);
    })();return closing;
  }
  return{get pid(){return exit?null:child?.pid||null;},start,terminate,close,
    // b11960 routes both this endpoint and completions through the same chat
    // parser and tokenizer, including BOS, schema and thinking parameters.
    tokenCount:async(payload,options)=>{const value=await request('/v1/chat/completions/input_tokens',payload,options);if(!Number.isInteger(value.input_tokens)||value.input_tokens<1)throw new Error('native_token_count_invalid');return value.input_tokens;},
    complete:(payload,options)=>request('/v1/chat/completions',payload,options),
    observedMetrics:()=>({observed_memory:{...usage},allocation_log:[...allocation],exit}),
  };
}
