/** @typedef {import('@serverless-stack/resources').TableProps} TableProps */

/** @type TableProps */
export const spaceUploadCountTableProps = {
  fields: {
    space: 'string',        // `did:key:space`
    count: 'number',         // `101`
  },
  // space must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space' },
}
