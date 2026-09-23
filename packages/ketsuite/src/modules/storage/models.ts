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
      /** Worker-owned projection; the canonical storeKey always remains private/default. */
      publicStoreKey: 'text?',
      mimetype: 'text',
      size: 'int',
      checksum: 'text?',
      public: 'bool',
      createdAt: 'datetime',
    },
  },

  /**
   * A smaller WebP copy of a stored image, made by the `storage.render` job after
   * upload. Worker-owned like `publicStoreKey`: nothing but the job writes one, and
   * a missing rendition only means the original is served in its place.
   */
  AttachmentRendition: {
    scope: 'company',
    fields: {
      id: 'id',
      attachmentId: 'ref:storage.Attachment',
      /** One of RENDITION_SIZES' names (policy.ts). */
      size: 'text',
      storeKey: 'text',
      mimetype: 'text',
      width: 'int',
      height: 'int',
      bytes: 'int',
      createdAt: 'datetime',
    },
    indexes: { attachment_size: { fields: ['attachmentId', 'size'], unique: true } },
  },
}
