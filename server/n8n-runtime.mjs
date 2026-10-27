import {z} from 'zod/v3';
import {workerRequest} from './quality.mjs';
import {registerRoutes} from './routes.mjs';
import {createRouter} from './router.mjs';
export async function applyRequest({snapshot,auth,request,config={}}){
  const original=JSON.stringify(snapshot);
  let state={...structuredClone(snapshot),challenges:structuredClone(auth.challenges||[]),sessions:structuredClone(auth.sessions||[])};
  // Session and challenge cleanup stays outside Git history.
  state.sessions=state.sessions.filter(s=>s.expires>Date.now());
  state.challenges=state.challenges.filter(c=>c.createdAt>Date.now()-3600000);
  let pendingMail=null,pendingUpload=null,pendingChat=null;
  const store={read:async()=>structuredClone(state),change:async fn=>{const draft=structuredClone(state);const result=await fn(draft);state=draft;return result;}};
  const blobs={put:async(name,bytes,type)=>{pendingUpload={name,data:bytes.toString('base64'),type};},get:async name=>({attachmentId:name}),remove:async()=>{pendingUpload=null;}};
  const app=createRouter();registerRoutes(app,{store,env:{STORAGE_KIND:'github-private-repository'},blobs,
    deliverMail:config.mailReady?async({email,code})=>{pendingMail={to:email,code,purpose:'pandora_login',expiresInMinutes:10};}:null,
    chat:config.agentReady?async body=>{pendingChat=body;return {reply:''};}:null});
  let r;
  if(config.internalWorker){const draft=structuredClone(state);try{const body=workerRequest(draft,request);state=draft;r={status:200,contentType:'application/json',body};}catch(err){const status=err instanceof z.ZodError?400:err.status||500;r={status,contentType:'application/json',body:{error:err instanceof z.ZodError?'Invalid internal worker payload':status===500?'Unexpected worker error':err.message}};}}
  else r=await app.dispatch({method:request.method||'GET',path:'/api'+request.path,body:request.body||{},headers:{authorization:request.token?`Bearer ${request.token}`:''}});
  const response={status:r.status,body:r.body};
  let download=null;
  if(r.contentType!=='application/json'&&r.body?.attachmentId){const a=state.attachments.find(a=>a.id===r.body.attachmentId);download={sha:a.blobSha,name:a.name,type:a.type};response.body={};}
  const authNext={...auth,challenges:state.challenges,sessions:state.sessions};
  delete state.challenges;delete state.sessions;
  if(Buffer.byteLength(JSON.stringify(state),'utf8')>700_000)return {response:{status:413,body:{error:'Pilot record capacity reached; contact the owner'}},authNext:auth,writeGit:false,pendingMail:null,pendingUpload:null,pendingChat:null,download:null};
  const changedEvents=JSON.stringify(state.issueAutomationEvents||[])!==JSON.stringify(snapshot.issueAutomationEvents||[]);
  const pendingAutomation=!config.internalWorker&&response.status<400&&changedEvents;
  return {response,authNext,snapshot:state,writeGit:JSON.stringify(state)!==original,pendingMail,pendingUpload,pendingChat,download,pendingAutomation};
}
