import {readFile,writeFile,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const projectId='3daa1c59-cd24-487b-a8e4-dc5d930e41f0';
const storeId=(await readFile('.local/quality-store-id','utf8')).trim();
const headers={'X-N8N-API-KEY':process.env.N8N_API_KEY,'Content-Type':'application/json'};
async function api(path,method,body){const r=await fetch(process.env.N8N_API_BASE_URL+'/api/v1'+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('n8n HTTP '+r.status);return r.json();}
let credentialId='CONFIGURE_WORKER_HEADER';try{credentialId=(await readFile('.local/delivery-worker-credential-id','utf8')).trim();}catch{}
if(process.argv.includes('--deploy')&&credentialId==='CONFIGURE_WORKER_HEADER'){
 const secret=randomBytes(32).toString('hex'),file=resolve('.local/delivery-worker-secret');await writeFile(file,secret,{mode:0o600});
 if(process.platform==='win32'){const user=execFileSync('whoami',[],{encoding:'utf8'}).trim();execFileSync('icacls',[file,'/inheritance:r','/grant:r',user+':F'],{stdio:'pipe'});}else await chmod(file,0o600);
 const c=await api('/credentials','POST',{name:'Pandora delivery worker (Intellectual Twin)',type:'httpHeaderAuth',data:{name:'X-Pandora-Worker',value:secret}});credentialId=c.id;await writeFile('.local/delivery-worker-credential-id',c.id);
}
const nodes=[],connections={};
const node=(name,type,parameters,v=2,extra={})=>nodes.push({id:name.toLowerCase().replaceAll(' ','-'),name,type,parameters,typeVersion:v,position:[nodes.length%4*280,Math.floor(nodes.length/4)*250],...extra});
const code=(name,jsCode)=>node(name,'n8n-nodes-base.code',{jsCode});
const edge=(a,b,branch=0)=>{connections[a]??={main:[]};connections[a].main[branch]=[{node:b,type:'main',index:0}];};
node('Worker request','n8n-nodes-base.webhook',{httpMethod:'POST',path:'pandora-delivery-worker-v1',authentication:'headerAuth',responseMode:'responseNode',options:{}},2,{webhookId:'pandora-delivery-worker-v1',credentials:{httpHeaderAuth:{id:credentialId,name:'Pandora delivery worker (Intellectual Twin)'}}});
code('Scope request',`const input=$json;if(input.headers?.origin)throw Error('Browser access is not supported');const b=typeof input.body==='string'?JSON.parse(input.body):input.body;if(!b||!['claim','renew','evidence','report','finish'].includes(b.action)||JSON.stringify(b).length>100000)throw Error('Invalid worker action');return [{json:{path:'/automation/delivery/'+b.action,method:'POST',body:{...(b.body||{}),projectId:'${projectId}',workerId:'codex-local'}}}];`);
node('Authorize request','n8n-nodes-base.executeWorkflow',{source:'database',workflowId:{__rl:true,mode:'id',value:storeId},workflowInputs:{mappingMode:'defineBelow',value:{path:'={{ $json.path }}',method:'POST',body:'={{ $json.body }}'},matchingColumns:[],schema:[],attemptToConvertTypes:false,convertFieldsToString:false},options:{waitForSubWorkflow:true}},1.2);
node('Read screenshot','n8n-nodes-base.if',{conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},conditions:[{id:'file',leftValue:'={{ $json.status === 200 && !!$json.body?.evidence }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}},2.2);
node('Load private screenshot','n8n-nodes-base.httpRequest',{url:'=https://api.github.com/repos/florianliepe/Pandora-data/git/blobs/{{ $json.body.evidence.sha }}',authentication:'predefinedCredentialType',nodeCredentialType:'githubApi',options:{timeout:20000,response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}}},4.2,{credentials:{githubApi:{id:'3V46mglu7fpoPISX',name:'GitHub account'}},onError:'continueRegularOutput'});
code('Screenshot response',`const e=$('Authorize request').first().json.body.evidence,b=$json.body;if($json.statusCode!==200||b?.sha!==e.sha||b.size>5*1024*1024||typeof b.content!=='string')return [{json:{status:502,body:{error:'Pinned screenshot could not be retrieved'}}}];return [{json:{status:200,body:{file:{name:e.name,type:e.type,data:b.content,sha:e.sha}}}}];`);
node('Respond','n8n-nodes-base.respondToWebhook',{respondWith:'json',responseBody:'={{ $json }}',options:{responseHeaders:{entries:[{name:'Cache-Control',value:'no-store'}]}}},1.4);
for(const [a,b,n] of [['Worker request','Scope request'],['Scope request','Authorize request'],['Authorize request','Read screenshot'],['Read screenshot','Load private screenshot',0],['Read screenshot','Respond',1],['Load private screenshot','Screenshot response'],['Screenshot response','Respond']])edge(a,b,n||0);
const w={name:'Pandora | scoped Codex delivery worker',nodes,connections,settings:{executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,executionTimeout:150}};
await writeFile('workflows/delivery-worker.json',JSON.stringify(w,null,2)+'\n');
if(process.argv.includes('--deploy')){let id;try{id=(await readFile('.local/delivery-worker-workflow-id','utf8')).trim();}catch{}const result=await api('/workflows'+(id?'/'+id:''),id?'PUT':'POST',w);await writeFile('.local/delivery-worker-workflow-id',result.id);if(process.argv.includes('--activate'))await api('/workflows/'+result.id+'/activate','POST',{});console.log(JSON.stringify({id:result.id,active:process.argv.includes('--activate')}));}
