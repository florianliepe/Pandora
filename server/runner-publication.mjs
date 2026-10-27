import {createHash} from 'node:crypto';
import {z} from 'zod/v3';
import {id,now,fail,audit} from './domain.mjs';
import {eventIsCurrent} from './issue-automation.mjs';
import {deliveryWorker} from './delivery-worker.mjs';
import {requestPullLink} from './delivery.mjs';
import {observePulls} from './delivery-observations.mjs';
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const identity=z.object({projectId:z.string().uuid(),eventId:z.string().uuid(),runId:z.number().int().positive(),jobId:z.string().uuid()}).strict();
const capability=identity.extend({workerId:z.literal('codex-local'),claimId:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function runnerContext(s,b,{renew=false}={}){
 const e=s.issueAutomationEvents?.find(e=>e.id===b.eventId&&e.projectId===b.projectId);
 const j=s.deliveries?.find(j=>j.id===b.jobId&&j.projectId===b.projectId);
 if(!e||!j||e.jobId!==j.id||j.automationEventId!==e.id||e.runId!==b.runId||e.state!=='running'||!eventIsCurrent(s,e)||j.repository!=='florianliepe/meids-app')fail(409,'Runner event is no longer authorized');
 if(renew){const cap=Object.fromEntries(['projectId','workerId','jobId','claimId','token'].map(k=>[k,b[k]]));deliveryWorker(s,{path:'/automation/delivery/renew',method:'POST',body:cap});}
 return {e,j};
}
function validateFiles(files){
 const names=new Set();let bytes=0;
 for(const f of files){
  if(names.has(f.path)||f.path.split('/').some(p=>!p||p.startsWith('.'))||!/^(frontend|backend|tests)\/[A-Za-z0-9_./-]+\.(js|cjs|mjs|ts|tsx|jsx|css|html|json|sql)$/.test(f.path))fail(400,'Publication path is outside the application/test allowlist');
  names.add(f.path);bytes+=Buffer.byteLength(f.content||'','utf8');
  if(f.content&&/(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(f.content))fail(400,'Potential secret found in candidate source');
 }
 if(bytes>3_000_000)fail(413,'Candidate source exceeds publication limit');
}
export function runnerPublication(s,action,raw){
 if(action==='publish-prepare'){
  const b=capability.extend({baseSha:sha,files:z.array(z.object({path:z.string().min(1).max(240),content:z.string().max(2_000_000).nullable()}).strict()).min(1).max(50)}).strict().parse(raw);
  const {e,j}=runnerContext(s,b,{renew:true});if(j.executionPhase!=='fix'||j.baseSha!==b.baseSha)fail(409,'Publication must use the pinned fix base');validateFiles(b.files);
  const files=[...b.files].sort((a,b)=>a.path.localeCompare(b.path)),hash=digest({baseSha:b.baseSha,files});
  if(j.publication&&j.publication.digest!==hash)fail(409,'Publication payload changed; prepare a new handoff');
  if(!j.publication)j.publication={requestId:id(),digest:hash,requestedAt:now(),state:'prepared'};
  const p=j.publication;if(p.state==='completed')return {accepted:true,duplicate:true,headSha:p.headSha,pullNumber:p.pullNumber,pullUrl:`https://github.com/${j.repository}/pull/${p.pullNumber}`};
  const author={name:'Pandora issue runner',email:'pandora-runner@users.noreply.github.com',date:p.requestedAt};
  return {publish:{projectId:b.projectId,eventId:e.id,runId:e.runId,jobId:j.id,requestId:p.requestId,repository:j.repository,baseSha:j.baseSha,branch:'pandora/'+e.id,files,commit:{message:`Pandora-Delivery: ${j.id}\nPandora-Event: ${e.id}\nPayload-SHA256: ${hash}`,author,committer:author}}};
 }
 if(action==='publish-complete'){
  // This operation is internal-only; the receiver supplies freshly fetched GitHub data.
  const b=identity.extend({requestId:z.string().uuid(),headSha:sha,pull:z.unknown()}).strict().parse(raw),{e,j}=runnerContext(s,b);
  const q=j.publication,p=b.pull;
  if(!q||q.requestId!==b.requestId||!p||!Number.isSafeInteger(p.number)||p.number<=0||p.head?.sha!==b.headSha||p.head?.ref!=='pandora/'+e.id||p.head?.repo?.full_name!==j.repository||p.base?.repo?.full_name!==j.repository||p.base?.ref!=='main'||p.base?.sha!==j.baseSha||p.state!=='open'||p.merged||!String(p.body||'').split(/\r?\n/).some(l=>l.trim()===`Pandora-Delivery: ${j.id}`))fail(409,'Published PR does not match the authorized source change');
  if(q.state==='completed'){if(q.headSha!==b.headSha||q.pullNumber!==p.number)fail(409,'Publication attestation changed');return {accepted:true,duplicate:true,headSha:q.headSha,pullNumber:q.pullNumber,pullUrl:`https://github.com/${j.repository}/pull/${q.pullNumber}`};}
  requestPullLink(s,j.projectId,j.id,s.projects.find(x=>x.id===j.projectId).issueAutomation.ownerId,{number:p.number,version:j.version});
  observePulls(s,[{kind:'pull',jobId:j.id,projectId:j.projectId,repository:j.repository,number:p.number,revision:j.pullRequest.revision,status:200,body:p}],now());
  Object.assign(q,{state:'completed',headSha:b.headSha,pullNumber:p.number,completedAt:now()});audit(s,j.projectId,'codex-runner','automation.source_published',j.id,null,{number:p.number,headSha:b.headSha});
  return {accepted:true,headSha:b.headSha,pullNumber:p.number,pullUrl:`https://github.com/${j.repository}/pull/${p.number}`};
 }
 fail(404,'Unknown publication operation');
}
