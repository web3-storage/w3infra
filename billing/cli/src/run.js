import { mustGetEnv } from '../../functions/lib.js'
import { isValidDate } from './lib.js'

/**
 * Do a billing run.
 *
 * $ billing run 2023-09-01T00:00:00.000Z 2023-10-01T00:00:00.000Z
 *
 * @param {string} rawFrom
 * @param {string} rawTo
 */
export async function billingRun (rawFrom, rawTo) {
  const url = new URL(mustGetEnv('RUNNER_URL'))
  const from = new Date(rawFrom)
  if (!isValidDate(from)) {
    throw new Error('invalid from date')
  }
  const to = new Date(rawTo)
  if (!isValidDate(to)) {
    throw new Error('invalid to date')
  }
  if (from.getTime() >= to.getTime()) {
    throw new Error('from date must be less than to date')
  }

  url.searchParams.set('from', from.toISOString())
  url.searchParams.set('to', to.toISOString())
  console.log(url.toString())

  const res = await fetch(url)
  console.log(res.ok ? { ok: {} } : { error: await res.text() })
}