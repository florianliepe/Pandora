import {deploymentWorker} from './deployment-worker.mjs';
import {deliveryWorker} from './delivery-worker.mjs';
import {pipelineWorker} from './pipelines.mjs';
import {z} from 'zod/v3';
import {id,now,audit,fail} from './domain.mjs';
export const cadenceSchema=z.object({enabled:z.boolean(),startDate:z.string().date(),lengthDays:z.number().int().min(7).max(42),lookahead:z.number().int().min(1).max(6)}).strict();
export const evidenceFields=['title','description','steps','expected','actual','environment','severity'];
export function queueTests(issue){issue.evidenceRevision=(issue.evidenceRevision||0)+1;issue.testGeneration={state:'queued',requestId:id(),revision:issue.evidenceRevision,queuedAt:now(),notBefore:Date.now()+30000,attempts:0};}
export function derivedTestStatus(s,issue){
 const cases=s.cases.filter(c=>c.projectId===issue.projectId&&c.issueId===issue.id&&!c.deletedAt);if(!cases.length)return 'not_run';
 const ready=s.events.filter(e=>e.entityId===issue.id&&e.after?.status==='ready_for_test'&&e.before?.status!=='ready_for_test').at(-1)?.at;
 const results=cases.map(c=>s.runs.filter(r=>!r.deletedAt&&r.projectId===issue.projectId&&r.issueId===issue.id&&r.caseId===c.id&&r.caseSnapshot?.version===c.version&&(r.issueEvidenceRevision||1)===(issue.evidenceRevision||1)&&(!ready||r.createdAt>=ready)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.result||'not_run');
 return results.includes('failed')?'failed':results.includes('blocked')?'blocked':results.every(r=>r==='passed')?'passed':'not_run';
}
export function syncTestStatuses(s,p){for(const issue of s.issues.filter(i=>i.projectId===p&&!i.deletedAt))issue.testStatus=derivedTestStatus(s,issue);}
export function ensureIterations(s,project,today=now().slice(0,10)){
 const c=project.cadence;if(!c?.enabled||project.deletedAt)return;
 const day=86400000,anchor=Date.parse(c.startDate+'T00:00:00Z');const current=Math.max(0,Math.floor((Date.parse(today+'T00:00:00Z')-anchor)/(c.lengthDays*day)));
 for(let i=current;i<current+c.lookahead;i++){const start=new Date(anchor+i*c.lengthDays*day).toISOString().slice(0,10),key=project.id+':'+start;if(s.iterations.some(x=>x.autoKey===key))continue;
 const item={id:id(),projectId:project.id,autoKey:key,name:`Iteration ${i+1}`,startDate:start,endDate:new Date(anchor+((i+1)*c.lengthDays-1)*day).toISOString().slice(0,10),goal:'',version:1,createdAt:now(),updatedAt:now(),createdBy:'automation',source:'cadence'};s.iterations.push(item);audit(s,project.id,'automation','iterations.created',item.id,null,item);}
}
export function iterationSuggestion(s,issue,today=now().slice(0,10)){
 if(issue.iterationId||['verified','closed'].includes(issue.status))return null;
 const choices=s.iterations.filter(i=>i.projectId===issue.projectId&&!i.deletedAt&&i.endDate>=today).sort((a,b)=>a.startDate.localeCompare(b.startDate));
 const choice=choices.find(i=>issue.dueDate&&i.startDate<=issue.dueDate&&i.endDate>=issue.dueDate)||choices[0];return choice?{id:choice.id,reason:issue.dueDate&&choice.startDate<=issue.dueDate&&choice.endDate>=issue.dueDate?'Matches the issue due date':'Next available iteration; review capacity before accepting'}:null;
}
const generatedCase=z.object({title:z.string().trim().min(2).max(180),steps:z.string().max(8000),expected:z.string().max(8000),preconditions:z.string().max(4000).default(''),kind:z.enum(['functional','regression','integration','smoke','acceptance']).default('regression')}).strict();
export const generationSchema=z.object({cases:z.array(generatedCase).min(1).max(6),notes:z.string().max(2000).default('')}).strict();
export function workerRequest(s,request){
 if(request.path.startsWith('/automation/deployments/'))return deploymentWorker(s,request);
 if(request.path.startsWith('/automation/delivery/'))return deliveryWorker(s,request);
 if(request.path.startsWith('/automation/pipelines/'))return pipelineWorker(s,request);
 if(request.method!=='POST')fail(405,'Internal worker requires POST');
 if(request.path==='/automation/claim'){
  for(const p of s.projects)ensureIterations(s,p);
  for(const i of s.issues)if(!i.deletedAt&&!i.testGeneration&&i.status!=='closed'&&s.projects.some(p=>p.id===i.projectId&&!p.deletedAt))queueTests(i);
  for(const i of s.issues){const j=i.testGeneration;if(j?.state==='running'&&j.lockUntil<Date.now()&&j.attempts>=3){j.state='failed';j.error='Generation timed out. Retry generation or maintain cases manually.';}}
  const issue=s.issues.find(i=>!i.deletedAt&&s.projects.some(p=>p.id===i.projectId&&!p.deletedAt)&&i.testGeneration&&(i.testGeneration.state==='queued'||(i.testGeneration.state==='running'&&i.testGeneration.lockUntil<Date.now()))&&i.testGeneration.notBefore<=Date.now()&&i.testGeneration.attempts<3);
  if(!issue)return {job:null};const job=issue.testGeneration;job.state='running';job.lockUntil=Date.now()+300000;job.attempts++;job.claimId=id();
  return {job:{projectId:issue.projectId,issueId:issue.id,requestId:job.requestId,claimId:job.claimId,revision:job.revision,issue:Object.fromEntries(evidenceFields.map(k=>[k,issue[k]||''])),attachments:s.attachments.filter(a=>a.issueId===issue.id&&a.projectId===issue.projectId&&!a.deletedAt).map(a=>({id:a.id,name:a.name,type:a.type,blobSha:a.blobSha,size:a.size})),existingCases:s.cases.filter(c=>c.issueId===issue.id&&(!c.deletedAt||c.manualDeleted)).map(c=>({title:c.title,manualEdited:!!c.manualEdited,archived:!!c.deletedAt,source:c.source||'manual'}))}};
 }
 if(request.path==='/automation/complete'){
  const {issueId,requestId,claimId,revision,result,error}=request.body||{};const issue=s.issues.find(i=>i.id===issueId&&!i.deletedAt&&s.projects.some(p=>p.id===i.projectId&&!p.deletedAt));const job=issue?.testGeneration;
  if(!job||job.requestId!==requestId||job.claimId!==claimId||job.revision!==revision||issue.evidenceRevision!==revision||job.state!=='running')return {applied:false,reason:'Superseded or already applied'};
  let parsed;try{if(error)throw new Error('Generation unavailable');parsed=generationSchema.parse(result);}catch{job.state=job.attempts<3?'queued':'failed';job.notBefore=Date.now()+job.attempts*60000;job.error='Test generation could not complete. Your issue and evidence are saved. Retry generation or maintain cases manually.';return {applied:false,retry:job.state==='queued'};}
  const existing=s.cases.filter(c=>c.issueId===issue.id&&!c.deletedAt);let added=0;
  for(const c of existing.filter(c=>c.source==='ai'&&!c.manualEdited&&!s.runs.some(r=>r.caseId===c.id&&!r.deletedAt))){c.deletedAt=now();audit(s,issue.projectId,'automation','cases.superseded',c.id);}
  const protectedCases=s.cases.filter(c=>c.issueId===issue.id&&(!c.deletedAt||c.manualDeleted));
  for(const draft of parsed.cases){if(protectedCases.some(c=>[c.title,c.generatedTitle].filter(Boolean).some(t=>t.toLowerCase()===draft.title.toLowerCase())))continue;const c={...draft,id:id(),issueId:issue.id,projectId:issue.projectId,source:'ai',generatedTitle:draft.title,reviewStatus:'draft',manualEdited:false,sourceRevision:revision,version:1,createdAt:now(),updatedAt:now(),createdBy:'automation'};s.cases.push(c);audit(s,issue.projectId,'automation','cases.generated',c.id,null,c);added++;}
  job.state='ready';job.completedAt=now();job.notes=parsed.notes;delete job.error;job.caseCount=added;syncTestStatuses(s,issue.projectId);return {applied:true,added};
 }
 fail(404,'Unknown worker operation');
}
