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
      state: 'text?',
      actorId: 'text?',
      reason: 'text?',
      reversedAt: 'datetime?',
      reversedBy: 'text?',
      reversalReason: 'text?',
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
      /** Liquidity for cash/bank rails; stored_value for a liability-backed settlement. */
      settlementKind: 'text?',
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
  /** Company-owned bank/cash endpoint with explicit clearing controls. */
  BankAccount: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      journalId: 'ref:account.Journal',
      liquidityAccountId: 'ref:account.Account',
      clearingAccountId: 'ref:account.Account',
      suspenseAccountId: 'ref:account.Account',
      currency: 'text',
      externalKey: 'text?',
      accessPolicy: 'text?',
      active: 'bool',
    },
    indexes: {
      company_journal: { fields: ['companyId', 'journalId'], unique: true },
      company_external: { fields: ['companyId', 'externalKey'], unique: true },
    },
  },
  /** Saved mapping from a provider-neutral row into normalized statement fields. */
  BankImportProfile: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      format: 'text',
      provider: 'text?',
      mapping: 'json',
      balancePolicy: 'text',
      version: 'int',
      active: 'bool',
    },
  },
  /** One control-total envelope around an imported statement. */
  BankStatementBatch: {
    scope: 'company',
    fields: {
      id: 'id',
      bankAccountId: 'ref:account.BankAccount',
      profileId: 'ref:account.BankImportProfile',
      sourceChecksum: 'text',
      openingBalance: 'decimal',
      movement: 'decimal',
      closingBalance: 'decimal',
      state: 'text',
      warning: 'text?',
      transactionCount: 'int',
      importedAt: 'datetime',
      importedBy: 'text?',
    },
    indexes: { company_source: { fields: ['companyId', 'sourceChecksum'], unique: true } },
  },
  /** Current normalized view of a provider transaction. Raw updates live separately. */
  BankTransaction: {
    scope: 'company',
    fields: {
      id: 'id',
      batchId: 'ref:account.BankStatementBatch',
      bankAccountId: 'ref:account.BankAccount',
      externalId: 'text?',
      fingerprint: 'text',
      bookingDate: 'date',
      valueDate: 'date?',
      amount: 'decimal',
      balance: 'decimal?',
      direction: 'text',
      reference: 'text?',
      counterparty: 'text?',
      partnerId: 'ref:partner.Partner?',
      providerState: 'text',
      reconcileState: 'text',
      moveId: 'ref:account.Move?',
      revision: 'int',
      updatedAt: 'datetime',
    },
    indexes: {
      company_fingerprint: { fields: ['companyId', 'fingerprint'], unique: true },
      company_external: { fields: ['companyId', 'bankAccountId', 'externalId'], unique: true },
    },
  },
  /** Append-only provider evidence retained across pending/posted/reversed updates. */
  BankTransactionVersion: {
    scope: 'company',
    fields: {
      id: 'id',
      transactionId: 'ref:account.BankTransaction',
      fingerprint: 'text',
      providerState: 'text',
      normalized: 'json',
      raw: 'json',
      receivedAt: 'datetime',
    },
    indexes: {
      transaction_fingerprint: { fields: ['companyId', 'transactionId', 'fingerprint'], unique: true },
    },
  },
  /** Versioned explainable rule used by the suggestion engine. */
  MatchRule: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      version: 'int',
      weights: 'json',
      minimumScore: 'int',
      autoApproveScore: 'int?',
      active: 'bool',
    },
  },
  MatchSuggestion: {
    scope: 'company',
    fields: {
      id: 'id',
      transactionId: 'ref:account.BankTransaction',
      moveLineId: 'ref:account.MoveLine',
      ruleId: 'ref:account.MatchRule',
      ruleVersion: 'int',
      score: 'int',
      reasons: 'json',
      ambiguous: 'bool',
      state: 'text',
      createdAt: 'datetime',
    },
    indexes: {
      candidate: {
        fields: ['companyId', 'transactionId', 'moveLineId', 'ruleId', 'ruleVersion'],
        unique: true,
      },
    },
  },
  /** Durable approval/undo envelope; allocations point to immutable partial reconciles. */
  BankReconciliation: {
    scope: 'company',
    fields: {
      id: 'id',
      transactionId: 'ref:account.BankTransaction',
      state: 'text',
      accountingDate: 'date',
      allocations: 'json',
      writeOffAccountId: 'ref:account.Account?',
      writeOffAmount: 'decimal',
      moveId: 'ref:account.Move?',
      actorId: 'text?',
      reason: 'text?',
      before: 'json',
      after: 'json?',
      ruleId: 'ref:account.MatchRule?',
      ruleVersion: 'int?',
      createdAt: 'datetime',
      reversedAt: 'datetime?',
      reversedBy: 'text?',
      reversalReason: 'text?',
    },
    indexes: { transaction: { fields: ['companyId', 'transactionId'], unique: true } },
  },
  /** Versioned printable receipt/payment/transfer snapshot. */
  CashDocument: {
    scope: 'company',
    fields: {
      id: 'id',
      paymentId: 'ref:account.Payment?',
      moveId: 'ref:account.Move?',
      kind: 'text',
      number: 'text',
      templateKey: 'text',
      templateVersion: 'text',
      snapshot: 'json',
      controlTotal: 'decimal',
      createdAt: 'datetime',
      createdBy: 'text?',
    },
    indexes: { company_number: { fields: ['companyId', 'number'], unique: true } },
  },
  CashCount: {
    scope: 'company',
    fields: {
      id: 'id',
      bankAccountId: 'ref:account.BankAccount',
      countedAt: 'datetime',
      accountingDate: 'date',
      countedBy: 'text',
      bookBalance: 'decimal',
      actualBalance: 'decimal',
      difference: 'decimal',
      state: 'text',
      differenceAccountId: 'ref:account.Account?',
      moveId: 'ref:account.Move?',
      approvedBy: 'text?',
      approvedAt: 'datetime?',
    },
  },
  FollowUpPolicy: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      levels: 'json',
      quietHours: 'json?',
      rateLimit: 'int',
      active: 'bool',
    },
  },
  FollowUpCase: {
    scope: 'company',
    fields: {
      id: 'id',
      partnerId: 'ref:partner.Partner',
      ownerId: 'text?',
      state: 'text',
      promiseDate: 'date?',
      promiseAmount: 'decimal?',
      disputeReason: 'text?',
      nextActionAt: 'datetime?',
      snapshot: 'json',
      updatedAt: 'datetime',
    },
    indexes: { partner: { fields: ['companyId', 'partnerId'], unique: true } },
  },
  /** Delivery-neutral outbox. Private adapters own email/SMS/chat delivery. */
  FollowUpMessage: {
    scope: 'company',
    fields: {
      id: 'id',
      caseId: 'ref:account.FollowUpCase',
      channel: 'text',
      templateKey: 'text',
      templateVersion: 'text',
      idempotencyKey: 'text',
      consent: 'bool',
      snapshot: 'json',
      state: 'text',
      scheduledAt: 'datetime',
      sentAt: 'datetime?',
      providerMessageId: 'text?',
      lastError: 'text?',
    },
    indexes: { company_idempotency: { fields: ['companyId', 'idempotencyKey'], unique: true } },
  },
  /** Jurisdiction-neutral fixed-asset or long-lived-tool accounting policy. */
  AssetCategory: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      kind: 'text',
      acquisitionAccountId: 'ref:account.Account',
      accumulatedAccountId: 'ref:account.Account',
      expenseAccountId: 'ref:account.Account',
      disposalGainAccountId: 'ref:account.Account?',
      disposalLossAccountId: 'ref:account.Account?',
      journalId: 'ref:account.Journal',
      method: 'text',
      usefulLifePeriods: 'int',
      prorataPolicy: 'text',
      policyVersion: 'int',
      active: 'bool',
    },
  },
  /** Asset and CCDC subledger authority; posted facts remain in Move/MoveLine. */
  Asset: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      categoryId: 'ref:account.AssetCategory',
      sourceType: 'text',
      sourceId: 'text',
      sourceLineId: 'text?',
      sourceKey: 'text',
      originalCost: 'decimal',
      accumulatedAmount: 'decimal',
      residualValue: 'decimal',
      carryingValue: 'decimal',
      startDate: 'date',
      state: 'text',
      custodianId: 'text?',
      dimension: 'json?',
      scheduleVersion: 'int',
      revision: 'int',
      createdAt: 'datetime',
      createdBy: 'text?',
      activatedAt: 'datetime?',
      disposedAt: 'datetime?',
    },
    indexes: { source: { fields: ['companyId', 'sourceKey'], unique: true } },
  },
  /** Append-only lifecycle, transfer, revaluation and disposal evidence. */
  AssetEvent: {
    scope: 'company',
    fields: {
      id: 'id',
      assetId: 'ref:account.Asset',
      action: 'text',
      before: 'json',
      after: 'json',
      reason: 'text?',
      actorId: 'text?',
      relatedId: 'text?',
      createdAt: 'datetime',
    },
  },
  /** Financial revaluation/disposal command; approved draft entry precedes subledger change. */
  AssetChange: {
    scope: 'company',
    fields: {
      id: 'id',
      assetId: 'ref:account.Asset',
      action: 'text',
      before: 'json',
      after: 'json',
      accountingDate: 'date',
      state: 'text',
      moveId: 'ref:account.Move',
      reason: 'text',
      actorId: 'text?',
      completedAt: 'datetime?',
      createdAt: 'datetime',
    },
  },
  /** Versioned depreciation/allocation schedule; draft entries are linked, never hidden. */
  AssetScheduleLine: {
    scope: 'company',
    fields: {
      id: 'id',
      assetId: 'ref:account.Asset',
      scheduleVersion: 'int',
      sequence: 'int',
      accountingDate: 'date',
      amount: 'decimal',
      state: 'text',
      moveId: 'ref:account.Move?',
      createdAt: 'datetime',
    },
    indexes: {
      asset_version_sequence: {
        fields: ['companyId', 'assetId', 'scheduleVersion', 'sequence'],
        unique: true,
      },
    },
  },
  /** Resumable, idempotent depreciation/allocation job envelope. */
  AssetBatchRun: {
    scope: 'company',
    fields: {
      id: 'id',
      idempotencyKey: 'text',
      activeLockKey: 'text?',
      cutoffDate: 'date',
      state: 'text',
      progress: 'int',
      checkpoint: 'text?',
      cancelRequested: 'bool',
      artifact: 'json?',
      createdAt: 'datetime',
      completedAt: 'datetime?',
    },
    indexes: {
      idempotency: { fields: ['companyId', 'idempotencyKey'], unique: true },
      active_lock: { fields: ['companyId', 'activeLockKey'], unique: true },
    },
  },
  /** Cost-pool and driver policy. Source systems remain authoritative. */
  CostPolicy: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      method: 'text',
      pools: 'json',
      drivers: 'json',
      tolerance: 'decimal',
      version: 'int',
      active: 'bool',
    },
  },
  /** Immutable, reproducible costing snapshot and one active lock fence. */
  CostRun: {
    scope: 'company',
    fields: {
      id: 'id',
      policyId: 'ref:account.CostPolicy',
      periodKey: 'text',
      version: 'int',
      identityChecksum: 'text',
      inputChecksum: 'text',
      outputChecksum: 'text?',
      activeLockKey: 'text?',
      state: 'text',
      snapshot: 'json?',
      progress: 'int',
      checkpoint: 'text?',
      cancelRequested: 'bool',
      createdAt: 'datetime',
      finalizedAt: 'datetime?',
    },
    indexes: {
      identity: { fields: ['companyId', 'identityChecksum'], unique: true },
      active_lock: { fields: ['companyId', 'activeLockKey'], unique: true },
    },
  },
  /** Frozen references copied from Stock, Manufacturing and Accounting. */
  CostInput: {
    scope: 'company',
    fields: {
      id: 'id',
      runId: 'ref:account.CostRun',
      source: 'text',
      sourceId: 'text',
      fingerprint: 'text',
      facts: 'json',
      capturedAt: 'datetime',
    },
    indexes: { source: { fields: ['companyId', 'runId', 'source', 'sourceId'], unique: true } },
  },
  CostVariance: {
    scope: 'company',
    fields: {
      id: 'id',
      runId: 'ref:account.CostRun',
      kind: 'text',
      sourceId: 'text?',
      expected: 'decimal',
      actual: 'decimal',
      variance: 'decimal',
      severity: 'text',
      ownerId: 'text?',
      resolution: 'text?',
    },
  },
  /** A proposal only; it cannot mutate Quant, Manufacturing or a posted move. */
  CostAdjustmentProposal: {
    scope: 'company',
    fields: {
      id: 'id',
      runId: 'ref:account.CostRun',
      varianceId: 'ref:account.CostVariance',
      journalId: 'ref:account.Journal',
      debitAccountId: 'ref:account.Account',
      creditAccountId: 'ref:account.Account',
      amount: 'decimal',
      accountingDate: 'date',
      state: 'text',
      moveId: 'ref:account.Move?',
      approvedBy: 'text?',
      approvedAt: 'datetime?',
      createdAt: 'datetime',
    },
  },
  /** Conditional FX gate. Revaluation functions stay unavailable until approved. */
  FxPolicy: {
    scope: 'company',
    fields: {
      id: 'id',
      state: 'text',
      rateSource: 'text?',
      businessOwnerId: 'text?',
      approvalRef: 'text?',
      activatedAt: 'datetime?',
    },
    indexes: { company: { fields: ['companyId'], unique: true } },
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
    append: true,
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
