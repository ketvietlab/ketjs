import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Setup: {
    scope: 'company',
    fields: {
      id: 'id',
      countryCode: 'text',
      standard: 'text',
      legalBasis: 'text',
      sourceChecksum: 'text',
      accountingTimezone: 'text?',
      moneyPolicyVersion: 'text?',
      installedAt: 'datetime',
    },
    indexes: { company: { fields: ['companyId'], unique: true } },
  },
  /**
   * The accounts a document falls back to when nothing more specific applies.
   *
   * One row per company. Without it every invoice asked the person writing it to
   * name a revenue account and a receivable account out of the whole chart —
   * a question the chart itself already answers the same way every time.
   */
  Defaults: {
    scope: 'company',
    fields: {
      id: 'id',
      incomeAccountId: 'ref:account.Account?',
      expenseAccountId: 'ref:account.Account?',
      receivableAccountId: 'ref:account.Account?',
      payableAccountId: 'ref:account.Account?',
    },
    indexes: { company: { fields: ['companyId'], unique: true } },
  },
  /**
   * What a product category posts to, per company.
   *
   * The catalogue is shared across every company in the tenant while a chart of
   * accounts belongs to one, so the mapping cannot live on the category itself —
   * two companies file the same category against different accounts.
   */
  CategoryAccount: {
    scope: 'company',
    fields: {
      id: 'id',
      categoryId: 'ref:product.Category',
      incomeAccountId: 'ref:account.Account?',
      expenseAccountId: 'ref:account.Account?',
    },
    indexes: { company_category: { fields: ['companyId', 'categoryId'], unique: true } },
  },
  Account: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      /** The statutory English name, when the account came from a bundled catalog. */
      nameEn: 'text?',
      accountType: 'text',
      reconcile: 'bool',
      active: 'bool',
    },
    indexes: { company_code: { fields: ['companyId', 'code'], unique: true } },
  },
  Journal: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      code: 'text',
      type: 'text',
      defaultAccountId: 'ref:account.Account?',
      sequenceNumber: 'int',
      active: 'bool',
    },
    indexes: { company_code: { fields: ['companyId', 'code'], unique: true } },
  },
  Tax: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      description: 'text?',
      typeTaxUse: 'text',
      /**
       * Reserved. Nothing computes with it yet — a tax is chosen on the line, not
       * derived from what the product is — so it is no longer offered on the form.
       * The column stays because dropping it is a destructive migration for a value
       * that costs nothing to keep.
       */
      taxScope: 'text?',
      amountType: 'text',
      amount: 'decimal',
      priceInclude: 'bool',
      includeBaseAmount: 'bool',
      accountId: 'ref:account.Account?',
      sequence: 'int',
      active: 'bool',
    },
  },
  /**
   * The default sales tax of a shared product in one legal entity.
   *
   * Tax belongs to a company's chart while the product template is shared, so
   * the mapping cannot live on `product.Template` without leaking one company's
   * accounting setup into another.
   */
  ProductTax: {
    scope: 'company',
    fields: {
      id: 'id',
      templateId: 'ref:product.Template',
      taxId: 'ref:account.Tax',
    },
    indexes: { company_template: { fields: ['companyId', 'templateId'], unique: true } },
  },
  PaymentTerm: {
    scope: 'company',
    fields: { id: 'id', name: 'text', note: 'text?', active: 'bool' },
  },
  PaymentTermLine: {
    scope: 'company',
    fields: {
      id: 'id',
      paymentId: 'ref:account.PaymentTerm',
      value: 'text',
      valueAmount: 'decimal',
      delayType: 'text',
      nbDays: 'int',
      daysNextMonth: 'int?',
      sequence: 'int',
    },
  },
  Move: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      ref: 'text?',
      date: 'datetime',
      /** Civil day that owns the sequence, period and report cutoff. */
      accountingDate: 'date?',
      /** Civil date printed on or received with the source document. */
      documentDate: 'date?',
      moveType: 'text',
      state: 'text',
      journalId: 'ref:account.Journal',
      partnerId: 'ref:partner.Partner?',
      invoiceDate: 'datetime?',
      invoiceDateDue: 'datetime?',
      paymentTermId: 'ref:account.PaymentTerm?',
      paymentState: 'text',
      currency: 'text',
      amountUntaxed: 'decimal',
      amountTax: 'decimal',
      amountTotal: 'decimal',
      /** Exact-money policy frozen with the move for reproducible reporting. */
      moneyPolicyVersion: 'text?',
      postedAt: 'datetime?',
      /** Source move for a correction entry; immutable once the reversal is reserved. */
      reversalOfId: 'ref:account.Move?',
      /** The one correction reserved for this move, including an in-progress retry. */
      reversedById: 'ref:account.Move?',
      /** Durable reversal progress: creating, posted, reconciling or completed. */
      reversalStatus: 'text?',
      /** Optimistic token for commands that must claim an invoice before writing. */
      revision: 'int?',
    },
    indexes: { journal_name: { fields: ['companyId', 'journalId', 'name'], unique: true } },
  },
  MoveLine: {
    scope: 'company',
    fields: {
      id: 'id',
      moveId: 'ref:account.Move',
      name: 'text',
      accountId: 'ref:account.Account',
      partnerId: 'ref:partner.Partner?',
      productId: 'ref:product.Product?',
      productUomId: 'ref:uom.Unit?',
      quantity: 'decimal',
      priceUnit: 'decimal',
      discount: 'decimal',
      taxId: 'ref:account.Tax?',
      debit: 'decimal',
      credit: 'decimal',
      balance: 'decimal',
      dateMaturity: 'datetime?',
      displayType: 'text?',
      reconciled: 'bool',
      amountResidual: 'decimal',
      sequence: 'int',
    },
  },
  PartialReconcile: {
    scope: 'company',
    fields: {
      id: 'id',
      debitMoveId: 'ref:account.MoveLine',
      creditMoveId: 'ref:account.MoveLine',
      amount: 'decimal',
      date: 'datetime',
    },
    indexes: { pair: { fields: ['companyId', 'debitMoveId', 'creditMoveId'] } },
  },
  Payment: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      paymentType: 'text',
      partnerType: 'text',
      partnerId: 'ref:partner.Partner?',
      journalId: 'ref:account.Journal',
      destinationAccountId: 'ref:account.Account',
      amount: 'decimal',
      date: 'datetime',
      accountingDate: 'date?',
      documentDate: 'date?',
      memo: 'text?',
      paymentReference: 'text?',
      state: 'text',
      currency: 'text',
      moneyPolicyVersion: 'text?',
      moveId: 'ref:account.Move?',
      /** Open item selected by the original command; immutable idempotency evidence. */
      reconcileLineId: 'ref:account.MoveLine?',
      /** The invoice this payment was collected for, when it was registered as an aggregate. */
      invoiceId: 'ref:account.Move?',
    },
  },
  /**
   * One company-wide lock fence. Posting and changing a lock both claim the
   * revision inside their transaction, so a concurrent backdated post cannot
   * slip between validation and the lock write.
   */
  PeriodPolicy: {
    scope: 'company',
    fields: {
      id: 'id',
      salesThrough: 'date?',
      purchasesThrough: 'date?',
      taxThrough: 'date?',
      allThrough: 'date?',
      hardThrough: 'date?',
      revision: 'int',
      updatedAt: 'datetime',
      updatedBy: 'text?',
    },
    indexes: { company: { fields: ['companyId'], unique: true } },
  },
  /** Immutable before/after evidence for every lock or reopen command. */
  PeriodLockEvent: {
    scope: 'company',
    fields: {
      id: 'id',
      scope: 'text',
      action: 'text',
      beforeThrough: 'date?',
      afterThrough: 'date?',
      reason: 'text',
      actorId: 'text?',
      policyRevision: 'int',
      createdAt: 'datetime',
    },
  },
  /** A reproducible import/dry-run envelope for opening balances. */
  OpeningBatch: {
    scope: 'company',
    fields: {
      id: 'id',
      state: 'text',
      accountingDate: 'date',
      journalId: 'ref:account.Journal',
      currency: 'text',
      sourceChecksum: 'text',
      contentChecksum: 'text',
      controlDebit: 'decimal',
      controlCredit: 'decimal',
      lineCount: 'int',
      moveId: 'ref:account.Move?',
      createdAt: 'datetime',
      createdBy: 'text?',
      postedAt: 'datetime?',
      revision: 'int',
    },
    indexes: { source: { fields: ['companyId', 'sourceChecksum'], unique: true } },
  },
  /** Source-preserving lines behind one opening move. */
  OpeningLine: {
    scope: 'company',
    fields: {
      id: 'id',
      batchId: 'ref:account.OpeningBatch',
      sourceKey: 'text',
      accountId: 'ref:account.Account',
      partnerId: 'ref:partner.Partner?',
      description: 'text',
      debit: 'decimal',
      credit: 'decimal',
      dateMaturity: 'date?',
      sequence: 'int',
    },
    indexes: { source_line: { fields: ['companyId', 'batchId', 'sourceKey'], unique: true } },
  },
  /** One controlled close lifecycle for a civil accounting period. */
  ClosePeriod: {
    scope: 'company',
    fields: {
      id: 'id',
      periodKey: 'text',
      dateFrom: 'date',
      dateTo: 'date',
      state: 'text',
      checklistVersion: 'text',
      snapshotChecksum: 'text?',
      blockerCount: 'int',
      revision: 'int',
      createdAt: 'datetime',
      createdBy: 'text?',
      closedAt: 'datetime?',
      closedBy: 'text?',
      reopenedAt: 'datetime?',
      reopenedBy: 'text?',
      reopenReason: 'text?',
    },
    indexes: { period: { fields: ['companyId', 'periodKey'], unique: true } },
  },
  /** Versioned close checks; automated checks and human sign-off share one ledger. */
  CloseStep: {
    scope: 'company',
    fields: {
      id: 'id',
      closeId: 'ref:account.ClosePeriod',
      code: 'text',
      required: 'bool',
      ownerId: 'text?',
      state: 'text',
      blocker: 'text?',
      evidenceChecksum: 'text?',
      evidence: 'json?',
      completedAt: 'datetime?',
      completedBy: 'text?',
      revision: 'int',
    },
    indexes: { close_code: { fields: ['companyId', 'closeId', 'code'], unique: true } },
  },
  /** Jurisdiction-neutral evidence supplied by an installed localization. */
  CloseEvidence: {
    scope: 'company',
    fields: {
      id: 'id',
      closeId: 'ref:account.ClosePeriod',
      provider: 'text',
      code: 'text',
      required: 'bool',
      state: 'text',
      evidenceChecksum: 'text?',
      evidence: 'json?',
      revision: 'int',
    },
    indexes: {
      close_provider_code: {
        fields: ['companyId', 'closeId', 'provider', 'code'],
        unique: true,
      },
    },
  },
  /** Cross-feature accounting timeline; financial facts remain in their source models. */
  AuditEvent: {
    scope: 'company',
    fields: {
      id: 'id',
      subjectType: 'text',
      subjectId: 'text',
      action: 'text',
      actorId: 'text?',
      accountingDate: 'date?',
      reason: 'text?',
      relatedId: 'text?',
      details: 'json',
      createdAt: 'datetime',
    },
  },
  /** Resumable migration envelope for open invoices, bills and credits. */
  OpenItemBatch: {
    scope: 'company',
    fields: {
      id: 'id',
      state: 'text',
      accountingDate: 'date',
      sourceChecksum: 'text',
      contentChecksum: 'text',
      controlReceivable: 'decimal',
      controlPayable: 'decimal',
      itemCount: 'int',
      createdAt: 'datetime',
      createdBy: 'text?',
      completedAt: 'datetime?',
      revision: 'int',
    },
    indexes: { source: { fields: ['companyId', 'sourceChecksum'], unique: true } },
  },
  /** Source-to-move mapping and exact original/residual controls. */
  OpenItemSource: {
    scope: 'company',
    fields: {
      id: 'id',
      batchId: 'ref:account.OpenItemBatch',
      sourceKey: 'text',
      moveType: 'text',
      partnerId: 'ref:partner.Partner',
      journalId: 'ref:account.Journal',
      counterpartAccountId: 'ref:account.Account',
      offsetAccountId: 'ref:account.Account',
      documentDate: 'date',
      dueDate: 'date',
      originalAmount: 'decimal',
      residualAmount: 'decimal',
      moveId: 'ref:account.Move',
      settlementMoveId: 'ref:account.Move?',
      state: 'text',
      sequence: 'int',
    },
    indexes: { source_item: { fields: ['companyId', 'batchId', 'sourceKey'], unique: true } },
  },
}
