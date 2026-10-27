import {z} from 'zod/v3';

export const PROJECT_ID='3daa1c59-cd24-487b-a8e4-dc5d930e41f0';
export const SOURCE_REPOSITORY='florianliepe/meids-app';
export const SOURCE_BRANCH='main';
export const BRIDGE_SCHEMA_VERSION=1;

const uuid=z.string().uuid();
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const capability=z.object({
 projectId:z.literal(PROJECT_ID),
 workerId:z.literal('codex-local'),
 jobId:uuid,
 claimId:uuid,
 token:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const startResponse=z.object({
 job:z.object({
  id:uuid,
  projectId:z.literal(PROJECT_ID),
  repository:z.literal(SOURCE_REPOSITORY),
  baseBranch:z.literal(SOURCE_BRANCH),
  baseSha:sha,
  executionPhase:z.enum(['fix','verification']),
  snapshot:z.object({
   report:z.record(z.unknown()),
   screenshots:z.array(z.object({id:uuid,name:z.string(),type:z.string(),size:z.number(),blobSha:sha.nullable()}).passthrough()),
   tests:z.array(z.object({id:z.string().min(1),version:z.number().int().positive(),title:z.string().min(1)}).passthrough()).min(1),
  }).strict(),
 }).passthrough(),
 capability,
 expires:z.number().int().positive(),
}).strict();

export const operation=z.enum([
 'preflight',
 'start','status','cancelled',
 'renew','evidence','report','finish',
 'publish','merge-readiness','merged',
]);

export function assertEventId(value){return uuid.parse(value);}
export function assertRunId(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw Error('GitHub run ID must be a positive integer');return n;}

export function requestEnvelope(name,eventId,runId,body={}){
 return {
  schemaVersion:BRIDGE_SCHEMA_VERSION,
  operation:operation.parse(name),
  eventId:assertEventId(eventId),
  runId:assertRunId(runId),
  body,
 };
}

export function parseStartResponse(value){return startResponse.parse(value);}

export function publicationAttestation(value){
 return z.object({
  repository:z.literal(SOURCE_REPOSITORY),
  baseBranch:z.literal(SOURCE_BRANCH),
  baseSha:sha,
  headSha:sha.refine(v=>v!==value?.baseSha,'Head SHA must differ from base SHA'),
  headBranch:z.string().regex(/^pandora\/[a-f0-9-]{36}$/),
  pullNumber:z.number().int().positive(),
  pullUrl:z.string().url().refine(v=>v.startsWith(`https://github.com/${SOURCE_REPOSITORY}/pull/`),'Unexpected pull-request URL'),
  marker:z.string().regex(/^Pandora-Delivery: [a-f0-9-]{36}$/),
 }).strict().parse(value);
}

export function mergeAttestation(value){
 const check=z.object({name:z.string().min(1).max(200),conclusion:z.literal('success'),headSha:sha}).strict();
 const parsed=z.object({
  repository:z.literal(SOURCE_REPOSITORY),
  baseBranch:z.literal(SOURCE_BRANCH),
  baseSha:sha,
  headSha:sha,
  pullNumber:z.number().int().positive(),
  draft:z.literal(false),
  mergeable:z.literal(true),
  branchProtection:z.object({enabled:z.literal(true),requiredChecks:z.array(z.string().min(1)).min(1)}).strict(),
  checks:z.array(check).min(1),
  observedAt:z.string().datetime(),
 }).strict().parse(value);
 const successes=new Set(parsed.checks.filter(c=>c.headSha===parsed.headSha).map(c=>c.name));
 const missing=parsed.branchProtection.requiredChecks.filter(name=>!successes.has(name));
 if(missing.length)throw Error('Required checks are not successful at the exact head SHA: '+missing.join(', '));
 return parsed;
}

export function redactForLog(value){
 if(!value||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(redactForLog);
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[/token|secret|key|description|steps|actual|expected|notes/i.test(key)?[key,'[redacted]']:[key,redactForLog(item)]]));
}
