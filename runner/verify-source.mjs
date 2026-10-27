import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assertEventId,mergeAttestation,SOURCE_BRANCH,SOURCE_REPOSITORY} from './protocol.mjs';

const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw Error('Missing '+name);return args[i+1];};
const git=(root,...argv)=>execFileSync('git',['-C',root,...argv],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

if(args[0]==='diff'){
 const eventId=assertEventId(value('--event-id')),root=resolve(value('--root')),state=JSON.parse(await readFile(resolve('.runner/private',eventId+'.json'),'utf8'));
 const head=git(root,'rev-parse','HEAD'),base=state.job.baseSha;
 if(head!==base)throw Error('Codex must begin from the exact claimed base SHA');
 const changed=git(root,'status','--porcelain','--untracked-files=all').split(/\r?\n/).filter(Boolean).map(line=>line.slice(3));
 if(!changed.length)throw Error('No candidate change was produced');
 const forbidden=changed.filter(path=>path==='.github'||path.startsWith('.github/')||path.startsWith('.git/')||path.includes('secret')||path.endsWith('.env'));
 if(forbidden.length)throw Error('Candidate touched forbidden paths: '+forbidden.join(', '));
 process.stdout.write(JSON.stringify({baseSha:base,files:changed})+'\n');
}
else if(args[0]==='merge'){
 const payload=JSON.parse(await readFile(value('--file'),'utf8'));
 const attested=mergeAttestation(payload);
 if(attested.repository!==SOURCE_REPOSITORY||attested.baseBranch!==SOURCE_BRANCH)throw Error('Unapproved source target');
 await writeFile(value('--output'),JSON.stringify(attested));
}
else throw Error('Expected diff or merge');
