// Pure read-only GitHub correlation, shared with the n8n collector.
const allowed=['florianliepe/meids-app','florianliepe/meids-agent-configs'];
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
export function pendingPulls(s){return (s.deliveries||[]).filter(j=>j.state!=='cancelled'&&j.pullRequest&&allowed.includes(j.repository)&&s.projects.some(p=>p.id===j.projectId&&!p.deletedAt&&p.pipelineConnection?.enabled&&p.pipelineConnection.revision===j.connectionRevision)).sort((a,b)=>(a.pullObservation?.observedAt||'').localeCompare(b.pullObservation?.observedAt||'')).slice(0,10).map(j=>({jobId:j.id,projectId:j.projectId,repository:j.repository,number:j.pullRequest.number,revision:j.pullRequest.revision}));}
export function pullRequests(refs=[]){return refs.filter(r=>allowed.includes(r.repository)&&positive(r.number)&&positive(r.revision)&&typeof r.jobId==='string').slice(0,10).map(r=>({...r,kind:'pull',url:`https://api.github.com/repos/${r.repository}/pulls/${r.number}`}));}
export function observePulls(s,details,observedAt){let applied=0;
 for(const r of details.filter(r=>r.kind==='pull')){
  const job=(s.deliveries||[]).find(j=>j.id===r.jobId&&j.projectId===r.projectId&&j.repository===r.repository&&j.state!=='cancelled'&&j.pullRequest?.number===r.number&&j.pullRequest.revision===r.revision);
  if(!job||job.pullObservation?.observedAt>=observedAt||job.pullRequest.requestedAt>observedAt||!s.projects.some(p=>p.id===job.projectId&&!p.deletedAt&&p.pipelineConnection?.enabled&&p.pipelineConnection.revision===job.connectionRevision))continue;
  const p=r.body,valid=r.status===200&&p?.number===r.number&&p.base?.repo?.full_name===job.repository&&p.base?.ref===job.baseBranch&&p.head?.repo?.full_name===job.repository&&sha(p.head?.sha);
  const linked=valid&&typeof p.body==='string'&&p.body.split(/\r?\n/).some(line=>line.trim()===`Pandora-Delivery: ${job.id}`);
  if(!valid){job.pullObservation={...(job.pullObservation||{}),observedAt,stale:true,error:'Pull request metadata is unavailable or does not match the allowed repository and base branch'};continue;}
  job.pullObservation={observedAt,number:p.number,url:`https://github.com/${job.repository}/pull/${p.number}`,headSha:p.head.sha,headBranch:String(p.head.ref||'').slice(0,200),baseBranch:p.base.ref,state:p.state==='closed'?'closed':'open',draft:!!p.draft,merged:!!p.merged,mergeSha:p.merged&&sha(p.merge_commit_sha)?p.merge_commit_sha:null,mergedAt:p.merged&&typeof p.merged_at==='string'?p.merged_at:null,correlationVerified:linked,error:linked?null:'Add the exact Pandora-Delivery marker to the PR description to establish issue correlation',stale:false};applied++;
 }
 return applied;
}
