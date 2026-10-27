import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');const helper=source.slice(source.indexOf('async function api('),source.indexOf('\nconst base='));
const busy={status:409,body:{error:'Another request is saving. Please retry shortly.'}};
function client(responses){const calls=[];const ctx={n8nMode:true,apiBase:'https://api.example.test',token:'original-session',setTimeout:fn=>fn(),fetch:async(url,options)=>{calls.push({...options});const next=responses.shift();if(next instanceof Error)throw next;return {ok:true,status:200,json:async()=>next};},sessionStorage:{removeItem(){}},renderLogin(){}};runInNewContext(helper+'\nthis.call=api;',ctx);return {ctx,calls};}
test('lease contention retries preserve the exact mutation and session',async()=>{const {ctx,calls}=client([busy,busy,{status:201,body:{id:'issue'}}]);assert.equal((await ctx.call('/projects/p/issues',{method:'POST',body:{title:'Report'}})).id,'issue');assert.equal(calls.length,3);assert.equal(new Set(calls.map(c=>c.body)).size,1);assert.equal(JSON.parse(calls[0].body).token,'original-session');});
test('stale record and ambiguous save conflicts never replay writes',async()=>{for(const message of ['Record changed; reload before saving','Session save conflict. Please retry.','Unable to save project data. Reload before retrying.']){const {ctx,calls}=client([{status:409,body:{error:message}}]);await assert.rejects(()=>ctx.call('/projects/p/issues',{method:'PUT',body:{version:1}}));assert.equal(calls.length,1);}});
test('network failure never replays a potentially committed mutation',async()=>{const {ctx,calls}=client([new Error('Network unavailable')]);await assert.rejects(()=>ctx.call('/projects',{method:'POST'}));assert.equal(calls.length,1);});
test('persistent contention stops after five retries',async()=>{const {ctx,calls}=client(Array(6).fill(busy));await assert.rejects(()=>ctx.call('/projects',{method:'POST'}),/Another request/);assert.equal(calls.length,6);});
