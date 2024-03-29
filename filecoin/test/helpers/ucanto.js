import * as Signer from '@ucanto/principal/ed25519'
import * as UcantoClient from '@ucanto/client'
import { Message } from '@ucanto/core'
import * as Server from '@ucanto/server'
import * as CAR from '@ucanto/transport/car'
import { Assert } from '@web3-storage/content-claims/capability'

import { OperationFailed } from './errors.js'
import { mockService } from './mocks.js'

/**
 * @typedef {import('@ucanto/interface').IssuedInvocation} IssuedInvocation
 * @typedef {import('@ucanto/interface').Receipt} Receipt
 * @typedef {import('@ucanto/interface').Tuple<Receipt>} TupleReceipt
 * @typedef {import('@ucanto/interface').Tuple<IssuedInvocation>} TupleIssuedInvocation
 */

const nop = (/** @type {any} */ invCap) => {}

/**
 * @param {any} serviceProvider
 * @param {object} [options]
 * @param {(inCap: any) => void} [options.onCall]
 * @param {boolean} [options.mustFail]
 */
export async function getClaimsServiceServer (serviceProvider, options = {}) {
  const onCall = options.onCall || nop
  const equalsStore = new Map()

  const service = mockService({
    assert: {
      equals: Server.provide(Assert.equals, async ({ capability, invocation }) => {
        const invCap = invocation.capabilities[0]
        const { content, equals } = capability.nb

        if (options.mustFail) {
          return {
            error: new OperationFailed(
              'failed to add to aggregate',
              // @ts-ignore wrong dep
              invCap.nb?.content
            )
          }
        }

        equalsStore.set(content.toString(), equals.toString())
        equalsStore.set(equals.toString(), content.toString())

        onCall(invCap)

        return {
          ok: {}
        }
      })
    }
  })

  const server = Server.create({
    id: serviceProvider,
    service,
    codec: CAR.inbound,
    validateAuthorization: () => ({ ok: {} })
  })
  const connection = UcantoClient.connect({
    id: serviceProvider,
    codec: CAR.outbound,
    channel: server,
  })

  return {
    service,
    connection
  }
}

export async function getServiceCtx () {
  const storefront = await Signer.generate()
  const aggregator = await Signer.generate()
  const claims = await Signer.generate()
  
  return {
    storefront: {
      did: storefront.did(),
      privateKey: Signer.format(storefront),
      raw: storefront
    },
    aggregator: {
      did: aggregator.did(),
      privateKey: Signer.format(aggregator),
      raw: aggregator
    },
    claims: {
      did: claims.did(),
      privateKey: Signer.format(claims),
      raw: claims
    }
  }
}


/**
 * @param {object} source
 * @param {IssuedInvocation[]} [source.invocations]
 * @param {Receipt[]} [source.receipts]
 */
export const encodeAgentMessage = async (source) => {
  const message = await Message.build({
    invocations: /** @type {TupleIssuedInvocation} */ (
      source.invocations
    ),
    receipts: /** @type {TupleReceipt} */ (source.receipts),
  })

  return CAR.request.encode(message)
}

/**
 * @param {import('@ucanto/interface').Principal} audience
 */
export async function createSpace (audience) {
  const space = await Signer.generate()
  const spaceDid = space.did()

  return {
    proof: await UcantoClient.delegate({
      issuer: space,
      audience,
      capabilities: [{ can: '*', with: spaceDid }]
    }),
    spaceDid
  }
}
