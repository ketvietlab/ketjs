import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { relationControl, relationLabels } from '../backend/relation-select.ts'
import type { RelationOption } from '../backend/relation-select.ts'

type Req = Parameters<Route>[1]

/**
 * An account, chosen by searching rather than by scrolling.
 *
 * The Vietnamese chart of accounts alone ships over two hundred rows, and every
 * form that names one was rendering all of them into a `<select>`. The picker
 * searches on code and name together, which is how an accountant reaches 131 or
 * "phải thu" without knowing which of the two they remember.
 *
 * `accountTypes` carries the restriction the forms were applying after the fact:
 * a receivable field offered the whole chart and relied on the domain to refuse
 * the wrong pick. Passing it here means the dialog never offers one. A trailing
 * `*` matches a family, so `income*` covers `income` and `income_other`.
 */
export const accountRelationControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: {
    id: string
    name: string
    label: string
    value?: string | null
    accounts: RelationOption[]
    accountTypes?: string[]
    required?: boolean
    allowEmpty?: boolean
  },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: options.name,
    ariaLabel: options.label,
    value: options.value,
    required: options.required,
    options: [...(options.allowEmpty ? [{ value: '', label: '—' }] : []), ...options.accounts],
    labels: relationLabels(_, _('account_backend.relation.accounts')),
    manager: {
      listFunction: 'account.listAccounts',
      ...(options.accountTypes?.length ? { listInput: { accountTypes: options.accountTypes } } : {}),
      labelField: 'name',
      descriptionField: 'code',
      // Deliberately no saveFunction: an account carries a type and a reconcile
      // flag that decide how every entry on it behaves, and guessing those from a
      // name in a dialog is how a chart of accounts goes wrong. New accounts are
      // created on the chart screen, which asks for all of it.
    },
  })

/** `code · name`, the way an accountant reads an account back. */
export const accountOptions = (rows: ReadonlyArray<Record<string, unknown>>): RelationOption[] =>
  rows.map((row) => ({
    value: String(row.id),
    label: `${String(row.code)} · ${String(row.name)}`,
    description: String(row.accountType ?? ''),
  }))
