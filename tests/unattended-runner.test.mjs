import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeAttestation,publicationAttestation,requestEnvelope,SOURCE_REPOSITORY} from '../runner/protocol.mjs';

const eventId='11111111-1111-4111-8111-111111111111';
const base='a'.repeat(40),head='b'.repeat(40);

test('runner accepts only UUID event identity and positive run identity',()=>{
 assert.equal(requestEnvelope('start',eventId,42).eventId,eventId);
 assert.throws(()=>requestEnvelope('start','issue text',42));
 assert.throws(()=>requestEnvelope('start',eventId,0));
 assert.throws(()=>requestEnvelope('shell',eventId,42));
});

test('publication is restricted to meids-app and opaque correlation metadata',()=>{
 const valid={repository:SOURCE_REPOSITORY,baseBranch:'main',baseSha:base,headSha:head,headBranch:'pandora/'+eventId,pullNumber:17,pullUrl:'https://github.com/florianliepe/meids-app/pull/17',marker:'Pandora-Delivery: '+eventId};
 assert.equal(publicationAttestation(valid).headSha,head);
 assert.throws(()=>publicationAttestation({...valid,repository:'florianliepe/meids-agent-configs'}));
 assert.throws(()=>publicationAttestation({...valid,headSha:base}));
 assert.throws(()=>publicationAttestation({...valid,pullUrl:'https://github.com/attacker/repo/pull/17'}));
});

test('merge attestation binds all required checks to the exact head SHA',()=>{
 const valid={repository:SOURCE_REPOSITORY,baseBranch:'main',baseSha:base,headSha:head,pullNumber:17,draft:false,mergeable:true,branchProtection:{enabled:true,requiredChecks:['validate','Me.IDs pull request validation']},checks:[{name:'validate',conclusion:'success',headSha:head},{name:'Me.IDs pull request validation',conclusion:'success',headSha:head}],observedAt:new Date().toISOString()};
 assert.equal(mergeAttestation(valid).pullNumber,17);
 assert.throws(()=>mergeAttestation({...valid,checks:[valid.checks[0]]}));
 assert.throws(()=>mergeAttestation({...valid,checks:valid.checks.map(c=>({...c,headSha:base}))}));
 assert.throws(()=>mergeAttestation({...valid,branchProtection:{enabled:false,requiredChecks:['validate']}}));
});

test('workflow pins trusted actions, scopes secrets to steps and stops before unattended merge',async()=>{
 const workflow=await readFile(new URL('../runner/pandora-issue-runner.yml',import.meta.url),'utf8');
 assert.match(workflow,/run-name: Pandora issue \$\{\{ inputs\.event_id \}\}/);
 assert.match(workflow,/openai\/codex-action@c05cfd74ad95c626cdf05c6685e62becc3bf7813/);
 assert.match(workflow,/actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/);
 assert.match(workflow,/actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/);
 assert.doesNotMatch(workflow,/jobs:\s*\n(?:.|\n)*?^\s{2}env:/m);
 assert.doesNotMatch(workflow,/\$\{\{[^}]*issue[^}]*\}\}.*(?:run:|shell:)/i);
 assert.match(workflow,/Stop unless trusted evidence and merge callbacks are implemented/);
});

test('receiver uses dedicated header credential and disables n8n execution retention',async()=>{
 const receiver=JSON.parse(await readFile(new URL('../runner/issue-runner-receiver.workflow.json',import.meta.url),'utf8'));
 const trigger=receiver.nodes.find(n=>n.name==='Runner callback');
 assert.equal(trigger.parameters.authentication,'headerAuth');
 assert.equal(trigger.credentials.httpHeaderAuth.name,'Pandora unattended runner (Intellectual Twin)');
 assert.equal(receiver.settings.saveDataSuccessExecution,'none');
 assert.equal(receiver.settings.saveDataErrorExecution,'none');
 const scope=receiver.nodes.find(n=>n.name==='Scope exact operation').parameters.jsCode;
 assert.match(scope,/Browser access is not supported/);
 assert.match(scope,/automation\/issues/);
 assert.doesNotMatch(JSON.stringify(receiver),/PANDORA_WORKER_TOKEN|OPENAI_API_KEY|MEIDS_APP_GITHUB_TOKEN/);
});

test('preflight is isolated from production event claiming and binds readiness to receiver file path',async()=>{
 const workflow=await readFile(new URL('../runner/pandora-runner-preflight.yml',import.meta.url),'utf8');
 assert.match(workflow,/mode:\s*\n\s*description: Nondestructive readiness probe/);
 assert.match(workflow,/00000000-0000-4000-8000-000000000001/);
 assert.match(workflow,/receiverWorkflowPath:\"runner\/issue-runner-receiver\.workflow\.json\"/);
 assert.match(workflow,/if: \$\{\{ cancelled\(\) \}\}/);
 assert.doesNotMatch(workflow,/meids-app|git push|gh pr create/);
});
