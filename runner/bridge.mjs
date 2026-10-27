import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertEventId,assertRunId,mergeAttestation,parseStartResponse,publicationAttestation,requestEnvelope} from './protocol.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const privateRoot=resolve(here,'../.runner/private');
const args=process.argv.slice(2);
const command=args.shift();
const option=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw Error('Missing '+name);return args[i+1];};

function config(){
 const url=process.env.PANDORA_BRIDGE_URL;
 const token=process.env.PANDORA_WORKER_TOKEN;
 if(!url||!/^https:\/\//.test(url))throw Error('PANDORA_BRIDGE_URL must be an HTTPS endpoint');
 if(!token)throw Error('PANDORA_WORKER_TOKEN is required');
 return {url,token};
}

async function call(operation,eventId,runId,body={}){
 const {url,token}=config();
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Pandora-Worker':token},body:JSON.stringify(requestEnvelope(operation,eventId,runId,body)),signal:AbortSignal.timeout(30000)});
 const value=await response.json().catch(()=>({status:'failed',error:'Receiver returned a non-JSON response'}));
 if(!response.ok||value?.status&&value.status!==200)throw Error('Pandora bridge rejected '+operation+' with HTTP '+response.status);
 return value?.body??value;
}

async function secureWrite(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,value,{mode:0o600});if(process.platform!=='win32')await chmod(path,0o600);}
const contextPath=eventId=>resolve(privateRoot,eventId+'.json');
async function context(eventId){return JSON.parse(await readFile(contextPath(assertEventId(eventId)),'utf8'));}
async function output(name,value){if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`${name}=${value}\n`,{flag:'a'});else process.stdout.write(`${name}=${value}\n`);}

async function start(){
 const eventId=assertEventId(option('--event-id')),runId=assertRunId(option('--run-id'));
 const claimed=parseStartResponse(await call('start',eventId,runId));
 const state={schemaVersion:1,eventId,runId,...claimed};
 await secureWrite(contextPath(eventId),JSON.stringify(state));
 await output('repository',claimed.job.repository);
 await output('base_sha',claimed.job.baseSha);
 await output('base_branch',claimed.job.baseBranch);
 await output('job_id',claimed.job.id);
}

async function callback(operationName,transform=x=>x){
 const eventId=assertEventId(option('--event-id')),state=await context(eventId);
 let body={...state.capability};
 if(args.includes('--file'))body={...body,...transform(JSON.parse(await readFile(option('--file'),'utf8')))};
 if(args.includes('--outcome'))body={...body,outcome:option('--outcome'),summary:(await readFile(option('--summary-file'),'utf8')).trim()};
 const value=await call(operationName,eventId,state.runId,body);
 process.stdout.write(JSON.stringify(value)+'\n');
}

async function status(){const eventId=assertEventId(option('--event-id')),state=await context(eventId),value=await call('status',eventId,state.runId,{});if(value.continue!==true)throw Error('Pandora event is no longer current');}
async function cancelled(){const eventId=assertEventId(option('--event-id')),runId=assertRunId(option('--run-id'));await call('cancelled',eventId,runId,{});}
async function preflight(){const eventId=assertEventId(option('--event-id')),runId=assertRunId(option('--run-id')),body=JSON.parse(await readFile(option('--file'),'utf8'));const value=await call('preflight',eventId,runId,body);process.stdout.write(JSON.stringify(value)+'\n');}

const commands={
 preflight,
 start,
 status,
 cancelled,
 renew:()=>callback('renew'),
 evidence:()=>callback('evidence',value=>({attachmentId:value.attachmentId})),
 report:()=>callback('report',report=>({report})),
 finish:()=>callback('finish'),
 publish:()=>callback('publish',value=>publicationAttestation(value)),
 'merge-readiness':()=>callback('merge-readiness',value=>mergeAttestation(value)),
 merged:()=>callback('merged',value=>value),
};

if(!commands[command])throw Error('Unknown bridge command');
await commands[command]();
