/**
 * @typedef {import('@web3-storage/upload-api/types').TasksScheduler} TasksSchedulerInterface
 * @typedef {import('@web3-storage/upload-api/types').Service} Service
 * @typedef {import('@ucanto/interface').ConnectionView<Service>} Connection
 * @typedef {import('@ucanto/interface').ServiceInvocation} ServiceInvocation
 * @typedef {import('@ucanto/interface').Failure} Failure
 * @typedef {import('@ucanto/interface').Unit} Unit
 * @typedef {import('@ucanto/interface').Result<Unit, Failure>} Result
 */

/**
 * @param {() => Connection} getServiceConnection 
 */
export const createTasksScheduler = (getServiceConnection) => new TasksScheduler(getServiceConnection)

/**
 * @implements {TasksSchedulerInterface}
 */
export class TasksScheduler {
  /**
   * 
   * @param {() => Connection} getServiceConnection 
   */
  constructor (getServiceConnection) {
    this.getServiceConnection = getServiceConnection
  }

  /**
   * @param {ServiceInvocation} invocation
   * @returns {Promise<Result>}
   */
  async schedule(invocation) {
    const connection = this.getServiceConnection()
    const [res] = await connection.execute(invocation)

    if (res.out.error) {
      return res.out
    }
    return {
      ok: {},
    }
  }
}
