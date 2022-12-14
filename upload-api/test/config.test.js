import { test } from './helpers/context.js'
import * as configModule from '../config.js'

/** keypair that can be used for testing */
const testKeypair = {
  private: {
    /**
     * Private key encoded as multiformats
     */
    multiformats:
      'MgCYWjE6vp0cn3amPan2xPO+f6EZ3I+KwuN1w2vx57vpJ9O0Bn4ci4jn8itwc121ujm7lDHkCW24LuKfZwIdmsifVysY=',
  },
  public: {
    /**
     * Public key encoded as a did:key
     */
    did: 'did:key:z6MkqBzPG7oNu7At8fktasQuS7QR7Tj7CujaijPMAgzdmAxD',
  },
}

test('getServiceSigner creates a signer using config.PRIVATE_KEY', async (t) => {
  const config = {
    PRIVATE_KEY: testKeypair.private.multiformats,
  }
  const signer = configModule.getServiceSigner(config)
  t.assert(signer)
  t.is(signer.did().toString(), testKeypair.public.did)
  const { keys } = signer.toArchive()
  const didKeys = Object.keys(keys)
  t.deepEqual(didKeys, [testKeypair.public.did])
})

test('getServiceSigner infers DID from config.PRIVATE_KEY when config.UPLOAD_API_DID is omitted', async (t) => {
  const config = {
    PRIVATE_KEY: testKeypair.private.multiformats,
  }
  const signer = configModule.getServiceSigner(config)
  t.assert(signer)
  t.is(signer.did().toString(), testKeypair.public.did)
})

test('getServiceSigner creates a signer using config.{UPLOAD_API_KEY,PRIVATE_KEY}', async (t) => {
  const config = {
    PRIVATE_KEY: testKeypair.private.multiformats,
    UPLOAD_API_DID: 'did:web:exampe.com',
  }
  const principal = configModule.getServiceSigner(config)
  t.assert(principal)
  t.is(principal.did().toString(), config.UPLOAD_API_DID)
})

test('getServiceSigner errors if config.UPLOAD_API_DID is provided but not a DID', (t) => {
  t.throws(() => {
    configModule.getServiceSigner({
      UPLOAD_API_DID: 'not a did',
      PRIVATE_KEY: testKeypair.private.multiformats,
    })
  }, { message: /^Invalid DID/ })
})
