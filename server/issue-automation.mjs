import {z} from 'zod/v3';
import {id,now,fail,permit,audit} from './domain.mjs';

// Issue contents never select a runner, repository, credential or executable command.
export const automationRepository='florianliepe/meids-app';
const terminal=new Set(['cancelled','completed','failed','superseded']);
export const triggerFields=['description','steps'];
export function automationView(s,projectId){
 const p=s.projects.find(p=>p.id===projectId&&!p.deletedAt);
 const config=p?.issueAutomation||{enabled:false,revision:0};
 const runner=s.automationRunners?.find(r=>r.projectId===projectId);
 const ready=!!runner?.ready&&Date.parse(runner.checkedAt)<=Date.now()+60000&&Date.now()-Date.parse(runner.checkedAt)<15*60000;
 return {enabled:!!config.enabled,revision:config.revision,repository:automationRepository,mergePolicy:'after_required_checks',ready,reason:ready?'Runner checks passed':runner?.reason||'Unattended runner authentication and required repository checks are not configured',events:(s.issueAutomationEvents||[]).filter(e=>e.projectId===projectId).slice(-30).map(({lease,...e})=>e)};
}
function cancelEvent(s,e,reason){
 if(terminal.has(e.state))return;
 e.state=e.runId||e.attempts?'cancellation_requested':'cancelled';e.reason=reason;e.updatedAt=now();delete e.lease;
 if(e.jobId){const j=s.deliveries?.find(j=>j.id===e.jobId);if(j&&!['accepted','reopened'].includes(j.state)){j.state='cancelled';j.cancelledAt=now();j.version++;delete j.lease;}}
}
export function setIssueAutomation(s,p,userId,raw){
 permit(s,p,userId,['owner']);
 const input=z.object({enabled:z.boolean(),revision:z.number().int().min(0)}).strict().parse(raw);
 const project=s.projects.find(x=>x.id===p&&!x.deletedAt),old=project.issueAutomation||{enabled:false,revision:0};
 if(old.revision!==input.revision)fail(409,'Automation changed; reload before saving');
 if(input.enabled){if(!project.pipelineConnection?.enabled)fail(409,'Connect development repositories first');if(!automationView(s,p).ready)fail(409,'Configure and verify the unattended runner and required repository checks first');}
 project.issueAutomation={enabled:input.enabled,revision:old.revision+1,ownerId:userId,updatedAt:now(),mergePolicy:'after_required_checks'};
 if(!input.enabled)for(const e of s.issueAutomationEvents||[])if(e.projectId===p)cancelEvent(s,e,'Owner stopped automation');
 project.version=(project.version||0)+1;project.updatedAt=now();
 audit(s,p,userId,input.enabled?'automation.started':'automation.stopped',p,null,{revision:project.issueAutomation.revision});
 // Start only affects subsequent issue events; it never replays historical backlog.
 return automationView(s,p);
}
export function recordIssueEvent(s,issue,actor,kind,before){
 if(!['created','updated','screenshot'].includes(kind)||actor==='automation'||actor==='codex-local'||actor==='codex-runner')return;
 if(kind==='updated'&&!triggerFields.some(k=>before?.[k]!==issue[k]))return;
 const project=s.projects.find(p=>p.id===issue.projectId&&!p.deletedAt),config=project?.issueAutomation;
 if(!config?.enabled||issue.deletedAt)return;
 const events=s.issueAutomationEvents??=[];
 for(const e of events)if(e.projectId===issue.projectId&&e.issueId===issue.id&&!terminal.has(e.state))cancelEvent(s,e,'Superseded by changed issue evidence');
 const event={id:id(),projectId:issue.projectId,issueId:issue.id,actor,kind,state:'pending',generation:config.revision,evidenceRevision:issue.evidenceRevision||1,createdAt:now(),updatedAt:now(),notBefore:Date.now()+30000,attempts:0,repository:automationRepository};
 events.push(event);audit(s,issue.projectId,actor,'automation.event_queued',event.id,null,{issueId:issue.id,kind});
}
export function eventIsCurrent(s,e){
 const p=s.projects.find(p=>p.id===e.projectId&&!p.deletedAt),i=s.issues.find(i=>i.id===e.issueId&&i.projectId===e.projectId&&!i.deletedAt);
 return !!p?.issueAutomation?.enabled&&p.issueAutomation.revision===e.generation&&!!i&&(i.evidenceRevision||1)===e.evidenceRevision;
}
