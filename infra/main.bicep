targetScope = 'resourceGroup'
param location string = 'westeurope'
param suffix string = uniqueString(resourceGroup().id)
@secure()
param postgresAdminPassword string
param postgresAdmin string = 'pandoraadmin'
param frontendOrigin string = 'https://florianliepe.github.io'
var appName = 'pandora-api-${suffix}'
var vaultName = 'kv-pandora-${suffix}'
var storageName = 'stpandora${suffix}'

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-pandora'
  location: location
  properties: {
    addressSpace: {addressPrefixes: ['10.87.0.0/16']}
    subnets: [
      {name: 'app', properties: {addressPrefix: '10.87.1.0/24', delegations: [{name: 'app', properties: {serviceName: 'Microsoft.Web/serverFarms'}}]}}
      {name: 'postgres', properties: {addressPrefix: '10.87.2.0/24', delegations: [{name: 'postgres', properties: {serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'}}]}}
      {name: 'endpoints', properties: {addressPrefix: '10.87.3.0/24', privateEndpointNetworkPolicies: 'Disabled'}}
    ]
  }
}
resource pgDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'pandora.postgres.database.azure.com'
  location: 'global'
}
resource pgDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: pgDns
  name: 'pandora'
  location: 'global'
  properties: {registrationEnabled: false, virtualNetwork: {id: network.id}}
}
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-pandora-${suffix}'
  location: location
  sku: {name: 'Standard_B1ms', tier: 'Burstable'}
  properties: {
    version: '16'
    administratorLogin: postgresAdmin
    administratorLoginPassword: postgresAdminPassword
    storage: {storageSizeGB: 32}
    backup: {backupRetentionDays: 14, geoRedundantBackup: 'Disabled'}
    network: {delegatedSubnetResourceId: '${network.id}/subnets/postgres', privateDnsZoneArmResourceId: pgDns.id, publicNetworkAccess: 'Disabled'}
    highAvailability: {mode: 'Disabled'}
  }
  dependsOn: [pgDnsLink]
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'pandora'
  properties: {charset: 'UTF8', collation: 'en_US.utf8'}
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {name: 'Standard_LRS'}
  kind: 'StorageV2'
  properties: {minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true, allowBlobPublicAccess: false, allowSharedKeyAccess: false, publicNetworkAccess: 'Disabled'}
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {isVersioningEnabled: true, deleteRetentionPolicy: {enabled: true, days: 14}, containerDeleteRetentionPolicy: {enabled: true, days: 14}}
}
resource evidence 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'evidence'
  properties: {publicAccess: 'None'}
}
resource blobDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
}
resource blobDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: blobDns
  name: 'pandora'
  location: 'global'
  properties: {registrationEnabled: false, virtualNetwork: {id: network.id}}
}
resource endpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-pandora-evidence'
  location: location
  properties: {
    subnet: {id: '${network.id}/subnets/endpoints'}
    privateLinkServiceConnections: [{name: 'blob', properties: {privateLinkServiceId: storage.id, groupIds: ['blob']}}]
  }
}
resource endpointDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: endpoint
  name: 'default'
  properties: {privateDnsZoneConfigs: [{name: 'blob', properties: {privateDnsZoneId: blobDns.id}}]}
}
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {tenantId: tenant().tenantId, sku: {family: 'A', name: 'standard'}, enableRbacAuthorization: true, enablePurgeProtection: true, softDeleteRetentionInDays: 90}
}
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'asp-pandora'
  location: location
  kind: 'linux'
  sku: {name: 'B1', tier: 'Basic', capacity: 1}
  properties: {reserved: true}
}
resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  identity: {type: 'SystemAssigned'}
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: '${network.id}/subnets/app'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'node server/index.mjs'
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
      vnetRouteAllEnabled: true
      appSettings: [
        {name: 'NODE_ENV', value: 'production'}
        {name: 'HOST', value: '0.0.0.0'}
        {name: 'PUBLIC_ORIGIN', value: frontendOrigin}
        {name: 'DATABASE_URL', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/pandora-database-url/)'}
        {name: 'ATTACHMENT_CONTAINER_URL', value: '${storage.properties.primaryEndpoints.blob}evidence'}
        {name: 'MAIL_WEBHOOK_URL', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/pandora-mail-url/)'}
        {name: 'MAIL_WEBHOOK_TOKEN', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/pandora-mail-token/)'}
        {name: 'N8N_CHAT_URL', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/pandora-chat-url/)'}
        {name: 'N8N_CHAT_BASIC_AUTH', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/pandora-chat-auth/)'}
        {name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true'}
      ]
    }
  }
}
resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(evidence.id, app.id, 'blob-contributor')
  scope: evidence
  properties: {principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','ba92f5b4-2d11-453d-a403-e96b0029c9fe')}
}
resource vaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, app.id, 'secrets-user')
  scope: vault
  properties: {principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','4633458b-17de-408a-b874-0445c86b69e6')}
}
output apiOrigin string = 'https://${app.properties.defaultHostName}'
output databaseHost string = postgres.properties.fullyQualifiedDomainName
output secretVault string = vault.name
output appServiceName string = app.name
