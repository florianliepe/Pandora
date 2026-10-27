import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {assertEventId} from './protocol.mjs';
import {resolveMeidsEvidencePlan} from './evidence/meids-catalog.mjs';

export function assessEvidence(job){
 try{
  resolveMeidsEvidencePlan(job,{phase:'reproduction',kind:'regression',environment:'isolated-meids'});
  for(const kind of ['regression','integration','browser'])resolveMeidsEvidencePlan(job,{phase:'candidate',kind,environment:'isolated-meids'});
  if(!job.deploymentPlan?.targets?.length)throw Error('Reviewed deployment targets are not configured');
  for(const targetId of job.deploymentPlan.targets)for(const kind of ['regression','integration','browser'])resolveMeidsEvidencePlan(job,{phase:'post_deployment',kind,targetId,environment:'observed-deployment'});
  return {ready:true};
 }catch(error){return {ready:false,reason:String(error.message).slice(0,1500)};}
}
async function main(){
 const args=process.argv.slice(2),eventId=assertEventId(args[args.indexOf('--event-id')+1]);
 const state=JSON.parse(await readFile(resolve('.runner/private',eventId+'-handoff.json'),'utf8')),result=assessEvidence(state.job);
 if(!result.ready){
  const summary=resolve('.runner/private',eventId+'-needs-input.txt');
  await writeFile(summary,'Trusted acceptance harness unavailable: '+result.reason,{mode:0o600});
  execFileSync(process.execPath,[fileURLToPath(new URL('./bridge.mjs',import.meta.url)),'finish','--event-id',eventId,'--outcome','needs_input','--summary-file',summary],{stdio:['ignore','ignore','pipe']});
 }
 if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,'ready='+result.ready+'\n',{flag:'a'});
 else console.log(JSON.stringify({ready:result.ready}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
