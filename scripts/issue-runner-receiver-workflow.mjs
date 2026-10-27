import {readFile,writeFile} from 'node:fs/promises';

const projectId='3daa1c59-cd24-487b-a8e4-dc5d930e41f0';
const storeId=(process.env.PANDORA_STORE_WORKFLOW_ID||await readFile('.local/quality-store-id','utf8').catch(()=>Buffer.from('CONFIGURE_STORE_WORKFLOW'))).toString().trim();
const credentialId=(process.env.PANDORA_WORKER_CREDENTIAL_ID||await readFile('.local/issue-runner-credential-id','utf8').catch(()=>Buffer.from('CONFIGURE_PANDORA_WORKER_CREDENTIAL'))).toString().trim();
const nodes=[],connections={};
const node=(name,type,parameters,v=2,extra={})=>nodes.push({id:name.toLowerCase().replaceAll(' ','-'),name,type,parameters,typeVersion:v,position:[nodes.length*280,0],...extra});
const edge=(a,b)=>{connections[a]={main:[[{node:b,type:'main',index:0}]]};};

node('Runner callback','n8n-nodes-base.webhook',{httpMethod:'POST',path:'pandora-issue-runner-v1',authentication:'headerAuth',responseMode:'responseNode',options:{}},2,{webhookId:'pandora-issue-runner-v1',credentials:{httpHeaderAuth:{id:credentialId,name:'Pandora unattended runner (Intellectual Twin)'}}});
node('Scope exact operation','n8n-nodes-base.code',{jsCode:`const input=$json;if(input.headers?.origin)throw Error('Browser access is not supported');const request=typeof input.body==='string'?JSON.parse(input.body):input.body;const issue=new Set(['preflight','start','status','cancelled','publish','merge-readiness','merged']);const delivery=new Set(['renew','evidence','report','finish']);if(!request||request.schemaVersion!==1||(!issue.has(request.operation)&&!delivery.has(request.operation))||typeof request.eventId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.eventId)||!Number.isSafeInteger(request.runId)||request.runId<=0||JSON.stringify(request).length>120000)throw Error('Invalid runner callback');const proposed=new Set(['publish','merge-readiness','merged']);const path=request.operation==='preflight'?'/automation/issues/preflight':proposed.has(request.operation)?'/automation/issues/'+request.operation:(issue.has(request.operation)?'/automation/issues/':'/automation/delivery/')+request.operation;const body={...(request.body||{}),projectId:'${projectId}'};if(request.operation==='preflight'){body.runId=request.runId;body.syntheticEventId=request.eventId;}if(request.operation==='start'||request.operation==='status'){body.eventId=request.eventId;body.runId=request.runId;}if(request.operation==='cancelled')body.eventId=request.eventId;if(delivery.has(request.operation))body.workerId='codex-local';if(proposed.has(request.operation)){body.eventId=request.eventId;body.runId=request.runId;body.workerId='codex-local';}return [{json:{path,method:'POST',body}}];`},2);
node('Authorize in Pandora store','n8n-nodes-base.executeWorkflow',{source:'database',workflowId:{__rl:true,mode:'id',value:storeId},workflowInputs:{mappingMode:'defineBelow',value:{path:'={{ $json.path }}',method:'POST',body:'={{ $json.body }}'},matchingColumns:[],schema:[],attemptToConvertTypes:false,convertFieldsToString:false},options:{waitForSubWorkflow:true}},1.2);
node('Return no-store JSON','n8n-nodes-base.respondToWebhook',{respondWith:'json',responseBody:'={{ $json }}',options:{responseHeaders:{entries:[{name:'Cache-Control',value:'no-store'},{name:'X-Content-Type-Options',value:'nosniff'}]}}},1.4);
edge('Runner callback','Scope exact operation');edge('Scope exact operation','Authorize in Pandora store');edge('Authorize in Pandora store','Return no-store JSON');

const workflow={name:'Pandora | unattended issue runner receiver',nodes,connections,settings:{executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,executionTimeout:180}};
await writeFile('runner/issue-runner-receiver.workflow.json',JSON.stringify(workflow,null,2)+'\n');

if(process.argv.includes('--deploy')){
 const base=process.env.N8N_API_BASE_URL,key=process.env.N8N_API_KEY;
 if(!base||!key)throw Error('N8N_API_BASE_URL and N8N_API_KEY are required');
 const headers={'X-N8N-API-KEY':key,'Content-Type':'application/json'};
 const api=async(path,method,body)=>{const response=await fetch(base+'/api/v1'+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('n8n HTTP '+response.status);return response.json();};
 let id;try{id=(await readFile('.local/issue-runner-receiver-id','utf8')).trim();}catch{}
 const result=await api('/workflows'+(id?'/'+id:''),id?'PUT':'POST',workflow);await writeFile('.local/issue-runner-receiver-id',result.id);
 if(process.argv.includes('--activate'))await api('/workflows/'+result.id+'/activate','POST',{});
 console.log(JSON.stringify({id:result.id,active:process.argv.includes('--activate')}));
}
