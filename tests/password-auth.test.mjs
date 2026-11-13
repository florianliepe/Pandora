import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyRequest} from '../server/n8n-runtime.mjs';
const password='Synthetic test passphrase 726!';
function fixture(){
  let snapshot=Object.fromEntries(['users','projects','members','issues','iterations','cases','runs','attachments','events','notifications','preferences'].map(k=>[k,[]])),auth={};
  return {get snapshot(){return snapshot;},get auth(){return auth;},async call(path,body={},token){const r=await applyRequest({snapshot,auth,request:{path,body,token,method:path==='/projects'&&!body.name?'GET':'POST'},config:{mailReady:true}});snapshot=r.snapshot||snapshot;auth=r.authNext;return r;}};
}
async function setup(f,email){const r=await f.call('/auth/password/request',{email});assert.equal(r.response.status,200);assert.ok(r.pendingMail);const v=await f.call('/auth/password/complete',{challengeId:r.response.body.challengeId,code:r.pendingMail.code,password});assert.equal(v.response.status,200);return v.response.body;}
test('password lifecycle preserves identity, keeps hashes outside Git, and revokes sessions on reset',async()=>{
  const f=fixture(),owner=await setup(f,'owner@eraneos.com');
  assert.equal(f.auth.passwordCredentials[0].algorithm,'scrypt-v1');
  for(const key of ['passwordCredentials','passwordChallenges','passwordAttempts','accountInvitations'])assert.equal(key in f.snapshot,false);
  const raw=JSON.stringify(f.snapshot);assert.ok(!raw.includes(password));assert.ok(!raw.includes(f.auth.passwordCredentials[0].hash));
  const login=await f.call('/auth/password/login',{email:'OWNER@ERANEOS.COM',password});assert.equal(login.response.status,200);
  assert.equal((await f.call('/auth/password/login',{email:'owner@eraneos.com',password:'wrong'})).response.status,401);
  const reset=await f.call('/auth/password/request',{email:'owner@eraneos.com'});
  const input={challengeId:reset.response.body.challengeId,code:reset.pendingMail.code,password:password+' new'};
  const changed=await f.call('/auth/password/complete',input);assert.equal(changed.response.body.user.id,owner.user.id);
  assert.equal((await f.call('/projects',{},owner.token)).response.status,401);
  assert.equal((await f.call('/projects',{},login.response.body.token)).response.status,401);
  assert.equal((await f.call('/auth/password/complete',input)).response.status,401);
  assert.equal((await f.call('/auth/password/login',{email:'owner@eraneos.com',password})).response.status,401);
});
test('external guests require a current owner invitation and cannot access other projects',async()=>{
  const f=fixture();const uninvited=await f.call('/auth/password/request',{email:'guest@example.com'});assert.equal(uninvited.response.status,200);assert.equal(uninvited.pendingMail,null);
  const owner=await setup(f,'owner@eraneos.com');
  const project=(await f.call('/projects',{name:'Invited project'},owner.token)).response.body;
  const other=(await f.call('/projects',{name:'Private project'},owner.token)).response.body;
  const invite=await f.call(`/projects/${project.id}/members`,{email:'guest@example.com',role:'tester'},owner.token);
  assert.equal(invite.response.status,200);assert.equal(invite.pendingMail.purpose,'pandora_invitation');
  const guest=await setup(f,'guest@example.com');
  const projects=(await f.call('/projects',{},guest.token)).response.body;assert.equal(projects.length,1);assert.equal(projects[0].id,project.id);
  assert.equal((await f.call(`/projects/${other.id}/members`,{email:'attacker@example.com',role:'owner'},guest.token)).response.status,403);
  assert.equal((await f.call('/projects',{name:'Guest-owned project'},guest.token)).response.status,201);
});
test('expired invitations, removed membership, expired codes and exhausted guesses fail closed',async()=>{
  const f=fixture(),owner=await setup(f,'owner@eraneos.com');
  const project=(await f.call('/projects',{name:'Invited project'},owner.token)).response.body;
  await f.call(`/projects/${project.id}/members`,{email:'guest@example.com',role:'viewer'},owner.token);
  const req=await f.call('/auth/password/request',{email:'guest@example.com'});
  f.auth.accountInvitations[0].expires=0;
  assert.equal((await f.call('/auth/password/complete',{challengeId:req.response.body.challengeId,code:req.pendingMail.code,password})).response.status,401);
  await f.call(`/projects/${project.id}/members`,{email:'removed@example.com',role:'viewer'},owner.token);
  const removed=await f.call('/auth/password/request',{email:'removed@example.com'});
  const removedUser=f.snapshot.users.find(u=>u.email==='removed@example.com');
  f.snapshot.members=f.snapshot.members.filter(m=>m.userId!==removedUser.id);
  assert.equal((await f.call('/auth/password/complete',{challengeId:removed.response.body.challengeId,code:removed.pendingMail.code,password})).response.status,401);
  const expired=await f.call('/auth/password/request',{email:'expired@eraneos.com'});
  f.auth.passwordChallenges.find(c=>c.id===expired.response.body.challengeId).expires=0;
  assert.equal((await f.call('/auth/password/complete',{challengeId:expired.response.body.challengeId,code:expired.pendingMail.code,password})).response.status,401);
  const r=await f.call('/auth/password/request',{email:'fresh@eraneos.com'});
  const wrong=r.pendingMail.code==='00000000'?'11111111':'00000000';
  for(let i=0;i<5;i++)assert.equal((await f.call('/auth/password/complete',{challengeId:r.response.body.challengeId,code:wrong,password})).response.status,401);
  assert.equal((await f.call('/auth/password/complete',{challengeId:r.response.body.challengeId,code:r.pendingMail.code,password})).response.status,401);
});
test('password request and login attempt limits persist outside Git',async()=>{
  const f=fixture();
  for(let i=0;i<3;i++)assert.equal((await f.call('/auth/password/request',{email:'rate@example.com'})).response.status,200);
  assert.equal((await f.call('/auth/password/request',{email:'rate@example.com'})).response.status,429);
  f.auth.passwordAttempts=Array.from({length:10},()=>({email:'rate@example.com',kind:'login',at:Date.now()}));
  assert.equal((await f.call('/auth/password/login',{email:'rate@example.com',password})).response.status,429);
  assert.equal('passwordAttempts' in f.snapshot,false);
});
