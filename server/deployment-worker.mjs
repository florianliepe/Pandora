import {z} from 'zod/v3';
import {deploymentTargets,deploymentProbe,verifyDeployment} from './deployment-evidence.mjs';
import {evidenceCurrent,publicJob} from './delivery.mjs';
import {permit,fail,audit,now} from './domain.mjs';
const ids=deploymentTargets.map(t=>t.id);
function connected(s,j){return s.projects.some(p=>p.id===j.projectId&&!p.deletedAt&&p.pipelineConnection?.enabled&&p.pipelineConnection.revision===j.connectionRevision);}
export function selectDeploymentTargets(s,projectId,jobId,userId,raw){
 permit(s,projectId,userId,['owner','developer']);
 const b=z.object({version:z.number().int().positive(),targets:z.array(z.enum(ids)).min(1).max(3)}).strict().parse(raw);
 const j=(s.deliveries||[]).find(j=>j.id===jobId&&j.projectId===projectId);
 if(!j)fail(404,'Handoff not found');if(j.version!==b.version)fail(409,'Handoff changed; reload');
 if(!['prepared','needs_input','failed','awaiting_review'].includes(j.state))fail(409,'Deployment targets cannot change during active execution or verification');
 if(j.repository!=='florianliepe/meids-app')fail(409,'No deployment targets configured for this repository');
 if(!connected(s,j)||!evidenceCurrent(s,j))fail(409,'Repository configuration or evidence changed; prepare a new handoff');
 if(new Set(b.targets).size!==b.targets.length)fail(400,'Duplicate deployment targets');
 j.deploymentPlan={targets:[...b.targets].sort(),revision:(j.deploymentPlan?.revision||0)+1,requestedAt:now()};
 delete j.deploymentObservations;delete j.deploymentObservation;j.version++;
 audit(s,projectId,userId,'delivery.deployment_targets_selected',j.id,null,j.deploymentPlan);return publicJob(s,j);
}
function eligible(s,j){const p=j.pullObservation;return j.state!=='cancelled'&&j.repository==='florianliepe/meids-app'&&connected(s,j)&&evidenceCurrent(s,j)&&j.deploymentPlan&&p?.merged&&p.correlationVerified&&!p.stale&&/^[a-f0-9]{40}$/.test(p.mergeSha||'')&&Number.isFinite(Date.parse(p.observedAt))&&Date.now()-Date.parse(p.observedAt)<900000;}
export function deploymentWorker(s,request){
 if(request.method!=='POST')fail(405,'Internal deployment worker requires POST');
 if(request.path==='/automation/deployments/targets'){
  const targets=(s.deliveries||[]).filter(j=>eligible(s,j)).flatMap(j=>j.deploymentPlan.targets.map(targetId=>({jobId:j.id,projectId:j.projectId,connectionRevision:j.connectionRevision,planRevision:j.deploymentPlan.revision,pullRevision:j.pullRequest.revision,expectedCommit:j.pullObservation.mergeSha,mergedAt:j.pullObservation.mergedAt,targetId,url:deploymentProbe(targetId).url,lastObservedAt:j.deploymentObservations?.[targetId]?.observedAt||''}))).sort((a,b)=>a.lastObservedAt.localeCompare(b.lastObservedAt)).slice(0,6);
  return {targets,observedAt:now()};
 }
 if(request.path!=='/automation/deployments/complete')fail(404,'Unknown deployment operation');
 const b=request.body||{};
 if(!Array.isArray(b.results)||b.results.length>6||!Number.isFinite(Date.parse(b.observedAt))||Date.parse(b.observedAt)>Date.now()+60000||Date.parse(b.observedAt)<Date.now()-600000)fail(400,'Invalid deployment batch');
 let applied=0;
 for(const r of b.results){
  const j=(s.deliveries||[]).find(j=>j.id===r.jobId&&j.projectId===r.projectId);
  if(!j||!eligible(s,j)||j.connectionRevision!==r.connectionRevision||j.deploymentPlan.revision!==r.planRevision||j.pullRequest.revision!==r.pullRevision||j.pullObservation.mergeSha!==r.expectedCommit||!j.deploymentPlan.targets.includes(r.targetId)||j.deploymentObservations?.[r.targetId]?.observedAt>=b.observedAt||j.deploymentPlan.requestedAt>b.observedAt)continue;
  const observation=verifyDeployment({targetId:r.targetId,expectedCommit:j.pullObservation.mergeSha,mergedAt:j.pullObservation.mergedAt,probe:r.probe,run:r.run,observedAt:b.observedAt});
  (j.deploymentObservations??={})[r.targetId]=observation;applied++;
  // Revision observations never close an issue, manufacture test results, or release a worker gate.
 }
 return {applied};
}
