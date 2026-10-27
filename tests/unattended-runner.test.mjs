import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decryptCapability,encryptCapability} from '../runner/capability-crypto.mjs';
import {decodePinnedGitBlob} from '../runner/git-blob.mjs';
import {approvedBridgeUrl,mergeAttestation,publicationProposal,requestEnvelope,SOURCE_REPOSITORY} from '../runner/protocol.mjs';

const eventId='11111111-1111-4111-8111-111111111111';
const base='a'.repeat(40),head='b'.repeat(40),blob='c'.repeat(40);
const capability={projectId:'3daa1c59-cd24-487b-a8e4-dc5d930e41f0',workerId:'codex-local',jobId:eventId,claimId:'22222222-2222-4222-8222-222222222222',token:'d'.repeat(64)};

test('dependency-free runner rejects shell-shaped event input before network access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pandora-minimal-runner-'));
 try{
  await cp(new URL('../runner',import.meta.url),join(root,'runner'),{recursive:true,filter:source=>!source.endsWith('.yml')&&!source.endsWith('.json')&&!source.endsWith('README.md')});
  const injected=join(root,'injected'),result=spawnSync(process.execPath,['runner/bridge.mjs','start','--event-id',`;touch ${injected}`,'--run-id','42'],{cwd:root,encoding:'utf8',env:{...process.env,PANDORA_BRIDGE_URL:'https://eraneos-agentic-platform.azurewebsites.net/webhook/pandora-issue-runner-v1',PANDORA_WORKER_TOKEN:'e'.repeat(64)}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Event ID must be a UUID/);assert.equal(spawnSync(process.execPath,['-e',`require('fs').accessSync(${JSON.stringify(injected)})`]).status,1);
  assert.doesNotMatch(await readFile(join(root,'runner/protocol.mjs'),'utf8'),/from ['"]zod/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('bridge endpoint is pinned to the approved n8n origin and path',()=>{
 const approved='https://eraneos-agentic-platform.azurewebsites.net/webhook/pandora-issue-runner-v1';
 assert.equal(approvedBridgeUrl(approved),approved);
 for(const value of ['http://eraneos-agentic-platform.azurewebsites.net/webhook/pandora-issue-runner-v1','https://evil.example/webhook/pandora-issue-runner-v1',approved+'?token=x',approved+'/extra'])assert.throws(()=>approvedBridgeUrl(value));
});

test('runner accepts only UUID event identity and positive run identity',()=>{
 assert.equal(requestEnvelope('start',eventId,42).eventId,eventId);
 assert.throws(()=>requestEnvelope('start','issue text',42));assert.throws(()=>requestEnvelope('start',eventId,0));assert.throws(()=>requestEnvelope('shell',eventId,42));
});

test('capability is authenticated encrypted data and wrong worker token fails',()=>{
 const token='f'.repeat(64),encrypted=encryptCapability(capability,token),serialized=JSON.stringify(encrypted);
 assert.doesNotMatch(serialized,/codex-local|3daa1c59|dddddddd/);
 assert.deepEqual(decryptCapability(encrypted,token),capability);
 assert.throws(()=>decryptCapability(encrypted,'0'.repeat(64)));
});

test('pinned screenshot bytes must match size and Git blob SHA',()=>{
 const bytes=Buffer.from('private screenshot bytes'),sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),file={name:'evidence.png',type:'image/png',data:bytes.toString('base64'),sha,size:bytes.length};
 assert.deepEqual(decodePinnedGitBlob(file),bytes);
 assert.throws(()=>decodePinnedGitBlob({...file,sha:'0'.repeat(40)}));
 assert.throws(()=>decodePinnedGitBlob({...file,size:bytes.length+1}));
});

test('publication proposal is bounded, sanitized and meids-app only',()=>{
 const valid={baseSha:base,files:[{path:'frontend/app.js',content:'change'}]};
 assert.equal(publicationProposal(valid).files.length,1);
 assert.throws(()=>publicationProposal({...valid,repository:'florianliepe/meids-agent-configs'}));
 assert.equal(publicationProposal({...valid,files:[{path:'frontend/old.js',content:null}]}).files[0].content,null);
 for(const path of ['.github/workflows/pwn.yml','.git/config','.env','config/client-secret.txt','config/credential.json','private.pem','../escape'])assert.throws(()=>publicationProposal({...valid,files:[{...valid.files[0],path}]}));
});

test('merge attestation binds required checks and both workflow blob SHAs',()=>{
 const valid={repository:SOURCE_REPOSITORY,baseBranch:'main',baseSha:base,headSha:head,pullNumber:17,draft:false,mergeable:true,branchProtection:{enabled:true,requiredChecks:['validate','Me.IDs pull request validation']},checks:[{name:'validate',conclusion:'success',headSha:head},{name:'Me.IDs pull request validation',conclusion:'success',headSha:head}],observedAt:new Date().toISOString(),runnerWorkflowBlobSha:blob,receiverWorkflowBlobSha:'d'.repeat(40)};
 assert.equal(mergeAttestation(valid).pullNumber,17);
 assert.throws(()=>mergeAttestation({...valid,checks:[valid.checks[0]]}));assert.throws(()=>mergeAttestation({...valid,checks:valid.checks.map(item=>({...item,headSha:base}))}));assert.throws(()=>mergeAttestation({...valid,receiverWorkflowBlobSha:undefined}));
});

test('production workflow uses env input, pinned actions, no source credential and explicit needs_input',async()=>{
 const workflow=await readFile(new URL('../runner/pandora-issue-runner.yml',import.meta.url),'utf8');
 assert.match(workflow,/run-name: Pandora issue \$\{\{ inputs\.event_id \}\}/);assert.match(workflow,/openai\/codex-action@c05cfd74ad95c626cdf05c6685e62becc3bf7813/);assert.match(workflow,/actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/);assert.match(workflow,/actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/);
 assert.equal((workflow.match(/\$\{\{ inputs\.event_id \}\}/g)||[]).length,3);assert.match(workflow,/EVENT_ID: \$\{\{ inputs\.event_id \}\}/);assert.doesNotMatch(workflow,/run:.*inputs\.event_id|MEIDS_APP_GITHUB_TOKEN|git push|gh pr create|npm exec|--yes/);assert.match(workflow,/npm ci --ignore-scripts/);assert.match(workflow,/--outcome needs_input/);assert.match(workflow,/Stop unless trusted evidence and merge callbacks are implemented/);
});

test('receiver uses dedicated header credential and disables n8n execution retention',async()=>{
 const receiver=JSON.parse(await readFile(new URL('../runner/issue-runner-receiver.workflow.json',import.meta.url),'utf8')),trigger=receiver.nodes.find(node=>node.name==='Runner callback');assert.equal(trigger.parameters.authentication,'headerAuth');assert.equal(trigger.credentials.httpHeaderAuth.name,'Pandora unattended runner (Intellectual Twin)');assert.equal(receiver.settings.saveDataSuccessExecution,'none');assert.equal(receiver.settings.saveDataErrorExecution,'none');const scope=receiver.nodes.find(node=>node.name==='Scope exact operation').parameters.jsCode;assert.match(scope,/Browser access is not supported/);assert.match(scope,/publish-prepare/);assert.match(scope,/request\.operation==='cancelled'\?'\/automation\/issues\/status'/);assert.ok(receiver.nodes.find(node=>node.name==='Acknowledge cancellation'));assert.ok(receiver.nodes.find(node=>node.name==='Load pinned screenshot blob'));assert.ok(receiver.nodes.find(node=>node.name==='Verify screenshot blob'));const complete=receiver.nodes.find(node=>node.name==='Complete publication');assert.match(complete.parameters.workflowInputs.value.body,/headSha:\$json\.publish\.commitSha/);assert.ok(receiver.nodes.filter(node=>node.credentials?.githubApi).every(node=>node.credentials.githubApi.id==='3V46mglu7fpoPISX'));assert.doesNotMatch(JSON.stringify(receiver),/PANDORA_WORKER_TOKEN|OPENAI_API_KEY|MEIDS_APP_GITHUB_TOKEN/);
});

test('preflight is isolated from production event claiming and source writes',async()=>{
 const workflow=await readFile(new URL('../runner/pandora-runner-preflight.yml',import.meta.url),'utf8');assert.match(workflow,/mode:\s*\n\s*description: Nondestructive readiness probe/);assert.match(workflow,/\n\s+- evidence\r?\n/);assert.match(workflow,/00000000-0000-4000-8000-000000000001/);assert.match(workflow,/receiverWorkflowPath:\"runner\/issue-runner-receiver\.workflow\.json\"/);assert.match(workflow,/if: \$\{\{ cancelled\(\) \}\}/);assert.doesNotMatch(workflow,/meids-app|git push|gh pr create/);
});
