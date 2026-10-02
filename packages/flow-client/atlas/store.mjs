import { atlasExtensions } from './extensions.mjs'
import {
  taskAssigneeIds,
  taskUsers,
  taskAssigneeNames,
  assignableUsers,
} from '@ketvietlab/flow-client/task-assignees.mjs'
import { taskColumns, taskTags, isDone, statusForKind } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { validateCustomFields, fieldKinds } from '@ketvietlab/flow-client/custom-fields.mjs'
import { orderedTasks, taskGroupValue, taskGroups } from '@ketvietlab/flow-client/task-order.mjs'
import { documentSiblings, sameDocumentLevel } from '@ketvietlab/flow-client/document-tree.mjs'
import { createData } from './fixtures.mjs'
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const fileSize = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const failure = (code, message, fields = {}) => ({
  ok: true,
  value: { ok: false, errors: [{ code, message }], fields },
})
export function createFixtureSession(scenario = 'baseline', route = 'my-work', { extensions = [] } = {}) {
  const hooks = atlasExtensions(extensions)
  const data = createData()
  for (const task of data.tasks) task.assigneeIds = taskAssigneeIds(data, task)
  data.taskOrderRevision = 0
  const replay = new Map()
  hooks.notify('seedBase', data, scenario, route)
  let failedOnce = false
  if (scenario === 'empty') {
    data.tasks = []
    if (route.includes('page')) data.pages = []
    if (route.includes('epic')) data.epics = []
    if (route === 'inbox') data.inbox = []
    for (const [screen, collection] of Object.entries({
      forms: 'forms',
      'saved-views': 'views',
      sprints: 'sprints',
    }))
      if (route === screen) data[collection] = []
  }
  if (route === 'issues-archived' && data.tasks.length) data.tasks[4].archived = true
  if (route === 'page-archived' && data.pages.length) data.pages[2].archived = true
  if (scenario === 'success') {
    data.tasks[0].status = 'done'
    data.tasks[0].blockedBy = []
  }
  let initial = true
  const call = (name, args = {}) => {
    if (scenario === 'forbidden') return failure('forbidden', 'Bạn không có quyền truy cập không gian này.')
    if (scenario === 'error' && !failedOnce) {
      failedOnce = true
      return failure('unavailable', 'Không tải được dữ liệu. Kết nối tạm thời gián đoạn.')
    }
    const extensionRead = hooks.first('read', { data, name, args, failure })
    if (extensionRead !== undefined) return extensionRead
    const read = name === 'flow.workspace.bootstrap'
    if (read) {
      const problem = initial
        ? ({
            conflict: {
              code: 'conflict',
              message: 'Người khác vừa cập nhật hồ sơ. Tải phiên bản mới trước khi lưu.',
            },
            blocked: { code: 'blocked', message: 'Còn công việc phụ thuộc chưa hoàn thành.' },
            validation: { code: 'validation', message: 'Vui lòng kiểm tra các trường bắt buộc.' },
          }[scenario] ?? null)
        : null
      initial = false
      return {
        ok: true,
        value: {
          ...structuredClone(data),
          tasks: data.tasks.map((t) => ({ ...structuredClone(t), assignees: taskUsers(data, t) })),
          problem,
          capabilities: { write: scenario !== 'readonly' },
          notice:
            scenario === 'truncated' ? 'Bộ lọc đã chạm giới hạn 900 kết quả. Hãy thu hẹp điều kiện.' : null,
        },
      }
    }
    if (scenario === 'readonly') return failure('forbidden', 'Bạn chỉ có quyền xem.')
    if (!args.idempotencyKey) return failure('validation', 'Thiếu khóa thao tác.')
    if (replay.has(args.idempotencyKey)) return structuredClone(replay.get(args.idempotencyKey))
    const task = data.tasks.find((t) => t.id === args.id)
    const beforeTask = task ? structuredClone(task) : null
    if (task && args.expectedVersion !== undefined && args.expectedVersion !== task.version)
      return failure('conflict', 'Công việc đã được người khác cập nhật. Tải bản mới rồi thử lại.')
    if (scenario === 'conflict' && !failedOnce) {
      failedOnce = true
      if (task) task.version++
      return failure('conflict', 'Người khác vừa cập nhật hồ sơ. Bản nháp của bạn vẫn được giữ.')
    }
    if (scenario === 'validation' && !failedOnce) {
      failedOnce = true
      return failure('validation', 'Kiểm tra lại các trường được đánh dấu.', {
        title: 'Vui lòng nhập tên khác.',
      })
    }
    const refusal = hooks.first('beforeCommand', { data, name, args, task, failure })
    if (refusal) return refusal
    let value = { ok: true }
    const extended = hooks.first('command', { data, name, args, failure })
    if (extended !== undefined) {
      if (extended.value?.ok === false) return extended
      value = extended.value
    } else if (name === 'flow.issue.save') {
      const title = String(args.title ?? task?.title ?? '').trim()
      if (!title) return failure('validation', 'Vui lòng nhập tiêu đề.', { title: 'Tiêu đề là bắt buộc.' })
      if (
        args.tags !== undefined &&
        (!Array.isArray(args.tags) ||
          args.tags.some((id) => {
            const tag = taskTags(data, args.projectId ?? task?.projectId).find((t) => t.id === id)
            return !tag || (tag.archived && !task?.tags?.includes(id))
          }) ||
          new Set(args.tags).size !== args.tags.length)
      )
        return failure('validation', 'Chọn các nhãn đang hoạt động trong danh sách.')
      const next = { ...task, ...args }
      if (
        task &&
        args.projectId &&
        args.projectId !== task.projectId &&
        (!taskColumns(data, args.projectId).some((c) => c.id === next.status) ||
          (args.tags ?? task.tags ?? []).some(
            (id) => !taskTags(data, args.projectId).some((t) => t.id === id),
          ))
      )
        return failure('validation', 'Chọn trạng thái và nhãn thuộc dự án đích.')
      if (next.startDate && next.dueDate && next.dueDate < next.startDate)
        return failure('validation', 'Hạn hoàn thành phải sau ngày bắt đầu.')
      if (args.points !== undefined && (!Number.isFinite(Number(args.points)) || Number(args.points) < 0))
        return failure('validation', 'Điểm ước lượng không hợp lệ.')
      if (
        args.status &&
        !taskColumns(data, args.projectId ?? task?.projectId).some((c) => c.id === args.status)
      )
        return failure('validation', 'Trạng thái không hợp lệ.')
      let assigneeIds
      if (Object.hasOwn(args, 'assigneeIds') || Object.hasOwn(args, 'assignee') || !task) {
        assigneeIds = Object.hasOwn(args, 'assigneeIds')
          ? args.assigneeIds
          : Object.hasOwn(args, 'assignee')
            ? args.assignee
              ? (data.members ?? []).filter((m) => m.name === args.assignee).map((m) => m.id)
              : []
            : [data.user.id]
        if (
          !Array.isArray(assigneeIds) ||
          assigneeIds.some((id) => typeof id !== 'string' || !data.members.some((m) => m.id === id)) ||
          new Set(assigneeIds).size !== assigneeIds.length ||
          (args.assignee && !Object.hasOwn(args, 'assigneeIds') && !assigneeIds.length)
        )
          return failure('validation', 'Người phụ trách không hợp lệ.')
        const eligible = new Set(
          assignableUsers(data, args.projectId ?? task?.projectId ?? 'core').map((u) => u.id),
        )
        const held =
          task && (!args.projectId || args.projectId === task.projectId) ? taskAssigneeIds(data, task) : []
        if (assigneeIds.some((id) => !eligible.has(id) && !held.includes(id)))
          return failure('validation', 'Chỉ chọn người đang có quyền trong dự án.')
      }
      if (args.priority && !['normal', 'high', 'urgent'].includes(args.priority))
        return failure('validation', 'Ưu tiên không hợp lệ.')
      if (args.sprint && args.sprint !== 'Backlog' && !data.sprints.some((s) => s.title === args.sprint))
        return failure('validation', 'Sprint không hợp lệ.')
      if (Object.hasOwn(args, 'projectId') && !data.projects.some((p) => p.id === args.projectId))
        return failure('validation', 'Dự án không hợp lệ.')
      if (
        args.blockedBy &&
        task &&
        (!Array.isArray(args.blockedBy) || args.blockedBy.some((id) => !task.blockedBy.includes(id)))
      )
        return failure('validation', 'Thêm phụ thuộc qua luồng liên kết để kiểm tra vòng lặp.')
      const blockedBy = args.blockedBy ?? task?.blockedBy ?? []
      const customError = validateCustomFields(
        data.fields,
        args.customFields ?? task?.customFields,
        next.projectId,
        data.columns.find((c) => c.id === next.status)?.kind === 'done',
      )
      if (customError) return failure('validation', customError)
      if (blockedBy.some((id) => !data.tasks.some((t) => t.id === id)))
        return failure('validation', 'Công việc phụ thuộc không tồn tại.')
      if (
        data.columns.find((c) => c.id === next.status)?.kind === 'done' &&
        blockedBy.some(
          (id) =>
            !isDone(
              data,
              data.tasks.find((t) => t.id === id),
            ),
        )
      )
        return failure('blocked', 'Hoàn tất công việc phụ thuộc trước khi đóng công việc này.')
      const patch = { title }
      if (assigneeIds !== undefined) {
        patch.assigneeIds = [...assigneeIds]
        patch.assignee = data.members.find((m) => m.id === assigneeIds[0])?.name ?? ''
      }
      for (const key of [
        'description',
        'descriptionDoc',
        'customFields',
        'blockedBy',
        'priority',
        'status',
        'sprint',
        'startDate',
        'dueDate',
        'type',
        'tags',
        'checklist',
        'projectId',
        'epic',
      ])
        if (Object.hasOwn(args, key)) patch[key] = structuredClone(args[key])
      if (Object.hasOwn(args, 'points')) patch.points = Number(args.points)
      if (Object.hasOwn(args, 'dueDate'))
        patch.due = args.dueDate ? args.dueDate.slice(8, 10) + '/' + args.dueDate.slice(5, 7) : '—'
      if (task) Object.assign(task, patch, { version: task.version + 1 })
      else {
        const project = data.projects.find((p) => p.id === (args.projectId ?? 'core')),
          prefix =
            (data.company?.id && data.company.id !== 'demo' ? data.company.id + '-' : '') +
            (project?.code ?? 'KV')
        const number =
          Math.max(
            prefix.endsWith('KV') ? 159 : 0,
            ...data.tasks
              .filter((t) => t.id.startsWith(prefix + '-'))
              .map((t) => Number(t.id.slice(prefix.length + 1)))
              .filter(Number.isFinite),
          ) + 1
        const id = `${prefix}-${number}`
        const created = {
          id,
          title,
          description: '',
          priority: 'normal',
          assignee: data.user.name,
          status: statusForKind(data, args.projectId ?? task?.projectId, 'todo'),
          projectId: 'core',
          due: '—',
          points: 0,
          version: 1,
          order: Math.min(0, ...data.tasks.map((t) => t.order ?? 0)) - 1,
          blockedBy,
          parentId: args.parentId ?? null,
          sprint: 'Backlog',
          epic: null,
          ...patch,
        }
        data.tasks.unshift(created)
        for (const [i, name] of (args.subtasks ?? []).entries())
          data.tasks.push({
            ...structuredClone(created),
            id: `${prefix}-${number + i + 1}`,
            title: name,
            description: '',
            parentId: id,
            order: Math.max(0, ...data.tasks.map((t) => t.order ?? 0)) + 1,
            blockedBy: [],
            checklist: [],
            tags: [],
          })
        for (const file of args.attachments ?? [])
          data.files.push({
            id: `file-${data.files.length + 1}`,
            taskId: id,
            title: file.title,
            description: `${Math.ceil(file.size / 1024)} KB · ${data.user.name}`,
          })
        data.taskOrderRevision++
        value.id = id
      }
    } else if (name === 'flow.issue.reorder') {
      const ids = args.ids ?? [args.id]
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 900 ||
        new Set(ids).size !== ids.length ||
        !ids.includes(args.id)
      )
        return failure('validation', 'Lựa chọn công việc không hợp lệ.')
      const moving = orderedTasks(data.tasks).filter((t) => ids.includes(t.id)),
        movingIds = new Set(ids)
      if (moving.length !== ids.length || moving.some((t) => t.archived))
        return failure('notFound', 'Một công việc không còn trong danh sách.')
      if (
        args.expectedOrderRevision !== data.taskOrderRevision ||
        moving.some((t) => (args.ids ? args.expectedVersions?.[t.id] : args.expectedVersion) !== t.version)
      )
        return failure('conflict', 'Thứ tự hoặc công việc đã thay đổi. Tải lại trước khi di chuyển.')
      const field = args.groupBy
      if (
        !['none', 'status', 'priority', 'assignee', 'sprint'].includes(field) ||
        !['before', 'after'].includes(args.position)
      )
        return failure('validation', 'Vị trí hoặc nhóm công việc không hợp lệ.')
      if (moving.some((t) => !taskGroups(data, field, t.projectId).some((g) => g.id === args.groupValue)))
        return failure(
          'validation',
          'Nhóm đích không hợp lệ với một trong các dự án đã chọn. Chưa di chuyển công việc nào.',
        )
      if (
        field === 'assignee' &&
        moving.some((t) => {
          const group = taskGroups(data, field, t.projectId).find((g) => g.id === args.groupValue),
            eligible = assignableUsers(data, t.projectId)
          return group.assigneeIds.some(
            (id) => !taskAssigneeIds(data, t).includes(id) && !eligible.some((u) => u.id === id),
          )
        })
      )
        return failure('validation', 'Người trong nhóm đích chưa có quyền ở dự án.')
      const target = args.targetId == null ? null : data.tasks.find((t) => t.id === args.targetId)
      if (
        args.targetId != null &&
        (!target ||
          target.archived ||
          movingIds.has(target.id) ||
          taskGroupValue(target, field) !== args.groupValue)
      )
        return failure('validation', 'Công việc đích không thuộc nhóm đã chọn.')
      const completing =
        field === 'status' && data.columns.find((c) => c.id === args.groupValue)?.kind === 'done'
      if (completing) {
        if (
          moving.some((t) =>
            t.blockedBy.some(
              (id) =>
                !movingIds.has(id) &&
                !isDone(
                  data,
                  data.tasks.find((t) => t.id === id),
                ),
            ),
          )
        )
          return failure('blocked', 'Còn việc phụ thuộc chưa hoàn thành. Chưa di chuyển công việc nào.')
        const error = moving
          .map((t) => validateCustomFields(data.fields, t.customFields, t.projectId, true))
          .find(Boolean)
        if (error) return failure('validation', error)
      }
      const ordered = orderedTasks(data.tasks).filter((t) => !movingIds.has(t.id))
      let index = target
        ? ordered.findIndex((t) => t.id === target.id) + (args.position === 'after' ? 1 : 0)
        : ordered.length
      if (!target) {
        const last = ordered.findLastIndex((t) => !t.archived && taskGroupValue(t, field) === args.groupValue)
        if (last >= 0) index = last + 1
      }
      for (const item of moving) {
        const previous = field === 'none' ? null : item[field]
        if (field === 'assignee') {
          const group = taskGroups(data, field, item.projectId).find((g) => g.id === args.groupValue)
          item.assigneeIds = [...group.assigneeIds]
          item.assignee = data.members.find((m) => m.id === item.assigneeIds[0])?.name ?? ''
        } else if (field !== 'none') item[field] = args.groupValue
        item.version++
        if (item.id !== args.id)
          data.history.unshift({
            id: crypto.randomUUID(),
            person: data.user.name,
            taskId: item.id,
            text: `Đã di chuyển cùng ${moving.length} công việc${field === 'none' ? '' : ` · ${previous} → ${args.groupValue}`}`,
            time: 'Vừa xong',
          })
      }
      ordered.splice(index, 0, ...moving)
      ordered.forEach((t, order) => {
        t.order = order
      })
      data.tasks = ordered
      data.taskOrderRevision++
      value.id = task.id
      value.ids = moving.map((t) => t.id)
    } else if (name === 'flow.issue.move') {
      if (!task) return failure('notFound', 'Không tìm thấy công việc.')
      if (
        data.columns.find((c) => c.id === args.columnId)?.kind === 'done' &&
        task.blockedBy.some(
          (id) =>
            !isDone(
              data,
              data.tasks.find((t) => t.id === id),
            ),
        )
      )
        return failure(
          'blocked',
          'Còn công việc đang chặn. Hoàn tất việc phụ thuộc trước khi đóng công việc này.',
        )
      if (!taskColumns(data, task.projectId).some((c) => c.id === args.columnId))
        return failure('validation', 'Trạng thái không hợp lệ.')
      const completionError = validateCustomFields(
        data.fields,
        task.customFields,
        task.projectId,
        data.columns.find((c) => c.id === args.columnId)?.kind === 'done',
      )
      if (completionError) return failure('validation', completionError)
      task.status = args.columnId
      task.version++
    } else if (name === 'flow.issue.bulk') {
      const targets = data.tasks.filter((t) => (args.ids ?? []).includes(t.id))
      if (
        targets.some(
          (t) =>
            !taskColumns(data, t.projectId).some(
              (c) => c.id === (args.status ?? statusForKind(data, t.projectId, 'done')),
            ),
        )
      )
        return failure('validation', 'Trạng thái không hợp lệ.')
      if (!args.status || data.columns.find((c) => c.id === args.status)?.kind === 'done') {
        const error = targets
          .map((t) => validateCustomFields(data.fields, t.customFields, t.projectId, true))
          .find(Boolean)
        if (error) return failure('validation', error)
      }
      if (
        (!args.status || data.columns.find((c) => c.id === args.status)?.kind === 'done') &&
        targets.some((t) =>
          t.blockedBy.some(
            (id) =>
              !isDone(
                data,
                data.tasks.find((x) => x.id === id),
              ),
          ),
        )
      )
        return failure('blocked', 'Nhóm đã chọn có việc đang bị chặn. Chưa thay đổi công việc nào.')
      for (const t of targets) {
        t.status = args.status ?? statusForKind(data, t.projectId, 'done')
        t.version++
      }
    } else if (name === 'flow.issue.dependency') {
      if (!task || !data.tasks.some((t) => t.id === args.target))
        return failure('notFound', 'Công việc không tồn tại.')
      const reaches = (id, seen = new Set()) => {
        if (id === task.id) return true
        if (seen.has(id)) return false
        seen.add(id)
        return data.tasks.find((t) => t.id === id)?.blockedBy.some((x) => reaches(x, seen))
      }
      if (reaches(args.target)) return failure('cycle', 'Liên kết này tạo vòng lặp phụ thuộc.')
      task.blockedBy = [...new Set([...task.blockedBy, args.target])]
      task.version++
    } else if (name === 'flow.issue.comment') {
      if (!String(args.text ?? '').trim()) return failure('validation', 'Vui lòng nhập bình luận.')
      data.comments.push({
        id: `c${data.comments.length + 1}`,
        taskId: args.id,
        person: data.user.name,
        text: args.text,
        time: new Date().toLocaleString('vi-VN'),
      })
    } else if (
      name === 'flow.issue.archive' ||
      name === 'flow.issue.restore' ||
      name === 'flow.issue.follow' ||
      name === 'flow.issue.assignSprint' ||
      name === 'flow.issue.linkChild'
    ) {
      if (!task) return failure('notFound', 'Không tìm thấy công việc.')
      if (name.endsWith('archive') && !args.reason?.trim())
        return failure('validation', 'Vui lòng ghi lý do lưu trữ.')
      if (name.endsWith('archive')) {
        task.archived = true
        task.archivedAt = new Date().toISOString()
        task.archivedBy = data.user.name
      }
      if (name.endsWith('restore')) task.archived = false
      if (name.endsWith('follow')) task.followed = !task.followed
      if (name.endsWith('assignSprint')) task.sprint = args.sprint
      if (name.endsWith('linkChild')) {
        const child = data.tasks.find((t) => t.id === args.target)
        if (!child || child.id === task.id) return failure('validation', 'Chọn công việc con hợp lệ.')
        child.parentId = task.id
      }
      task.version++
    } else if (name === 'flow.page.reorder') {
      const source = data.pages.find((p) => p.id === args.id)
      const target = data.pages.find((p) => p.id === args.targetId)
      if (!source || !target) return failure('notFound', 'Tài liệu không còn tồn tại.')
      if (source.archived || target.archived || !sameDocumentLevel(source, target))
        return failure('validation', 'Chỉ đổi vị trí giữa tài liệu cùng cấp trong cùng dự án và phạm vi.')
      if (!['before', 'after'].includes(args.position)) return failure('validation', 'Vị trí không hợp lệ.')
      const siblings = documentSiblings(data.pages, source).map((p) => p.id)
      if (JSON.stringify(siblings) !== JSON.stringify(args.expectedSiblingIds))
        return failure('conflict', 'Thứ tự tài liệu đã thay đổi. Tải lại trước khi di chuyển.')
      if (source.id !== target.id) {
        const ordered = data.pages.filter((p) => p.id !== source.id)
        ordered.splice(
          ordered.findIndex((p) => p.id === target.id) + (args.position === 'after' ? 1 : 0),
          0,
          source,
        )
        data.pages = ordered
      }
    } else if (name === 'flow.entity.save' && args.collection === 'files' && Object.hasOwn(args, 'files')) {
      const task = data.tasks.find((t) => t.id === args.taskId && !t.archived)
      if (!task) return failure('notFound', 'Công việc không còn tồn tại.')
      if (
        !Array.isArray(args.files) ||
        !args.files.length ||
        args.files.some(
          (f) =>
            !f ||
            typeof f.title !== 'string' ||
            !f.title.trim() ||
            !Number.isSafeInteger(f.size) ||
            f.size < 0 ||
            (f.uploadId != null && !UPLOAD_ID.test(f.uploadId)) ||
            (f.type != null && (typeof f.type !== 'string' || f.type.length > 120)),
        )
      )
        return failure('validation', 'Kiểm tra tên và kích thước các tệp đã chọn.')
      // Content lives with the server's upload store; the record keeps only a reference to it.
      const files = args.files.map((f, index) => ({
        id: `files-${data.files.length + index + 1}`,
        taskId: task.id,
        title: f.title.trim(),
        size: f.size,
        contentType: f.type || null,
        url: f.uploadId ? `/_ket/files/${f.uploadId}` : null,
        description: `${fileSize(f.size)} · ${data.user.name}`,
      }))
      data.files.push(...files)
      value = { ids: files.map((f) => f.id) }
    } else if (name === 'flow.entity.save') {
      const list = data[args.collection]
      if (!Array.isArray(list)) return failure('validation', 'Loại hồ sơ không hợp lệ.')
      if (!String(args.title ?? '').trim())
        return failure('validation', 'Vui lòng nhập tên.', { title: 'Tên là bắt buộc.' })
      if (args.start && args.end && args.end < args.start)
        return failure('validation', 'Ngày kết thúc phải sau ngày bắt đầu.')
      const held = list.find((x) => x.id === args.entityId)
      if (args.collection === 'forms') {
        if (
          !data.projects.some((p) => p.id === args.projectId) ||
          (held && held.projectId !== args.projectId)
        )
          return failure('validation', 'Chọn đúng dự án sở hữu.')
      }
      if (args.collection === 'pages') {
        const owner = Object.hasOwn(args, 'projectId') ? args.projectId : (held?.projectId ?? null)
        if (owner !== null && !data.projects.some((p) => p.id === owner))
          return failure('validation', 'Dự án sở hữu không hợp lệ.')
        if (held && (held.projectId ?? null) !== owner)
          return failure('validation', 'Không thể đổi nơi sở hữu khi sửa nội dung tài liệu.')
        const parent = data.pages.find((p) => p.id === args.parentId)
        if (args.parentId && (!parent || parent.archived || (parent.projectId ?? null) !== owner))
          return failure('validation', 'Tài liệu cha phải thuộc cùng nơi sở hữu.')
        let ancestor = parent
        const visited = new Set()
        while (ancestor) {
          if (ancestor.id === held?.id || visited.has(ancestor.id))
            return failure('cycle', 'Không thể tạo vòng lặp tài liệu.')
          visited.add(ancestor.id)
          ancestor = data.pages.find((p) => p.id === ancestor.parentId)
        }
        if (parent && !held) args = { ...args, visibility: parent.visibility ?? 'shared' }
      }
      if (args.collection === 'tags') {
        if (args.entityId && !held) return failure('notFound', 'Nhãn không còn tồn tại.')
        if (!['neutral', 'blue', 'green', 'yellow', 'red'].includes(args.color ?? held?.color ?? 'blue'))
          return failure('validation', 'Màu nhãn không hợp lệ.')
        if (
          list.some(
            (t) =>
              t.id !== held?.id &&
              !t.archived &&
              t.title.trim().toLocaleLowerCase() === args.title.trim().toLocaleLowerCase(),
          )
        )
          return failure('validation', 'Tên nhãn đã tồn tại.', { title: 'Chọn tên nhãn khác.' })
      }
      if (
        args.collection === 'fields' &&
        (!fieldKinds.some((f) => f.value === args.kind) ||
          (['select', 'multi-select'].includes(args.kind) && !String(args.options ?? '').trim()))
      )
        return failure('validation', 'Chọn kiểu dữ liệu và nhập các lựa chọn.')
      if (
        args.collection === 'fields' &&
        [
          'version',
          'phiên bản',
          'バージョン',
          'status',
          'trạng thái',
          'priority',
          'ưu tiên',
          'assignee',
          'người phụ trách',
          'due date',
          'hạn hoàn thành',
          'phụ trách',
          'ngày bắt đầu',
          'loại',
          'ステータス',
          '優先度',
          '担当者',
          '期限',
          '開始日',
          '種類',
          'id',
        ].includes(args.title.trim().toLowerCase())
      )
        return failure('validation', 'Tên này dành cho trường hệ thống.')
      const fields = {
        ...(args.collection === 'fields'
          ? {
              required: args.required === 'true',
              appliesTo: args.appliesTo ?? 'all',
              options: [
                ...new Set(
                  String(args.options ?? '')
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean),
                ),
              ],
            }
          : {}),
        ...(args.collection === 'types' ? { icon: args.icon ?? 'list' } : {}),
        ...(args.collection === 'tags' ? { color: args.color ?? held?.color ?? 'blue' } : {}),
        title: args.title.trim(),
        taskId: args.taskId ?? null,
        description: args.description ?? '',
        content: args.description ?? '',
        ...(args.collection === 'epics'
          ? {
              owner: args.owner ?? held?.owner ?? '',
              outcome: args.outcome ?? held?.outcome ?? '',
              goalId: args.goalId ?? held?.goalId ?? '',
            }
          : {}),
        ...(args.collection === 'views'
          ? {
              ownerId: held?.ownerId ?? data.user.id,
              visibility: args.visibility ?? held?.visibility ?? 'private',
            }
          : {}),
        start: args.start,
        end: args.end,
        projectId: Object.hasOwn(args, 'projectId') ? args.projectId : (held?.projectId ?? null),
        ...(args.collection === 'pages'
          ? { visibility: args.visibility ?? held?.visibility ?? 'shared' }
          : {}),
        ...(args.liveDoc ? { liveDoc: args.liveDoc } : {}),
        ...(args.blocks ? { blocks: structuredClone(args.blocks) } : {}),
        parentId: args.parentId ?? null,
        query: args.query ?? '',
        status: args.status ?? 'all',
        code: args.code ?? held?.code ?? '',
        label: args.title,
        kind: args.kind ?? 'todo',
      }
      if (held) Object.assign(held, fields)
      else
        list.push({
          id: `${args.collection}-${list.length + 1}`,
          ...fields,
          progress: 0,
          state: 'planned',
          enabled: false,
          responses: 0,
          version: 1,
        })
      value = { id: held?.id ?? list.at(-1).id }
    } else if (name === 'flow.entity.action') {
      const held = data[args.collection]?.find((x) => x.id === args.entityId)
      if (!held) return failure('notFound', 'Hồ sơ không còn tồn tại.')
      if (args.collection === 'forms' && held.projectId !== args.projectId)
        return failure('validation', 'Thao tác không thuộc dự án này.')
      if (args.collection === 'pages' && args.action === 'move' && args.parentId) {
        let parent = data.pages.find((p) => p.id === args.parentId)
        const visited = new Set()
        if (
          !parent ||
          parent.archived ||
          (parent.projectId ?? null) !== (held.projectId ?? null) ||
          (parent.visibility ?? 'shared') !== (held.visibility ?? 'shared')
        )
          return failure('validation', 'Chỉ di chuyển trong cùng nơi sở hữu và quyền hiển thị.')
        while (parent) {
          if (parent.id === held.id || visited.has(parent.id))
            return failure('cycle', 'Không thể tạo vòng lặp tài liệu.')
          visited.add(parent.id)
          parent = data.pages.find((p) => p.id === parent.parentId)
        }
      }
      if (
        args.action === 'start' &&
        data.sprints.some((x) => x.id !== held.id && x.projectId === held.projectId && x.state === 'active')
      )
        return failure('activeSprint', 'Đã có một sprint đang chạy. Đóng sprint hiện tại trước.')
      if (args.action === 'move' && args.parentId === held.id)
        return failure('cycle', 'Không thể chuyển tài liệu vào chính nó.')
      if (args.action === 'close') {
        const sprintTasks = data.tasks.filter(
          (t) => t.projectId === held.projectId && t.sprint === held.title,
        )
        const initial = held.commitment ?? sprintTasks.map((t) => ({ id: t.id, points: t.points }))
        held.report = hooks.first('sprintReport', { data, sprintTasks, initial, args }) ?? {
          closedAt: new Date().toISOString(),
          tasks: sprintTasks.map((t) => ({ id: t.id, title: t.title, status: t.status, points: t.points })),
          completedPoints: sprintTasks
            .filter((t) => isDone(data, t))
            .reduce((n, t) => n + (t.points || 0), 0),
          committedPoints: initial.reduce((n, t) => n + (t.points || 0), 0),
          added: sprintTasks.filter((t) => !initial.some((x) => x.id === t.id)).length,
          removed: initial.filter((x) => !sprintTasks.some((t) => t.id === x.id)).length,
          taskIds: sprintTasks.map((t) => t.id),
          completed: sprintTasks.filter((t) => isDone(data, t)).length,
          carried: sprintTasks.filter((t) => !isDone(data, t)).length,
          carryTo: args.carryTo ?? 'Backlog',
        }
        held.state = 'closed'
        for (const t of data.tasks.filter(
          (t) => t.projectId === held.projectId && t.sprint === held.title && !isDone(data, t),
        ))
          t.sprint = args.carryTo ?? 'Backlog'
      }
      if (args.action === 'start') {
        held.state = 'active'
        held.commitment = data.tasks
          .filter((t) => t.projectId === held.projectId && t.sprint === held.title)
          .map((t) => ({
            id: t.id,
            points: t.points,
            ...(hooks.first('sprintCommitment', { data, task: t }) ?? {}),
          }))
      }
      if (args.action === 'toggle') held.enabled = !held.enabled
      if (args.action === 'archive') {
        held.archived = true
        held.archivedAt = new Date().toISOString()
        held.archivedBy = data.user.name
      }
      if (args.action === 'restore') {
        held.archived = false
        if (
          args.collection === 'pages' &&
          held.parentId &&
          !data.pages.some((p) => p.id === held.parentId && !p.archived)
        )
          held.parentId = null
      }
      if (args.action === 'read') held.read = true
      if (args.action === 'move') held.parentId = args.parentId || null
    } else if (name === 'flow.preferences.save') data.timezone = args.timezone ?? data.timezone
    else return failure('not_found', 'Thao tác này chưa có hợp đồng fixture.')
    hooks.notify('afterCommand', { data, name, args })
    const assignmentChange =
      task &&
      beforeTask &&
      JSON.stringify(taskAssigneeIds(data, task)) !== JSON.stringify(taskAssigneeIds(data, beforeTask))
        ? `Phụ trách: ${taskAssigneeNames(data, beforeTask)} → ${taskAssigneeNames(data, task)}`
        : ''
    const changes =
      task && beforeTask
        ? ['status', 'startDate', 'dueDate', 'points', 'sprint', 'title']
            .filter((k) => beforeTask[k] !== task[k])
            .map(
              (k) =>
                `${{ status: 'Trạng thái', assignee: 'Phụ trách', startDate: 'Bắt đầu', dueDate: 'Hạn', points: 'Khối lượng', sprint: 'Sprint', title: 'Tiêu đề' }[k]}: ${beforeTask[k] ?? 'chưa đặt'} → ${task[k] ?? 'chưa đặt'}`,
            )
            .concat(assignmentChange ? [assignmentChange] : [])
            .join(' · ')
        : ''
    data.history.unshift({
      id: `h${data.history.length + 1}`,
      person: data.user.name,
      taskId: name.startsWith('flow.issue.') ? (args.id ?? value.id) : args.taskId,
      text: `${changes ? changes + ' · ' : ''}${{ 'flow.issue.save': 'Đã lưu công việc', 'flow.issue.move': 'Đã chuyển trạng thái', 'flow.issue.reorder': 'Đã sắp xếp công việc', 'flow.issue.comment': 'Đã thêm bình luận', 'flow.issue.dependency': 'Đã thêm phụ thuộc', 'flow.issue.archive': 'Đã lưu trữ', 'flow.issue.restore': 'Đã khôi phục', 'flow.issue.follow': 'Đã đổi theo dõi', 'flow.issue.assignSprint': 'Đã đổi sprint', 'flow.issue.linkChild': 'Đã gắn việc con' }[name] ?? 'Đã cập nhật'} · ${args.title ?? args.id ?? ''}`,
      time: 'Vừa xong',
    })
    const result = { ok: true, value }
    replay.set(args.idempotencyKey, structuredClone(result))
    return result
  }
  return { call, data, scenario }
}
