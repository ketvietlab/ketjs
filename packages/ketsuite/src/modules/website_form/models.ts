import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Form: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      name: 'text',
      schema: 'json',
      /**
       * Bumped whenever the field contract changes. A form page rendered against
       * version 3 must not be validated against version 4: the visitor would be
       * told a field they were never shown is required. Optional so that forms
       * created before versioning existed read as version 1.
       */
      schemaVersion: 'int?',
      /**
       * The privacy notice shown beside the consent box. Part of the versioned
       * contract, not a separate one: a bare `consent: true` records that
       * someone ticked a box without recording which text they agreed to, so
       * changing the notice would silently reinterpret every earlier consent.
       */
      consentText: 'text?',
      successMessage: 'text',
      notifyTo: 'text?',
      active: 'bool',
    },
    indexes: { site_name: { fields: ['companyId', 'siteId', 'name'], unique: true } },
  },
  FormSubmission: {
    scope: 'company',
    fields: {
      id: 'id',
      formId: 'ref:website_form.Form',
      payload: 'json',
      /** Which field contract this payload was accepted against. */
      schemaVersion: 'int?',
      /**
       * The exact notice this visitor agreed to, copied at the moment they
       * agreed. A Form is one mutable row with no history, so the version alone
       * cannot be resolved back to any text once the notice is edited — and a
       * consent record that cannot say what was consented to is not a record.
       */
      consentText: 'text?',
      consent: 'bool',
      status: 'text',
      source: 'text?',
      fingerprint: 'text?',
      dedupeKey: 'text?',
      createdAt: 'datetime',
    },
    indexes: {
      form_created: { fields: ['companyId', 'formId', 'createdAt'] },
      form_status: { fields: ['companyId', 'formId', 'status'] },
      form_dedupe: { fields: ['companyId', 'formId', 'dedupeKey'], unique: true },
    },
  },
  FormRateLimit: {
    scope: 'company',
    fields: {
      id: 'id',
      key: 'text',
      windowStartedAt: 'datetime',
      count: 'int',
    },
    indexes: { key: { fields: ['companyId', 'key'], unique: true } },
  },
}
