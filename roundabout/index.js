import { getSignedUrl as getR2SignedUrl } from "@aws-sdk/s3-request-presigner"
import { GetObjectCommand } from "@aws-sdk/client-s3"

/**
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 * @typedef {import('@aws-sdk/types').RequestPresigningArguments} RequestPresigningArguments
 */

/**
 * @param {S3Client} s3Client
 * @param {string} bucketName 
 */
export function getSigner (s3Client, bucketName) {
  return {
    /**
     * 
     * @param {string} key
     * @param {RequestPresigningArguments} [options]
     */
    getUrl: async (key, options) => {
      const signedUrl = await getR2SignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key
        }),
        options
      )

      return signedUrl
    }
  }
}
