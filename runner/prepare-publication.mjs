import {execFileSync} from 'node:child_process';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assertEventId,publicationProposal} from './protocol.mjs';

const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw Error('Missing '+name);return args[i+1];};
const eventId=assertEventId(value('--event-id')),root=resolve(value('--root')),output=resolve(value('--output'));
const state=JSON.parse(await readFile(resolve('.runner/private',eventId+'-handoff.json'),'utf8'));
const git=(...argv)=>execFileSync('git',['-C',root,...argv],{encoding:'buffer',stdio:['ignore','pipe','pipe']});
if(git('rev-parse','HEAD').toString().trim()!==state.job.baseSha)throw Error('Publication source is not the claimed base SHA');
const changes=[];
const tracked=git('diff','--name-status','-z','HEAD').toString('utf8').split('\0').filter(Boolean);
for(let i=0;i<tracked.length;){const status=tracked[i++],path=tracked[i++];if(!/^[AMD]$/.test(status))throw Error('Renames, copies and type changes require manual review');changes.push({path,operation:status==='D'?'delete':'upsert'});}
for(const path of git('ls-files','--others','--exclude-standard','-z').toString('utf8').split('\0').filter(Boolean))changes.push({path,operation:'upsert'});
if(!changes.length)throw Error('No candidate files were proposed');
const files=[],decoder=new TextDecoder('utf-8',{fatal:true});
for(const change of changes){if(change.operation==='delete'){files.push({path:change.path,content:null});continue;}const stage=git('ls-files','--stage','--',change.path).toString().trim();if(stage&&stage.split(/\s/,1)[0]!=='100644')throw Error('Executable, linked and special files require manual publication review');const path=resolve(root,change.path),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('Only regular files can be proposed');const bytes=await readFile(path);let content;try{content=decoder.decode(bytes);}catch{throw Error('Binary files require manual publication review');}files.push({path:change.path,content});}
const proposal=publicationProposal({baseSha:state.job.baseSha,files});
await writeFile(output,JSON.stringify(proposal),{mode:0o600});
