import {createHash} from 'node:crypto';

export function decodePinnedGitBlob(file){
 if(!file||typeof file.name!=='string'||typeof file.type!=='string'||typeof file.data!=='string'||typeof file.sha!=='string'||!/^[a-f0-9]{40}$/.test(file.sha)||!Number.isSafeInteger(file.size)||file.size<0||file.size>5*1024*1024)throw Error('Pinned Git blob response is invalid');
 const encoded=file.data.replace(/\s/g,'');if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('Pinned Git blob encoding is invalid');
 const bytes=Buffer.from(encoded,'base64');if(bytes.length!==file.size)throw Error('Pinned Git blob size does not match');
 const actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');if(actual!==file.sha)throw Error('Pinned Git blob SHA does not match');
 return bytes;
}
