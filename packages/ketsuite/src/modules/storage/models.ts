import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  /** Metadata is transactional; bytes live behind the Storage contract. */
  Attachment: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      resModel: 'text?',
      /** Polymorphic target ids cannot be a ref because resModel selects the table. */
      resId: 'text?',
      resField: 'text?',
      kind: 'text',
      url: 'text?',
      storeKey: 'text?',
      mimetype: 'text',
      size: 'int',
      checksum: 'text?',
      public: 'bool',
      createdAt: 'datetime',
    },
  },
}
