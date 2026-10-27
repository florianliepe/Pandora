import {z} from 'zod/v3';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {id,now,fail,permit,audit,notify} from './domain.mjs';
import {evidenceCurrent,publicJob} from './delivery.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const identity=z.object({projectId:z.string().uuid(),workerId:z.literal('codex-local')}).strict();
const capability=identity.extend({jobId:z.string().uuid(),claimId:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)});
const testReport=z.object({reportId:z.string().uuid(),phase:z.enum(['reproduction','candidate','post_deployment']),kind:z.enum(['unit','regression','integration','browser']),commit:sha,targetId:z.enum(['production_frontend','production_backend','sandbox_frontend']).optional(),environment:z.string().trim().min(1).max(120),startedAt:z.string().datetime(),completedAt:z.string().datetime(),command:z.string().trim().min(1).max(500),exitCode:z.number().int().min(0).max(255),tests:z.array(z.object({caseId:z.string().min(1).max(80),caseVersion:z.number().int().positive(),result:z.enum(['passed','failed','blocked','skipped']),name:z.string().min(1).max(180)}).strict()).min(1).max(60),summary:z.string().max(2000).default('')}).strict();
function connected(s,j){return s.projects.some(p=>p.id===j.projectId&&!p.deletedAt&&p.pipelineConnection?.enabled&&p.pipelineConnection.revision===j.connectionRevision);}
export function queueDelivery(s,p,jobId,userId,version){permit(s,p,userId,['owner','developer']);const j=(s.deliveries||[]).find(j=>j.id===jobId&&j.projectId===p);if(!j)fail(404,'Handoff not found');if(j.version!==version)fail(409,'Handoff changed; reload');if(!['prepared','needs_input','failed'].includes(j.state))fail(409,'Handoff is already queued, running or cancelled');if(!connected(s,j)||!evidenceCurrent(s,j))fail(409,'Repository connection or evidence changed; prepare a new handoff');if((s.deliveries||[]).some(other=>other.id!==j.id&&other.issueId===j.issueId&&['queued','running'].includes(other.state)))fail(409,'Another fix request is active for this issue');j.executionPhase='fix';j.state='queued';j.version++;j.queuedAt=now();j.attempts=0;delete j.lease;audit(s,p,userId,'delivery.queued',j.id);return publicJob(s,j);}
function lease(s,b){const j=(s.deliveries||[]).find(j=>j.id===b.jobId&&j.projectId===b.projectId);const l=j?.lease;const hash=digest(b.token);if(!j||j.state!=='running'||!l||l.claimId!==b.claimId||l.workerId!==b.workerId||l.expires<=Date.now()||l.hash.length!==hash.length||!timingSafeEqual(Buffer.from(l.hash),Buffer.from(hash)))fail(403,'Worker claim is invalid or expired');if(!connected(s,j)||!evidenceCurrent(s,j))fail(409,'Work was superseded by changed evidence or repository configuration');return j;}
function candidate(j){const p=j.pullObservation;if(!p||p.stale||!p.correlationVerified||!Number.isFinite(Date.parse(p.observedAt))||Date.parse(p.observedAt)>Date.now()+60000||Date.now()-Date.parse(p.observedAt)>900000)fail(409,'A recent correlated GitHub PR observation is required');return p;}
function currentReports(j,phase,commit){const latest=new Map();for(const r of j.testReports||[])if(r.phase===phase&&r.commit===commit){const previous=latest.get(r.kind);if(!previous||r.completedAt>=previous.completedAt)latest.set(r.kind,r);}return [...latest.values()];}
export function candidateReadiness(j){const p=j.pullObservation;if(!p?.correlationVerified||p.stale)return {ready:false,missing:['Verified PR correlation']};const reports=currentReports(j,'candidate',p.headSha);const missing=['regression','integration','browser'].filter(kind=>!reports.some(r=>r.kind===kind&&r.exitCode===0&&r.tests.every(t=>t.result==='passed')));if(reports.some(r=>r.exitCode!==0||r.tests.some(t=>t.result!=='passed')))missing.push('Failed, blocked or skipped candidate results');const covered=new Set(reports.filter(r=>r.exitCode===0).flatMap(r=>r.tests.filter(t=>t.result==='passed').map(t=>t.caseId+':'+t.caseVersion)));if(j.snapshot.tests.some(t=>!covered.has(t.id+':'+t.version)))missing.push('Passing coverage for every pinned test case');if(!(j.testReports||[]).some(r=>r.phase==='reproduction'&&r.commit===j.baseSha&&r.tests.some(t=>t.result==='failed')))missing.push('Failing reproduction on the original revision');return {ready:missing.length===0,missing};}
export function deliveryWorker(s,request){
 if(request.method!=='POST')fail(405,'Internal worker requires POST');const raw=request.body||{};
 if(request.path==='/automation/delivery/claim'){
  const b=identity.parse(raw);const eligible=(s.deliveries||[]).filter(j=>j.projectId===b.projectId&&connected(s,j)&&evidenceCurrent(s,j));
  for(const j of eligible)if(j.state==='running'&&j.lease?.expires<=Date.now()&&(j.attempts||0)>=3){j.state='failed';j.lastError='Worker lease expired after three attempts';delete j.lease;audit(s,j.projectId,b.workerId,'delivery.worker_exhausted',j.id);}
  const j=eligible.find(j=>j.state==='queued'||(j.state==='running'&&j.lease?.expires<=Date.now()&&(j.attempts||0)<3));if(!j)return {job:null};
  const token=randomBytes(32).toString('hex'),claimId=id();j.lease={hash:digest(token),claimId,workerId:b.workerId,expires:Date.now()+15*60000};j.state='running';j.attempts=(j.attempts||0)+1;j.version++;audit(s,j.projectId,b.workerId,'delivery.claimed',j.id,null,{claimId,attempt:j.attempts});
  return {job:{...publicJob(s,j),snapshot:j.snapshot},capability:{projectId:b.projectId,workerId:b.workerId,jobId:j.id,claimId,token},expires:j.lease.expires};
 }
 if(request.path==='/automation/delivery/renew'){const b=capability.parse(raw),j=lease(s,b);j.lease.expires=Date.now()+15*60000;return {expires:j.lease.expires};}
 if(request.path==='/automation/delivery/evidence'){const {attachmentId,...credentials}=capability.extend({attachmentId:z.string().uuid()}).strict().parse(raw);const j=lease(s,credentials),a=j.snapshot.screenshots.find(a=>a.id===attachmentId);if(!a||!sha.safeParse(a.blobSha).success)fail(404,'Pinned screenshot unavailable');return {evidence:{sha:a.blobSha,name:a.name,type:a.type}};}
 if(request.path==='/automation/delivery/report'){
  const {report,...credentials}=capability.extend({report:testReport}).strict().parse(raw);const j=lease(s,credentials);const prior=(j.testReports||[]).find(r=>r.reportId===report.reportId);if(prior){if(prior.digest!==digest(JSON.stringify(report)))fail(409,'Report ID was reused with different content');return {accepted:true,duplicate:true};}
  if((j.testReports||[]).length>=60)fail(413,'Pilot test-report capacity reached');
  if(Date.parse(report.completedAt)<Date.parse(report.startedAt)||Date.parse(report.completedAt)>Date.now()+60000||Date.parse(report.startedAt)<Date.parse(j.createdAt))fail(400,'Test execution timestamps are invalid for this handoff');
  const verifying=j.executionPhase==='verification';
  if(verifying!== (report.phase==='post_deployment'))fail(409,'Report phase does not match the claimed work');
  const observation=verifying?j.verificationBasis?.targets.find(t=>t.targetId===report.targetId):null;
  if(verifying){requireDeployment(j);if(!observation||!sameDeployment(observation,j.deploymentObservations?.[report.targetId])||report.environment!==observation.environment||Date.parse(report.startedAt)<Date.parse(j.verificationBasis.queuedAt))fail(409,'Report must follow this verification request and match its current target deployment');}
  const expected=report.phase==='reproduction'?j.baseSha:report.phase==='candidate'?candidate(j).headSha:observation?.commit;
  if(!expected||report.commit!==expected)fail(409,'Test report does not match the required application revision');
  if(new Set(report.tests.map(t=>t.caseId)).size!==report.tests.length)fail(400,'Duplicate test cases in report');
  for(const t of report.tests)if(!j.snapshot.tests.some(c=>c.id===t.caseId&&c.version===t.caseVersion))fail(409,'Test report references an unpinned test-case version');
  (j.testReports??=[]).push({...report,digest:digest(JSON.stringify(report)),receivedAt:now(),source:'authenticated_codex_worker',verificationRound:j.executionPhase==='verification'?j.verificationBasis.round:null,workerId:credentials.workerId});audit(s,j.projectId,credentials.workerId,'delivery.test_reported',j.id,null,{reportId:report.reportId,phase:report.phase,kind:report.kind,commit:report.commit,exitCode:report.exitCode});return {accepted:true,readiness:candidateReadiness(j)};
 }
 if(request.path==='/automation/delivery/finish'){
  const {outcome,summary,...credentials}=capability.extend({outcome:z.enum(['awaiting_review','ready_for_verification','needs_input','failed']),summary:z.string().trim().min(1).max(2000)}).strict().parse(raw);const j=lease(s,credentials);
  if(outcome==='ready_for_verification'){if(j.executionPhase!=='verification')fail(409,'Verification work is required');requireDeployment(j);const result=verificationReadiness(j);if(!result.ready)fail(409,'Post-deployment evidence incomplete: '+result.missing.join(', '));}
  if(outcome==='awaiting_review'){if(j.executionPhase==='verification')fail(409,'Verification cannot return to candidate review');candidate(j);const readiness=candidateReadiness(j);if(!readiness.ready)fail(409,'Candidate evidence incomplete: '+readiness.missing.join(', '));}
  j.state=outcome;j.workerSummary=summary;j.version++;delete j.lease;audit(s,j.projectId,credentials.workerId,'delivery.'+outcome,j.id,null,{summary});const issue=s.issues.find(i=>i.id===j.issueId);if(issue)notify(s,issue,credentials.workerId,outcome==='ready_for_verification'?'ready_for_test':'fix_'+outcome);return {accepted:true,state:outcome};
 }
 fail(404,'Unknown delivery worker operation');
}

function sameDeployment(a,b){return !!a&&!!b&&b.verified&&['targetId','commit','runId','runAttempt','workflowId'].every(k=>a[k]===b[k]);}
function requireDeployment(j){
 const p=candidate(j);if(!p.merged||!p.mergeSha)fail(409,'A merged correlated PR is required');
 if(!candidateReadiness(j).ready)fail(409,'Candidate evidence is incomplete');
 if(!j.deploymentPlan?.targets.length)fail(409,'Select deployment targets first');
 for(const id of j.deploymentPlan.targets){const o=j.deploymentObservations?.[id];if(!o?.verified||o.commit!==p.mergeSha||!Number.isFinite(Date.parse(o.observedAt))||Date.now()-Date.parse(o.observedAt)>900000||Date.parse(o.observedAt)>Date.now()+60000)fail(409,'Fresh matching deployment evidence is required for every target');}
}
export function queueVerification(s,p,jobId,userId,version){
 permit(s,p,userId,['owner','developer']);const j=(s.deliveries||[]).find(j=>j.id===jobId&&j.projectId===p);if(!j)fail(404,'Handoff not found');if(j.version!==version)fail(409,'Handoff changed; reload');
 if(!['awaiting_review','needs_input','failed','reopened','ready_for_verification'].includes(j.state))fail(409,'Handoff is not available for verification');
 if(!connected(s,j)||!evidenceCurrent(s,j))fail(409,'Repository or issue evidence changed');requireDeployment(j);
 if((s.deliveries||[]).some(o=>o.id!==j.id&&o.issueId===j.issueId&&['queued','running'].includes(o.state)))fail(409,'Another worker is active for this issue');
 const queuedAt=now();j.verificationBasis={round:(j.verificationBasis?.round||0)+1,planRevision:j.deploymentPlan.revision,pullRevision:j.pullRequest.revision,queuedAt,targets:j.deploymentPlan.targets.map(id=>({...j.deploymentObservations[id]}))};
 j.executionPhase='verification';j.state='queued';j.queuedAt=queuedAt;j.attempts=0;j.version++;delete j.lease;delete j.acceptance;
 audit(s,p,userId,'delivery.verification_queued',j.id,null,{round:j.verificationBasis.round,targets:j.deploymentPlan.targets});return publicJob(s,j);
}
export function verificationReadiness(j){
 const missing=[];try{requireDeployment(j);}catch(e){missing.push(e.message);}
 const basis=j.verificationBasis;if(!basis||basis.planRevision!==j.deploymentPlan?.revision||basis.pullRevision!==j.pullRequest?.revision)return {ready:false,missing:[...missing,'Current verification request']};
 for(const target of basis.targets){
  if(!sameDeployment(target,j.deploymentObservations?.[target.targetId]))missing.push('Deployment changed: '+target.targetId);
  const latest=new Map();for(const r of j.testReports||[])if(r.phase==='post_deployment'&&r.verificationRound===basis.round&&r.targetId===target.targetId&&r.commit===target.commit){const old=latest.get(r.kind);if(!old||r.completedAt>=old.completedAt)latest.set(r.kind,r);}
  const reports=[...latest.values()];for(const kind of ['regression','integration','browser'])if(!reports.some(r=>r.kind===kind&&r.exitCode===0&&r.tests.every(t=>t.result==='passed')))missing.push(target.targetId+': '+kind);
  if(reports.some(r=>r.exitCode!==0||r.tests.some(t=>t.result!=='passed')))missing.push(target.targetId+': failing or incomplete results');
  const covered=new Set(reports.filter(r=>r.exitCode===0).flatMap(r=>r.tests.filter(t=>t.result==='passed').map(t=>t.caseId+':'+t.caseVersion)));
  if(j.snapshot.tests.some(t=>!covered.has(t.id+':'+t.version)))missing.push(target.targetId+': pinned test coverage');
 }
 return {ready:missing.length===0,missing};
}
export function decideDelivery(s,p,jobId,userId,raw){
 permit(s,p,userId,['owner','tester']);const b=z.object({version:z.number().int().positive(),issueVersion:z.number().int().positive(),decision:z.enum(['accept','reopen']),notes:z.string().trim().min(1).max(2000)}).strict().parse(raw);
 const j=(s.deliveries||[]).find(j=>j.id===jobId&&j.projectId===p);if(!j)fail(404,'Handoff not found');const issue=s.issues.find(i=>i.id===j.issueId&&i.projectId===p&&!i.deletedAt);
 if(!issue||j.version!==b.version||issue.version!==b.issueVersion)fail(409,'Handoff or issue changed; reload');
 if(!['ready_for_verification','accepted'].includes(j.state))fail(409,'Handoff is not awaiting a tester decision');
 if(b.decision==='accept'){if((s.deliveries||[]).filter(o=>o.projectId===p&&o.issueId===issue.id&&o.state!=='cancelled').at(-1)?.id!==j.id)fail(409,'A newer handoff supersedes this verification');if(j.state==='accepted')fail(409,'Already accepted');if(!connected(s,j)||!evidenceCurrent(s,j))fail(409,'Repository or evidence changed');const result=verificationReadiness(j);if(!result.ready)fail(409,'Delivery evidence incomplete: '+result.missing.join(', '));}
 const before=structuredClone(issue);j.state=b.decision==='accept'?'accepted':'reopened';j.version++;j.acceptance={decision:b.decision,notes:b.notes,userId,at:now(),round:j.verificationBasis?.round};issue.status=b.decision==='accept'?'verified':'reopened';issue.version++;issue.updatedAt=now();
 audit(s,p,userId,'delivery.'+j.state,j.id,null,j.acceptance);audit(s,p,userId,'issues.updated',issue.id,before,issue);notify(s,issue,userId,issue.status);return publicJob(s,j);
}
export function deliveryClosureGate(s,issue){const jobs=(s.deliveries||[]).filter(j=>j.issueId===issue.id&&j.projectId===issue.projectId&&j.state!=='cancelled');if(!jobs.length)return false;const latest=jobs.at(-1);if(latest.state!=='accepted'||latest.acceptance?.decision!=='accept'||!connected(s,latest)||!evidenceCurrent(s,latest)||!verificationReadiness(latest).ready)fail(409,'Accept the current fix through delivery verification before closing this issue');return true;}

export function reopenIssueDeliveries(s,issue,userId){for(const j of (s.deliveries||[]).filter(j=>j.projectId===issue.projectId&&j.issueId===issue.id&&['accepted','ready_for_verification'].includes(j.state))){j.state='reopened';j.version++;j.acceptance={decision:'reopen',userId,at:now(),notes:'Issue reopened through status editor',round:j.verificationBasis?.round};audit(s,issue.projectId,userId,'delivery.reopened',j.id,null,j.acceptance);}}
