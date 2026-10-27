import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import * as cryptoAdapter from '../server/n8n-crypto.mjs';

execFileSync(process.execPath,['scripts/build-n8n.mjs']);
const context={Buffer};
runInNewContext(readFileSync('.local/n8n-runtime.js','utf8'),context);
const fresh=()=>Object.fromEntries(['users','projects','members','issues','iterations','cases','runs','attachments','events','notifications','preferences'].map(k=>[k,[]]));
const execute=(snapshot,auth,request,config={})=>context.Pandora.run({snapshot,auth,request,config,entropy:randomBytes(32).toString('hex')});

test('n8n crypto adapter matches native SHA-256 and requires strong entropy',()=>{
  assert.throws(()=>cryptoAdapter.setEntropy('weak'));
  cryptoAdapter.setEntropy(randomBytes(32).toString('hex'));
  for(const value of ['', 'Pandora', 'über '.repeat(100)])assert.equal(cryptoAdapter.createHash('sha256').update(value).digest('hex'),createHash('sha256').update(value).digest('hex'));
  assert.match(cryptoAdapter.randomUUID(),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(cryptoAdapter.randomBytes(32).toString('hex'),cryptoAdapter.randomBytes(32).toString('hex'));
});

test('bundled n8n runtime keeps authentication out of Git and enforces access',async()=>{
  let snapshot=fresh(),auth={};
  const call=async(path,method='GET',body,token,config={})=>{
    const result=await execute(snapshot,auth,{path,method,body,token},config);
    snapshot=result.snapshot||snapshot;auth=result.authNext;
    return result;
  };
  assert.equal((await call('/health')).response.status,200);
  assert.equal((await call('/projects')).response.status,401);
  assert.equal((await call('/auth/request','POST',{email:'owner@eraneos.com'})).response.status,503);
  const request=await call('/auth/request','POST',{email:'owner@eraneos.com'},null,{mailReady:true});
  assert.equal(request.response.status,200);
  assert.equal(request.writeGit,false);
  assert.equal('challenges' in snapshot,false);
  assert.equal('sessions' in snapshot,false);
  const code=request.pendingMail.code,challengeId=request.response.body.challengeId;
  const login=await call('/auth/verify','POST',{challengeId,code});
  assert.equal(login.response.status,200);
  const token=login.response.body.token;
  assert.equal(auth.sessions[0].hash,createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(snapshot).includes(token),false);
  assert.equal((await call('/auth/verify','POST',{challengeId,code})).response.status,401);
  const created=await call('/projects','POST',{name:'Runtime acceptance'},token);
  assert.equal(created.response.status,201);
  assert.equal(created.writeGit,true);
  assert.equal(snapshot.members[0].role,'owner');
  const before=JSON.stringify(snapshot);
  const denied=await call('/projects/'+created.response.body.id,'PUT',{name:'Changed',version:99},token);
  assert.equal(denied.response.status,409);
  assert.equal(JSON.stringify(snapshot),before);
  assert.equal((await call('/auth/logout','POST',{},token)).response.status,200);
  assert.equal((await call('/projects','GET',null,token)).response.status,401);
});

test('bundled worker errors remain explicit and do not mutate private state',async()=>{
 const snapshot=fresh(),before=JSON.stringify(snapshot),body={projectId:'11111111-1111-4111-8111-111111111111',workerId:'codex-local',jobId:'22222222-2222-4222-8222-222222222222',claimId:'33333333-3333-4333-8333-333333333333',token:'a'.repeat(64)};
 const denied=await execute(snapshot,{}, {path:'/automation/delivery/renew',method:'POST',body},{internalWorker:true});
 assert.equal(denied.response.status,403);assert.equal(denied.writeGit,false);assert.equal(JSON.stringify(snapshot),before);
 const invalid=await execute(snapshot,{}, {path:'/automation/delivery/renew',method:'POST',body:{}},{internalWorker:true});assert.equal(invalid.response.status,400);assert.equal(invalid.writeGit,false);
});
