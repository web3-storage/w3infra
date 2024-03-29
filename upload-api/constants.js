import { 
  add as storeAdd,
  remove as storeRemove
} from '@web3-storage/capabilities/store'
import {
  add as uploadAdd,
  remove as uploadRemove
} from '@web3-storage/capabilities/upload'

// UCAN protocol
export const STORE_ADD = storeAdd.can
export const STORE_REMOVE = storeRemove.can
export const UPLOAD_ADD = uploadAdd.can
export const UPLOAD_REMOVE = uploadRemove.can

// Admin Metrics
export const METRICS_NAMES = {
  UPLOAD_ADD_TOTAL: `${UPLOAD_ADD}-total`,
  UPLOAD_REMOVE_TOTAL: `${UPLOAD_REMOVE}-total`,
  STORE_ADD_TOTAL: `${STORE_ADD}-total`,
  STORE_ADD_SIZE_TOTAL: `${STORE_ADD}-size-total`,
  STORE_REMOVE_TOTAL: `${STORE_REMOVE}-total`,
  STORE_REMOVE_SIZE_TOTAL: `${STORE_REMOVE}-size-total`,
}

// Space Metrics
export const SPACE_METRICS_NAMES = {
  UPLOAD_ADD_TOTAL: `${UPLOAD_ADD}-total`,
  UPLOAD_REMOVE_TOTAL: `${UPLOAD_REMOVE}-total`,
  STORE_ADD_TOTAL: `${STORE_ADD}-total`,
  STORE_ADD_SIZE_TOTAL: `${STORE_ADD}-size-total`,
  STORE_REMOVE_TOTAL: `${STORE_REMOVE}-total`,
  STORE_REMOVE_SIZE_TOTAL: `${STORE_REMOVE}-size-total`,
}
