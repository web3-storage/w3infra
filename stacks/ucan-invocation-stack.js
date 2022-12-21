import {
  Bucket,
  Function,
  KinesisStream,
  Queue,
  use
} from '@serverless-stack/resources'
import { Duration } from 'aws-cdk-lib'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'

import { BusStack } from './bus-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { getBucketConfig, setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function UcanInvocationStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'ucan-invocation'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get eventBus reference
  const { eventBus } = use(BusStack)
  const { spaceUploadCountTable } = use(UploadDbStack)

  const ucanBucket = new Bucket(stack, 'ucan-store', {
    cors: true,
    cdk: {
      bucket: getBucketConfig('ucan-store', app.stage)
    }
  })

  // Trigger ucan store events when a CAR is put into the bucket.
  const ucanPutEventConsumer = new Function(stack, 'ucan-consumer', {
    environment: {
      EVENT_BUS_ARN: eventBus.eventBusArn,
    },
    permissions: [eventBus],
    handler: 'functions/ucan-bucket-event.ucanBucketConsumer',
  })
  ucanBucket.addNotifications(stack, {
    newCarPut: {
      function: ucanPutEventConsumer,
      events: ['object_created_put'],
    }
  })

  const spaceUploadCountDLQ = new Queue(stack, 'space-upload-count-dlq')
  const spaceUploadCountConsumer = new Function(stack, 'space-upload-count-consumer', {
    environment: {
      TABLE_NAME: spaceUploadCountTable.tableName
    },
    permissions: [spaceUploadCountTable],
    handler: 'functions/space-upload-count.consumer',
    deadLetterQueue: spaceUploadCountDLQ.cdk.queue
  })

  // create a kinesis stream
  const ucanStream = new KinesisStream(stack, 'ucan-stream', {
    cdk: {
      stream: {
        retentionPeriod: Duration.days(365),
      }
    },
    consumers: {
      spaceUploadCountConsumer: {
        function: spaceUploadCountConsumer,
        cdk: {
          eventSource: {
            ...KINESIS_EVENT_SOURCE_CONFIG
          }
        }
      }
    },
  })

  return {
    ucanBucket,
    ucanStream
  }
}

const KINESIS_EVENT_SOURCE_CONFIG = {
  // Dynamo Transactions allow up to 100 writes per transactions. If we allow 10 capabilities executed per request, we can have up to 100.
  // TODO: we use bisectBatchOnError, so maybe we can attempt bigger batch sizes to be optimistic?
  batchSize: 10,
  // The maximum amount of time to gather records before invoking the function.
  maxBatchingWindow: Duration.minutes(2),
  // If the function returns an error, split the batch in two and retry.
  bisectBatchOnError: true,
  // Where to begin consuming the stream.
  startingPosition: StartingPosition.TRIM_HORIZON
}
