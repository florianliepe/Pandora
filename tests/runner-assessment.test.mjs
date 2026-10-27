import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessEvidence} from '../runner/assess-evidence.mjs';
import {readFileSync} from 'node:fs';
test('KG010 stays needs_input even when local contract cases have automation markers',()=>{
 const result=assessEvidence({repository:'florianliepe/meids-app',baseBranch:'main',issueId:'da380680-c1e3-414d-a4b9-0aa3fdf58912',snapshot:{tests:[{id:'iso01',version:1,reviewStatus:'approved',title:'[AUTO:MEIDS-GRAPH-RELATION-CONTRACT-V1] isolation'}]}});
 assert.equal(result.ready,false);assert.match(result.reason,/KG-010 requires two real principals/);
});
test('a local graph contract cannot stand in for complete hosted verification',()=>{
 const result=assessEvidence({repository:'florianliepe/meids-app',baseBranch:'main',issueId:'graph',deploymentPlan:{targets:['sandbox_frontend']},snapshot:{tests:[{id:'graph',version:1,reviewStatus:'approved',title:'[AUTO:MEIDS-GRAPH-RELATION-CONTRACT-V1] graph'}]}});
 assert.equal(result.ready,false);assert.match(result.reason,/Hosted post-deployment evidence is unsupported/);
 const yaml=readFileSync(new URL('../runner/pandora-issue-runner.yml',import.meta.url),'utf8');
 assert.ok(yaml.indexOf('assess-evidence.mjs')<yaml.indexOf('Check out pinned application base'));
 assert.match(yaml,/Implement bounded candidate\r?\n\s+if:.*steps.evidence.outputs.ready/);
 assert.match(yaml,/Request constrained trusted publication\r?\n\s+if:.*steps.evidence.outputs.ready/);
});
