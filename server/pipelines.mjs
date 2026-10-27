import {pendingPulls,pullRequests,observePulls} from './delivery-observations.mjs';
// Fixed, reviewed read-only sources. No client-provided URLs or arbitrary repositories.
export const repositories=['florianliepe/meids-app','florianliepe/meids-agent-configs'];
export const workflows=[
 {id:354029928,name:'Production frontend',environment:'Azure Static Web Apps'},
 {id:390689734,name:'Production backend',environment:'Azure App Service'},
 {id:328868831,name:'Sandbox frontend',environment:'GitHub Pages'}
];
export const uatPath='docs/uat/agent-interaction-uat-results.json';
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const number=v=>Number.isSafeInteger(v)&&v>0;
const text=(v,n=160)=>typeof v==='string'?v.slice(0,n):'';
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const conclusion=v=>['success','failure','cancelled','skipped','neutral','timed_out','action_required','stale','startup_failure'].includes(v)?v:'unknown';
export function initialRequests(){return [...repositories.map(repository=>({kind:'head',repository,url:`https://api.github.com/repos/${repository}/commits/main`})),...workflows.map(w=>({kind:'runs',repository:repositories[0],workflowId:w.id,url:`https://api.github.com/repos/${repositories[0]}/actions/workflows/${w.id}/runs?branch=main&per_page=3`}))];}
export function validRuns(r){return (Array.isArray(r.body?.workflow_runs)?r.body.workflow_runs:[]).filter(x=>number(x.id)&&x.workflow_id===r.workflowId&&x.head_branch==='main'&&sha(x.head_sha)&&x.repository?.full_name===repositories[0]).slice(0,3);}
export function detailRequests(results,refs=[]){
 const requests=pullRequests(refs);
 for(const r of results){if(r.status!==200)continue;
  if(r.kind==='head'&&r.repository===repositories[0]&&sha(r.body?.sha))requests.push({kind:'uat',repository:r.repository,sourceCommit:r.body.sha,url:`https://api.github.com/repos/${r.repository}/contents/${uatPath}?ref=${r.body.sha}`});
  if(r.kind==='runs')for(const run of validRuns(r))requests.push({kind:'jobs',repository:r.repository,runId:run.id,attempt:run.run_attempt||1,url:`https://api.github.com/repos/${r.repository}/actions/runs/${run.id}/attempts/${run.run_attempt||1}/jobs?per_page=100`});
 }
 return requests;
}
export function normalizeEvidence(initial,details,observedAt){
 const errors=[];const sources=repositories.map(repository=>{const r=initial.find(x=>x.kind==='head'&&x.repository===repository);if(r?.status!==200||!sha(r.body?.sha))errors.push(`${repository}: source unavailable`);return {repository,branch:'main',commit:sha(r?.body?.sha)?r.body.sha:null,role:repository===repositories[0]?'application':'configuration (no CI configured)'};});
 const runs=[];
 for(const w of workflows){const r=initial.find(x=>x.kind==='runs'&&x.workflowId===w.id);if(r?.status!==200){errors.push(`${w.name}: workflow unavailable`);continue;}
  for(const run of validRuns(r)){
   const j=details.find(x=>x.kind==='jobs'&&x.runId===run.id&&x.attempt===(run.run_attempt||1));
   const jobs=(Array.isArray(j?.body?.jobs)?j.body.jobs:[]).filter(x=>number(x.id)&&x.run_id===run.id&&x.head_sha===run.head_sha).slice(0,12).map(x=>({id:x.id,name:text(x.name),status:text(x.status,30),conclusion:conclusion(x.conclusion),steps:(x.steps||[]).slice(0,40).map(s=>({name:text(s.name),number:s.number,status:text(s.status,30),conclusion:conclusion(s.conclusion)}))}));
   if(j?.status!==200)errors.push(`Run ${run.id}: job details unavailable`);
   runs.push({repository:repositories[0],id:run.id,attempt:run.run_attempt||1,workflowId:w.id,name:w.name,environment:w.environment,commit:run.head_sha,branch:'main',event:text(run.event,30),status:text(run.status,30),conclusion:conclusion(run.conclusion),createdAt:date(run.created_at),updatedAt:date(run.updated_at),url:`https://github.com/${repositories[0]}/actions/runs/${run.id}`,jobs,jobsTruncated:(j?.body?.total_count||0)>jobs.length});
  }
 }
 let uat=null;const raw=details.find(x=>x.kind==='uat');
 if(raw?.status===200&&sha(raw.sourceCommit)&&raw.body?.encoding==='base64'&&raw.body.size<=150000&&typeof raw.body.content==='string'){
  try{const doc=JSON.parse(Buffer.from(raw.body.content,'base64').toString('utf8'));if(!Array.isArray(doc.cases))throw Error();
   uat={kind:'historical_versioned_evidence',sourceCommit:raw.sourceCommit,blobSha:sha(raw.body.sha)?raw.body.sha:null,reportedAt:text(doc.generated_at||doc.executed_at||doc.timestamp||doc.run_at,80)||null,schemaVersion:text(doc.schema_version,30),totalCases:doc.cases.length,cases:doc.cases.slice(0,40).map(c=>({id:text(c.case_id,80),status:text(c.status,40),findings:text(typeof c.findings==='string'?c.findings:JSON.stringify(c.findings||''),400),traceId:text(c.trace_id,120)})),url:`https://github.com/${repositories[0]}/blob/${raw.sourceCommit}/${uatPath}`};
  }catch{errors.push('UAT evidence format not supported');}
 }else errors.push('Versioned UAT evidence unavailable');
 return {observedAt,sources,runs,uat,errors};
}
export function pipelineWorker(s,request){
 const err=(status,message)=>{throw Object.assign(Error(message),{status});};
 if(request.method!=='POST')err(405,'Internal worker requires POST');
 if(request.path==='/automation/pipelines/targets')return {pulls:pendingPulls(s),targets:s.projects.filter(p=>!p.deletedAt&&p.pipelineConnection?.enabled).slice(0,10).map(p=>({projectId:p.id,revision:p.pipelineConnection.revision})),observedAt:new Date().toISOString()};
 if(request.path!=='/automation/pipelines/complete')err(404,'Unknown pipeline operation');
 const b=request.body||{};if(!Array.isArray(b.initial)||!Array.isArray(b.details)||b.initial.length>5||b.details.length>20||!Array.isArray(b.targets)||b.targets.length>10||!date(b.observedAt)||Date.parse(b.observedAt)>Date.now()+60000||Date.parse(b.observedAt)<Date.now()-600000)err(400,'Invalid pipeline observation');
 const snapshot=normalizeEvidence(b.initial,b.details,b.observedAt);if(JSON.stringify(snapshot).length>90000)err(413,'Pipeline evidence exceeds capacity');
 let applied=0;for(const target of b.targets){const p=s.projects.find(p=>p.id===target.projectId&&!p.deletedAt&&p.pipelineConnection?.enabled&&p.pipelineConnection.revision===target.revision);if(!p||p.pipelineEvidence?.observedAt>=b.observedAt)continue;
 // Keep last successful evidence on partial outages, explicitly mark it stale.
 const previous=p.pipelineEvidence;const unavailable=new Set(workflows.filter(w=>!b.initial.some(r=>r.kind==='runs'&&r.workflowId===w.id&&r.status===200)).map(w=>w.id));
 p.pipelineEvidence={...snapshot,runs:[...snapshot.runs,...(previous?.runs||[]).filter(r=>unavailable.has(r.workflowId)).map(r=>({...r,stale:true}))],uat:snapshot.uat||(previous?.uat?{...previous.uat,stale:true}:null)};applied++;}
 const pullsApplied=observePulls(s,b.details,b.observedAt);return {applied,pullsApplied};
}
