import {z} from 'zod/v3';
import {now,fail,audit} from './domain.mjs';
import {automationView,eventIsCurrent,cancelEvent} from './issue-automation.mjs';
import {prepareDelivery} from './delivery.mjs';
import {queueDelivery,deliveryWorker} from './delivery-worker.mjs';
import {runnerPublication} from './runner-publication.mjs';
import {runnerMerge} from './runner-merge.mjs';
const identity=z.object({projectId:z.string().uuid()}).strict();
const ref=identity.extend({eventId:z.string().uuid()}).strict();
function event(s,b){const e=s.issueAutomationEvents?.find(e=>e.id===b.eventId&&e.projectId===b.projectId);if(!e)fail(404,'Issue event not found');return e;}
export function issueAutomationWorker(s,r){
 if(r.method!=='POST')fail(405,'Internal worker requires POST');
 const action=r.path.split('/').at(-1),raw=r.body||{};
 if(['publish-prepare','publish-complete'].includes(action))return runnerPublication(s,action,raw);
 if(['merge-prepare','merge-authorize','merge-consume','merge-complete','verification-start'].includes(action))return runnerMerge(s,action,raw);
 if(action==='preflight'){
  const b=identity.extend({schemaVersion:z.literal(1),syntheticEventId:z.literal('00000000-0000-4000-8000-000000000001'),runId:z.number().int().positive(),mode:z.enum(['callback','provider','cancellation','evidence']),phase:z.enum(['started','completed','cancelled']),nonce:z.string().uuid(),receiverWorkflowPath:z.literal('runner/issue-runner-receiver.workflow.json')}).strict().parse(raw);
  const rows=s.automationPreflights??=[],old=rows.find(x=>x.projectId===b.projectId&&x.runId===b.runId);
  if(old){if(old.nonce!==b.nonce||old.mode!==b.mode)fail(409,'Preflight run identity changed');if(old.phase===b.phase)return {accepted:true,duplicate:true};if(old.phase!=='started'||b.phase==='started')fail(409,'Preflight already finished');old.phase=b.phase;old.updatedAt=now();}
  else{if(b.phase!=='started')fail(409,'Preflight start was not recorded');rows.push({...b,createdAt:now(),updatedAt:now()});s.automationPreflights=rows.slice(-30);}
  // An authenticated callback proves transport only. GitHub and provider evidence is verified independently.
  return {accepted:true,readinessGranted:false};
 }
 if(action==='readiness-input'){const b=identity.parse(raw);return {preflights:(s.automationPreflights||[]).filter(x=>x.projectId===b.projectId)};}
 if(action==='readiness'){
  const check=z.object({passed:z.boolean(),runId:z.number().int().positive().nullable(),workflowSha:z.string().regex(/^[a-f0-9]{40}$/).nullable()}).strict();
  const b=identity.extend({observedAt:z.string().datetime(),privateRepository:z.boolean(),sourceProtected:z.boolean(),requiredChecks:z.array(z.string()).max(10),credentialsPresent:z.boolean(),receiverSha:z.string().regex(/^[a-f0-9]{40}$/).nullable(),provider:check,callback:check,cancellation:check,evidence:check}).strict().parse(raw);
  if(Date.parse(b.observedAt)>Date.now()+60000||Date.now()-Date.parse(b.observedAt)>60000)fail(409,'Readiness observation must be current');
  const missing=[];
  if(!b.privateRepository)missing.push('private runner repository');
  if(!b.sourceProtected)missing.push('source branch protection');
  if(!['Me.IDs pull request validation','validate'].every(c=>b.requiredChecks.includes(c)))missing.push('required source checks');
  if(!b.credentialsPresent)missing.push('runner credentials');
  for(const key of ['provider','callback','cancellation','evidence'])if(!b.receiverSha||!b[key].passed||!b[key].runId||b[key].workflowSha!==b.receiverSha)missing.push(key+' verification');
  const observation={projectId:b.projectId,ready:missing.length===0,checkedAt:b.observedAt,reason:missing.length?'Pending: '+missing.join(', '):'Hosted runner and safety checks verified',evidence:b};
  s.automationRunners=(s.automationRunners||[]).filter(x=>x.projectId!==b.projectId);s.automationRunners.push(observation);return {ready:observation.ready,missing};
 }
 if(action==='tasks'){
  const b=identity.parse(raw),tasks=[];
  for(const e of s.issueAutomationEvents||[]){
   if(tasks.length>=5)break;
   if(e.projectId!==b.projectId)continue;
   if(['pending','dispatching','dispatched','running'].includes(e.state)&&!eventIsCurrent(s,e))cancelEvent(s,e,'Issue scope, ownership or evidence is no longer current');
   const runningJob=s.deliveries?.find(j=>j.id===e.jobId);
   if((['dispatching','dispatched'].includes(e.state)&&Date.now()-Date.parse(e.updatedAt)>10*60000)||(e.state==='running'&&runningJob?.lease&&runningJob.lease.expires<Date.now())){e.state='cancellation_requested';e.reason='Runner acknowledgement or lease expired';if(runningJob){runningJob.state='cancelled';runningJob.version++;delete runningJob.lease;}}
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
  const b=ref.extend({disposition:z.enum(['cancelled','finished']).default('cancelled')}).parse(raw),e=event(s,b);if(e.state!=='cancellation_requested')return {applied:false};e.state='cancelled';e.updatedAt=now();e.reason=b.disposition==='finished'?'Runner already finished; completed actions were not undone':'Runner cancellation confirmed';audit(s,e.projectId,'codex-runner','automation.cancel_acknowledged',e.id,null,{disposition:b.disposition});return {applied:true};
 }
 fail(404,'Unknown issue automation operation');
}
