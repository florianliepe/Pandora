import { randomUUID } from 'node:crypto';
import { z } from 'zod/v3';
export const id=()=>randomUUID();
export const now=()=>new Date().toISOString();
export function fail(status,message){throw Object.assign(new Error(message),{status});}
export const emailSchema=z.string().trim().toLowerCase().email().max(254).refine(v=>v.split('@')[1]==='eraneos.com','Use your @eraneos.com email address');
const text=z.string().trim().max(16000).default('');
const title=z.string().trim().min(2).max(180);
const ref=z.string().max(80).default('');
const date=z.union([z.literal(''),z.string().date()]).default('');
export const roles=['owner','developer','tester','viewer'];
export const statuses=['reported','triaged','planned','in_progress','ready_for_test','verified','closed','reopened'];
export const schemas={
  projects:z.object({name:title,description:text,repository:z.string().regex(/^$|^[\w.-]+\/[\w.-]+$/).default(''),mergePolicy:z.enum(['human','agentic']).default('human')}).strict(),
  issues:z.object({title,description:text,type:z.enum(['issue','defect','bug']).default('bug'),priority:z.enum(['critical','high','medium','low']).default('medium'),severity:z.enum(['critical','major','minor','cosmetic']).default('minor'),status:z.enum(statuses).default('reported'),ownerId:ref,iterationId:ref,steps:text,expected:text,actual:text,environment:text,mitigation:text,notes:text,testStatus:z.enum(['not_run','passed','failed','blocked']).default('not_run'),implementationStatus:z.enum(['not_started','coding','pull_request','merged','deployed']).default('not_started'),dueDate:date,estimate:z.number().int().min(0).max(1000).default(1),notify:z.boolean().default(true)}).strict(),
  iterations:z.object({name:title,startDate:z.string().date(),endDate:z.string().date(),goal:text}).strict().refine(v=>v.endDate>=v.startDate,'End date must follow start date'),
  cases:z.object({title,steps:text,expected:text,preconditions:text,kind:z.enum(['functional','regression','integration','smoke','acceptance']).default('functional'),issueId:ref}).strict(),
  runs:z.object({caseId:z.string().min(1),issueId:ref,iterationId:ref,result:z.enum(['passed','failed','blocked','not_run']),actual:text,environment:z.string().trim().min(1).max(200),build:z.string().trim().min(1).max(200),notes:text}).strict()
};
export function member(s,projectId,userId){const p=s.projects.find(p=>p.id===projectId&&!p.deletedAt); if(!p)fail(404,'Project not found'); const m=s.members.find(m=>m.projectId===projectId&&m.userId===userId);if(!m)fail(403,'Project access required');return m;}
export function permit(s,p,u,allowed){const m=member(s,p,u);if(!allowed.includes(m.role))fail(403,'Your project role does not allow this action');return m;}
export function audit(s,projectId,userId,action,entityId,before=null,after=null){s.events.push({id:id(),projectId,userId,action,entityId,at:now(),before:structuredClone(before),after:structuredClone(after)});}
export function validateRefs(s,p,record){
  for(const [field,collection] of [['iterationId','iterations'],['issueId','issues'],['caseId','cases']])if(record[field]&&!s[collection].some(x=>x.id===record[field]&&x.projectId===p&&!x.deletedAt))fail(400,`Invalid ${field}`);
  if(record.ownerId&&!s.members.some(m=>m.projectId===p&&m.userId===record.ownerId&&['owner','developer'].includes(m.role)))fail(400,'Owner must be a project owner or developer');
}
export function notify(s,issue,actor,event){
  if(!issue.notify)return;
  const relevant=event==='ready_for_test'?['owner','tester']:['owner','developer'];
  for(const m of s.members.filter(m=>m.projectId===issue.projectId&&m.userId!==actor&&(relevant.includes(m.role)||m.userId===issue.createdBy||m.userId===issue.ownerId))){
    const pref=s.preferences.find(p=>p.userId===m.userId&&p.projectId===issue.projectId);
    if(pref?.muted)continue;
    s.notifications.push({id:id(),projectId:issue.projectId,userId:m.userId,issueId:issue.id,title:issue.title,event,at:now(),read:false});
  }
}
export function metrics(s,p){
  const issues=s.issues.filter(i=>i.projectId===p&&!i.deletedAt), closed=issues.filter(i=>i.status==='closed');
  const events=s.events.filter(e=>e.projectId===p);
  const closing=i=>events.filter(e=>e.entityId===i.id&&e.after?.status==='closed'&&e.before?.status!=='closed').at(-1);
  const cycles=closed.map(i=>{const started=events.find(e=>e.entityId===i.id&&e.after?.status==='in_progress');const ended=closing(i);return started&&ended?(new Date(ended.at)-new Date(started.at))/86400000:null;}).filter(x=>x!==null);
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?(b[Math.floor((b.length-1)/2)]+b[Math.ceil((b.length-1)/2)])/2:null;};
  return {total:issues.length,open:issues.length-closed.length,critical:issues.filter(i=>i.priority==='critical'&&i.status!=='closed').length,wip:issues.filter(i=>i.status==='in_progress').length,closed:closed.length,cycleDays:median(cycles),throughput30d:closed.filter(i=>new Date(closing(i)?.at||0)>Date.now()-30*86400000).length,dora:null,doraReason:'Connect production deployment and incident events in phase two.'};
}

