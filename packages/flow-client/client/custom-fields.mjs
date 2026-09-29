import { tr } from './i18n.mjs'
export const fieldKinds = [
  {
    value: 'text',
    get label() {
      return tr('flow.ui.text')
    },
  },
  {
    value: 'number',
    get label() {
      return tr('flow.ui.number')
    },
  },
  {
    value: 'date',
    get label() {
      return tr('flow.ui.date')
    },
  },
  {
    value: 'select',
    get label() {
      return tr('flow.ui.select')
    },
  },
  {
    value: 'multi-select',
    get label() {
      return tr('flow.ui.multiple.select')
    },
  },
  {
    value: 'boolean',
    get label() {
      return tr('flow.ui.true.false')
    },
  },
]
export const appliesTo = (f, projectId) =>
  !f.archived && (!f.appliesTo || f.appliesTo === 'all' || f.appliesTo === projectId)
export function validateCustomFields(fields, values, projectId, requireAll = false) {
  for (const field of fields.filter((f) => appliesTo(f, projectId))) {
    const value = values?.[field.id],
      empty = value == null || value === '' || (Array.isArray(value) && !value.length)
    if (empty) {
      if (requireAll && field.required) return field.title + tr('flow.ui.is.required.before.completion')
      continue
    }
    if (field.kind === 'number' && !Number.isFinite(Number(value)))
      return field.title + tr('flow.ui.must.be.a.number')
    if (field.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return field.title + tr('flow.ui.must.be.a.date')
    if (field.kind === 'boolean' && typeof value !== 'boolean')
      return field.title + tr('flow.ui.must.be.true.or.false')
    if (field.kind === 'select' && !field.options?.includes(value))
      return field.title + tr('flow.ui.is.not.an.available.option')
    if (
      field.kind === 'multi-select' &&
      (!Array.isArray(value) || value.some((x) => !field.options?.includes(x)))
    )
      return field.title + tr('flow.ui.contains.an.invalid.option')
  }
  return null
}
