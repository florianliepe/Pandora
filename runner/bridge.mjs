import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decryptCapability,encryptCapability} from './capability-crypto.mjs';
import {decodePinnedGitBlob} from './git-blob.mjs';
import {approvedBridgeUrl,assertEventId,assertRunId,mergeAttestation,parseStartResponse,publicationProposal,requestEnvelope} from './protocol.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const privateRoot=resolve(here,'../.runner/private');
const args=process.argv.slice(2);
const command=args.shift();
const option=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw Error('Missing '+name);return args[i+1];};

function config(){const url=approvedBridgeUrl(process.env.PANDORA_BRIDGE_URL);const token=process.env.PANDORA_WORKER_TOKEN;if(!token||token.length<32)throw Error('PANDORA_WORKER_TOKEN is required');return {url,token};}
const contention=value=>(value?.body?.code||value?.code)==='storage_lease_contention';
async function call(operation,eventId,runId,body={}){
 const {url,token}=config(),payload=JSON.stringify(requestEnvelope(operation,eventId,runId,body));
 for(let attempt=1;attempt<=3;attempt++){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Pandora-Worker':token},body:payload,signal:AbortSignal.timeout(30000)});
  const value=await response.json().catch(()=>null),status=Number(value?.status||response.status);
  if(response.ok&&status>=200&&status<300)return value?.body??value;
  if(status===409&&contention(value)&&attempt<3){await new Promise(resolvePromise=>setTimeout(resolvePromise,attempt*250));continue;}
  throw Error('Pandora bridge rejected '+operation+' with status '+status);
 }
 throw Error('Pandora bridge storage contention retry exhausted');
}

async function secureWrite(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,value,{mode:0o600});if(process.platform!=='win32')await chmod(path,0o600);}
const handoffPath=eventId=>resolve(privateRoot,eventId+'-handoff.json');
const capabilityPath=eventId=>resolve(privateRoot,eventId+'-capability.enc.json');
async function handoff(eventId){return JSON.parse(await readFile(handoffPath(assertEventId(eventId)),'utf8'));}
async function context(eventId){const id=assertEventId(eventId),state=await handoff(id),encrypted=JSON.parse(await readFile(capabilityPath(id),'utf8'));return {...state,capability:decryptCapability(encrypted,config().token)};}
async function output(name,value){if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`${name}=${value}\n`,{flag:'a'});else process.stdout.write(`${name}=${value}\n`);}

async function start(){const eventId=assertEventId(option('--event-id')),runId=assertRunId(option('--run-id')),claimed=parseStartResponse(await call('start',eventId,runId));await secureWrite(handoffPath(eventId),JSON.stringify({schemaVersion:1,eventId,runId,job:claimed.job,expires:claimed.expires}));await secureWrite(capabilityPath(eventId),JSON.stringify(encryptCapability(claimed.capability,config().token)));await output('repository',claimed.job.repository);await output('base_sha',claimed.job.baseSha);await output('base_branch',claimed.job.baseBranch);await output('job_id',claimed.job.id);}

async function callback(operationName,transform=x=>x){const eventId=assertEventId(option('--event-id')),state=await context(eventId);let body={...state.capability};if(args.includes('--file'))body={...body,...transform(JSON.parse(await readFile(option('--file'),'utf8')))};if(args.includes('--outcome'))body={...body,outcome:option('--outcome'),summary:(await readFile(option('--summary-file'),'utf8')).trim()};await call(operationName,eventId,state.runId,body);}
async function status(){const eventId=assertEventId(option('--event-id')),state=await handoff(eventId),value=await call('status',eventId,state.runId,{});if(value.continue!==true)throw Error('Pandora event is no longer current');}
async function cancelled(){const eventId=assertEventId(option('--event-id')),runId=assertRunId(option('--run-id'));await call('cancelled',eventId,runId,{});}
async function preflight(){const eventId=assertEventId(option('--event-id')),runId=assertRunId(option('--run-id')),body=JSON.parse(await readFile(option('--file'),'utf8'));await call('preflight',eventId,runId,body);}
async function evidence(){const eventId=assertEventId(option('--event-id')),state=await context(eventId),input=JSON.parse(await readFile(option('--file'),'utf8')),value=await call('evidence',eventId,state.runId,{...state.capability,attachmentId:input.attachmentId}),bytes=decodePinnedGitBlob(value?.file);await secureWrite(resolve(option('--output')),bytes);}

const commands={preflight,start,status,cancelled,renew:()=>callback('renew'),evidence,report:()=>callback('report',report=>({report})),finish:()=>callback('finish'),publish:()=>callback('publish',value=>publicationProposal(value)),'merge-readiness':()=>callback('merge-readiness',value=>mergeAttestation(value)),merged:()=>callback('merged',value=>value)};
if(!commands[command])throw Error('Unknown bridge command');
await commands[command]();
