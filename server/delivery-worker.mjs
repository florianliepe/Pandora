import {z} from 'zod/v3';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {id,now,fail,permit,audit,notify} from './domain.mjs';
import {evidenceCurrent,publicJob} from './delivery.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const identity=z.object({projectId:z.string().uuid(),workerId:z.literal('codex-local')}).strict();
const capability=identity.extend({jobId:z.string().uuid(),claimId:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)});
const testReport=z.object({reportId:z.string().uuid(),phase:z.enum(['reproduction','candidate','post_deployment']),kind:z.enum(['unit','regression','integration','browser']),commit:sha,environment:z.string().trim().min(1).max(120),startedAt:z.string().datetime(),completedAt:z.string().datetime(),command:z.string().trim().min(1).max(500),exitCode:z.number().int().min(0).max(255),tests:z.array(z.object({caseId:z.string().min(1).max(80),caseVersion:z.number().int().positive(),result:z.enum(['passed','failed','blocked','skipped']),name:z.string().min(1).max(180)}).strict()).min(1).max(60),summary:z.string().max(2000).default('')}).strict();
function connected(s,j){return s.projects.some(p=>p.id===j.projectId&&!p.deletedAt&&p.pipelineConnection?.enabled&&p.pipelineConnection.revision===j.connectionRevision);}
export function queueDelivery(s,p,jobId,userId,version){permit(s,p,userId,['owner','developer']);const j=(s.deliveries||[]).find(j=>j.id===jobId&&j.projectId===p);if(!j)fail(404,'Handoff not found');if(j.version!==version)fail(409,'Handoff changed; reload');if(!['prepared','needs_input','failed'].includes(j.state))fail(409,'Handoff is already queued, running or cancelled');if(!connected(s,j)||!evidenceCurrent(s,j))fail(409,'Repository connection or evidence changed; prepare a new handoff');if((s.deliveries||[]).some(other=>other.id!==j.id&&other.issueId===j.issueId&&['queued','running'].includes(other.state)))fail(409,'Another fix request is active for this issue');j.state='queued';j.version++;j.queuedAt=now();j.attempts=0;delete j.lease;audit(s,p,userId,'delivery.queued',j.id);return publicJob(s,j);}
function lease(s,b){const j=(s.deliveries||[]).find(j=>j.id===b.jobId&&j.projectId===b.projectId);const l=j?.lease;const hash=digest(b.token);if(!j||j.state!=='running'||!l||l.claimId!==b.claimId||l.workerId!==b.workerId||l.expires<=Date.now()||l.hash.length!==hash.length||!timingSafeEqual(Buffer.from(l.hash),Buffer.from(hash)))fail(403,'Worker claim is invalid or expired');if(!connected(s,j)||!evidenceCurrent(s,j))fail(409,'Work was superseded by changed evidence or repository configuration');return j;}
function candidate(j){const p=j.pullObservation;if(!p||p.stale||!p.correlationVerified||Date.now()-Date.parse(p.observedAt)>900000)fail(409,'A recent correlated GitHub PR observation is required');return p;}
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
  if((j.testReports||[]).length>=20)fail(413,'Pilot test-report capacity reached');
  if(Date.parse(report.completedAt)<Date.parse(report.startedAt)||Date.parse(report.completedAt)>Date.now()+60000||Date.parse(report.startedAt)<Date.parse(j.createdAt))fail(400,'Test execution timestamps are invalid for this handoff');
  const expected=report.phase==='reproduction'?j.baseSha:report.phase==='candidate'?candidate(j).headSha:j.deploymentObservation?.commit;
  if(!expected||report.commit!==expected)fail(409,'Test report does not match the required application revision');
  if(report.phase==='post_deployment'&&(!j.deploymentObservation?.verified||report.environment!==j.deploymentObservation.environment||Date.parse(report.startedAt)<Date.parse(j.deploymentObservation.observedAt)))fail(409,'A verified deployment preceding the test is required');
  if(new Set(report.tests.map(t=>t.caseId)).size!==report.tests.length)fail(400,'Duplicate test cases in report');
  for(const t of report.tests)if(!j.snapshot.tests.some(c=>c.id===t.caseId&&c.version===t.caseVersion))fail(409,'Test report references an unpinned test-case version');
  (j.testReports??=[]).push({...report,digest:digest(JSON.stringify(report)),receivedAt:now(),source:'authenticated_codex_worker',workerId:credentials.workerId});audit(s,j.projectId,credentials.workerId,'delivery.test_reported',j.id,null,{reportId:report.reportId,phase:report.phase,kind:report.kind,commit:report.commit,exitCode:report.exitCode});return {accepted:true,readiness:candidateReadiness(j)};
 }
 if(request.path==='/automation/delivery/finish'){
  const {outcome,summary,...credentials}=capability.extend({outcome:z.enum(['awaiting_review','needs_input','failed']),summary:z.string().trim().min(1).max(2000)}).strict().parse(raw);const j=lease(s,credentials);
  if(outcome==='awaiting_review'){candidate(j);const readiness=candidateReadiness(j);if(!readiness.ready)fail(409,'Candidate evidence incomplete: '+readiness.missing.join(', '));}
  j.state=outcome;j.workerSummary=summary;j.version++;delete j.lease;audit(s,j.projectId,credentials.workerId,'delivery.'+outcome,j.id,null,{summary});const issue=s.issues.find(i=>i.id===j.issueId);if(issue)notify(s,issue,credentials.workerId,'fix_'+outcome);return {accepted:true,state:outcome};
 }
 fail(404,'Unknown delivery worker operation');
}
