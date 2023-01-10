import { connect } from '@ucanto/client'
import { CAR, CBOR, HTTP } from '@ucanto/transport'
import * as DID from '@ipld/dag-ucan/did'

import { create as createClient } from '@web3-storage/w3up-client'
// import { StoreConf } from '@web3-storage/access/stores/store-conf'

/**
 * @param {string} uploadServiceUrl
 * @param {object} [options]
 * @param {boolean} [options.shouldRegister]
 */
export async function getClient(uploadServiceUrl, options = {}) {
  // const store = new StoreConf({ profile: 'integration-tests' })

  const client = await createClient({
    serviceConf: {
      upload: getUploadServiceConnection(uploadServiceUrl),
      access: getAccessServiceConnection()
    },
  })

  if (options.shouldRegister) {
    await register(client)
  }

  return client
}

/**
 * @param {import("@web3-storage/w3up-client").Client} client
 */
async function register (client) {
  const space = await client.createSpace('w3infra-integration-tests')
  await client.setCurrentSpace(space.did())
  await client.registerSpace('it@dag.house')

  // TODO: Extract this to conf file
}

function getAccessServiceConnection() {
  const accessServiceURL = new URL('https://w3access-staging.protocol-labs.workers.dev')
  const accessServicePrincipal = DID.parse('did:web:staging.web3.storage')

  return connect({
    id: accessServicePrincipal,
    encoder: CAR,
    decoder: CBOR,
    channel: HTTP.open({
      url: accessServiceURL,
      method: 'POST'
    })
  })
}

/**
 * @param {string} serviceUrl
 */
function getUploadServiceConnection(serviceUrl) {
  const uploadServiceURL = new URL(serviceUrl)
  const uploadServicePrincipal = DID.parse('did:web:staging.web3.storage')

  return connect({
    id: uploadServicePrincipal,
    encoder: CAR,
    decoder: CBOR,
    channel: HTTP.open({
      url: uploadServiceURL,
      method: 'POST'
    })
  })  
}
