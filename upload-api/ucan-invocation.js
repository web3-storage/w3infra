import * as CAR from '@ucanto/transport/car'
import { CBOR, API } from '@ucanto/core'
import * as Link from 'multiformats/link'
import { fromString as uint8arrayFromString } from 'uint8arrays/from-string'

import {
  BadBodyError,
  BadContentTypeError,
  NoTokenError,
  ExpectedBasicStringError,
  NoValidTokenError,
  NoInvocationFoundForGivenReceiptError,
  NoCarFoundForGivenReceiptError,
} from './errors.js'

export const CONTENT_TYPE = CAR.contentType

export const STREAM_TYPE = {
  WORKFLOW: 'workflow',
  RECEIPT: 'receipt',
}

export { API }

/**
 * @typedef {import('./types').UcanLogCtx} UcanLogCtx
 * @typedef {import('./types').WorkflowCtx} WorkflowCtx
 * @typedef {import('./types').ReceiptBlockCtx} ReceiptBlockCtx
 * @typedef {import('./types').Workflow} Workflow
 * @typedef {import('./types').ReceiptBlock} ReceiptBlock
 */

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {UcanLogCtx} ctx
 */
export async function processUcanLogRequest(request, ctx) {
  const token = getTokenFromRequest(request)
  if (token !== ctx.basicAuth) {
    throw new NoValidTokenError('invalid Authorization credentials provided')
  }

  if (!request.body) {
    throw new BadBodyError('service requests are required to have body')
  }
  const bytes = Buffer.from(request.body, 'base64')

  const contentType = request.headers['content-type'] || ''
  if (contentType === CONTENT_TYPE) {
    const apiRequest = {
      body: bytes,
      headers: {
        'content-type': contentType,
      },
    }
    return await processAgentMessageArchive(apiRequest, ctx)
  }

  throw new BadContentTypeError()
}

/**
 * @param {API.HTTPRequest<API.AgentMessage>} request
 * @param {WorkflowCtx} ctx
 */
export async function processAgentMessageArchive(request, ctx) {
  const agentMessageCar = await CAR.request.decode(request)
  const messageCid = agentMessageCar.root.cid.toString()

  // persist workflow message and its invocations/receipts
  await persistAgentMessageArchive(
    agentMessageCar,
    request,
    ctx.invocationBucket,
    ctx.workflowBucket
  )

  // Process message content
  await Promise.all([
    processMessageInvocations(agentMessageCar.invocations, messageCid, ctx),
    processMessageReceipts(
      [...agentMessageCar.receipts.values()],
      messageCid,
      ctx
    ),
  ])

  return agentMessageCar
}

/**
 * Processes given invocations by adding them to the UCAN Stream.
 *
 * @param {API.Invocation[]} invocations
 * @param {string} carCid
 * @param {WorkflowCtx} ctx
 */
async function processMessageInvocations(invocations, carCid, ctx) {
  if (!invocations.length) {
    return
  }

  await ctx.kinesisClient?.putRecords({
    Records: invocations.map((invocation) => ({
      Data: uint8arrayFromString(
        JSON.stringify({
          carCid,
          value: normalizeInvocation(invocation),
          ts: Date.now(),
          type: STREAM_TYPE.WORKFLOW,
        })
      ),
      // https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
      // A partition key is used to group data by shard within a stream.
      // It is required, and now we are starting with one shard. We need to study best partition key
      PartitionKey: 'key',
    })),
    StreamName: ctx.streamName,
  })
}

/**
 * Processes given receipts by persisting them and adding them to the UCAN Stream.
 *
 * @param {API.Receipt[]} receipts
 * @param {string} carCid
 * @param {import("./types").WorkflowCtx} ctx
 */
async function processMessageReceipts(receipts, carCid, ctx) {
  const tasks = []
  const records = []

  for (const receipt of receipts.values()) {
    const invocationCid = receipt.ran.link().toString()
    // When we implement invocation spec, instruction CID will be different.
    // That combined with the fact that it will be unlikely that invocation blocks will be included with CAR responses,
    // we will not be able to derive instruction CID from receipt itself.
    // We need to discuss / consider what to do about it.
    const taskCid = invocationCid
    const agentMessageWithInvocationCid = await ctx.invocationBucket.getInLink(
      invocationCid
    )

    if (!agentMessageWithInvocationCid) {
      throw new NoCarFoundForGivenReceiptError()
    }

    const agentMessageBytes = await ctx.workflowBucket.get(
      agentMessageWithInvocationCid
    )
    if (!agentMessageBytes) {
      throw new NoCarFoundForGivenReceiptError()
    }

    const agentMessage = await CAR.request.decode({
      body: agentMessageBytes,
      headers: {},
    })
    const invocation = agentMessage.invocations.find(
      (invocation) => invocation.cid.toString() === invocationCid
    )
    if (!invocation) {
      throw new NoInvocationFoundForGivenReceiptError()
    }

    // keep records for UCAN Stream
    records.push({
      carCid,
      invocationCid,
      value: normalizeInvocation(invocation),
      ts: Date.now(),
      type: STREAM_TYPE.RECEIPT,
      out: receipt.out,
    })

    tasks.push(
      // Store Task result
      (async () => {
        const taskResult = await CBOR.write({
          out: receipt.out,
        })
        await ctx.taskBucket.putResult(taskCid, taskResult.bytes)
      })(),
      // Store task invocation link
      ctx.taskBucket.putInvocationLink(taskCid, invocationCid)
    )
  }

  if (!records.length) {
    return
  }

  // Write to stores
  await Promise.all(tasks)

  // write to UCAN Stream
  await ctx.kinesisClient?.putRecords({
    Records: records.map((r) => ({
      Data: uint8arrayFromString(JSON.stringify(r)),
      // https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
      // A partition key is used to group data by shard within a stream.
      // It is required, and now we are starting with one shard. We need to study best partition key
      PartitionKey: 'key',
    })),
    StreamName: ctx.streamName,
  })
}

/**
 * Persist agent message archive with invocations to be handled by the router.
 * Persist symlink per invocation to which workflow they come from.
 *
 * @param {API.AgentMessage} agentMessage
 * @param {API.HTTPRequest} request
 * @param {import('./types').InvocationBucket} invocationStore
 * @param {import('./types').WorkflowBucket} workflowStore
 */
export async function persistAgentMessageArchive(
  agentMessage,
  request,
  invocationStore,
  workflowStore
) {
  const carCid = agentMessage.root.cid.toString()
  const invocations = agentMessage.invocations
  const receipts = [...agentMessage.receipts.values()]

  const tasks = [
    workflowStore.put(carCid, request.body),
    invocations.map((i) => invocationStore.putInLink(i.cid.toString(), carCid)),
    receipts.map((r) =>
      invocationStore.putOutLink(r.ran.link().toString(), carCid)
    ),
  ]

  await Promise.all(tasks)
}

/**
 * @param {API.Invocation} invocation
 * @returns {import('./types').UcanInvocation}
 */
function normalizeInvocation(invocation) {
  return {
    att: invocation.capabilities,
    aud: invocation.audience.did(),
    iss: invocation.issuer.did(),
    cid: invocation.cid.toString(),
  }
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
function getTokenFromRequest(request) {
  const authHeader = request.headers.authorization || ''
  if (!authHeader) {
    throw new NoTokenError('no Authorization header provided')
  }

  const token = parseAuthorizationHeader(authHeader)
  return token
}

/**
 * @param {string} header
 */
function parseAuthorizationHeader(header) {
  if (!header.toLowerCase().startsWith('basic ')) {
    throw new ExpectedBasicStringError('no basic Authorization header provided')
  }

  return header.slice(6)
}

/**
 * @param {any} value
 */
export const replaceAllLinkValues = (value) => {
  // Array with Links?
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (Link.isLink(value[i])) {
        value[i] = toJSON(value[i])
      } else {
        replaceAllLinkValues(value[i])
      }
    }
  }
  // Object with Links?
  else if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (Link.isLink(value[key])) {
        value[key] = toJSON(value[key])
      }
      replaceAllLinkValues(value[key])
    }
  }

  return value
}

/**
 * @template {import('multiformats').UnknownLink} Link
 * @param {Link} link
 */
export const toJSON = (link) =>
  /** @type {import('@web3-storage/upload-api').LinkJSON<Link>} */ ({
    '/': link.toString(),
  })
