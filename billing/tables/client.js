import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall, convertToAttr } from '@aws-sdk/util-dynamodb'
import retry from 'p-retry'
import { RecordNotFound, StoreOperationFailure } from './lib.js'

/** @param {{ region: string } | DynamoDBClient} target */
export const connectTable = target =>
  target instanceof DynamoDBClient
    ? target
    : new DynamoDBClient(target)

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../lib/api').Validator<T>} context.validate
 * @param {import('../lib/api').Encoder<T, import('../lib/api').StoreRecord>} context.encode
 * @returns {import('../lib/api').StorePutter<T>}
 */
export const createStorePutterClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    put: async (record) => {
      const validation = context.validate(record)
      if (validation.error) return validation

      const encoding = context.encode(record)
      if (encoding.error) return encoding

      const cmd = new PutItemCommand({
        TableName: context.tableName,
        Item: marshall(encoding.ok)
      })

      try {
        await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status putting item to table: ${res.$metadata.httpStatusCode}`)
          }
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
        return { ok: {} }
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message) }
      }
    }
  }
}

/**
 * @template {object} K
 * @template V
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../lib/api').Encoder<K, import('../lib/api').StoreRecord>} context.encodeKey
 * @param {import('../lib/api').Decoder<import('../lib/api').StoreRecord, V>} context.decode
 * @returns {import('../lib/api').StoreGetter<K, V>}
 */
export const createStoreGetterClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    get: async (key) => {
      const encoding = context.encodeKey(key)
      if (encoding.error) return encoding

      const cmd = new GetItemCommand({
        TableName: context.tableName,
        Key: marshall(encoding.ok)
      })

      let res
      try {
        res = await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status getting item from table: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message) }
      }

      if (!res.Item) {
        return { error: new RecordNotFound(key) }
      }

      return context.decode(unmarshall(res.Item))
    }
  }
}

/**
 * @template {object} K
 * @template V
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../lib/api').Encoder<K, import('../lib/api').StoreRecord>} context.encodeKey
 * @param {import('../lib/api').Decoder<import('../lib/api').StoreRecord, V>} context.decode
 * @param {string} [context.indexName]
 * @returns {import('../lib/api').StoreLister<K, V>}
 */
export const createStoreListerClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    list: async (key, options) => {
      const encoding = context.encodeKey(key)
      if (encoding.error) return encoding

      /** @type {Record<string, import('@aws-sdk/client-dynamodb').Condition>} */
      const conditions = {}
      for (const [k, v] of Object.entries(key)) {
        conditions[k] = {
          ComparisonOperator: 'EQ',
          AttributeValueList: [convertToAttr(v)]
        }
      }

      const cmd = new QueryCommand({
        TableName: context.tableName,
        IndexName: context.indexName,
        Limit: options?.size ?? 100,
        KeyConditions: conditions,
        ExclusiveStartKey: options?.cursor
          ? marshall(JSON.parse(options.cursor))
          : undefined
      })

      let res
      try {
        res = await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status listing table content: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message) }
      }
  
      const results = []
      for (const item of res.Items ?? []) {
        const decoding = context.decode(unmarshall(item))
        if (decoding.error) return decoding
        results.push(decoding.ok)
      }
      const lastKey = res.LastEvaluatedKey && unmarshall(res.LastEvaluatedKey)
      const cursor = lastKey && JSON.stringify(lastKey)
  
      return { ok: { cursor, results } }
    }
  }
}
