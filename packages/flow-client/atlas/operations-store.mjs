import { taskColumns } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { canManageScope, accessFor } from '@ketvietlab/flow-client/access-model.mjs'
const fail = (message, fields = {}) => ({
  ok: true,
  value: { ok: false, errors: [{ code: 'validation', message }], fields },
})
const denied = () => ({
  ok: true,
  value: { ok: false, errors: [{ code: 'forbidden', message: 'Bạn chưa có quyền thực hiện thao tác này.' }] },
})
export function seedOperations(d) {
  d.operationsRevision = 1
  d.formResponses = []
  d.personalPreferences = { theme: 'light', timezone: d.timezone, notifications: 'mentions' }
  for (const f of d.forms)
    Object.assign(f, {
      responses: 0,
      access: 'internal',
      assignee: 'Mai Anh',
      priority: 'normal',
      fields: [{ id: 'details', label: 'Chi tiết yêu cầu', type: 'textarea', required: true }],
      status: 'published',
    })
  for (const n of d.inbox)
    Object.assign(n, {
      createdAt: '2026-09-21T08:30:00Z',
      kind: n.title.includes('nhắc') ? 'mention' : 'update',
      actorId: n.title.includes('nhắc') ? 'ha' : 'bao',
    })
}
export function operationsCommand(d, args, scenario, replay, baseCall) {
  if (['readonly', 'guest', 'revoked'].includes(scenario)) return denied()
  if (!args.idempotencyKey) return fail('Thiếu khóa thao tác.')
  const key = d.company.id + ':operations:' + args.idempotencyKey
  if (replay.has(key)) return structuredClone(replay.get(key))
  if (args.expectedRevision !== d.operationsRevision)
    return {
      ok: true,
      value: {
        ok: false,
        errors: [{ code: 'conflict', message: 'Dữ liệu đã thay đổi. Tải lại trước khi tiếp tục.' }],
      },
    }
  const a = args.action
  let value = {}
  const project = d.projects.find((p) => p.id === args.projectId && !p.archived)
  const workspace = d.workspaces.find((w) => w.id === args.workspaceId && !w.archived)
  if (a === 'form.submit' && (!project || accessFor(d, project, d.user.id).role === 'viewer')) return denied()
  const manager = canManageScope(d, 'company', d.company.id)
  if (a === 'form.save') {
    if (!project || !canManageScope(d, 'project', project.id)) return denied()
  }
  if (a === 'form.save') {
    if (!String(args.title ?? '').trim()) return fail('Nhập tên biểu mẫu.')
    if (!['internal', 'project'].includes(args.access)) return fail('Chọn phạm vi gửi biểu mẫu.')
    if (
      !Array.isArray(args.fields) ||
      args.fields.length > 12 ||
      args.fields.some((f) => !f.label?.trim() || !['text', 'textarea', 'number'].includes(f.type))
    )
      return fail('Mỗi trường cần tên và kiểu dữ liệu, tối đa 12 trường.')
    if (!d.people.includes(args.assignee)) return fail('Chọn người tiếp nhận.')
    let f = d.forms.find((f) => f.id === args.id)
    if (args.id && (!f || f.projectId !== project.id)) return denied()
    if (!f) {
      f = { id: crypto.randomUUID(), projectId: project.id, responses: 0 }
      d.forms.push(f)
    }
    Object.assign(f, {
      title: args.title.trim(),
      description: args.description ?? '',
      access: args.access,
      assignee: args.assignee,
      priority: args.priority ?? 'normal',
      fields: args.fields.map((x, i) => ({ ...x, id: 'field-' + i, required: !!x.required })),
      status: args.publish ? 'published' : 'draft',
    })
    value = { id: f.id }
  } else if (a === 'form.submit') {
    const f = d.forms.find((f) => f.id === args.id && f.projectId === project?.id && f.status === 'published')
    if (!f) return fail('Biểu mẫu chưa được xuất bản.')
    if (!String(args.title ?? '').trim())
      return fail('Nhập tiêu đề yêu cầu.', { title: 'Tiêu đề là bắt buộc.' })
    for (const field of f.fields) {
      const v = args.answers?.[field.id]
      if (field.required && !String(v ?? '').trim()) return fail(`Vui lòng nhập ${field.label}.`)
      if (field.type === 'number' && v !== undefined && v !== '' && !Number.isFinite(Number(v)))
        return fail(`${field.label} phải là số.`)
    }
    const response = baseCall('flow.issue.save', {
      title: args.title,
      description: f.fields.map((field) => `${field.label}: ${args.answers?.[field.id] ?? ''}`).join('\n'),
      projectId: f.projectId,
      assignee: f.assignee,
      priority: f.priority,
      idempotencyKey: args.idempotencyKey + ':task',
    })
    if (response.value?.ok === false) return response
    f.responses++
    d.formResponses.unshift({
      id: crypto.randomUUID(),
      formId: f.id,
      taskId: response.value.id,
      title: args.title,
      answers: args.answers,
      person: d.user.name,
      at: new Date().toISOString(),
    })
    value = { id: response.value.id }
  } else if (a === 'inbox.read') {
    if (!Array.isArray(args.ids)) return fail('Chọn thông báo.')
    for (const n of d.inbox)
      if (args.ids.includes(n.id) && (!n.recipientId || n.recipientId === d.user.id)) n.read = true
  } else if (a === 'view.save') {
    const v = d.views.find((v) => v.id === args.id)
    if (!v || (v.ownerId && v.ownerId !== d.user.id && !manager)) return denied()
    if (args.archive) v.archived = true
    else {
      if (!String(args.title ?? '').trim()) return fail('Nhập tên view.')
      Object.assign(v, {
        title: args.title.trim(),
        description: args.description ?? '',
        visibility: args.visibility === 'project' ? 'project' : 'private',
        ownerId: v.ownerId ?? d.user.id,
        query: String(args.query ?? v.query ?? ''),
        status: taskColumns(d, args.projectId).some((c) => c.id === args.status) ? args.status : 'all',
      })
    }
  } else if (a === 'preferences.save') {
    if (args.timezone)
      try {
        new Intl.DateTimeFormat('vi', { timeZone: args.timezone }).format(new Date())
      } catch {
        return fail('Múi giờ không hợp lệ.')
      }
    Object.assign(d.personalPreferences, {
      timezone: args.timezone ?? d.personalPreferences.timezone,
      notifications: args.notifications ?? 'mentions',
    })
  } else return fail('Thao tác chưa được hỗ trợ.')
  d.operationsRevision++
  const result = { ok: true, value }
  replay.set(key, structuredClone(result))
  return result
}
