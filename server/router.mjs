import {z} from 'zod/v3';
export function createRouter(){
  const layers=[];const app={};
  for(const method of ['get','post','put','delete','use'])app[method]=(path,...handlers)=>layers.push({method,path,handlers});
  app.dispatch=async(input)=>{
    const req={method:input.method,path:input.path,headers:input.headers||{},body:input.body||{},params:{}};
    let result={status:200,body:null,contentType:'application/json'},finished=false;
    const res={status(n){result.status=n;return this;},type(t){result.contentType=t;return this;},json(b){result.body=b;finished=true;return this;},send(b){result.body=b;finished=true;return this;}};
    try{
      for(const layer of layers){
        if(finished)break;
        if(layer.method==='use'){
          if(!req.path.startsWith(layer.path))continue;
          const original=req.path;req.path=req.path.slice(layer.path.length)||'/';
          for(const handler of layer.handlers){let next=false;await handler(req,res,()=>{next=true;});if(finished||!next)break;}
          req.path=original;continue;
        }
        if(layer.method.toUpperCase()!==req.method)continue;
        const keys=[];const regex=new RegExp('^'+layer.path.replace(/:([A-Za-z]+)/g,(_,k)=>{keys.push(k);return '([^/]+)';})+'$');const match=req.path.match(regex);if(!match)continue;
        req.params=Object.fromEntries(keys.map((k,i)=>[k,decodeURIComponent(match[i+1])]));
        for(const handler of layer.handlers)await handler(req,res,()=>{});
      }
    }catch(err){const status=err instanceof z.ZodError?400:err.status||500;result={status,body:{error:err instanceof z.ZodError?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):status===500?'Unexpected server error':err.message},contentType:'application/json'};}
    if(!finished&&result.status===200)result={status:404,body:{error:"Route not found"},contentType:"application/json"};
    return result;
  };
  return app;
}
