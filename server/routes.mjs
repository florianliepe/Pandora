import {createHash,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {z} from 'zod/v3';
import {id,now,fail,emailSchema,schemas,member,permit,audit,validateRefs,notify,metrics,roles} from './domain.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const editors=['owner','developer'];
const contributors=['owner','developer','tester'];
export function registerRoutes(app,{store,env={},deliverMail,blobs=null,chat=null}){
const mailReady=!!deliverMail;
  app.get('/api/health',(_req,res)=>res.json({status:'ok',mailReady,storage:env.STORAGE_KIND||'sqlite',agentReady:!!chat}));

  app.post('/api/auth/request',async(req,res)=>{
    const email=emailSchema.parse(req.body.email);
    if(!mailReady)fail(503,'Email delivery is not configured. Contact the application owner.');
    const code=String(randomInt(10000000,100000000));const challengeId=id();
    await store.change(s=>{const recent=s.challenges.filter(c=>c.email===email&&c.createdAt>Date.now()-3600000);if(recent.length>=5||recent.some(c=>c.createdAt>Date.now()-60000))fail(429,'Please wait before requesting another code');s.challenges=s.challenges.filter(c=>c.createdAt>Date.now()-3600000);for(const c of s.challenges)if(c.email===email)c.used=true;s.challenges.push({id:challengeId,email,hash:digest(challengeId+code),createdAt:Date.now(),expires:Date.now()+600000,attempts:0,used:false});});
    try{
      await deliverMail({email,code});
    }catch{await store.change(s=>{const c=s.challenges.find(c=>c.id===challengeId);if(c)c.used=true;});fail(503,'Unable to deliver login code. Please try later.');}
    res.json({challengeId,message:'Check your email. The code expires in 10 minutes.'});
  });
  app.post('/api/auth/verify',async(req,res)=>{
    const {challengeId,code}=z.object({challengeId:z.string().uuid(),code:z.string().regex(/^\d{8}$/)}).parse(req.body);
    const result=await store.change(s=>{
      const c=s.challenges.find(c=>c.id===challengeId);
      if(!c||c.used||c.expires<Date.now()||c.attempts>=5)return null;
      c.attempts++;
      if(!equal(c.hash,digest(challengeId+code)))return null;
      c.used=true;
      let user=s.users.find(u=>u.email===c.email);
      if(!user){user={id:id(),email:c.email,name:c.email.split('@')[0].replaceAll('.',' '),createdAt:now()};s.users.push(user);}
      const token=randomBytes(32).toString('hex');
      s.sessions=s.sessions.filter(x=>x.expires>Date.now());s.sessions.push({hash:digest(token),userId:user.id,expires:Date.now()+8*3600000});
      return {token,user};
    });
    if(!result)fail(401,'Code is invalid, expired, or already used');res.json(result);
  });
  app.use('/api',async(req,res,next)=>{if(req.path==='/health')return next();const token=req.headers.authorization?.replace(/^Bearer /,'')||'';const s=await store.read();const session=s.sessions.find(x=>x.hash===digest(token)&&x.expires>Date.now());if(!session)fail(401,'Please sign in');req.user=s.users.find(u=>u.id===session.userId);req.tokenHash=session.hash;next();});
  app.post('/api/auth/logout',async(req,res)=>{await store.change(s=>{s.sessions=s.sessions.filter(x=>x.hash!==req.tokenHash);});res.json({ok:true});});
  app.get('/api/me',(req,res)=>res.json(req.user));
  app.get('/api/projects',async(req,res)=>{const s=await store.read();res.json(s.projects.filter(p=>!p.deletedAt&&s.members.some(m=>m.projectId===p.id&&m.userId===req.user.id)).map(p=>({...p,role:member(s,p.id,req.user.id).role})));});
  app.post('/api/projects',async(req,res)=>{const data=schemas.projects.parse(req.body);if(data.mergePolicy!=='human')fail(400,'New projects require human approval');const p=await store.change(s=>{const p={...data,id:id(),createdBy:req.user.id,createdAt:now(),updatedAt:now(),version:1};s.projects.push(p);s.members.push({projectId:p.id,userId:req.user.id,role:'owner'});audit(s,p.id,req.user.id,'project.created',p.id,null,p);return p;});res.status(201).json(p);});
  app.get('/api/projects/:projectId',async(req,res)=>{
    const s=await store.read(),p=req.params.projectId;const m=member(s,p,req.user.id);
    const data={project:s.projects.find(x=>x.id===p),role:m.role,members:s.members.filter(x=>x.projectId===p).map(x=>({...x,user:s.users.find(u=>u.id===x.userId)})),metrics:metrics(s,p),preferences:s.preferences.find(x=>x.projectId===p&&x.userId===req.user.id)||{muted:false}};
    for(const key of ['issues','iterations','cases','runs','events'])data[key]=s[key].filter(x=>x.projectId===p&&!x.deletedAt);
    data.attachments=s.attachments.filter(x=>x.projectId===p&&!x.deletedAt).map(({data,...x})=>x);
    data.notifications=s.notifications.filter(x=>x.projectId===p&&x.userId===req.user.id);
    res.json(data);
  });
  app.put('/api/projects/:projectId',async(req,res)=>{
    const {version,...raw}=req.body;const data=schemas.projects.parse(raw);
    const result=await store.change(s=>{const p=req.params.projectId;permit(s,p,req.user.id,['owner']);const old=s.projects.find(x=>x.id===p);if(old.version!==version)fail(409,'Project changed; reload before saving');if(data.mergePolicy==='agentic')fail(409,'Agentic merge is unavailable until phase-two checks and repository protection are implemented');const before={...old};Object.assign(old,data,{version:old.version+1,updatedAt:now()});audit(s,p,req.user.id,'project.updated',p,before,old);return old;});res.json(result);
  });
  app.delete('/api/projects/:projectId',async(req,res)=>{await store.change(s=>{const p=req.params.projectId;permit(s,p,req.user.id,['owner']);const item=s.projects.find(x=>x.id===p);item.deletedAt=now();audit(s,p,req.user.id,'project.archived',p);});res.json({ok:true});});
  app.post('/api/projects/:projectId/members',async(req,res)=>{
    const email=emailSchema.parse(req.body.email),role=z.enum(roles).parse(req.body.role);
    await store.change(s=>{const p=req.params.projectId;permit(s,p,req.user.id,['owner']);let u=s.users.find(u=>u.email===email);if(!u){u={id:id(),email,name:email.split('@')[0].replaceAll('.',' '),createdAt:now()};s.users.push(u);}const m=s.members.find(m=>m.projectId===p&&m.userId===u.id);if(m?.role==='owner'&&role!=='owner'&&s.members.filter(x=>x.projectId===p&&x.role==='owner').length===1)fail(400,'Keep at least one project owner');if(m)m.role=role;else s.members.push({projectId:p,userId:u.id,role});audit(s,p,req.user.id,'member.updated',u.id,null,{email,role});});res.json({ok:true});
  });
  app.delete('/api/projects/:projectId/members/:userId',async(req,res)=>{await store.change(s=>{const p=req.params.projectId;permit(s,p,req.user.id,['owner']);const m=s.members.find(m=>m.projectId===p&&m.userId===req.params.userId);if(!m)fail(404,'Member not found');if(m.role==='owner'&&s.members.filter(m=>m.projectId===p&&m.role==='owner').length===1)fail(400,'Keep at least one owner');s.members=s.members.filter(x=>x!==m);audit(s,p,req.user.id,'member.removed',m.userId);});res.json({ok:true});});
  for(const collection of ['issues','iterations','cases','runs']){
    app.post(`/api/projects/:projectId/${collection}`,async(req,res)=>{
      const data=schemas[collection].parse(req.body);
      const result=await store.change(s=>{const p=req.params.projectId;permit(s,p,req.user.id,collection==='iterations'?editors:contributors);validateRefs(s,p,data);
        if(collection==='issues'&&data.status!=='reported')fail(400,'New issues start as reported');
        const item={...data,id:id(),projectId:p,createdBy:req.user.id,createdAt:now(),updatedAt:now(),version:1};
        if(collection==='runs')item.caseSnapshot=structuredClone(s.cases.find(c=>c.id===data.caseId));
        s[collection].push(item);audit(s,p,req.user.id,`${collection}.created`,item.id,null,item);if(collection==='issues')notify(s,item,req.user.id,'reported');return item;
      });res.status(201).json(result);
    });
    app.put(`/api/projects/:projectId/${collection}/:id`,async(req,res)=>{
      const {version,...raw}=req.body;const data=schemas[collection].parse(raw);
      const result=await store.change(s=>{const p=req.params.projectId;const m=permit(s,p,req.user.id,collection==='iterations'?editors:contributors);const item=s[collection].find(x=>x.id===req.params.id&&x.projectId===p&&!x.deletedAt);if(!item)fail(404,'Record not found');if(item.version!==version)fail(409,'Record changed; reload before saving');validateRefs(s,p,data);
        if(collection==='issues'){
          if(m.role==='tester'){
            const allowed=['status','testStatus','actual','notes'];
            if(item.createdBy===req.user.id)allowed.push('title','description','steps','expected','environment','severity');
            if(Object.keys(data).some(k=>!allowed.includes(k)&&data[k]!==item[k]))fail(403,'Testers can update their reports and verification results, not delivery planning');
          }
          if(data.status!==item.status){
            const graph={reported:['triaged'],triaged:['planned','in_progress'],planned:['in_progress','triaged'],in_progress:['ready_for_test','planned'],ready_for_test:['verified','reopened'],verified:['closed','reopened'],closed:['reopened'],reopened:['triaged','in_progress']};
            if(!graph[item.status].includes(data.status))fail(400,'Invalid status transition');
            if(m.role==='tester'&&!['verified','reopened'].includes(data.status))fail(403,'Tester can verify or reopen issues');
            if(['verified','closed'].includes(data.status)&&!['owner','tester'].includes(m.role))fail(403,'Owner or tester verification required');
            const ready=s.events.filter(e=>e.entityId===item.id&&e.after?.status==='ready_for_test').at(-1)?.at||item.updatedAt;
            const latest=s.runs.filter(r=>r.projectId===p&&r.issueId===item.id&&!r.deletedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
            if(['verified','closed'].includes(data.status)&&(!latest||latest.result!=='passed'||latest.createdAt<ready||data.testStatus!=='passed'))fail(400,'A passing linked test run after the fix is ready for test is required');
          }
        }
        const before=structuredClone(item);Object.assign(item,data,{version:item.version+1,updatedAt:now()});
        if(collection==='runs'&&data.caseId!==before.caseId)item.caseSnapshot=structuredClone(s.cases.find(c=>c.id===data.caseId));
        audit(s,p,req.user.id,`${collection}.updated`,item.id,before,item);if(collection==='issues')notify(s,item,req.user.id,item.status);return item;
      });res.json(result);
    });
    app.delete(`/api/projects/:projectId/${collection}/:id`,async(req,res)=>{await store.change(s=>{const p=req.params.projectId;permit(s,p,req.user.id,editors);const item=s[collection].find(x=>x.id===req.params.id&&x.projectId===p&&!x.deletedAt);if(!item)fail(404,'Record not found');const before=structuredClone(item);item.deletedAt=now();audit(s,p,req.user.id,`${collection}.archived`,item.id,before,item);});res.json({ok:true});});
  }
  app.post('/api/projects/:projectId/issues/:id/attachments',async(req,res)=>{
    const file=z.object({name:z.string().min(1).max(180),type:z.enum(['image/png','image/jpeg','image/webp']),data:z.string().max(7_000_000)}).parse(req.body);
    const bytes=Buffer.from(file.data,'base64');if(bytes.length>5*1024*1024)fail(413,'Maximum screenshot size is 5 MB');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!({'image/png':png,'image/jpeg':jpg,'image/webp':webp}[file.type]))fail(400,'Invalid image content');
    const attachmentId=id();let uploaded=false;
    try {await store.change(async s=>{const p=req.params.projectId;permit(s,p,req.user.id,contributors);const issue=s.issues.find(i=>i.id===req.params.id&&i.projectId===p&&!i.deletedAt);if(!issue)fail(404,'Issue not found');if(s.attachments.filter(a=>a.issueId===issue.id&&!a.deletedAt).length>=10)fail(400,'Maximum 10 screenshots per issue');const a={...file,id:attachmentId,projectId:p,issueId:issue.id,createdBy:req.user.id,createdAt:now(),size:bytes.length};if(blobs){await blobs.put(attachmentId,bytes,file.type);uploaded=true;delete a.data;a.blobName=attachmentId;}s.attachments.push(a);audit(s,p,req.user.id,'attachment.created',a.id,null,{name:a.name,issueId:issue.id});});}catch(e){if(uploaded)await blobs.remove(attachmentId).catch(()=>{});throw e;}res.status(201).json({ok:true});
  });
  app.get('/api/projects/:projectId/attachments/:id',async(req,res)=>{const s=await store.read(),p=req.params.projectId;member(s,p,req.user.id);const a=s.attachments.find(a=>a.id===req.params.id&&a.projectId===p&&!a.deletedAt);if(!a)fail(404,'Screenshot not found');res.type(a.type).send(a.blobName?await blobs.get(a.blobName):Buffer.from(a.data,'base64'));});
  app.delete('/api/projects/:projectId/attachments/:id',async(req,res)=>{await store.change(s=>{const p=req.params.projectId;const m=permit(s,p,req.user.id,contributors);const a=s.attachments.find(a=>a.id===req.params.id&&a.projectId===p&&!a.deletedAt);if(!a)fail(404,'Screenshot not found');if(m.role==='tester'&&a.createdBy!==req.user.id)fail(403,'Only your own screenshots can be removed');a.deletedAt=now();audit(s,p,req.user.id,'attachment.archived',a.id);});res.json({ok:true});});
  app.put('/api/projects/:projectId/preferences',async(req,res)=>{const muted=z.boolean().parse(req.body.muted);await store.change(s=>{const p=req.params.projectId;member(s,p,req.user.id);s.preferences=s.preferences.filter(x=>!(x.projectId===p&&x.userId===req.user.id));s.preferences.push({projectId:p,userId:req.user.id,muted});});res.json({ok:true});});
  app.post('/api/projects/:projectId/notifications/read',async(req,res)=>{await store.change(s=>{const p=req.params.projectId;member(s,p,req.user.id);for(const n of s.notifications)if(n.projectId===p&&n.userId===req.user.id)n.read=true;});res.json({ok:true});});
  app.post('/api/projects/:projectId/chat',async(req,res)=>{
    const message=z.string().trim().min(1).max(4000).parse(req.body.message);const s=await store.read(),p=req.params.projectId;const m=member(s,p,req.user.id);
    if(!chat)fail(503,'Agent workflow is not connected yet. Issue reporting and test management remain available.');
    const context={projectId:p,userId:req.user.id,role:m.role,mode:'advisory',mergePolicy:'human',project:s.projects.find(x=>x.id===p).name,issues:s.issues.filter(i=>i.projectId===p&&!i.deletedAt).slice(0,100).map(i=>({id:i.id,title:i.title,description:i.description.slice(0,2000),status:i.status,priority:i.priority,steps:i.steps.slice(0,2000),expected:i.expected.slice(0,1000)}))};
    const result=await chat({action:'sendMessage',chatInput:message,sessionId:digest(req.user.id+p),context});res.json({reply:String(result.output||result.reply||'The workflow returned no response.').slice(0,16000)});
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API endpoint'}));

}
