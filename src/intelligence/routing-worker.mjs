import {pipeline,env} from '@huggingface/transformers';
env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.useFSCache=false;
let extractor;const started=performance.now(),cpu=process.cpuUsage();
process.on('message',async({id,type,modelDir,text})=>{
 try{let result;
  if(type==='initialize'){extractor=await pipeline('feature-extraction',modelDir,{local_files_only:true,dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1,executionMode:'sequential',enableCpuMemArena:false}});result={ready:true};}
  else if(type==='embed'){if(!extractor)throw Error('Not initialized');const v=await extractor(text.slice(0,12000),{pooling:'mean',normalize:true,truncation:true,max_length:256});result={vector:Array.from(v.data)};}
  else throw Error('Unsupported request');
  process.send?.({id,result,elapsed_ms:Math.round(performance.now()-started),memory:process.memoryUsage(),cpu:process.cpuUsage(cpu)});
 }catch(e){process.send?.({id,error:e.message});}
});
process.on('disconnect',()=>process.exit(0));
