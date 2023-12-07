import { testConsumerWithBucket as test } from '../helpers/context.js'

import { CBOR, CAR } from '@ucanto/core'
import * as Signer from '@ucanto/principal/ed25519'
import * as DealerCapabilities from '@web3-storage/capabilities/filecoin/dealer'
import * as StoreCapabilities from '@web3-storage/capabilities/store'
import { randomAggregate } from '@web3-storage/filecoin-api/test'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { Piece } from '@web3-storage/data-segment'

import { updateAggregateOfferTotal } from '../../filecoin.js'

import { adminMetricsTableProps } from '../../tables/index.js'
import { createFilecoinMetricsTable } from '../../stores/filecoin-metrics.js'
import { createWorkflowStore } from '../../buckets/workflow-store.js'
import { METRICS_NAMES, STREAM_TYPE } from '../../constants.js'

import {
  createDynamodDb,
  createS3,
  createBucket,
} from '../helpers/resources.js'
import { randomCAR } from '../helpers/random.js'
import { createDynamoTable, getItemFromTable} from '../helpers/tables.js'
import { encodeAgentMessage, createSpace } from '../helpers/ucanto.js'

const REGION = 'us-west-2'

/**
 * @typedef {import('@web3-storage/data-segment').PieceLink} PieceLink
 * @typedef {import('@web3-storage/data-segment').AggregateView} AggregateView
 */

test.before(async t => {
  // Dynamo DB
  const {
    client: dynamo,
    endpoint: dbEndpoint
  } = await createDynamodDb({ port: 8000 })
  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo

  // S3
  const { client, clientOpts } = await createS3()
  t.context.s3 = client
  t.context.s3Opts = clientOpts
})

test('handles a batch of single invocation with aggregate/offer', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, bucketName, t.context.s3Opts)

  // Generate aggregate for test
  const { pieces, aggregate } = await randomAggregate(100, 128)
  const aggregateOffers = [{ pieces, aggregate }]
  const workflows = [aggregateOffers]

  // Get UCAN Stream Invocations
  const ucanStreamInvocations = await prepareUcanStream(workflows, {
    bucketName,
    s3: t.context.s3
  })

  // @ts-expect-error not expecting type with just `aggregate/offer`
  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    filecoinMetricsStore
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_TOTAL)
  t.is(aggregateOfferTotal?.value, aggregateOffers.length)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.truthy(aggregateOfferPiecesTotal)
  t.is(aggregateOfferPiecesTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL)
  t.is(aggregateOfferPiecesTotal?.value, pieces.length)

  const piecesSize = pieces.reduce((acc, p) => {
    return acc + Piece.fromLink(p.link).size
  }, 0n)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.truthy(aggregateOfferPiecesSizeTotal)
  t.is(aggregateOfferPiecesSizeTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL)
  t.is(aggregateOfferPiecesSizeTotal?.value, Number(piecesSize))
})

test('handles a batch of single invocation with multiple aggregate/offer attributes', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, bucketName, t.context.s3Opts)

  // Generate aggregate for test
  const aggregateOffers = await Promise.all([
    randomAggregate(50, 128),
    randomAggregate(50, 128)
  ])
  const workflows = [aggregateOffers]

  // Get UCAN Stream Invocations
  const ucanStreamInvocations = await prepareUcanStream(workflows, {
    bucketName,
    s3: t.context.s3
  })

  // @ts-expect-error not expecting type with just `aggregate/offer`
  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    filecoinMetricsStore
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_TOTAL)
  t.is(aggregateOfferTotal?.value, aggregateOffers.length)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.truthy(aggregateOfferPiecesTotal)
  t.is(aggregateOfferPiecesTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL)
  t.is(aggregateOfferPiecesTotal?.value, aggregateOffers.reduce((acc, ao) => {
    return acc + ao.pieces.length
  }, 0))

  const piecesSize = aggregateOffers.reduce((acc, ao) => {
    return acc + ao.pieces.reduce((acc, p) => {
      return acc + Piece.fromLink(p.link).size
    }, 0n)
  }, 0n)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.truthy(aggregateOfferPiecesSizeTotal)
  t.is(aggregateOfferPiecesSizeTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL)
  t.is(aggregateOfferPiecesSizeTotal?.value, Number(piecesSize))
})

test('handles a batch of multiple invocations with single aggregate/offer attribute', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, bucketName, t.context.s3Opts)

  // Generate aggregate for test
  const aggregateOffers = await Promise.all([
    randomAggregate(50, 128),
    randomAggregate(50, 128)
  ])
  const workflows = aggregateOffers.map(ao => [ao])

  // Get UCAN Stream Invocations
  const ucanStreamInvocations = await prepareUcanStream(workflows, {
    bucketName,
    s3: t.context.s3
  })

  // @ts-expect-error not expecting type with just `aggregate/offer`
  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    filecoinMetricsStore
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_TOTAL)
  t.is(aggregateOfferTotal?.value, aggregateOffers.length)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.truthy(aggregateOfferPiecesTotal)
  t.is(aggregateOfferPiecesTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL)
  t.is(aggregateOfferPiecesTotal?.value, aggregateOffers.reduce((acc, ao) => {
    return acc + ao.pieces.length
  }, 0))

  const piecesSize = aggregateOffers.reduce((acc, ao) => {
    return acc + ao.pieces.reduce((acc, p) => {
      return acc + Piece.fromLink(p.link).size
    }, 0n)
  }, 0n)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.truthy(aggregateOfferPiecesSizeTotal)
  t.is(aggregateOfferPiecesSizeTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL)
  t.is(aggregateOfferPiecesSizeTotal?.value, Number(piecesSize))
})

test('handles a batch of single invocation without aggregate/offer', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, bucketName, t.context.s3Opts)

  // Get unrelated invocation
  const uploadService = await Signer.generate()
  const car = await randomCAR(128)
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const ucanStreamInvocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          StoreCapabilities.add.create({
            with: spaceDid,
            nb: {
              link: car.cid,
              size: car.size
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error not expecting type with just `aggregate/offer`
  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    filecoinMetricsStore
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_TOTAL)
  t.is(aggregateOfferTotal?.value, 0)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.truthy(aggregateOfferPiecesTotal)
  t.is(aggregateOfferPiecesTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL)
  t.is(aggregateOfferPiecesTotal?.value, 0)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.truthy(aggregateOfferPiecesSizeTotal)
  t.is(aggregateOfferPiecesSizeTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL)
  t.is(aggregateOfferPiecesSizeTotal?.value, 0)
})

/**
 * @param {{pieces: { link: PieceLink }[], aggregate: AggregateView }[][]} workflows
 * @param {{ bucketName: string, s3: import('@aws-sdk/client-s3').S3Client }} ctx
 */
async function prepareUcanStream (workflows, ctx) {
  const w3sService = await Signer.generate()

  return Promise.all(workflows.map(async aggregateOffers => {
    const invocationsToExecute = await Promise.all(aggregateOffers.map(async agg => {
      const offer = agg.pieces.map((p) => p.link)
      const piecesBlock = await CBOR.write(offer)

      // Create UCAN invocation workflow
      const invocationParameters = {
        aggregate: agg.aggregate.link,
        pieces: piecesBlock.cid,
      }
      const invocation = DealerCapabilities.aggregateOffer.invoke({
        issuer: w3sService,
        audience: w3sService,
        with: w3sService.did(),
        nb: invocationParameters
      })
      invocation.attach(piecesBlock)

      return {
        invocation,
        params: invocationParameters
      }
    }))

    const request = await encodeAgentMessage({ invocations: invocationsToExecute.map(ie => ie.invocation) })
    const body = new Uint8Array(request.body.buffer)
    // Decode request to get CAR CID
    const decodedCar = CAR.decode(body)
    const agentMessageCarCid = decodedCar.roots[0].cid.toString()

    // Store UCAN invocation workflow
    const putObjectCmd = new PutObjectCommand({
      Key: `${agentMessageCarCid}/${agentMessageCarCid}`,
      Bucket: ctx.bucketName,
      Body: body
    })
    await ctx.s3.send(putObjectCmd)

    // Create UCAN Stream Invocation
    return {
      carCid: agentMessageCarCid,
      value: {
          att: invocationsToExecute.map(ie => DealerCapabilities.aggregateOffer.create({
            with: w3sService.did(),
            nb: ie.params
          })),
          aud: w3sService.did(),
          iss: w3sService.did()
      },
      type: STREAM_TYPE.RECEIPT,
      out: {
        ok: true
      },
      ts: Date.now()
    }
  }))
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 */
async function prepareResources (dynamoClient, s3Client) {
  const [ tableName, bucketName ] = await Promise.all([
    createDynamoTable(dynamoClient, adminMetricsTableProps),
    createBucket(s3Client)
  ])

  return {
    bucketName,
    tableName
  }
}
