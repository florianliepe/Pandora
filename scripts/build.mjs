import {cp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const target=resolve('dist');
if(target!==resolve(process.cwd(),'dist'))throw new Error('Unexpected build directory');
await mkdir(target,{recursive:true});
await cp('public',target,{recursive:true});
const apiBase=process.env.PANDORA_API_URL||'';
if(apiBase){const u=new URL(apiBase);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('PANDORA_API_URL must be a public HTTPS endpoint without credentials');}
const apiMode=apiBase.includes('/webhook/')?'n8n':'rest';
await writeFile('dist/config.js',`window.PANDORA_CONFIG = ${JSON.stringify({apiBase,apiMode,deploymentReady:!!apiBase})};\n`);
await writeFile('dist/.nojekyll','');
console.log(`Frontend built. API: ${apiBase||'same origin (local development)'}`);
