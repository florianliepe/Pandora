import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const w=JSON.parse(readFileSync(new URL('../runner/issue-runner-receiver.workflow.json',import.meta.url),'utf8'));
const node=name=>w.nodes.find(n=>n.name===name);
const execute=(name,json,refs={})=>new Function('$json','$',node(name).parameters.jsCode)(json,name=>({first:()=>({json:refs[name]})}));
test('receiver compiles every code node and forbids direct merge observations from runner',()=>{
 for(const n of w.nodes.filter(n=>n.type==='n8n-nodes-base.code'))assert.doesNotThrow(()=>new Function('$json','$',n.parameters.jsCode),n.name);
 const request={schemaVersion:1,operation:'merge',eventId:randomUUID(),runId:42,body:{jobId:randomUUID()}};
 assert.equal(execute('Scope exact operation',{body:request})[0].json.path,'/automation/issues/merge-prepare');
 for(const operation of ['merge-authorize','merge-consume','merge-complete','merged','merge-readiness'])assert.throws(()=>execute('Scope exact operation',{body:{...request,operation}}));
 assert.throws(()=>execute('Scope exact operation',{headers:{origin:'https://florianliepe.github.io'},body:request}));
});
test('receiver requires store authorization before exact-SHA GitHub mutation and independently refetches merge',()=>{
 assert.throws(()=>execute('Validate merge authorization',{status:409,body:{}}));
 assert.throws(()=>execute('Validate consumed merge',{status:409,body:{}}));
 const mutation=node('Merge exact revision');assert.equal(mutation.parameters.method,'PUT');assert.match(mutation.parameters.url,/^=https:\/\/api.github.com\/repos\/florianliepe\/meids-app\/pulls\//);assert.match(mutation.parameters.jsonBody,/sha:\$json.headSha/);assert.match(mutation.parameters.jsonBody,/merge_method:'merge'/);assert.equal(mutation.credentials.githubApi.id,'3V46mglu7fpoPISX');
 assert.throws(()=>execute('Check merge submission',{statusCode:200,body:{merged:false}}));
 assert.throws(()=>execute('Prepare merge confirmation',{statusCode:200,body:{merge_commit_sha:'a'.repeat(40)}},{'Merge exact revision':{body:{sha:'b'.repeat(40)}}}));
 assert.equal(node('Record confirmed merge').parameters.workflowInputs.value.path,'/automation/issues/merge-complete');
 assert.equal(w.connections['Authorize request'].main[0][0].node,'Request authorized');
});
