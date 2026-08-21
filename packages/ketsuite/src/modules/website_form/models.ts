import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  Form: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      name: 'text',
      schema: 'json',
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
