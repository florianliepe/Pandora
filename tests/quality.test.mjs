import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../server/store.mjs';
import {queueTests,workerRequest,ensureIterations,derivedTestStatus,iterationSuggestion} from '../server/quality.mjs';
const setup=()=>{const s=emptyState();const p={id:'p',name:'Project'},i={id:'i',projectId:'p',title:'Broken submit',status:'reported'};s.projects.push(p);s.issues.push(i);return {s,p,i};};
const claim=s=>workerRequest(s,{path:'/automation/claim',method:'POST'}).job;
const complete=(s,j,result)=>workerRequest(s,{path:'/automation/complete',method:'POST',body:{...j,result}});
const result={cases:[{title:'Submit succeeds',steps:'Click submit',expected:'Saved',kind:'regression'}]};
test('generation is revision-bound, retry-safe and preserves edited cases and run snapshots',()=>{
 const {s,i}=setup();queueTests(i);i.testGeneration.notBefore=0;const stale=claim(s);queueTests(i);assert.equal(complete(s,stale,result).applied,false);
 i.testGeneration.notBefore=0;const j=claim(s);assert.equal(complete(s,j,result).added,1);assert.equal(complete(s,j,result).applied,false);
 const c=s.cases[0];c.manualEdited=true;c.title='Human renamed test';c.steps='Human steps';const snap=structuredClone(c);s.runs.push({id:'run',caseId:c.id,caseSnapshot:snap});queueTests(i);i.testGeneration.notBefore=0;
 assert.equal(complete(s,claim(s),{cases:[...result.cases,{title:'Validation failure',steps:'Empty form',expected:'Error'}]}).added,1);assert.equal(c.steps,'Human steps');assert.equal(c.deletedAt,undefined);assert.deepEqual(s.runs[0].caseSnapshot,snap);
});
test('generation rejects malformed output without mutating cases and exposes bounded retries',()=>{
 const {s,i}=setup();queueTests(i);for(let n=0;n<3;n++){i.testGeneration.notBefore=0;complete(s,claim(s),{cases:[{title:'Bad'}]});}assert.equal(i.testGeneration.state,'failed');assert.equal(s.cases.length,0);
});
test('iteration cadence is idempotent, respects edited and archived iterations, and only suggests assignments',()=>{
 const {s,p,i}=setup();p.cadence={enabled:true,startDate:'2026-01-01',lengthDays:14,lookahead:3};ensureIterations(s,p,'2026-10-27');assert.equal(s.iterations.length,3);const first=s.iterations[0];first.name='Manual name';first.deletedAt='2026-10-27';ensureIterations(s,p,'2026-10-27');assert.equal(s.iterations.length,3);assert.equal(first.name,'Manual name');assert.ok(iterationSuggestion(s,i,'2026-10-27'));assert.equal(i.iterationId,undefined);
});
test('test status requires current evidence and passing executions for every linked current test version',()=>{
 const {s,i}=setup();i.evidenceRevision=2;const c={id:'c',issueId:'i',projectId:'p',version:1},d={...c,id:'d'};s.cases.push(c,d);
 const run=(id,caseId)=>({id,caseId,issueId:'i',projectId:'p',caseSnapshot:{version:1},issueEvidenceRevision:2,result:'passed',createdAt:'2026-10-27T10:00:00Z',updatedAt:'2026-10-27T10:00:00Z'});
 s.runs.push(run('a','c'));assert.equal(derivedTestStatus(s,i),'not_run');s.runs.push(run('b','d'));assert.equal(derivedTestStatus(s,i),'passed');i.evidenceRevision++;assert.equal(derivedTestStatus(s,i),'not_run');i.evidenceRevision--;d.version++;assert.equal(derivedTestStatus(s,i),'not_run');d.deletedAt='now';assert.equal(derivedTestStatus(s,i),'passed');
});

test('manually archived generated tests are not resurrected on refresh',()=>{const {s,i}=setup();queueTests(i);i.testGeneration.notBefore=0;complete(s,claim(s),result);s.cases[0].deletedAt='now';s.cases[0].manualDeleted=true;queueTests(i);i.testGeneration.notBefore=0;assert.equal(complete(s,claim(s),result).added,0);assert.equal(s.cases.length,1);});
