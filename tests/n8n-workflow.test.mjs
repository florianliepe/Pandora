import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=JSON.parse(readFileSync(new URL('../workflows/api.json',import.meta.url),'utf8'));
const node=name=>api.nodes.find(n=>n.name===name);
test('deployed API definition fences writes and does not retain credentials in execution logs',()=>{
  assert.equal(api.settings.saveDataErrorExecution,'none');
  assert.equal(api.settings.saveDataSuccessExecution,'none');
  assert.equal(api.settings.saveManualExecutions,false);
  assert.equal(api.settings.executionTimeout,110);
  assert.equal(node('API request').parameters.options.allowedOrigins,'https://florianliepe.github.io');
  assert.deepEqual(node('Acquire lease').parameters.filters.conditions.map(c=>c.keyName),['workspace','revision','lockUntil']);
  assert.deepEqual(node('Release lease').parameters.filters.conditions.map(c=>c.keyName),['workspace','leaseToken','revision']);
  assert.match(node('Encode state').parameters.jsCode,/sha:\$\('Read Git state'\)/);
  assert.match(node('Git result').parameters.jsCode,/r\.authNext=\$\('Prepare'\)/);
  assert.match(node('Released').parameters.jsCode,/Session save conflict/);
  assert.equal(node('Send email').parameters.options.waitForSubWorkflow,true);
  assert.match(node('Mail result').parameters.jsCode,/\$json\.accepted===true/);
  assert.match(node('Prepare').parameters.jsCode,/Pandora.tokenHash\(request.token/);
});

test('quality automation is internal-only and keeps model calls outside the storage lease',()=>{
  const store=JSON.parse(readFileSync(new URL('../workflows/quality-store.json',import.meta.url),'utf8'));
  const worker=JSON.parse(readFileSync(new URL('../workflows/quality-worker.json',import.meta.url),'utf8'));
  for(const w of [store,worker]){assert.equal(w.settings.callerPolicy,'workflowsFromSameOwner');assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveManualExecutions,false);assert.ok(!w.nodes.some(n=>n.type==='n8n-nodes-base.webhook'));}
  assert.match(store.nodes.find(n=>n.name==='Prepare').parameters.jsCode,/Internal operation required/);
  assert.match(store.nodes.find(n=>n.name==='Apply request').parameters.jsCode,/internalWorker:true/);
  assert.ok(!store.nodes.some(n=>n.type.includes('lmChat')));
  assert.ok(worker.nodes.some(n=>n.name==='Describe screenshot'));
  assert.equal(worker.nodes.find(n=>n.name==='Claim job').parameters.options.waitForSubWorkflow,true);
  assert.equal(worker.nodes.find(n=>n.name==='Save drafts').parameters.workflowInputs.value.path,'/automation/complete');
});
