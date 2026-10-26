import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export const emptyState = () => ({schemaVersion:1, users:[], challenges:[], sessions:[], projects:[], members:[], issues:[], iterations:[], cases:[], runs:[], attachments:[], events:[], notifications:[], preferences:[]});

// Small-team transactional aggregate. PostgreSQL row locking serializes writers across
// instances. SQLite is a local-development fallback. Split hot tables before scaling.
export async function createStore({databaseUrl, dataDir='.local', memory=false}={}) {
  let db, pool;
  if (databaseUrl) {
    pool = new pg.Pool({connectionString:databaseUrl});
    await pool.query('CREATE TABLE IF NOT EXISTS pandora_state (id integer PRIMARY KEY, data jsonb NOT NULL)');
    await pool.query('INSERT INTO pandora_state VALUES (1,$1) ON CONFLICT DO NOTHING',[JSON.stringify(emptyState())]);
  } else {
    if (!memory) mkdirSync(dataDir,{recursive:true});
    db = new DatabaseSync(memory ? ':memory:' : join(dataDir,'pandora.db'));
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO state VALUES(1,?)').run(JSON.stringify(emptyState()));
  }
  let queue = Promise.resolve();
  return {
    async read() { return pool ? (await pool.query('SELECT data FROM pandora_state WHERE id=1')).rows[0].data : JSON.parse(db.prepare('SELECT data FROM state WHERE id=1').get().data); },
    change(fn) {
      const operation = queue.then(async()=>{
        if (pool) {
          const c=await pool.connect();
          try { await c.query('BEGIN'); const s=(await c.query('SELECT data FROM pandora_state WHERE id=1 FOR UPDATE')).rows[0].data; const result=await fn(s); await c.query('UPDATE pandora_state SET data=$1 WHERE id=1',[JSON.stringify(s)]); await c.query('COMMIT'); return result; }
          catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
        }
        db.exec('BEGIN IMMEDIATE');
        try { const s=JSON.parse(db.prepare('SELECT data FROM state WHERE id=1').get().data); const result=await fn(s); db.prepare('UPDATE state SET data=? WHERE id=1').run(JSON.stringify(s)); db.exec('COMMIT'); return result; }
        catch(e){db.exec('ROLLBACK');throw e;}
      });
      queue=operation.catch(()=>{}); return operation;
    },
    async close(){await queue; if(pool)await pool.end(); else db.close();}
  };
}
