// Structured authoring data shared by the editor and fixture adapter.
// MenuItem follows website_menu.MenuItem; schema.fields follows website_form.Form.schema.
export const menuItems = (items) => (Array.isArray(items) ? items : [])
export const formFields = (schema) => (Array.isArray(schema?.fields) ? schema.fields : [])
export const newMenuItem = (id) => ({ id, label: '', href: '/', parentId: null, position: 0 })
export const newFormField = (id) => ({
  id,
  name: `field_${id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 58)}`,
  label: '',
  type: 'text',
  required: true,
  maxLength: 4000,
  classification: 'personal',
})
export function menuIssues(items) {
  if (!Array.isArray(items) || items.length > 100) return ['items']
  const ids = new Set(),
    issues = []
  for (const item of items) {
    if (
      !item?.id ||
      ids.has(item.id) ||
      !String(item.label ?? '').trim() ||
      !/^(\/(?!\/)|https:\/\/)/.test(item.href ?? '')
    )
      issues.push('items')
    ids.add(item?.id)
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  for (const item of items) {
    const seen = new Set([item.id])
    let parent = item.parentId
    while (parent) {
      if (!byId.has(parent) || seen.has(parent)) {
        issues.push('parentId')
        break
      }
      seen.add(parent)
      parent = byId.get(parent).parentId
    }
  }
  return [...new Set(issues)]
}
export function formSchemaIssues(schema) {
  const fields = formFields(schema),
    seen = new Set()
  if (!fields.length || fields.length > 50) return ['schema']
  return fields.flatMap((field) => {
    const valid =
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field.name ?? '') &&
      !seen.has(field.name) &&
      ['text', 'email', 'tel', 'number', 'textarea', 'checkbox'].includes(field.type ?? 'text') &&
      !!String(field.label ?? '').trim() &&
      typeof field.required === 'boolean' &&
      Number.isInteger(field.maxLength) &&
      field.maxLength >= 1 &&
      field.maxLength <= 4000 &&
      ['public', 'personal', 'sensitive'].includes(field.classification)
    seen.add(field.name)
    return valid ? [] : ['schema']
  })
}
export function menuTree(items) {
  const rows = menuItems(items),
    seen = new Set()
  const children = (parentId = null) =>
    rows
      .filter((item) => (item.parentId || null) === parentId)
      .sort((a, b) => a.position - b.position)
      .flatMap((item) => {
        if (seen.has(item.id)) return []
        seen.add(item.id)
        return [{ ...item, children: children(item.id) }]
      })
  return children()
}
