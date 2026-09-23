const API='https://api.groq.com/openai/v1';
const DEFAULT_MODEL='openai/gpt-oss-20b';
const CACHE_PREFIX='sfv6:';
let chain=Promise.resolve();
let nextAt=0;

const SYS=`You are a strict multilingual YouTube study-focus classifier.\nALLOW only clearly educational/academic/technical/tutorial/course/language-learning/professional-skill content and music.\nBLOCK movies/movie recaps/series/anime/trailers/gaming/memes/comedy/pranks/challenges/reactions/vlogs/lifestyle/celebrity/sports entertainment/viral/random entertainment and anything not clearly useful for study and not clearly music.\nArabic, English, and mixed titles are common. Student/school words do not automatically mean education. Narrative revenge/bullying/crime/romance titles are often entertainment. If uncertain, BLOCK.\nReturn only JSON: {\"decisions\":[{\"id\":\"same id\",\"block\":true,\"category\":\"short category\",\"reason\":\"short reason\"}]}`;

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function ck(v){return CACHE_PREFIX+(v.videoId||v.url||v.title||'');}
function parseJson(s){
  s=String(s||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(s);}catch(e){}
  const m=s.match(/\{[\s\S]*\}/); if(m){try{return JSON.parse(m[0]);}catch(e){}}
  return null;
}

function supportsStrictJson(model){
  return [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b'
  ].includes(model);
}

function reasoningOptions(model){
  if(model==='openai/gpt-oss-20b'||model==='openai/gpt-oss-120b'){
    return {
      reasoning_format:'hidden',
      reasoning_effort:'low'
    };
  }

  if(model==='qwen/qwen3.8-27b'){
    return {
      reasoning_format:'hidden',
      reasoning_effort:'low'
    };
  }

  return {};
}

function jsonResponseFormat(model,name,schema){
  if(supportsStrictJson(model)){
    return {
      type:'json_schema',
      json_schema:{
        name,
        strict:true,
        schema
      }
    };
  }

  return {type:'json_object'};
}

const TEST_SCHEMA={
  type:'object',
  properties:{
    ok:{type:'boolean'}
  },
  required:['ok'],
  additionalProperties:false
};

const CLASSIFY_SCHEMA={
  type:'object',
  properties:{
    decisions:{
      type:'array',
      items:{
        type:'object',
        properties:{
          id:{type:'string'},
          block:{type:'boolean'},
          category:{type:'string'},
          reason:{type:'string'}
        },
        required:['id','block','category','reason'],
        additionalProperties:false
      }
    }
  },
  required:['decisions'],
  additionalProperties:false
};

function retryMs(resp,txt){
  const h=resp.headers.get('retry-after');
  if(h && Number.isFinite(Number(h))) return Math.max(1000,Number(h)*1000);
  const m=String(txt).match(/try again in\s*([0-9.]+)\s*s/i);
  return m?Math.max(1000,Number(m[1])*1000):5000;
}
async function paced(url,opt,attempts=4){
  const job=async()=>{
    let err;
    for(let i=0;i<attempts;i++){
      const w=nextAt-Date.now(); if(w>0) await sleep(w);
      nextAt=Date.now()+1200;
      try{
        const r=await fetch(url,opt);
        if(r.ok) return r;
        const t=await r.text();
        if([429,500,503].includes(r.status)){
          const ms=r.status===429?retryMs(r,t):Math.min(15000,2000*(2**i));
          nextAt=Math.max(nextAt,Date.now()+ms); err=new Error(`HTTP ${r.status}: ${t.slice(0,220)}`); await sleep(ms); continue;
        }
        throw new Error(`HTTP ${r.status}: ${t.slice(0,260)}`);
      }catch(e){err=e;if(i<attempts-1) await sleep(Math.min(10000,1500*(2**i)));}
    }
    throw err||new Error('Request failed');
  };
  const p=chain.then(job,job); chain=p.catch(()=>{}); return p;
}
async function settings(){return chrome.storage.local.get({groqApiKey:'',groqModel:DEFAULT_MODEL,useGroq:true});}
async function statsInc(patch){
  const d=await chrome.storage.local.get({focusStats:{aiClassified:0,aiBatches:0,blockedTotal:0,manualBlocks:0,aiBlocks:0,errors:0,retries:0,lastError:''}});
  const s=d.focusStats||{}; for(const [k,v] of Object.entries(patch)){ if(k.startsWith('inc:')){const q=k.slice(4);s[q]=Number(s[q]||0)+Number(v||0);} else s[k]=v; }
  await chrome.storage.local.set({focusStats:s});
}
async function logBlock(video,res){
  const d=await chrome.storage.local.get({blockLogs:[]}); const a=Array.isArray(d.blockLogs)?d.blockLogs:[];
  const id=(video.videoId||video.url||video.title||'')+'|'+(res.source||'')+'|'+(res.reason||'');
  if(a.some(x=>x.id===id)) return;
  a.unshift({id,title:video.title||'',channel:video.channel||'',url:video.url||'',category:res.category||'',reason:res.reason||'',source:res.source||'',time:new Date().toISOString()});
  if(a.length>1000)a.length=1000; await chrome.storage.local.set({blockLogs:a});
}
async function listModels(key){
  if(!key) throw new Error('Enter Groq API key first.');
  const r=await paced(API+'/models',{headers:{Authorization:`Bearer ${key}`}},2); const j=await r.json();
  return (j.data||[]).map(x=>x.id).filter(Boolean).sort();
}
async function testGroq(key,model){
  const models=await listModels(key);
  if(!models.length)throw new Error('No models found.');

  if(!models.includes(model)){
    model=models.includes(DEFAULT_MODEL)?DEFAULT_MODEL:models[0];
  }

  const body={
    model,
    temperature:0,
    max_completion_tokens:256,
    ...reasoningOptions(model),
    response_format:jsonResponseFormat(
      model,
      'study_focus_connection_test',
      TEST_SCHEMA
    ),
    messages:[
      {
        role:'user',
        content:'Return a JSON object with exactly one field named ok set to true.'
      }
    ]
  };

  const r=await paced(
    API+'/chat/completions',
    {
      method:'POST',
      headers:{
        Authorization:`Bearer ${key}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(body)
    },
    2
  );

  const j=await r.json();
  const content=j?.choices?.[0]?.message?.content||'';
  const p=parseJson(content);

  if(!p?.ok){
    const finish=j?.choices?.[0]?.finish_reason||'unknown';
    const preview=String(content||'').slice(0,180);

    throw new Error(
      `Unexpected Groq response (finish_reason=${finish})`+
      (preview?`: ${preview}`:'; response content was empty.')
    );
  }

  return {model,models};
}

async function classify(videos){
  const s=await settings();
  if(s.useGroq===false) throw new Error('Groq AI fallback is disabled in Settings.');
  if(!s.groqApiKey) throw new Error('Groq API key is not configured.');

  const model=s.groqModel||DEFAULT_MODEL;

  const items=videos.map(v=>({
    id:v.clientId,
    title:String(v.title||'').slice(0,350),
    channel:String(v.channel||'').slice(0,160),
    description:String(v.description||'')
      .replace(/\s+/g,' ')
      .slice(0,450)
  }));

  const body={
    model,
    temperature:0,
    max_completion_tokens:1800,
    ...reasoningOptions(model),
    response_format:jsonResponseFormat(
      model,
      'youtube_study_focus_decisions',
      CLASSIFY_SCHEMA
    ),
    messages:[
      {
        role:'user',
        content:
          SYS+
          '\n\nClassify every item below. Return exactly one decision per id.\n'+
          JSON.stringify(items)
      }
    ]
  };

  const r=await paced(
    API+'/chat/completions',
    {
      method:'POST',
      headers:{
        Authorization:`Bearer ${s.groqApiKey}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(body)
    }
  );

  const j=await r.json();
  const content=j?.choices?.[0]?.message?.content||'';
  const p=parseJson(content);

  if(!p||!Array.isArray(p.decisions)){
    const finish=j?.choices?.[0]?.finish_reason||'unknown';

    throw new Error(
      `Groq returned invalid JSON (finish_reason=${finish})`+
      (content?`: ${String(content).slice(0,220)}`:'; response content was empty.')
    );
  }

  const map=new Map(
    p.decisions
      .filter(x=>
        x &&
        typeof x.id==='string' &&
        typeof x.block==='boolean'
      )
      .map(x=>[x.id,x])
  );

  const out=[];

  for(const v of videos){
    const x=map.get(v.clientId)||{
      block:false,
      category:'unknown',
      reason:'No AI decision returned.'
    };

    const res={
      block:!!x.block,
      category:String(x.category||'').slice(0,100),
      reason:String(x.reason||'').slice(0,240),
      source:'Groq'
    };

    await chrome.storage.local.set({
      [ck(v)]:res
    });

    await statsInc({
      'inc:aiClassified':1,
      ...(res.block
        ? {
            'inc:blockedTotal':1,
            'inc:aiBlocks':1
          }
        : {})
    });

    if(res.block){
      await logBlock(v,res);
    }

    out.push({
      id:v.clientId,
      result:res
    });
  }

  await statsInc({
    'inc:aiBatches':1,
    lastError:''
  });

  return out;
}

chrome.runtime.onMessage.addListener((m,sender,send)=>{
  if(m?.type==='GROQ_LIST_MODELS'){listModels(m.apiKey).then(models=>send({ok:true,models})).catch(e=>send({ok:false,error:e.message}));return true;}
  if(m?.type==='GROQ_TEST'){testGroq(m.apiKey,m.model).then(x=>send({ok:true,...x})).catch(e=>send({ok:false,error:e.message}));return true;}
  if(m?.type==='GROQ_CLASSIFY_BATCH'){classify(m.videos||[]).then(results=>send({ok:true,results})).catch(async e=>{await statsInc({'inc:errors':1,lastError:e.message});send({ok:false,error:e.message});});return true;}
  if(m?.type==='GET_CACHED_DECISION'){chrome.storage.local.get(ck(m.video)).then(d=>send({ok:true,result:d[ck(m.video)]||null}));return true;}
  if(m?.type==='LOG_MANUAL_BLOCK'){
    const res={block:true,category:m.category||'manual',reason:m.reason||'Matched manual filter.',source:'Manual filter'};
    logBlock(m.video,res).then(async()=>{await statsInc({'inc:blockedTotal':1,'inc:manualBlocks':1});send({ok:true});}); return true;
  }
  if(m?.type==='CLEAR_DECISION_CACHE'){chrome.storage.local.get(null).then(async all=>{const ks=Object.keys(all).filter(k=>k.startsWith(CACHE_PREFIX));if(ks.length)await chrome.storage.local.remove(ks);send({ok:true,removed:ks.length});});return true;}
  if(m?.type==='CLEAR_BLOCK_LOGS'){chrome.storage.local.set({blockLogs:[]}).then(()=>send({ok:true}));return true;}
  if(m?.type==='RESET_STATS'){chrome.storage.local.set({focusStats:{aiClassified:0,aiBatches:0,blockedTotal:0,manualBlocks:0,aiBlocks:0,errors:0,retries:0,lastError:''}}).then(()=>send({ok:true}));return true;}
  if(m?.type==='GET_STATUS'){
    chrome.storage.local.get({focusEnabled:true,cleanerEnabled:true,useGroq:true,groqApiKey:'',groqModel:DEFAULT_MODEL,hideWhileChecking:false,allowedChannels:[],blockedChannels:[],allowedTitlePhrases:[],blockedTitlePhrases:[],focusStats:{},blockLogs:[]}).then(d=>send({ok:true,enabled:d.focusEnabled!==false,cleanerEnabled:d.cleanerEnabled!==false,useGroq:d.useGroq!==false,keyConfigured:!!d.groqApiKey,model:d.groqModel,hideWhileChecking:d.hideWhileChecking===true,manualCounts:{allowedChannels:d.allowedChannels.length,blockedChannels:d.blockedChannels.length,allowedTitlePhrases:d.allowedTitlePhrases.length,blockedTitlePhrases:d.blockedTitlePhrases.length},stats:d.focusStats||{},blockLogCount:(d.blockLogs||[]).length})); return true;
  }
});
