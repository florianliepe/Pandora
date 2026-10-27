import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,relative,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod/v3';
const planSchema=z.object({phase:z.enum(['reproduction','candidate','post_deployment']),kind:z.enum(['unit','regression','integration','browser']),environment:z.string().min(1).max(120),targetId:z.enum(['production_frontend','production_backend','sandbox_frontend']).optional(),files:z.array(z.string().min(1)).min(1).max(20),mappings:z.array(z.object({caseId:z.string().min(1),caseVersion:z.number().int().positive(),testName:z.string().min(1)}).strict()).min(1).max(60),timeoutMs:z.number().int().min(100).max(600000).default(120000)}).strict();
function git(root,args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function identity(root){const commit=git(root,['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/.test(commit)||git(root,['status','--porcelain','--untracked-files=all']))throw Error('Test checkout and harness must have clean committed source');return commit;}
export function mapResults(raw,plan,job){
 if(raw?.schemaVersion!==1||!Array.isArray(raw.results)||!raw.summary)throw Error('Test runner did not complete a structured report');
 if(new Set(plan.mappings.map(m=>m.caseId)).size!==plan.mappings.length||new Set(plan.mappings.map(m=>m.testName)).size!==plan.mappings.length)throw Error('Mappings must identify unique cases and unique test names');
 return plan.mappings.map(m=>{if(!job.snapshot.tests.some(t=>t.id===m.caseId&&t.version===m.caseVersion))throw Error('Mapping references an unpinned case version');const matches=raw.results.filter(t=>t.name===m.testName&&t.nesting===0);if(matches.length!==1)throw Error('Mapped test is missing or ambiguous: '+m.testName);const t=matches[0];if(!['passed','failed','blocked','skipped'].includes(t.result))throw Error('Invalid runner result');return {caseId:m.caseId,caseVersion:m.caseVersion,result:t.result,name:m.testName};});
}
export async function runEvidence({checkout,harness=checkout,handoff,plan:rawPlan,outputRoot}){
 const plan=planSchema.parse(rawPlan),root=await realpath(checkout),testRoot=await realpath(harness),commit=identity(root),harnessCommit=identity(testRoot);
 const target=plan.phase==='post_deployment'?handoff.verificationBasis?.targets.find(t=>t.targetId===plan.targetId):null;
 const expected=plan.phase==='reproduction'?handoff.baseSha:plan.phase==='candidate'?handoff.pullObservation?.headSha:target?.commit;
 if(commit!==expected)throw Error('Checkout HEAD does not match the handoff phase revision');
 if((handoff.executionPhase==='verification')!==(plan.phase==='post_deployment'))throw Error('Test phase differs from claimed work');
 if(target&&plan.environment!==target.environment)throw Error('Environment does not match verification target');
 const files=[];for(const file of plan.files){if(isAbsolute(file))throw Error('Harness files must be relative');const path=await realpath(resolve(testRoot,file)),rel=relative(testRoot,path);if(rel.startsWith('..')||isAbsolute(rel)||!git(testRoot,['ls-files','--',rel]))throw Error('Test file is outside committed harness');files.push(path);}
 // Validate mapping identities before executing reviewed test code.
 for(const m of plan.mappings)if(!handoff.snapshot.tests.some(t=>t.id===m.caseId&&t.version===m.caseVersion))throw Error('Unpinned test mapping');
 const reportId=randomUUID(),dir=resolve(outputRoot,reportId);await mkdir(dir,{recursive:true,mode:0o700});if(process.platform==='win32'){const user=execFileSync('whoami',[],{encoding:'utf8'}).trim();execFileSync('icacls',[dir,'/inheritance:r','/grant:r',user+':(OI)(CI)F'],{stdio:'pipe'});}
 const artifact=join(dir,'node-results.json'),reporter=new URL('./node-test-evidence-reporter.mjs',import.meta.url).href;
 const args=['--test','--test-concurrency=1','--test-reporter='+reporter,'--test-reporter-destination='+artifact,...files];
 const startedAt=new Date().toISOString();
 // Do not pass n8n/GitHub credentials to application tests. Extra environment setup belongs
 // in the reviewed harness; only these basic runtime variables are inherited.
 const env=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 env.PANDORA_TARGET_ROOT=root;if(target)env.PANDORA_TARGET_URL=target.url;
 const execution=await new Promise((resolvePromise,reject)=>{const child=spawn(process.execPath,args,{cwd:testRoot,env,stdio:['ignore','ignore','ignore'],windowsHide:true});let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},plan.timeoutMs);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',(code,signal)=>{clearTimeout(timer);resolvePromise({code,signal,timedOut});});});
 const completedAt=new Date().toISOString();
 if(execution.timedOut||execution.signal||execution.code===null)throw Error('Test execution was interrupted; no accepted report produced');
 if(identity(root)!==commit||identity(testRoot)!==harnessCommit)throw Error('Source changed during test execution');
 const bytes=await readFile(artifact);if(bytes.length>2000000)throw Error('Test report too large');if(!bytes.length)throw Error('Test runner produced no structured results');const raw=JSON.parse(bytes),tests=mapResults(raw,plan,handoff);
 const exitCode=execution.code===0&&raw.summary.success===true?0:1;
 const report={reportId,phase:plan.phase,kind:plan.kind,commit,environment:plan.environment,...(target?{targetId:plan.targetId}:{}),startedAt,completedAt,command:'node --test (reviewed committed harness)',exitCode,tests,summary:'Executed Node test runner; explicit case mapping. Harness commit '+harnessCommit+'. Result SHA256 '+createHash('sha256').update(bytes).digest('hex')};
 const reportPath=join(dir,'report.json');await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});return {report,reportPath,artifact};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw Error('Missing '+k);return args[i+1];};const handoff=JSON.parse(await readFile(get('--handoff'),'utf8')),plan=JSON.parse(await readFile(get('--plan'),'utf8'));const result=await runEvidence({checkout:get('--checkout'),harness:args.includes('--harness')?get('--harness'):undefined,handoff,plan,outputRoot:resolve('.local/test-evidence')});console.log(JSON.stringify({reportPath:result.reportPath,exitCode:result.report.exitCode,results:result.report.tests.map(t=>({caseId:t.caseId,result:t.result}))}));}
