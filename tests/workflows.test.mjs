import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const workflows={};for(const n of ['mail','chat','context'])workflows[n]=JSON.parse(await readFile(new URL(`../workflows/${n}.json`,import.meta.url),'utf8'));
test('email workflow validates exact recipients and hides code from response',()=>{
  const validate=workflows.mail.nodes.find(n=>n.name==='Validate request').parameters.jsCode;
  const run=body=>vm.runInNewContext(`(function(){${validate}})()`,{$input:{first:()=>({json:body})}});
  assert.equal(run({to:'tester@eraneos.com',code:'12345678',purpose:'pandora_login'})[0].json.to,'tester@eraneos.com');
  for(const to of ['tester@eraneos.com.evil.test','other@example.com','a@eraneos.com,b@example.com','a@eraneos.com\r\nBcc:x@example.com'])assert.throws(()=>run({to,code:'12345678',purpose:'pandora_login'}));
  assert.throws(()=>run({to:'tester@eraneos.com',code:'123',purpose:'pandora_login'}));
  const ack=workflows.mail.nodes.find(n=>n.name==='Delivery acknowledged').parameters.jsCode;assert.equal(JSON.stringify(vm.runInNewContext(`(function(){${ack}})()`)),'[{"json":{"accepted":true}}]');
});
test('workflow drafts require authentication and do not retain execution payloads',()=>{
  assert.equal(workflows.mail.nodes[0].type,'n8n-nodes-base.executeWorkflowTrigger');assert.equal(workflows.mail.settings.callerPolicy,'workflowsFromSameOwner');assert.ok(!workflows.mail.nodes.some(n=>n.type==='n8n-nodes-base.webhook'));const sender=workflows.mail.nodes.find(n=>n.name==='Send login code');assert.equal(sender.credentials.microsoftOutlookOAuth2Api.id,'RwBmsnNR6Poq2bIE');assert.equal(sender.parameters.additionalFields.from,'florian.liepe@eraneos.com');assert.equal(sender.parameters.additionalFields.saveToSentItems,false);assert.equal(workflows.chat.nodes[0].parameters.authentication,'basicAuth');assert.equal(workflows.chat.nodes[0].parameters.public,false);
  for(const w of Object.values(workflows)){assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveManualExecutions,false);}
  const tool=workflows.chat.nodes.find(n=>n.name==='read_issue_context');assert.match(tool.parameters.workflowInputs.value.context,/Embedded chat/);assert.ok(!tool.parameters.workflowInputs.value.context.includes('$fromAI'));
});
