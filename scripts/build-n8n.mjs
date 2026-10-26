import {rollup} from 'rollup';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
// n8n's sandbox does not expose esbuild's getter-based module namespaces.
const bundle=await rollup({input:'server/n8n-entry.mjs',plugins:[{name:'native-crypto-adapter',resolveId(id){if(id==='node:crypto')return resolve('server/n8n-crypto.mjs');}},nodeResolve({browser:true})]});
const {output}=await bundle.generate({format:'iife',name:'Pandora'});
await mkdir('.local',{recursive:true});
await writeFile('.local/n8n-runtime.js',`const structuredClone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));\nconst TextEncoder=class {encode(v){return new Uint8Array(Buffer.from(v));}};\n${output[0].code}`);
await bundle.close();
console.log(`n8n runtime bundled: ${output[0].code.length} bytes`);
