export const UCAN_STORE_EVENT_BRIDGE_SOURCE_EVENT = 'ucan_store_bucket'

/**
 * @typedef {{ detail: {key?: string, region: string, bucketName: string}}} EventBridgeEvent
 */

/**
 * @param {import('aws-lambda').S3Event} event
 * @param {import('@aws-sdk/client-eventbridge').EventBridge} eventBridge
 * @param {string} eventBusName
 */
 export async function notifyBus(event, eventBridge, eventBusName) {
  const s3Events = event.Records
    ? event.Records.map((r) => ({
        key: r?.s3?.object?.key,
        region: r?.awsRegion || 'us-west-2',
        bucketName: r?.s3?.bucket?.name,
      // only notify target subscribers for CAR files
      })).filter((entry) => entry.key && entry.key.endsWith('.car'))
    : []

  if (s3Events.length > 0) {
    const feedbackEntries = s3Events.map((s3Event) => ({
      EventBusName: eventBusName,
      Source: UCAN_STORE_EVENT_BRIDGE_SOURCE_EVENT,
      DetailType: 'ucan_car_added',
      Detail: JSON.stringify(s3Event),
    }))
    await eventBridge.putEvents({ Entries: feedbackEntries })
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: `File was added to s3 bucket`,
  }
}
