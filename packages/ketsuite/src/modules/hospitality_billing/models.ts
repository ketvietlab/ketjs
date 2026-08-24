import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  /**
   * What a kind of charge is, once it leaves the folio and becomes revenue.
   *
   * A folio charge knows what it is operationally — a room night, a minibar
   * item, a cancellation fee — and nothing about tax. An invoice cannot be
   * written without knowing both, and neither the charge nor the product carries
   * a rate: in Vietnam accommodation and food are taxed differently, and which
   * applies is a decision a business makes once, not one a night audit can infer.
   *
   * One row per charge type, and no row means no invoice. That is the point: a
   * line with no tax on it is filed as *not subject to VAT*, which is a claim
   * about the sale, not an absence of information. Refusing until somebody has
   * said what a minibar is worth taxing at is the only honest default.
   */
  ChargeRule: {
    scope: 'company',
    fields: {
      id: 'id',
      /** One of `hospitality_core` CHARGE_TYPES. */
      chargeType: 'text',
      /** Left empty, the product's category decides, then the company default. */
      incomeAccountId: 'ref:account.Account?',
      taxId: 'ref:account.Tax?',
      /** Where the tax posts, when the tax itself does not name an account. */
      taxAccountId: 'ref:account.Account?',
      /**
       * This charge type carries no VAT, deliberately.
       *
       * Separate from an empty `taxId` so that "nobody has decided" and "decided
       * there is none" cannot be told apart only by what is missing.
       */
      taxExempt: 'bool',
      updatedAt: 'datetime',
    },
    indexes: { type_company: { fields: ['companyId', 'chargeType'], unique: true } },
  },

  /**
   * The invoice a folio became.
   *
   * One per folio, enforced by the index rather than by checking first: a
   * checkout that is retried, a sweep that runs twice and an operator pressing
   * the button again must all converge on the same document. A guest is billed
   * once.
   */
  FolioBill: {
    scope: 'company',
    fields: {
      id: 'id',
      folioId: 'ref:hospitality_core.Folio',
      moveId: 'ref:account.Move',
      /** `invoiced` once the entry is posted. Kept for what comes after it. */
      state: 'text',
      chargeCount: 'int',
      amountTotal: 'decimal',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      folio_company: { fields: ['companyId', 'folioId'], unique: true },
      move_company: { fields: ['companyId', 'moveId'], unique: true },
    },
  },
}
