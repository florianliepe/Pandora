import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {z} from 'zod/v3';
import {registerRoutes} from './routes.mjs';

// Local acceptance server only. Deployed requests execute the same route logic in n8n.
export function createApp({store,env=process.env,deliverMail}={}){
  const app=express();const origins=(env.PUBLIC_ORIGIN||'http://127.0.0.1:4173').split(',');
  const localMailbox=env.DEV_MAILBOX==='true'&&env.NODE_ENV!=='production'&&['127.0.0.1','localhost'].includes(env.HOST||'127.0.0.1');
  if(!deliverMail&&localMailbox)deliverMail=async({email,code})=>{const dir=env.DATA_DIR||'.local';await mkdir(dir,{recursive:true});await writeFile(join(dir,'mailbox.json'),JSON.stringify({email,code}));};
  if(!deliverMail&&env.SMTP_URL&&env.MAIL_FROM)deliverMail=async({email,code})=>nodemailer.createTransport(env.SMTP_URL).sendMail({from:env.MAIL_FROM,to:email,subject:'Your Pandora sign-in code',text:`Your code is ${code}. It expires in 10 minutes.`});
  app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'blob:','data:'],connectSrc:["'self'",...origins],objectSrc:["'none'"],upgradeInsecureRequests:null}}}));
  app.use(cors({origin(origin,cb){cb(null,!origin||origins.includes(origin));}}));
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(req.headers.origin&&!origins.includes(req.headers.origin))return res.status(403).json({error:'Origin not allowed'});next();});
  app.use(express.json({limit:'8mb'}));app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false}));
  registerRoutes(app,{store,env,deliverMail});
  app.use(express.static(resolve('public')));
  app.use((err,_req,res,_next)=>{const status=err instanceof z.ZodError?400:err.status||500;res.status(status).json({error:err instanceof z.ZodError?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):status===500?'Unexpected server error':err.message});});
  return app;
}
