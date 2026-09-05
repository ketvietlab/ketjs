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
      /**
       * Which answers may appear in a list of submissions, by field name.
       *
       * Deliberately not part of `schema`, and so deliberately not part of the
       * version: marking a field as safe to preview changes nothing a visitor
       * sees, and versioning it would invalidate every page open against the
       * form for an internal decision. It is also applied as it stands now
       * rather than as it stood at collection time — someone who realises today
       * that a field holds personal data expects yesterday's rows to be covered
       * by that realisation, not exempt from it.
       */
      summaryFields: 'json?',
      /**
       * How long the answers are kept, in days.
       *
       * Absent means kept until someone says otherwise. That is the honest
       * default: a form that has never been given a retention period has not
       * been thought about, and quietly erasing its submissions on a number
       * this module invented would destroy records nobody agreed to lose.
       */
      retentionDays: 'int?',
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
      /**
       * When the answers were erased, and why they were kept past their date.
       *
       * A hold is a reason rather than a flag so that the row says who is
       * relying on it. Retention skips a held row for as long as the reason
       * stands; clearing the reason puts it back in the ordinary queue rather
       * than erasing it on the spot.
       */
      purgedAt: 'datetime?',
      holdReason: 'text?',
      heldBy: 'text?',
      heldAt: 'datetime?',
    },
    indexes: {
      form_created: { fields: ['companyId', 'formId', 'createdAt'] },
      form_status: { fields: ['companyId', 'formId', 'status'] },
      form_dedupe: { fields: ['companyId', 'formId', 'dedupeKey'], unique: true },
      /** Retention reads by age across every form in a company, not per form. */
      retention: { fields: ['companyId', 'purgedAt', 'createdAt'] },
    },
  },
  /**
   * Who looked, who exported, who erased.
   *
   * Append-only, and separate from the submission it describes: the point of
   * the record is that it survives the erasure of what it describes, so it
   * cannot live on that row. It is a site-content record rather than an
   * identity one, which is why it stays in this module instead of borrowing
   * `user.SecurityAudit` and dragging a dependency on `user` behind it.
   */
  FormSubmissionAudit: {
    scope: 'company',
    fields: {
      id: 'id',
      formId: 'ref:website_form.Form',
      /** Null for an action over a set: an export, or a retention pass. */
      submissionId: 'text?',
      /** read | export | purge | hold | release */
      action: 'text',
      /** The acting user, or `system` for a scheduled pass with no actor. */
      actorKey: 'text',
      /** Exactly which answers left the system, for an export. */
      fields: 'json?',
      rowCount: 'int?',
      reason: 'text?',
      occurredAt: 'datetime',
    },
    indexes: {
      form_occurred: { fields: ['companyId', 'formId', 'occurredAt'] },
      submission: { fields: ['companyId', 'submissionId'] },
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
