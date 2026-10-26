import {createStore} from './store.mjs';
import {createApp} from './app.mjs';
if(process.env.NODE_ENV==='production'&&(!process.env.DATABASE_URL||!process.env.ATTACHMENT_CONTAINER_URL))throw new Error('Production requires PostgreSQL and private evidence storage configuration');
const store=await createStore({databaseUrl:process.env.DATABASE_URL,dataDir:process.env.DATA_DIR});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4173);
const server=createApp({store}).listen(port,host,()=>console.log(`Pandora: http://${host}:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await store.close();process.exit(0);}));
