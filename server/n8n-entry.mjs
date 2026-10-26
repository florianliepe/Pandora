import {setEntropy,createHash} from './n8n-crypto.mjs';
import {applyRequest} from './n8n-runtime.mjs';
export async function run(input){setEntropy(input.entropy);return applyRequest(input);}
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
