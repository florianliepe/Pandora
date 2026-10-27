import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/app.mjs';
import {schemas} from '../server/domain.mjs';
let store,server,origin;const mailbox=new Map();
before(async()=>{store=await createStore({memory:true});const app=createApp({store,env:{PUBLIC_ORIGIN:'https://example.test'},deliverMail:async({email,code})=>mailbox.set(email,code)});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(r=>server.close(r));await store.close();});
async function call(path,method='GET',body,token){const r=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function login(email){const a=await call('/auth/request','POST',{email});assert.equal(a.status,200);const b=await call('/auth/verify','POST',{challengeId:a.data.challengeId,code:mailbox.get(email)});assert.equal(b.status,200);return {...b.data,challengeId:a.data.challengeId,code:mailbox.get(email)};}
let owner,developer,tester,outsider,viewer,project,issue,iteration,testcase,run;
const path=()=>`/projects/${project.id}`;
test('authentication restricts exact email domain and fails closed without credentials',async()=>{
  assert.equal((await call('/auth/request','POST',{email:'x@eraneos.com.evil.test'})).status,400);
  assert.equal((await call('/auth/request','POST',{email:'x@other.com'})).status,400);
  assert.equal((await call('/projects')).status,401);
  owner=await login('owner@eraneos.com');developer=await login('developer@eraneos.com');tester=await login('tester@eraneos.com');outsider=await login('outsider@eraneos.com');viewer=await login('viewer@eraneos.com');
  assert.equal((await call('/auth/verify','POST',{challengeId:owner.challengeId,code:owner.code})).status,401);
});
test('wrong code attempts persist and lock the challenge',async()=>{const a=await call('/auth/request','POST',{email:'locked@eraneos.com'});for(let n=0;n<5;n++)assert.equal((await call('/auth/verify','POST',{challengeId:a.data.challengeId,code:'00000000'})).status,401);assert.equal((await call('/auth/verify','POST',{challengeId:a.data.challengeId,code:mailbox.get('locked@eraneos.com')})).status,401);});
test('project creator becomes owner; existing projects require membership',async()=>{
  const r=await call('/projects','POST',{name:'Pandora acceptance',description:'Private test project'},owner.token);assert.equal(r.status,201);project=r.data;
  assert.equal((await call(path(),'GET',null,outsider.token)).status,403);
  assert.deepEqual((await call('/projects','GET',null,outsider.token)).data,[]);
  for(const [u,role] of [[developer,'developer'],[tester,'tester'],[viewer,'viewer']])assert.equal((await call(path()+'/members','POST',{email:u.user.email,role},owner.token)).status,200);
  assert.equal((await call(path()+'/members','POST',{email:outsider.user.email,role:'owner'},developer.token)).status,403);
});
test('last owner cannot be removed or downgraded',async()=>{assert.equal((await call(path()+'/members/'+owner.user.id,'DELETE',null,owner.token)).status,400);assert.equal((await call(path()+'/members','POST',{email:owner.user.email,role:'viewer'},owner.token)).status,400);});
test('roles restrict writes and project-scoped references',async()=>{
  assert.equal((await call(path()+'/issues','POST',{title:'Viewer cannot write'},viewer.token)).status,403);
  assert.equal((await call(path()+'/iterations','POST',{name:'Iteration',startDate:'2026-10-01',endDate:'2026-10-14'},tester.token)).status,403);
  const r=await call(path()+'/iterations','POST',{name:'Iteration 1',startDate:'2026-10-01',endDate:'2026-10-31'},developer.token);assert.equal(r.status,201);iteration=r.data;
  assert.equal((await call(path()+'/issues','POST',{title:'Bad reference',iterationId:'other-project-iteration'},tester.token)).status,400);
  const i=await call(path()+'/issues','POST',{title:'Screenshot upload fails',priority:'high',iterationId:iteration.id,ownerId:developer.user.id},owner.token);assert.equal(i.status,201);issue=i.data;
});
test('optimistic concurrency rejects stale updates without lost changes',async()=>{
  let r=await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(issue),status:'triaged',version:issue.version},developer.token);assert.equal(r.status,200);const old=issue;issue=r.data;
  assert.equal((await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(old),version:old.version,title:'Stale overwrite'},developer.token)).status,409);
  const current=(await call(path(),'GET',null,owner.token)).data.issues.find(i=>i.id===issue.id);assert.equal(current.status,'triaged');assert.notEqual(current.title,'Stale overwrite');
});
test('workflow rejects skipped stages and tester planning changes',async()=>{
  assert.equal((await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(issue),status:'closed',version:issue.version},owner.token)).status,400);
  assert.equal((await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(issue),priority:'critical',version:issue.version},tester.token)).status,403);
  for(const status of ['in_progress','ready_for_test']){const r=await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(issue),status,version:issue.version},developer.token);assert.equal(r.status,200);issue=r.data;}
});
test('verification requires a linked passing test; developer cannot verify',async()=>{
  assert.equal((await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(issue),status:'verified',testStatus:'passed',version:issue.version},tester.token)).status,400);
  testcase=(await call(path()+'/cases','POST',{title:'Upload a screenshot',steps:'Attach PNG to an issue',expected:'Preview appears',issueId:issue.id},tester.token)).data;
  let r=await call(path()+'/runs','POST',{caseId:testcase.id,issueId:issue.id,result:'passed',environment:'staging',build:'test-sha',actual:'Preview appears'},tester.token);assert.equal(r.status,201);run=r.data;
  assert.equal((await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(issue),status:'verified',testStatus:'passed',version:issue.version},developer.token)).status,403);
  r=await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(issue),status:'verified',testStatus:'passed',version:issue.version},tester.token);assert.equal(r.status,200);issue=r.data;
  r=await call(path()+'/issues/'+issue.id,'PUT',{...schemas.issues.strip().parse(issue),status:'closed',version:issue.version},owner.token);assert.equal(r.status,200);issue=r.data;
});
test('test case changes do not rewrite execution snapshots',async()=>{
  const r=await call(path()+'/cases/'+testcase.id,'PUT',{...schemas.cases.strip().parse(testcase),expected:'Changed expected result',version:testcase.version},tester.token);assert.equal(r.status,200);
  const r2=await call(path()+'/runs/'+run.id,'PUT',{...schemas.runs.strip().parse(run),notes:'Extra note',version:run.version},tester.token);assert.equal(r2.status,200);assert.equal(r2.data.caseSnapshot.expected,'Preview appears');
});
test('private screenshots validate signatures, enforce access, and can be archived',async()=>{
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1cAAAAASUVORK5CYII=';
  assert.equal((await call(path()+'/issues/'+issue.id+'/attachments','POST',{name:'fake.png',type:'image/png',data:Buffer.from('<script>alert(1)</script>').toString('base64')},owner.token)).status,400);
  assert.equal((await call(path()+'/issues/'+issue.id+'/attachments','POST',{name:'evidence.png',type:'image/png',data:png},tester.token)).status,201);
  const snapshot=(await call(path(),'GET',null,owner.token)).data;const a=snapshot.attachments[0];assert.equal(a.data,undefined);
  assert.equal((await call(path()+'/attachments/'+a.id,'GET',null,outsider.token)).status,403);
  const r=await fetch(origin+'/api'+path()+'/attachments/'+a.id,{headers:{Authorization:`Bearer ${owner.token}`}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');
  assert.equal((await call(path()+'/attachments/'+a.id,'DELETE',null,tester.token)).status,200);
});
test('notifications route to relevant roles and respect mute',async()=>{
  const d=(await call(path(),'GET',null,developer.token)).data,t=(await call(path(),'GET',null,tester.token)).data,v=(await call(path(),'GET',null,viewer.token)).data;
  assert.ok(d.notifications.length>0);assert.ok(t.notifications.some(n=>n.event==='ready_for_test'));assert.equal(v.notifications.length,0);
  await call(path()+'/preferences','PUT',{muted:true},developer.token);const count=d.notifications.length;
  await call(path()+'/issues','POST',{title:'New report after mute'},owner.token);
  assert.equal((await call(path(),'GET',null,developer.token)).data.notifications.length,count);
});
test('audit snapshots are immutable; metrics do not invent DORA',async()=>{const d=(await call(path(),'GET',null,owner.token)).data;assert.equal(d.events.find(e=>e.entityId===issue.id&&e.action==='issues.created').after.status,'reported');assert.equal(d.metrics.closed,1);assert.equal(d.metrics.dora,null);assert.equal(d.metrics.throughput30d,1);});
test('unconfigured agent and merge policy fail explicitly',async()=>{assert.equal((await call(path()+'/chat','POST',{message:'Fix all issues'},owner.token)).status,503);assert.equal((await call(path(),'PUT',{...schemas.projects.strip().parse(project),mergePolicy:'agentic',version:project.version},owner.token)).status,409);});
test('aggregate tests enforce membership and cadence configuration requires ownership',async()=>{
  assert.ok((await call('/tests','GET',null,owner.token)).data.cases.some(c=>c.projectId===project.id));
  assert.deepEqual((await call('/tests','GET',null,outsider.token)).data.cases,[]);
  const config={enabled:true,startDate:'2026-10-27',lengthDays:14,lookahead:3};
  assert.equal((await call(path()+'/cadence','PUT',config,developer.token)).status,403);
  assert.equal((await call(path()+'/cadence','PUT',config,owner.token)).status,200);
  const first=(await call(path(),'GET',null,owner.token)).data.iterations.length;
  assert.equal((await call(path()+'/cadence','PUT',config,owner.token)).status,200);
  assert.equal((await call(path(),'GET',null,owner.token)).data.iterations.length,first);
});
test('cross-origin requests rejected and logout revokes token',async()=>{const r=await fetch(origin+'/api/projects',{headers:{Origin:'https://evil.test',Authorization:`Bearer ${owner.token}`}});assert.equal(r.status,403);assert.equal((await call('/auth/logout','POST',{},outsider.token)).status,200);assert.equal((await call('/projects','GET',null,outsider.token)).status,401);});
test('pipeline connection is owner-only, revision checked, and ingestion is not public',async()=>{
  for(const user of [developer,tester,viewer])assert.equal((await call(path()+'/pipelines','PUT',{enabled:true,revision:0},user.token)).status,403);
  assert.equal((await call(path()+'/pipelines','PUT',{enabled:true,revision:0},owner.token)).status,200);
  assert.equal((await call(path()+'/pipelines','PUT',{enabled:false,revision:0},owner.token)).status,409);
  assert.equal((await call(path()+'/pipelines','PUT',{enabled:true,revision:1,repository:'attacker/repo'},owner.token)).status,400);
  assert.equal((await call('/automation/pipelines/complete','POST',{},owner.token)).status,404);
  assert.equal((await call(path()+'/pipelines','PUT',{enabled:false,revision:1},owner.token)).status,200);
});

test('project archiving hides records and preserves audit history',async()=>{assert.equal((await call(path(),'DELETE',null,developer.token)).status,403);assert.equal((await call(path(),'DELETE',null,owner.token)).status,200);assert.equal((await call(path(),'GET',null,owner.token)).status,404);assert.ok((await store.read()).events.some(e=>e.action==='project.archived'));});

