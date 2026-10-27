import {z} from 'zod/v3';
import {now,fail,audit} from './domain.mjs';
import {automationView,eventIsCurrent} from './issue-automation.mjs';
import {prepareDelivery} from './delivery.mjs';
import {queueDelivery,deliveryWorker} from './delivery-worker.mjs';
const identity=z.object({projectId:z.string().uuid()}).strict();
const ref=identity.extend({eventId:z.string().uuid()}).strict();
function event(s,b){const e=s.issueAutomationEvents?.find(e=>e.id===b.eventId&&e.projectId===b.projectId);if(!e)fail(404,'Issue event not found');return e;}
export function issueAutomationWorker(s,r){
 if(r.method!=='POST')fail(405,'Internal worker requires POST');
 const action=r.path.split('/').at(-1),raw=r.body||{};
 if(action==='tasks'){
  const b=identity.parse(raw),tasks=[];
  for(const e of s.issueAutomationEvents||[]){
   if(e.projectId!==b.projectId)continue;
   if(e.state==='cancellation_requested'){tasks.push({action:'cancel',eventId:e.id,runId:e.runId||null});continue;}
   if(e.state!=='pending'||e.notBefore>Date.now()||!eventIsCurrent(s,e)||!automationView(s,b.projectId).ready)continue;
   const issue=s.issues.find(i=>i.id===e.issueId),p=s.projects.find(p=>p.id===b.projectId);
   if(['queued','running'].includes(issue.testGeneration?.state))continue;
   if(!s.cases.some(c=>c.issueId===issue.id&&c.projectId===b.projectId&&!c.deletedAt)){e.reason='Awaiting linked test cases';continue;}
   try{
    const job=prepareDelivery(s,b.projectId,e.issueId,p.issueAutomation.ownerId,{repository:e.repository,issueVersion:issue.version,requestId:e.id});
    queueDelivery(s,b.projectId,job.id,p.issueAutomation.ownerId,job.version);
    const j=s.deliveries.find(j=>j.id===job.id);j.automationEventId=e.id;j.mergePolicy='after_required_checks';j.executionMode='github_actions';
    e.jobId=job.id;e.state='dispatching';e.attempts++;e.updatedAt=now();
    tasks.push({action:'dispatch',eventId:e.id,jobId:e.jobId});
   }catch(err){e.reason=err.status===409?'Waiting for fresh repository observations or an available handoff': 'Unable to prepare issue handoff';e.notBefore=Date.now()+60000;}
   if(tasks.length>=5)break;
  }
  return {tasks};
 }
 if(action==='dispatched'){
  const b=ref.extend({accepted:z.boolean()}).parse(raw),e=event(s,b);
  if(e.state!=='dispatching')return {applied:false};
  e.state=b.accepted?'dispatched':'needs_input';e.updatedAt=now();e.reason=b.accepted?'Waiting for runner acknowledgement':'Runner dispatch failed; inspect configuration before retrying';return {applied:true};
 }
 if(action==='start'){
  const b=ref.extend({runId:z.number().int().positive()}).parse(raw),e=event(s,b);
  if(!['dispatching','dispatched'].includes(e.state)||!eventIsCurrent(s,e))fail(409,'Issue event stopped, superseded or already claimed');
  const claimed=deliveryWorker(s,{path:'/automation/delivery/claim',method:'POST',body:{projectId:b.projectId,workerId:'codex-local',jobId:e.jobId}});
  if(!claimed.job)fail(409,'Delivery is unavailable');
  e.state='running';e.runId=b.runId;e.updatedAt=now();audit(s,e.projectId,'codex-runner','automation.runner_started',e.id,null,{runId:e.runId});return claimed;
 }
 if(action==='status'){
  const b=ref.extend({runId:z.number().int().positive()}).parse(raw),e=event(s,b);
  if(e.runId!==b.runId)fail(403,'Runner identity does not match');const j=s.deliveries?.find(j=>j.id===e.jobId);return {continue:eventIsCurrent(s,e)&&e.state==='running'&&!!j&&!['cancelled','failed','needs_input'].includes(j.state),state:e.state};
 }
 if(action==='cancelled'){
  const b=ref.parse(raw),e=event(s,b);if(e.state!=='cancellation_requested')return {applied:false};e.state='cancelled';e.updatedAt=now();audit(s,e.projectId,'codex-runner','automation.cancel_acknowledged',e.id);return {applied:true};
 }
 fail(404,'Unknown issue automation operation');
}
