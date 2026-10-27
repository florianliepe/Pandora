// Local Codex bridge. No shell commands are accepted from issue data or callbacks.
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const [action,...args]=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
if(!['claim','renew','evidence','report','finish'].includes(action))throw Error('Usage: delivery-worker.mjs claim | renew/evidence/report/finish --job <UUID> [--file <report.json>] [--outcome awaiting_review|ready_for_verification|needs_input|failed --summary-file <file>]');
const secret=(await readFile(process.env.PANDORA_DELIVERY_WORKER_SECRET_FILE||'.local/delivery-worker-secret','utf8')).trim();
const origin=new URL(process.env.N8N_API_BASE_URL);if(origin.protocol!=='https:'||origin.hostname!=='eraneos-agentic-platform.azurewebsites.net'||origin.username||origin.password||origin.search||origin.hash||!['','/'].includes(origin.pathname))throw Error('Worker endpoint must be the approved n8n origin');
const endpoint=origin.origin+'/webhook/pandora-delivery-worker-v1';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
async function privateWrite(path,value){await writeFile(path,value,{mode:0o600});if(process.platform==='win32'){const user=execFileSync('whoami',[],{encoding:'utf8'}).trim();execFileSync('icacls',[path,'/inheritance:r','/grant:r',user+':F'],{stdio:'pipe'});}else await chmod(path,0o600);}
async function call(body){for(let n=0;n<6;n++){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Pandora-Worker':secret},body:JSON.stringify({action,body}),signal:AbortSignal.timeout(120000)});const e=await r.json();if(e.status===409&&/^Another request is saving\./.test(e.body?.error||'')&&n<5){await new Promise(r=>setTimeout(r,1000*(n+1)));continue;}if(!r.ok||e.status!==200)throw Error(e.body?.error||'Worker request failed');return e.body;}}
if(action==='claim'){const result=await call({});if(!result.job){console.log('No queued job');}else{if(!uuid(result.job.id))throw Error('Invalid job identity');const dir=resolve('.local/delivery-jobs',result.job.id);await mkdir(dir,{recursive:true});await privateWrite(join(dir,'handoff.json'),JSON.stringify(result.job,null,2));await privateWrite(join(dir,'capability.json'),JSON.stringify(result.capability));console.log(JSON.stringify({jobId:result.job.id,handoff:join(dir,'handoff.json'),expires:result.expires}));}}
else{const jobId=value('--job');if(!uuid(jobId))throw Error('--job must be a UUID');const dir=resolve('.local/delivery-jobs',jobId),cap=JSON.parse(await readFile(join(dir,'capability.json'),'utf8'));if(cap.jobId!==jobId)throw Error('Capability belongs to another job');const body={...cap};
 if(action==='report'){if(!args.includes('--file'))throw Error('--file is required');body.report=JSON.parse(await readFile(value('--file'),'utf8'));}
 if(action==='finish'){body.outcome=value('--outcome');if(!args.includes('--summary-file'))throw Error('--summary-file is required');body.summary=(await readFile(value('--summary-file'),'utf8')).trim();}
 if(action==='evidence'){const attachmentId=value('--attachment');if(!uuid(attachmentId))throw Error('--attachment must be a UUID');body.attachmentId=attachmentId;}
 const result=await call(body);
 if(action==='evidence'){const file=result.file,bytes=Buffer.from(file.data.replace(/\s/g,''),'base64'),ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];if(!ext||bytes.length>5*1024*1024)throw Error('Invalid screenshot');const path=join(dir,body.attachmentId+'.'+ext);await privateWrite(path,bytes);console.log(JSON.stringify({path,sha:file.sha}));}else console.log(JSON.stringify(result));
}
