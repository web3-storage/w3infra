import { fetch } from '@web-std/fetch'
import { createRequire } from 'module'
import git from 'git-rev-sync'

import { test } from './helpers/context.js'
import { stage } from './helpers/deployment.js'
import { getClient } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'

const DUDEWHERE_CF_BUCKET_PUBLIC_URL = 'https://pub-d01596b464514cb28ca394eaa41cdbdc.r2.dev'

test('GET /', async t => {
  const apiEndpoint = getApiEndpoint()
  const response = await fetch(apiEndpoint)
  t.is(response.status, 200)
})

test('GET /version', async t => {
  const apiEndpoint = getApiEndpoint()

  const response = await fetch(`${apiEndpoint}/version`)
  t.is(response.status, 200)

  const body = await response.json()
  t.is(body.env, stage)
  t.is(body.commit, git.long('.'))
})

test('POST / client can upload a file and list it', async t => {
  const apiEndpoint = getApiEndpoint()
  const client = await getClient(apiEndpoint)
  const file = await randomFile(100)
  const shards = []

  // Upload new file
  const fileLink = await client.uploadFile(file, {
    onShardStored: (meta) => {
      shards.push(meta.cid)
    }
  })
  t.truthy(fileLink)
  t.is(shards.length, 1)

  // Test Dudewhere
  console.log('fileLink', fileLink.toString())
  console.log('url', `${DUDEWHERE_CF_BUCKET_PUBLIC_URL}/${fileLink.toString()}/${shards[0].toString()}`)
  // const dudeWhereRequest = await fetch(
  //   `${DUDEWHERE_CF_BUCKET_PUBLIC_URL}/${fileLink.toString()}/${shards[0].toString()}`
  // )
  console.log('sha', shards)

  // List space files
  let uploadFound, cursor
  do {
    const listResult = await client.capability.upload.list({
      size: 5,
      cursor
    })
    uploadFound = listResult.results.find(upload => upload.root.equals(fileLink))
    cursor = listResult.cursor
  } while (!uploadFound)

  t.is(uploadFound.shards?.length, 1)
  t.deepEqual(shards, uploadFound.shards)

  // Remove file from space
  const removeResult = await client.capability.upload.remove(fileLink)
  t.falsy(removeResult?.error)
})

const getApiEndpoint = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    return `https://${stage}.up.web3.storage`
  }

  const require = createRequire(import.meta.url)
  const sst = require('../sst.json')
  const testEnv = require('../.test-env.json')

  // Get Upload API endpoint
  const id = 'UploadApiStack'
  return testEnv[`${stage}-${sst.name}-${id}`].ApiEndpoint
}