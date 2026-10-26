import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.mjs';
import {appServiceCredential} from '../server/evidence.mjs';
test('transaction rollback and concurrent writes preserve state',async()=>{
  const store=await createStore({memory:true});
  await assert.rejects(store.change(s=>{s.users.push({id:'rolled-back'});throw new Error('reject');}));
  assert.equal((await store.read()).users.length,0);
  await Promise.all(Array.from({length:25},(_,n)=>store.change(s=>{s.users.push({id:String(n)});})));assert.equal((await store.read()).users.length,25);await store.close();
});
test('production PostgreSQL adapter serializes writes across clients',{skip:!process.env.POSTGRES_TEST_URL},async()=>{
  const url=new URL(process.env.POSTGRES_TEST_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/pandora_test');
  const a=await createStore({databaseUrl:url.href}),b=await createStore({databaseUrl:url.href});
  await a.change(s=>{s.users=[];});await Promise.all(Array.from({length:20},(_,n)=>(n%2?a:b).change(s=>{s.users.push({id:String(n)});})));assert.equal((await a.read()).users.length,20);
  await assert.rejects(a.change(s=>{s.users=[];throw new Error('rollback');}));assert.equal((await b.read()).users.length,20);await a.close();await b.close();
});
test('managed identity token is scoped to storage and cached',async()=>{let calls=0;const credential=appServiceCredential({IDENTITY_ENDPOINT:'http://127.0.0.1/token',IDENTITY_HEADER:'test-header'},async(url,options)=>{calls++;assert.equal(url.searchParams.get('resource'),'https://storage.azure.com/');assert.equal(options.headers['X-IDENTITY-HEADER'],'test-header');return {ok:true,json:async()=>({access_token:'test-token',expires_on:String(Math.floor(Date.now()/1000)+3600)})};});await credential.getToken();await credential.getToken();assert.equal(calls,1);});
