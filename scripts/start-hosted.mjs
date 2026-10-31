import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const APP=resolve(fileURLToPath(new URL('..',import.meta.url)));

export function hostingEnvironment(environment=process.env){
  const origin=environment.PUBLIC_ORIGIN||environment.RENDER_EXTERNAL_URL;
  let url;
  try{url=new URL(origin);}catch{throw Error('Set PUBLIC_ORIGIN or RENDER_EXTERNAL_URL to the exact HTTPS origin.');}
  if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)throw Error('Hosted access requires an exact HTTPS origin without a path, query or credentials.');
  const password=environment.SUPPORT_ADMIN_PASSWORD;
  if(typeof password!=='string'||password.length<16||password.length>512||/[\r\n]/u.test(password)||!password.trim())throw Error('Set a generated SUPPORT_ADMIN_PASSWORD of at least 16 characters.');
  const user=environment.SUPPORT_ADMIN_USER||'admin';
  if(typeof user!=='string'||!user.trim()||user.length>128||/[:\r\n]/u.test(user))throw Error('Set a valid SUPPORT_ADMIN_USER without colon or line breaks.');
  return {...environment,HOST:'0.0.0.0',ALLOW_REMOTE:'1',PUBLIC_ORIGIN:origin,SUPPORT_ADMIN_USER:user,SUPPORT_ADMIN_PASSWORD:password,DATA_DIR:join(APP,'data/hosting-demo'),RUNTIME_DIR:environment.RUNTIME_DIR||join(APP,'runtime'),LOCAL_GENERATOR:'0',TRIAGE_DRAFT_MODE:'fast',GENERATOR_FOCUS_MODE:'deterministic',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
}

export function startHosted(environment=process.env){
  const env=hostingEnvironment(environment);
  const child=spawn(process.execPath,[join(APP,'src/server.mjs')],{cwd:APP,env,stdio:'inherit',windowsHide:true});
  let closing=false,closed=false,killTimer;
  const forward=signal=>{if(closing||closed)return;closing=true;child.kill(signal);killTimer=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},10000);};
  const terminate=()=>forward('SIGTERM'),interrupt=()=>forward('SIGINT');
  process.on('SIGTERM',terminate);process.on('SIGINT',interrupt);
  child.once('error',()=>{console.error('Hosted server could not start.');process.exitCode=1;});
  child.once('close',(code,signal)=>{closed=true;clearTimeout(killTimer);process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',interrupt);process.exitCode=code??(signal==='SIGTERM'?143:signal==='SIGINT'?130:1);});
  return child;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{startHosted();}catch(error){console.error(error.message);process.exitCode=1;}
}
