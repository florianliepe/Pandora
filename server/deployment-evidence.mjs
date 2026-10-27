// Read-only revision evidence. Fixed targets prevent client-controlled network destinations.
export const deploymentTargets=Object.freeze([
 {id:'production_frontend',component:'frontend',workflowId:354029928,environment:'Azure Static Web Apps',url:'https://victorious-flower-0f10a8303.6.azurestaticapps.net/build-info.json'},
 {id:'production_backend',component:'backend',workflowId:390689734,environment:'Azure App Service',url:'https://meids-prod-backend-1853a19b.azurewebsites.net/api/build-info'},
 {id:'sandbox_frontend',component:'frontend',workflowId:328868831,environment:'GitHub Pages',url:'https://florianliepe.github.io/meids-app/build-info.json'}
].map(Object.freeze));
const repository='florianliepe/meids-app';
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
const fields=['schemaVersion','available','component','repository','commit','runId','runAttempt','builtAt'];
export function deploymentProbe(targetId){const target=deploymentTargets.find(t=>t.id===targetId);return target?{targetId,url:target.url,authentication:'none'}:null;}
export function manifestRunRequest(targetId,probe){
 const target=deploymentTargets.find(t=>t.id===targetId),m=probe?.body;
 if(!target||probe.status!==200||!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!fields.includes(k))||m.schemaVersion!==1||m.available!==true||m.component!==target.component||m.repository!==repository||!sha(m.commit)||!positive(m.runId)||!positive(m.runAttempt)||!Number.isFinite(time(m.builtAt)))return null;
 return {targetId,runId:m.runId,attempt:m.runAttempt,url:`https://api.github.com/repos/${repository}/actions/runs/${m.runId}/attempts/${m.runAttempt}`,authentication:'github'};
}
export function verifyDeployment({targetId,expectedCommit,mergedAt,probe,run,observedAt},clock=Date.now()){
 const target=deploymentTargets.find(t=>t.id===targetId);
 const result={verified:false,targetId,environment:target?.environment||null,observedAt,commit:null};
 const reject=error=>({...result,error});
 if(!target||!sha(expectedCommit)||!Number.isFinite(time(mergedAt)))return reject('Expected merged revision or deployment target is invalid');
 if(!Number.isFinite(time(observedAt))||time(observedAt)>clock+60000||time(observedAt)<clock-600000)return reject('Deployment observation is stale or invalid');
 const request=manifestRunRequest(targetId,probe);
 if(!request)return reject('Served revision manifest is unavailable or invalid');
 const m=probe.body;
 if(m.commit!==expectedCommit)return reject('Environment is not serving the expected merged revision');
 const r=run?.body;
 if(run?.status!==200||r?.id!==m.runId||r?.run_attempt!==m.runAttempt||r?.workflow_id!==target.workflowId||r?.repository?.full_name!==repository||r?.head_sha!==expectedCommit||r?.head_branch!=='main'||!['push','workflow_dispatch'].includes(r?.event))return reject('GitHub run does not match the served build and target');
 if(r.status!=='completed'||r.conclusion!=='success')return reject('Matching deployment run has not succeeded');
 const started=time(r.run_started_at),completed=time(r.updated_at),built=time(m.builtAt),observed=time(observedAt),merged=time(mergedAt);
 // Small clock allowance only for timestamp ordering, never for commit identity.
 if(![started,completed,built].every(Number.isFinite)||started<merged-60000||completed<started||built<started-60000||built>completed+60000||completed>observed+60000)return reject('Build and deployment timestamps are inconsistent');
 return {...result,verified:true,commit:expectedCommit,repository,runId:m.runId,runAttempt:m.runAttempt,workflowId:target.workflowId,builtAt:m.builtAt,deployedAt:r.updated_at,url:target.url,runUrl:`https://github.com/${repository}/actions/runs/${m.runId}/attempts/${m.runAttempt}`,error:null};
}
