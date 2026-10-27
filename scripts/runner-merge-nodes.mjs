// Trusted n8n receiver nodes. Runner input never supplies GitHub observations or URLs.
export function addRunnerMergeNodes({node,code,github,store,edge,connections}){
 const repo='https://api.github.com/repos/florianliepe/meids-app';
 const condition=(name,left,right)=>node(name,'n8n-nodes-base.if',{conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},conditions:[{id:name,leftValue:left,rightValue:right,operator:{type:'string',operation:'equals'}}],combinator:'and'},options:{}},2.2);
 condition('Request authorized','={{ String($json.status) }}','200');
 condition('Merge requested',"={{ $('Scope exact operation').first().json.operation }}",'merge');
 code('Validate prepared merge',`const m=$json.body?.merge;if(!m||m.repository!=='florianliepe/meids-app'||!Number.isSafeInteger(m.pullNumber)||!/^[a-f0-9]{40}$/.test(m.headSha))throw Error('Store did not authorize merge observation');return [{json:m}];`);
 github('Read merge PR','GET',`=${repo}/pulls/{{ $json.pullNumber }}`);
 code('Check merge PR response',`if($json.statusCode!==200)throw Error('PR unavailable');return [{json:$('Validate prepared merge').first().json}];`);
 github('Read enforced protection','GET',repo+'/branches/main/protection');
 code('Check protection response',`if($json.statusCode!==200)throw Error('Branch protection unavailable');return [{json:$('Validate prepared merge').first().json}];`);
 github('Read exact head checks','GET',`=${repo}/commits/{{ $json.headSha }}/check-runs?per_page=100&filter=latest`);
 code('Check head checks response',`if($json.statusCode!==200)throw Error('Required checks unavailable');return [{json:$('Validate prepared merge').first().json}];`);
 github('Read merge base','GET',repo+'/git/ref/heads/main');
 code('Prepare merge observations',`if($json.statusCode!==200||$json.body?.object?.type!=='commit')throw Error('Source base unavailable');return [{json:{...$('Scope exact operation').first().json.body,observedAt:new Date().toISOString(),mainSha:$json.body.object.sha,pull:$('Read merge PR').first().json.body,protection:$('Read enforced protection').first().json.body,checks:$('Read exact head checks').first().json.body}}];`);
 store('Authorize exact merge','/automation/issues/merge-authorize','={{ $json }}');
 code('Validate merge authorization',`const a=$json.body?.authorization;if($json.status!==200||!a||a.repository!=='florianliepe/meids-app')throw Error('Merge requirements not satisfied');return [{json:a}];`);
 store('Consume merge authorization','/automation/issues/merge-consume',`={{ {projectId:$json.projectId,eventId:$json.eventId,runId:$json.runId,jobId:$json.jobId,authorizationId:$json.id} }}`);
 code('Validate consumed merge',`const m=$json.body?.merge;if($json.status!==200||!m||m.repository!=='florianliepe/meids-app'||m.method!=='merge')throw Error('Merge authorization revoked');return [{json:m}];`);
 github('Merge exact revision','PUT',`=${repo}/pulls/{{ $json.pullNumber }}/merge`,`={{ {sha:$json.headSha,merge_method:'merge'} }}`);
 code('Check merge submission',`if($json.statusCode!==200||$json.body?.merged!==true)throw Error('Merge not confirmed; do not retry an ambiguous submission');return [{json:$('Validate consumed merge').first().json}];`);
 github('Read merged PR','GET',`=${repo}/pulls/{{ $json.pullNumber }}`);
 code('Prepare merge confirmation',`if($json.statusCode!==200||$json.body?.merge_commit_sha!==$('Merge exact revision').first().json.body.sha)throw Error('Merged revision not independently confirmed');const a=$('Validate merge authorization').first().json;return [{json:{projectId:a.projectId,eventId:a.eventId,runId:a.runId,jobId:a.jobId,authorizationId:a.id,pull:$json.body}}];`);
 store('Record confirmed merge','/automation/issues/merge-complete','={{ $json }}');
 connections['Authorize request']={main:[]};edge('Authorize request','Request authorized');edge('Request authorized','Merge requested',0);edge('Request authorized','Return no-store JSON',1);edge('Merge requested','Validate prepared merge',0);edge('Merge requested','Cancellation requested',1);
 const path=['Validate prepared merge','Read merge PR','Check merge PR response','Read enforced protection','Check protection response','Read exact head checks','Check head checks response','Read merge base','Prepare merge observations','Authorize exact merge','Validate merge authorization','Consume merge authorization','Validate consumed merge','Merge exact revision','Check merge submission','Read merged PR','Prepare merge confirmation','Record confirmed merge','Return no-store JSON'];
 for(let i=1;i<path.length;i++)edge(path[i-1],path[i]);
}
