import {z} from 'zod/v3';
import {id,now,fail,audit} from './domain.mjs';
import {runnerContext} from './runner-publication.mjs';
import {candidateReadiness,queueVerification,deliveryWorker} from './delivery-worker.mjs';
import {observePulls} from './delivery-observations.mjs';
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const identity=z.object({projectId:z.string().uuid(),eventId:z.string().uuid(),runId:z.number().int().positive(),jobId:z.string().uuid()}).strict();
const capability=identity.extend({workerId:z.literal('codex-local'),claimId:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const required=['Me.IDs pull request validation','validate'];
function eligible(j){
 if(j.mergePolicy!=='after_required_checks'||j.executionPhase!=='fix'||j.publication?.state!=='completed')fail(409,'Published automatic fix is required');
 if(!j.deploymentPlan?.targets?.length)fail(409,'Reviewed deployment targets are required');
 if(j.snapshot.tests.some(t=>t.reviewStatus!=='approved'))fail(409,'Every pinned test case must be approved');
 const r=candidateReadiness(j);if(!r.ready)fail(409,'Candidate evidence incomplete: '+r.missing.join(', '));
}
function correlated(j,e,p){return p?.number===j.publication.pullNumber&&p.head?.sha===j.publication.headSha&&p.head?.ref==='pandora/'+e.id&&p.head?.repo?.full_name===j.repository&&p.base?.repo?.full_name===j.repository&&p.base?.ref==='main'&&String(p.body||'').split(/\r?\n/).some(l=>l.trim()===`Pandora-Delivery: ${j.id}`);}
export function runnerMerge(s,action,raw){
 if(action==='merge-prepare'){
  const b=capability.parse(raw),{e,j}=runnerContext(s,b,{renew:true});eligible(j);
  if(j.mergeAttempt)fail(409,'Merge already attempted; reconcile GitHub before another attempt');
  return {merge:{projectId:b.projectId,eventId:e.id,runId:e.runId,jobId:j.id,repository:j.repository,pullNumber:j.publication.pullNumber,headSha:j.publication.headSha,baseSha:j.baseSha}};
 }
 if(action==='merge-authorize'){
  // Only the trusted receiver can supply these independently fetched GitHub observations.
  const b=capability.extend({observedAt:z.string().datetime(),mainSha:sha,pull:z.unknown(),protection:z.unknown(),checks:z.unknown()}).strict().parse(raw);
  const {e,j}=runnerContext(s,b,{renew:true});eligible(j);
  if(j.mergeAttempt)fail(409,'Merge authorization already issued');
  if(Date.now()-Date.parse(b.observedAt)>60000||Date.parse(b.observedAt)>Date.now()+5000)fail(409,'Fresh GitHub observations required');
  const p=b.pull,protection=b.protection,checks=b.checks;
  if(!correlated(j,e,p)||p.base.sha!==j.baseSha||b.mainSha!==j.baseSha||p.state!=='open'||p.merged||p.draft!==false||p.mergeable!==true||p.mergeable_state!=='clean')fail(409,'PR revision, mergeability or base changed');
  const rules=protection?.required_status_checks;
  if(protection?.enforce_admins?.enabled!==true||rules?.strict!==true||!Array.isArray(rules.checks)||!required.every(name=>rules.checks.some(c=>c.context===name&&c.app_id===15368)))fail(409,'Required branch protection is not enforced');
  if(!Array.isArray(checks?.check_runs)||checks.total_count!==checks.check_runs.length||checks.check_runs.length>100)fail(409,'Complete check observations required');
  // Evaluate every protected check, including additional requirements introduced by owners.
  const protectedChecks=[...rules.checks,...(rules.contexts||[]).filter(name=>!rules.checks.some(c=>c.context===name)).map(context=>({context,app_id:null}))];
  for(const rule of protectedChecks){
   const rows=checks.check_runs.filter(c=>c.name===rule.context&&c.head_sha===j.publication.headSha&&(rule.app_id==null||rule.app_id===-1||c.app?.id===rule.app_id)).sort((a,b)=>b.id-a.id);
   if(!rows.length||rows[0].status!=='completed'||rows[0].conclusion!=='success')fail(409,'Required check not successful: '+rule.context);
  }
  j.mergeAttempt={id:id(),headSha:j.publication.headSha,baseSha:j.baseSha,pullNumber:p.number,issuedAt:now(),expires:Date.now()+60000,state:'issued'};
  audit(s,j.projectId,'codex-runner','automation.merge_authorized',j.id,null,{headSha:j.mergeAttempt.headSha,checks:protectedChecks.map(c=>c.context)});
  return {authorization:{...j.mergeAttempt,projectId:j.projectId,eventId:e.id,runId:e.runId,jobId:j.id,repository:j.repository}};
 }
 if(action==='merge-consume'){
  const b=identity.extend({authorizationId:z.string().uuid()}).strict().parse(raw),{j}=runnerContext(s,b),a=j.mergeAttempt;eligible(j);
  if(!a||a.id!==b.authorizationId||a.state!=='issued'||a.expires<=Date.now()||a.headSha!==j.publication.headSha)fail(409,'Merge authorization expired, consumed or changed');
  a.state='submitted';a.submittedAt=now();
  return {merge:{repository:j.repository,pullNumber:a.pullNumber,headSha:a.headSha,method:'merge'}};
 }
 if(action==='merge-complete'){
  const b=identity.extend({authorizationId:z.string().uuid(),pull:z.unknown()}).strict().parse(raw),{e,j}=runnerContext(s,b),a=j.mergeAttempt,p=b.pull;
  if(!a||a.id!==b.authorizationId||!['submitted','completed'].includes(a.state)||!correlated(j,e,p)||!p.merged||p.state!=='closed'||!sha.safeParse(p.merge_commit_sha).success||!Number.isFinite(Date.parse(p.merged_at))||Date.parse(p.merged_at)<Date.parse(a.issuedAt)-1000)fail(409,'GitHub has not confirmed this exact authorized merge');
  if(a.state==='completed'&&a.mergeSha!==p.merge_commit_sha)fail(409,'Merge revision changed');
  // Replace the candidate observation with this independently fetched confirmed merge,
  // including when both observations land in the same clock millisecond.
  delete j.pullObservation;
  observePulls(s,[{kind:'pull',jobId:j.id,projectId:j.projectId,repository:j.repository,number:p.number,revision:j.pullRequest.revision,status:200,body:p}],now());
  if(!j.pullObservation?.merged||!j.pullObservation.correlationVerified)fail(409,'Unable to record verified merge');
  Object.assign(a,{state:'completed',mergeSha:p.merge_commit_sha,completedAt:now()});
  return {accepted:true,mergeSha:a.mergeSha,awaiting:'deployment_and_functional_verification'};
 }
 if(action==='verification-start'){
  const b=capability.parse(raw),{j}=runnerContext(s,b,{renew:true});
  if(j.mergeAttempt?.state!=='completed')fail(409,'Confirmed automatic merge required');
  if(j.executionPhase!=='fix')fail(409,'Verification already started');
  // Validate against a copy first: a missing deployment must not release the active claim.
  const draft=structuredClone(s),job=draft.deliveries.find(x=>x.id===j.id);
  job.state='awaiting_review';
  queueVerification(draft,j.projectId,j.id,draft.projects.find(p=>p.id===j.projectId).issueAutomation.ownerId,job.version);
  const claimed=deliveryWorker(draft,{method:'POST',path:'/automation/delivery/claim',body:{projectId:j.projectId,workerId:'codex-local',jobId:j.id}});
  if(!claimed.job)fail(409,'Verification claim unavailable');
  Object.assign(s,draft);return claimed;
 }
 fail(404,'Unknown merge operation');
}
