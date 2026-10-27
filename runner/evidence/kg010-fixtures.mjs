import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateKg010Manifest,KG010} from './kg010-contract.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fixtureId(runId,label){const h=createHash('sha256').update(runId+':'+label).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
/** Produces a plan only. No database, identity, network or cloud mutation occurs here. */
export function prepareKg010Fixtures(rawManifest,runId){
 if(typeof runId!=='string'||!uuid.test(runId))throw Error('A canonical version-4 run UUID is required');
 const manifest=validateKg010Manifest(rawManifest),runMarker='pandora-kg010-'+runId;
 const productionNames=['meids-prod-backend-1853a19b','psql-meids-prod-1853a19b','stmeidsprod1853a19b','srch-meids-prod-1853a19b'];
 if(productionNames.some(n=>JSON.stringify(manifest.environment).toLowerCase().includes(n)))throw Error('Known production resources cannot be used for KG-010 fixtures');
 const fixtures=manifest.principals.map(p=>{
  if(p.expectedTwinId!==`${runMarker}-${p.label}`)throw Error('Test twins must be created for this exact run; existing twins cannot be revoked');
  const marker=`${runMarker}:${p.label}`,recordId=fixtureId(runId,p.label+':record'),nodeId=fixtureId(runId,p.label+':node');
  return {principal:p.label,organizationId:p.expectedOrganizationId,ownerUserId:p.expectedUserId,twinId:p.expectedTwinId,recordId,nodeId,marker,visibility:'private',allowedUserIds:[],allowedGroupIds:[],title:marker+' synthetic record',content:'Synthetic KG-010 isolation fixture. '+marker,blobKey:`kg010/${runId}/${p.label}/fixture.txt`,searchDocumentKey:recordId};
 });
 const matrix=fixtures.flatMap(own=>KG010.surfaces.map(surface=>({principal:own.principal,surface,ownRecordId:own.recordId,foreignRecordId:fixtures.find(f=>f!==own).recordId,ownMarker:own.marker,foreignMarker:fixtures.find(f=>f!==own).marker,expectOwnVisible:true,expectForeignVisible:false})));
 const revoke=fixtures.find(f=>f.principal==='principal_b');
 return {schemaVersion:1,issueId:KG010.issueId,runId,runMarker,manifestDigest:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),mode:'configuration_only',requiresIndependentInventoryVerification:true,resourceBindings:manifest.environment,fixtures,matrix,
  graphBoundaryProbe:{edgeId:fixtureId(runId,'boundary-edge'),fromNodeId:fixtures[0].nodeId,toNodeId:fixtures[1].nodeId,synthetic:true,expectedForeignMarkerVisible:false},
  revocation:{type:'run_created_twin_assignment_only',principal:revoke.principal,userId:revoke.ownerUserId,twinId:revoke.twinId,requiresCreatedByRun:true,changeEntraMembership:false,expected:{apiStatus:[403,404],searchMatches:0,blobStatus:[403,404],graphMatches:0}},
  cleanup:{requiresRunOwnership:true,recordIds:fixtures.map(f=>f.recordId),nodeIds:fixtures.map(f=>f.nodeId),edgeIds:[fixtureId(runId,'boundary-edge')],blobKeys:fixtures.map(f=>f.blobKey),searchDocumentKeys:fixtures.map(f=>f.searchDocumentKey),twinAssignments:fixtures.map(f=>({userId:f.ownerUserId,twinId:f.twinId})),drainOutboxForRecordIds:fixtures.map(f=>f.recordId),deleteEntraUsers:false,deleteEntraGroups:false,deleteDatabase:false,deleteStorageContainer:false,deleteSearchIndex:false}};
}
async function main(){const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw Error('Missing '+k);return args[i+1];};const manifest=JSON.parse(await readFile(resolve(get('--manifest')),'utf8')),plan=prepareKg010Fixtures(manifest,get('--run-id'));await writeFile(resolve(get('--output')),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Prepared synthetic fixture plan; no resources changed.');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
