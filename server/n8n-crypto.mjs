import {sha256} from '@noble/hashes/sha256';
let entropy, counter=0;
export function setEntropy(hex){if(!/^[0-9a-f]{64,}$/i.test(hex||''))throw new Error('Cryptographic entropy required');entropy=Buffer.from(hex,'hex');counter=0;}
export function createHash(algorithm){if(algorithm!=='sha256')throw new Error('Unsupported hash');let values=[];return {update(value){values.push(Buffer.from(value));return this;},digest(encoding){return Buffer.from(sha256(new Uint8Array(Buffer.concat(values)))).toString(encoding);}};}
// The native n8n Crypto node supplies fresh 256-bit entropy for each request.
// Domain-separated SHA-256 expansion avoids Math.random and forbidden module imports.
export function randomBytes(length){if(!entropy)throw new Error('Entropy not initialized');const parts=[];let size=0;while(size<length){const part=Buffer.from(sha256(new Uint8Array(Buffer.concat([entropy,Buffer.from(`Pandora/random/${counter++}`)]))));parts.push(part);size+=part.length;}return Buffer.concat(parts).subarray(0,length);}
export function randomInt(min,max){const range=max-min,limit=Math.floor(4294967296/range)*range;let n;do{n=randomBytes(4).readUInt32BE(0);}while(n>=limit);return min+n%range;}
export function randomUUID(){const b=randomBytes(16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export function timingSafeEqual(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;}

