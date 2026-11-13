import {randomBytes,randomInt,createHash,timingSafeEqual,scryptSync} from 'node:crypto';
import {z} from 'zod/v3';
import {id,now,fail} from './domain.mjs';

export const accountEmail=z.string().trim().toLowerCase().email().max(254);
const password=z.string().min(15,'Use at least 15 characters').max(128);
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const parameters={N:131072,r:8,p:1,maxmem:256*1024*1024};
export const passwordHash=(value,salt)=>scryptSync(value,salt,32,parameters).toString('hex');
const staff=email=>email.split('@')[1]==='eraneos.com';
function eligible(s,email){
  const user=s.users.find(u=>u.email===email);
  return staff(email)||(s.passwordCredentials||[]).some(c=>c.userId===user?.id)||(s.accountInvitations||[]).some(i=>i.email===email&&i.expires>Date.now()&&s.members.some(m=>m.projectId===i.projectId&&m.userId===user?.id)&&s.members.some(m=>m.projectId===i.projectId&&m.userId===i.invitedBy&&m.role==='owner')&&s.projects.some(p=>p.id===i.projectId&&!p.deletedAt));
}
function session(s,user){
  const token=randomBytes(32).toString('hex');
  s.sessions=(s.sessions||[]).filter(x=>x.expires>Date.now());
  s.sessions.push({hash:hash(token),userId:user.id,expires:Date.now()+8*3600000});
  return {token,user};
}
async function throttle(store,email,kind){
  const allowed=await store.change(s=>{
    s.passwordAttempts=(s.passwordAttempts||[]).filter(x=>x.at>Date.now()-15*60000);
    const limit=kind==='mail'?3:10;
    if(s.passwordAttempts.length>=120||s.passwordAttempts.filter(x=>x.email===email&&x.kind===kind).length>=limit)return false;
    s.passwordAttempts.push({email,kind,at:Date.now()});return true;
  });
  if(!allowed)fail(429,'Too many attempts. Please try again in 15 minutes.');
}
export function registerPasswordRoutes(app,{store,deliverMail}){
  app.post('/api/auth/password/request',async(req,res)=>{
    const email=accountEmail.parse(req.body.email);
    if(!deliverMail)fail(503,'Email delivery is unavailable');
    await throttle(store,email,'mail');
    const challengeId=id(),code=String(randomInt(10000000,100000000));
    const send=await store.change(s=>{
      s.passwordChallenges=(s.passwordChallenges||[]).filter(c=>c.expires>Date.now()&&!c.used);
      if(!eligible(s,email))return false;
      for(const c of s.passwordChallenges)if(c.email===email)c.used=true;
      s.passwordChallenges.push({id:challengeId,email,hash:hash(challengeId+code),expires:Date.now()+10*60000,attempts:0,used:false});
      return true;
    });
    if(send){try{await deliverMail({email,code,purpose:'pandora_password'});}catch{await store.change(s=>{const c=s.passwordChallenges.find(c=>c.id===challengeId);if(c)c.used=true;});fail(503,'Unable to deliver the email. Please try later.');}}
    res.json({challengeId,message:'If your address is eligible, a password setup/reset code has been sent. External guests need a project-owner invitation.'});
  });
  app.post('/api/auth/password/complete',async(req,res)=>{
    const input=z.object({challengeId:z.string().uuid(),code:z.string().regex(/^\d{8}$/),password}).strict().parse(req.body);
    const result=await store.change(s=>{
      const c=(s.passwordChallenges||[]).find(c=>c.id===input.challengeId);
      if(!c||c.used||c.expires<=Date.now()||c.attempts>=5)return null;
      c.attempts++;
      if(!same(c.hash,hash(c.id+input.code))||!eligible(s,c.email))return null;
      let user=s.users.find(u=>u.email===c.email);
      if(!user){user={id:id(),email:c.email,name:c.email.split('@')[0].replaceAll('.',' '),createdAt:now()};s.users.push(user);}
      const salt=randomBytes(32).toString('hex');
      const credential={userId:user.id,algorithm:'scrypt-v1',salt,hash:passwordHash(input.password,salt),changedAt:now()};
      s.passwordCredentials=(s.passwordCredentials||[]).filter(x=>x.userId!==user.id);s.passwordCredentials.push(credential);
      for(const other of s.passwordChallenges)if(other.email===c.email)other.used=true;
      for(const other of s.challenges||[])if(other.email===c.email)other.used=true;
      s.sessions=(s.sessions||[]).filter(x=>x.userId!==user.id);
      s.accountInvitations=(s.accountInvitations||[]).filter(i=>i.email!==c.email);
      return session(s,user);
    });
    if(!result)fail(401,'Code is invalid, expired or already used');
    res.json(result);
  });
  app.post('/api/auth/password/login',async(req,res)=>{
    const input=z.object({email:accountEmail,password:z.string().min(1).max(128)}).strict().parse(req.body);
    await throttle(store,input.email,'login');
    const s=await store.read(),user=s.users.find(u=>u.email===input.email),credential=(s.passwordCredentials||[]).find(c=>c.userId===user?.id);
    const calculated=passwordHash(input.password,credential?.salt||'0'.repeat(64));
    if(!credential||credential.algorithm!=='scrypt-v1'||!same(calculated,credential.hash))fail(401,'Email or password is incorrect');
    const result=await store.change(current=>{
      const latest=(current.passwordCredentials||[]).find(c=>c.userId===user.id);
      if(!latest||latest.hash!==credential.hash)return null;
      return session(current,current.users.find(u=>u.id===user.id));
    });
    if(!result)fail(401,'Please sign in again');
    res.json(result);
  });
}
