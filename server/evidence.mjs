import {ContainerClient} from '@azure/storage-blob';
// App Service's documented managed-identity endpoint. No browser/CLI credential
// fallback is used on the server; tokens remain in process memory.
export function appServiceCredential(env=process.env,request=fetch){
  let cached;
  return {async getToken(){
    if(cached&&cached.expiresOnTimestamp>Date.now()+120000)return cached;
    if(!env.IDENTITY_ENDPOINT||!env.IDENTITY_HEADER)throw new Error('Azure managed identity is not configured');
    const endpoint=new URL(env.IDENTITY_ENDPOINT);endpoint.searchParams.set('resource','https://storage.azure.com/');endpoint.searchParams.set('api-version','2019-08-01');
    const response=await request(endpoint,{headers:{'X-IDENTITY-HEADER':env.IDENTITY_HEADER},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Managed identity token request failed');
    const value=await response.json();const expiresOnTimestamp=Number(value.expires_on)*1000;
    if(!value.access_token||!Number.isFinite(expiresOnTimestamp))throw new Error('Invalid managed identity response');
    cached={token:value.access_token,expiresOnTimestamp};return cached;
  }};
}
export function evidenceStorage(url){
  if(!url)return null;
  const container=new ContainerClient(url,appServiceCredential());
  return {
    async put(name,buffer,type){await container.getBlockBlobClient(name).uploadData(buffer,{blobHTTPHeaders:{blobContentType:type,blobCacheControl:'private, no-store'}});},
    async get(name){return container.getBlockBlobClient(name).downloadToBuffer();},
    async remove(name){await container.getBlockBlobClient(name).deleteIfExists();}
  };
}
