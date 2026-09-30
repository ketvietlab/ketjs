import { atlasExtensions } from './extensions.mjs'
import { expandRealisticFixtures } from './realistic-fixtures.mjs'
import { documentAccess } from '@ketvietlab/flow-client/document-access.mjs'
import { captureProduct, recordProductChanges } from './product-audit.mjs'
import {
  validateCatalog,
  projectStatuses,
  projectTags,
  taskColumns,
  taskTags,
  statusKind,
} from '@ketvietlab/flow-client/project-catalogs.mjs'
import { seedOperations, operationsCommand } from './operations-store.mjs'
import { createFixtureSession } from './store.mjs'
import {
  clearOrganization,
  createAccount,
  seedFirstWorkspace,
  blankStages,
  BLANK_COMPANY,
} from './blank-organization.mjs'
import { accessFor, canManageScope, moveImpact } from '@ketvietlab/flow-client/access-model.mjs'
import {
  sprintCadence,
  validCadence,
  overlappingSprint,
  activeSprint,
  DEFAULT_CADENCE,
} from '@ketvietlab/flow-client/sprint-cadence.mjs'
const fail = (code, message, fields = {}) => ({
  ok: true,
  value: { ok: false, errors: [{ code, message }], fields },
})
const ok = (value) => ({ ok: true, value })
export function createOrganizationSession(
  scenario = 'baseline',
  route = 'my-work',
  { profile = 'compact', extensions = [] } = {},
) {
  const hooks = atlasExtensions(extensions)
  const blank = blankStages.includes(scenario),
    account = blank ? createAccount(scenario) : null
  const companies = blank
    ? [BLANK_COMPANY]
    : [
        { id: 'demo', name: 'Két Việt' },
        { id: 'north', name: 'Northstar Studio' },
      ]
  const sessions = new Map(),
    replay = new Map()
  for (const company of companies) {
    const session = createFixtureSession(
        ['guest', 'revoked', 'member'].includes(scenario) || blank ? 'baseline' : scenario,
        route,
        { extensions },
      ),
      d = session.data
    d.company = company
    d.companies = companies
    d.organizationRevision = 1
    const prefix = company.id === 'demo' ? '' : `${company.id}-`
    if (prefix) {
      for (const collection of [
        'projects',
        'tasks',
        'pages',
        'epics',
        'sprints',
        'views',
        ...hooks.values('collections'),
        'forms',
        'inbox',
        'files',
        'history',
      ])
        for (const item of d[collection] ?? []) {
          item.id = prefix + item.id
          for (const key of ['projectId', 'taskId', 'parentId']) if (item[key]) item[key] = prefix + item[key]
          if (item.blockedBy) item.blockedBy = item.blockedBy.map((x) => prefix + x)
        }
      d.projects[0].title = 'Website Northstar'
      if (d.tasks[0]) d.tasks[0].title = 'Ra mắt website Northstar'
    }
    d.members = [
      { id: 'mai', name: 'Mai Anh', email: 'mai@example.test', role: 'owner', status: 'active' },
      { id: 'bao', name: 'Trần Quốc Bảo', email: 'bao@example.test', role: 'member', status: 'active' },
      { id: 'ha', name: 'Lê Thu Hà', email: 'ha@example.test', role: 'member', status: 'active' },
      {
        id: 'guest',
        name: 'An · Khách hàng',
        email: 'an@example.test',
        role: 'guest',
        status: scenario === 'revoked' ? 'revoked' : 'active',
      },
    ]
    d.user =
      scenario === 'guest' || scenario === 'revoked'
        ? { id: 'guest', name: 'An · Khách hàng' }
        : scenario === 'member'
          ? { id: 'bao', name: 'Trần Quốc Bảo' }
          : d.user
    d.workspaces = [
      {
        id: prefix + 'product',
        companyId: company.id,
        title: 'Sản phẩm',
        description: 'Phát triển sản phẩm và cộng tác với khách hàng.',
        access: 'private',
        archived: false,
      },
      {
        id: prefix + 'operations',
        companyId: company.id,
        title: 'Vận hành',
        description: 'Quy trình và vận hành đội ngũ.',
        access: 'private',
        archived: false,
      },
      {
        id: prefix + 'lab',
        companyId: company.id,
        title: 'Thử nghiệm',
        description: 'Không gian cho ý tưởng mới.',
        access: 'internal',
        archived: false,
      },
    ]
    d.teams = [
      {
        id: 'engineering',
        companyId: company.id,
        title: 'Engineering',
        description: 'Nhóm kỹ thuật, tham gia nhiều Workspace.',
        memberIds: ['mai', 'bao'],
      },
      {
        id: 'success',
        companyId: company.id,
        title: 'Customer Success',
        description: 'Nhóm phụ trách khách hàng và vận hành.',
        memberIds: ['mai', 'ha'],
      },
    ]
    for (const key of ['sprints', 'epics'])
      for (const item of d[key]) if (!item.projectId) item.projectId = prefix + 'core'
    d.projects.forEach((p, i) => {
      p.companyId = company.id
      p.workspaceId = prefix + (i === 1 ? 'operations' : 'product')
      p.access = i === 2 ? 'private' : 'workspace'
    })
    d.grants = [
      {
        id: 'g1',
        scope: 'workspace',
        targetId: prefix + 'product',
        subjectType: 'team',
        subjectId: 'engineering',
        role: 'member',
      },
      {
        id: 'g2',
        scope: 'workspace',
        targetId: prefix + 'operations',
        subjectType: 'team',
        subjectId: 'success',
        role: 'member',
      },
      {
        id: 'g3',
        scope: 'workspace',
        targetId: prefix + 'lab',
        subjectType: 'team',
        subjectId: 'engineering',
        role: 'member',
      },
      ...d.projects.map((p, i) => ({
        id: 'owner-' + i,
        scope: 'project',
        targetId: p.id,
        subjectType: 'user',
        subjectId: 'mai',
        role: 'admin',
      })),
      {
        id: 'g4',
        scope: 'project',
        targetId: prefix + 'docs',
        subjectType: 'user',
        subjectId: 'guest',
        role: 'viewer',
      },
      {
        id: 'g5',
        scope: 'project',
        targetId: prefix + 'docs',
        subjectType: 'team',
        subjectId: 'success',
        role: 'editor',
      },
    ]
    d.tags.forEach((t) => {
      t.domain ??= 'task'
    })
    d.tags.push(
      { id: 'project-strategic', title: 'Strategic', color: 'blue', domain: 'project' },
      { id: 'project-customer', title: 'Customer', color: 'green', domain: 'project' },
    )
    d.projects.forEach((p) => {
      p.tags = []
    })
    for (const p of d.pages) {
      p.ownerId = 'mai'
      p.readerIds = []
      p.history = []
      if (!p.projectId) p.workspaceId = prefix + 'product'
    }
    for (const f of d.fields) if (f.title === 'Phiên bản') f.title = f.label = 'Phiên bản phát hành'
    d.invitations = [
      { id: 'invite-1', email: 'linh@example.test', role: 'member', status: 'pending', projectId: null },
    ]
    d.projectFavorites = [d.projects[0].id]
    d.recentProjects = d.projects.map((p) => p.id)
    if (
      scenario === 'empty' &&
      ['workspaces', 'workspace-overview', 'workspace-settings', 'workspace-members'].includes(route)
    ) {
      d.projects = []
      d.tasks = []
      d.pages = []
    }
    seedOperations(d)
    hooks.notify('seedOrganization', d, scenario, { prefix, company })
    if (profile === 'realistic' && !blank) expandRealisticFixtures(d, scenario, hooks)
    hooks.notify('linkSeed', d)
    if (['today', 'today-success'].includes(scenario)) {
      const task = d.tasks.find((t) => t.id === prefix + 'KV-131'),
        dependent = d.tasks.find((t) => t.id === prefix + 'KV-151')
      task.status = 'todo'
      task.blockedBy = []
      dependent.blockedBy = [task.id]
      dependent.assignee = 'Mai Anh'
      dependent.assigneeIds = ['mai']
      d.inbox.unshift({
        id: prefix + 'today-assignment',
        taskId: task.id,
        actorId: 'bao',
        recipientId: 'mai',
        kind: 'assignment',
        titleKey: 'flow.today.assigned',
        description: task.title,
        read: false,
        actionNeeded: true,
        route: 'issue',
        createdAt: '2026-09-22T08:00:00Z',
      })
      if (scenario === 'today-success') {
        const before = captureProduct(d)
        task.status = 'progress'
        task.version++
        recordProductChanges(d, before)
        d.inbox.find((n) => n.id === prefix + 'today-assignment').read = true
      }
    }

    for (const t of d.tasks) {
      const epic = d.epics.find((e) => e.projectId === t.projectId && e.title === t.epic)
      if (epic) t.epic = epic.id
    }
    hooks.notify('finishSeed', d, scenario, { profile, blank, prefix })
    if (blank) {
      clearOrganization(d)
      hooks.notify('clearOrganization', d)
    }
    if (scenario === 'blank-workspace') seedFirstWorkspace(d)
    sessions.set(company.id, session)
  }
  function call(name, args = {}) {
    const d = sessions.get(args.companyId ?? 'demo')?.data,
      before = d && name !== 'flow.workspace.bootstrap' ? captureProduct(d) : null
    const result = dispatch(name, args)
    if (before && result.ok && result.value?.ok !== false) {
      hooks.notify('afterOrganizationCommand', d, before)
      recordProductChanges(d, before)
    }
    return result
  }
  function dispatch(name, args = {}) {
    if (account) {
      const refused = account.gate(name)
      if (refused) return refused
      const result = account.command(name, args)
      if (result) return result
    }
    if (['guest', 'revoked'].includes(scenario) && args.companyId && args.companyId !== 'demo')
      return fail('forbidden', 'Bạn không có quyền vào tổ chức này.')
    const session = sessions.get(args.companyId ?? 'demo')
    if (!session) return fail('forbidden', 'Tổ chức không tồn tại hoặc bạn không có quyền truy cập.')
    const d = session.data,
      user = d.members.find((m) => m.id === d.user.id)
    if (scenario === 'revoked' || !user || user.status !== 'active')
      return fail('revoked', 'Quyền truy cập đã được thu hồi. Nội dung tổ chức không còn khả dụng.')
    if (scenario === 'forbidden') return fail('forbidden', 'Bạn không có quyền xem phạm vi này.')
    const projects = d.projects.filter((p) => accessFor(d, p, d.user.id).role)
    const projectIds = new Set(projects.map((p) => p.id))
    const memberTeams = d.teams.filter((t) => t.memberIds.includes(d.user.id)).map((t) => t.id)
    const workspaces = d.workspaces.filter(
      (w) =>
        !w.archived &&
        (canManageScope(d, 'workspace', w.id) ||
          (user.role !== 'guest' &&
            (w.access === 'internal' ||
              d.grants.some(
                (g) =>
                  g.scope === 'workspace' &&
                  g.targetId === w.id &&
                  (g.subjectType === 'user' ? g.subjectId === d.user.id : memberTeams.includes(g.subjectId)),
              ))) ||
          projects.some((p) => p.workspaceId === w.id)),
    )
    const targetTask = d.tasks.find((t) => t.id === (args.recordId ?? args.id ?? args.taskId))
    const targetPage = d.pages.find((p) => p.id === (args.recordId ?? args.id ?? args.entityId))
    const requestedProject = targetTask?.projectId ?? targetPage?.projectId ?? args.projectId
    if (requestedProject && !projectIds.has(requestedProject))
      return fail('forbidden', 'Dự án không tồn tại hoặc bạn chưa được cấp quyền.')
    if (targetPage && !documentAccess(d, targetPage).read)
      return fail('forbidden', 'Tài liệu không tồn tại hoặc bạn chưa được cấp quyền.')
    if (
      name === 'flow.page.reorder' &&
      !documentAccess(
        d,
        d.pages.find((p) => p.id === args.targetId),
      ).write
    )
      return fail('forbidden', 'Không có quyền sửa tài liệu đích.')
    if (targetPage && name !== 'flow.workspace.bootstrap' && !documentAccess(d, targetPage).write)
      return fail('forbidden', 'Bạn chỉ có quyền xem tài liệu.')
    if (
      args.parentId &&
      args.collection === 'pages' &&
      !documentAccess(
        d,
        d.pages.find((p) => p.id === args.parentId),
      ).write
    )
      return fail('forbidden', 'Không có quyền sửa tài liệu cha.')
    if (name === 'flow.document.command') {
      if (scenario === 'readonly' || !targetPage || !documentAccess(d, targetPage).manage)
        return fail('forbidden', 'Chỉ chủ tài liệu được đổi phạm vi chia sẻ.')
      const key = d.company.id + ':doc:' + user.id + ':' + args.idempotencyKey
      if (!args.idempotencyKey) return fail('validation', 'Thiếu khóa thao tác.')
      if (replay.has(key)) return structuredClone(replay.get(key))
      if (args.expectedVersion !== targetPage.version)
        return fail('conflict', 'Tài liệu đã đổi. Tải lại trước khi lưu.')
      if (
        !['shared', 'private'].includes(args.visibility) ||
        !Array.isArray(args.readerIds) ||
        args.readerIds.some(
          (id) => !documentAccess(d, { ...targetPage, visibility: 'shared', readerIds: [id] }, id).read,
        )
      )
        return fail('validation', 'Chọn người đang có quyền trong phạm vi tài liệu.')
      targetPage.visibility = args.visibility
      targetPage.readerIds = [...new Set(args.readerIds)]
      const result = ok({ id: targetPage.id })
      replay.set(key, result)
      return result
    }
    if (name === 'flow.workspace.bootstrap') {
      if (
        user.role === 'guest' &&
        [
          'settings',
          'project-profile',
          'project-members',
          'project-move',
          ...hooks.values('adminRoutes'),
          'forms',
          'workspace-settings',
          'workspace-members',
          'organization',
          'organization-members',
          'permissions',
          'teams',
        ].includes(args.route)
      )
        return fail('forbidden', 'Bạn không có quyền vào công cụ quản trị.')
      const response = session.call(name, args)
      if (response.value?.ok === false) return response
      const result = response.value
      result.projects = structuredClone(projects).map((p) => ({
        ...p,
        accessInfo: accessFor(d, p, d.user.id),
      }))
      result.workspaces = structuredClone(workspaces)
      for (const collection of ['tasks', 'epics', 'sprints', 'views', 'forms'])
        result[collection] = result[collection].filter((x) => projectIds.has(x.projectId ?? projects[0]?.id))
      result.columns = result.columns.filter((c) => !c.projectId || projectIds.has(c.projectId))
      result.tags = result.tags.filter((t) => !t.projectId || projectIds.has(t.projectId))
      result.pages = result.pages
        .filter((p) => documentAccess(d, p).read)
        .map((p) => ({ ...p, access: documentAccess(d, p) }))
      for (const p of result.pages)
        if (p.parentId && !result.pages.some((x) => x.id === p.parentId)) p.parentId = null
      result.grants = result.grants.filter((g) =>
        g.scope === 'project' ? projectIds.has(g.targetId) : workspaces.some((w) => w.id === g.targetId),
      )
      const taskIds = new Set(result.tasks.map((t) => t.id))
      for (const collection of ['inbox', 'files', 'history'])
        result[collection] = result[collection].filter(
          (x) => (!x.taskId || taskIds.has(x.taskId)) && (!x.recipientId || x.recipientId === d.user.id),
        )
      const target = projects.find((p) => p.id === requestedProject)
      if (
        args.workspaceId &&
        !workspaces.some((w) => w.id === args.workspaceId) &&
        !d.workspaces.some((w) => w.id === args.workspaceId && w.archived) &&
        !target
      )
        return fail('forbidden', 'Bạn không có quyền vào Workspace này.')
      const workspaceId =
        target?.workspaceId ??
        (workspaces.some((w) => w.id === args.workspaceId) ? args.workspaceId : (workspaces[0]?.id ?? ''))
      result.context = { companyId: d.company.id, workspaceId, projectId: target?.id ?? null }
      result.capabilities = {
        write:
          scenario !== 'readonly' &&
          (target ? accessFor(d, target, d.user.id).role !== 'viewer' : user.role !== 'guest'),
        manageOrganization: scenario !== 'readonly' && canManageScope(d, 'company', d.company.id),
      }
      if (user.role === 'guest') {
        result.members = [structuredClone(user)]
        result.teams = []
        result.grants = d.grants.filter((g) => g.subjectType === 'user' && g.subjectId === user.id)
        result.invitations = []
        result.companies = [d.company]
        result.people = [user.name]
        result.forms = []
        result.fields = []
        result.projectFavorites = []
      }
      result.formResponses = (result.formResponses ?? []).filter((r) =>
        result.forms.some((f) => f.id === r.formId),
      )
      result.views = result.views.filter(
        (v) => !v.archived && (!v.ownerId || v.ownerId === d.user.id || v.visibility === 'project'),
      )
      result.history = result.history.filter((h) => h.taskId && taskIds.has(h.taskId))
      hooks.notify('scope', { d, result, scenario, user, projectIds, taskIds, workspaces })

      return ok(result)
    }
    const extended = hooks.first('organizationCommand', {
      d,
      name,
      args,
      scenario,
      replay,
      baseCall: session.call,
      fail,
    })
    if (extended !== undefined) return extended
    if (name === 'flow.operations.command') return operationsCommand(d, args, scenario, replay, session.call)
    if (name === 'flow.project.move.preview') {
      const p = d.projects.find((p) => p.id === args.projectId),
        w = d.workspaces.find((w) => w.id === args.targetWorkspaceId && !w.archived)
      if (!p || !w || p.workspaceId === w.id)
        return fail('validation', 'Chọn Workspace đích khác trong cùng tổ chức.')
      if (!canManageScope(d, 'project', p.id) || !canManageScope(d, 'workspace', w.id))
        return fail('forbidden', 'Cần quyền quản trị dự án và Workspace đích.')
      return ok({
        projectId: p.id,
        targetWorkspaceId: w.id,
        revision: d.organizationRevision,
        preserve: !!args.preserve,
        people: moveImpact(d, p, w.id, !!args.preserve),
      })
    }
    if (name === 'flow.organization.command') {
      if (scenario === 'readonly') return fail('forbidden', 'Bạn chỉ có quyền xem.')
      if (!args.idempotencyKey) return fail('validation', 'Thiếu khóa thao tác.')
      const key = d.company.id + ':' + args.idempotencyKey
      if (replay.has(key)) return structuredClone(replay.get(key))
      const action = args.action,
        heldGrant = d.grants.find((g) => g.id === args.id),
        scope =
          action === 'access.grant'
            ? args.scope
            : action === 'access.revoke'
              ? heldGrant?.scope
              : action.startsWith('project.')
                ? 'project'
                : action.startsWith('workspace.')
                  ? 'workspace'
                  : 'company'
      if (
        action !== 'project.favorite' &&
        !canManageScope(
          d,
          scope,
          action === 'access.grant'
            ? args.targetId
            : action === 'access.revoke'
              ? heldGrant?.targetId
              : (args.id ?? args.projectId ?? d.company.id),
        )
      )
        return fail('forbidden', 'Bạn chưa có quyền quản lý phạm vi này.')
      if (args.expectedRevision !== d.organizationRevision)
        return fail('conflict', 'Quyền hoặc cấu trúc đã thay đổi. Tải lại và xem trước lần nữa.')
      let value = {}
      if (['workspace.save', 'team.save', 'company.save'].includes(action)) {
        if (!String(args.title ?? '').trim()) return fail('validation', 'Vui lòng nhập tên.')
        if (action === 'company.save') d.company.name = args.title.trim()
        else {
          const collection = action.startsWith('team') ? 'teams' : 'workspaces'
          let entity = d[collection].find((x) => x.id === args.id)
          if (!entity) {
            entity = {
              id: collection + '-' + crypto.randomUUID(),
              companyId: d.company.id,
              memberIds: [],
              archived: false,
              createdAt: new Date().toISOString(),
            }
            d[collection].push(entity)
          }
          Object.assign(entity, {
            title: args.title.trim(),
            description: args.description ?? '',
            access: args.access ?? 'private',
          })
          value = { id: entity.id }
        }
      } else if (action === 'workspace.archive') {
        const w = d.workspaces.find((w) => w.id === args.id)
        if (!w) return fail('notFound', 'Workspace không còn tồn tại.')
        if (d.projects.some((p) => p.workspaceId === w.id && !p.archived))
          return fail('activeProjects', 'Chuyển hoặc lưu trữ các Project trước khi lưu trữ Workspace.')
        w.archived = true
      } else if (action === 'member.invite') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email ?? ''))
          return fail('validation', 'Nhập email hợp lệ.')
        if (!['member', 'admin', 'guest'].includes(args.role))
          return fail('validation', 'Vai trò không hợp lệ.')
        if (args.role === 'guest' && !d.projects.some((p) => p.id === args.projectId))
          return fail('validation', 'Khách mời phải được cấp một Project cụ thể.')
        if (d.invitations.some((i) => i.email === args.email && i.status === 'pending'))
          return fail('validation', 'Email này đã có lời mời đang chờ.')
        d.invitations.push({
          id: crypto.randomUUID(),
          email: args.email,
          role: args.role,
          projectId: args.role === 'guest' ? args.projectId : null,
          status: 'pending',
          sentAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        })
      } else if (action === 'invitation.resend') {
        const i = d.invitations.find((i) => i.id === args.id && i.status === 'pending')
        if (!i) return fail('validation', 'Lời mời không còn hiệu lực.')
        i.sentAt = new Date().toISOString()
        i.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
        i.resendCount = (i.resendCount ?? 0) + 1
      } else if (action === 'invitation.revoke') {
        const i = d.invitations.find((i) => i.id === args.id)
        if (!i) return fail('notFound', 'Không tìm thấy lời mời.')
        i.status = 'revoked'
      } else if (action === 'member.update') {
        const m = d.members.find((m) => m.id === args.id)
        if (!m || m.role === 'owner')
          return fail('validation', 'Chủ sở hữu được bảo vệ; cần chuyển quyền sở hữu trước.')
        if (!['admin', 'member', 'guest'].includes(args.role))
          return fail('validation', 'Vai trò không hợp lệ.')
        Object.assign(m, { role: args.role, status: args.revoke ? 'revoked' : 'active' })
      } else if (action === 'team.member') {
        const t = d.teams.find((t) => t.id === args.id),
          m = d.members.find((m) => m.id === args.memberId && m.role !== 'guest' && m.status === 'active')
        if (!t || !m) return fail('validation', 'Chọn thành viên nội bộ đang hoạt động.')
        t.memberIds = args.remove
          ? t.memberIds.filter((x) => x !== m.id)
          : [...new Set([...t.memberIds, m.id])]
      } else if (action === 'access.grant') {
        if (
          !['workspace', 'project'].includes(args.scope) ||
          !['viewer', 'editor', 'admin'].includes(args.role) ||
          !['user', 'team'].includes(args.subjectType)
        )
          return fail('validation', 'Phạm vi hoặc vai trò không hợp lệ.')
        const target = (args.scope === 'project' ? d.projects : d.workspaces).find(
          (x) => x.id === args.targetId,
        )
        const ids = [...new Set(args.subjectIds ?? [args.subjectId])]
        if (!target || !ids.length || ids.length > 100)
          return fail('validation', 'Chọn người hoặc Team để cấp quyền.')
        for (const id of ids) {
          const subject = (args.subjectType === 'team' ? d.teams : d.members).find((x) => x.id === id)
          if (
            !subject ||
            subject.status === 'revoked' ||
            (subject.role === 'guest' && args.scope !== 'project')
          )
            return fail('validation', 'Chỉ cấp quyền trong tổ chức; khách mời chỉ được cấp Project.')
        }
        for (const id of ids) {
          d.grants = d.grants.filter(
            (g) =>
              !(
                g.scope === args.scope &&
                g.targetId === args.targetId &&
                g.subjectType === args.subjectType &&
                g.subjectId === id
              ),
          )
          d.grants.push({
            id: crypto.randomUUID(),
            scope: args.scope,
            targetId: args.targetId,
            subjectType: args.subjectType,
            subjectId: id,
            role: args.role,
          })
        }
      } else if (action === 'access.revoke') {
        const g = d.grants.find((g) => g.id === args.id)
        if (!g) return fail('notFound', 'Quyền đã được gỡ.')
        d.grants = d.grants.filter((x) => x.id !== g.id)
      } else if (action === 'project.move') {
        const preview = call('flow.project.move.preview', args)
        if (preview.value?.ok === false) return preview
        const p = d.projects.find((p) => p.id === args.projectId)
        if (args.preserve)
          for (const row of moveImpact(d, p, args.targetWorkspaceId, false).filter(
            (x) => x.change === 'loss',
          ))
            d.grants.push({
              id: crypto.randomUUID(),
              scope: 'project',
              targetId: p.id,
              subjectType: 'user',
              subjectId: row.id,
              role: row.before.role,
            })
        p.workspaceId = args.targetWorkspaceId
        value = { id: p.id, workspaceId: p.workspaceId }
      } else if (action === 'project.access') {
        const p = d.projects.find((p) => p.id === args.id)
        if (!p || !['private', 'workspace'].includes(args.access))
          return fail('validation', 'Dự án hoặc chế độ truy cập không hợp lệ.')
        p.access = args.access
      } else if (action === 'project.favorite') {
        if (!projectIds.has(args.id)) return fail('forbidden', 'Bạn không có quyền xem dự án.')
        d.projectFavorites = d.projectFavorites.includes(args.id)
          ? d.projectFavorites.filter((x) => x !== args.id)
          : [...d.projectFavorites, args.id]
      } else {
        const extra = hooks.first('organizationAction', { d, action, args })
        if (extra === undefined) return fail('unknown', 'Thao tác không được hỗ trợ.')
        value = extra
      }
      d.organizationRevision++
      const result = ok(value)
      replay.set(key, structuredClone(result))
      return result
    }
    if (
      ['columns', 'types', 'fields', 'tags'].includes(args.collection) &&
      !canManageScope(d, 'company', d.company.id)
    )
      return fail('forbidden', 'Cần quyền quản lý thư viện tổ chức.')
    if (targetPage && args.expectedVersion !== undefined && args.expectedVersion !== targetPage.version)
      return fail('conflict', 'Tài liệu đã thay đổi. Tải lại trước khi lưu.')
    if (hooks.values('readNames').includes(name)) return session.call(name, args)
    if (
      requestedProject &&
      accessFor(
        d,
        d.projects.find((p) => p.id === requestedProject),
        d.user.id,
      ).role === 'viewer'
    )
      return fail('forbidden', 'Bạn chỉ có quyền xem dự án này.')
    if (scenario === 'guest' || scenario === 'readonly')
      return fail('forbidden', 'Bạn chỉ có quyền xem trong phạm vi được cấp.')
    if (
      ['flow.issue.bulk', 'flow.issue.reorder'].includes(name) &&
      args.ids !== undefined &&
      !Array.isArray(args.ids)
    )
      return fail('validation', 'Danh sách lựa chọn không hợp lệ.')
    if (
      name === 'flow.issue.reorder' &&
      args.targetId &&
      !d.tasks.some((t) => t.id === args.targetId && projectIds.has(t.projectId))
    )
      return fail('forbidden', 'Không có quyền vào nhóm đích.')
    if (
      ['flow.issue.bulk', 'flow.issue.reorder'].includes(name) &&
      (args.ids ?? []).some((id) => {
        const task = d.tasks.find((t) => t.id === id),
          project = d.projects.find((p) => p.id === task?.projectId)
        return (
          !project || !['editor', 'member', 'admin', 'owner'].includes(accessFor(d, project, d.user.id).role)
        )
      })
    )
      return fail('forbidden', 'Lựa chọn có công việc ngoài quyền chỉnh sửa.')
    const extensionRefusal = hooks.first('beforeOrganizationCommand', { d, name, args, fail })
    if (extensionRefusal) return extensionRefusal
    const projectSave = args.collection === 'projects' && name === 'flow.entity.save'
    let heldProject
    if (projectSave) {
      heldProject = d.projects.find((p) => p.id === args.entityId)
      args = { ...args, access: args.access ?? heldProject?.access ?? 'workspace' }
      if (args.entityId && !heldProject) return fail('notFound', 'Dự án không còn tồn tại.')
      if (heldProject && !canManageScope(d, 'project', heldProject.id))
        return fail('forbidden', 'Cần quyền quản trị dự án.')
      if (
        !d.workspaces.some((w) => w.id === args.workspaceId && !w.archived) ||
        (!heldProject && !canManageScope(d, 'workspace', args.workspaceId))
      )
        return fail('validation', 'Chọn Workspace được phép quản lý trong cùng tổ chức.')
      if (heldProject && (heldProject.workspaceId !== args.workspaceId || heldProject.access !== args.access))
        return fail('validation', 'Dùng luồng chuyển Workspace hoặc quản lý quyền để thay đổi phạm vi.')
      if (!args.idempotencyKey) return fail('validation', 'Thiếu khóa thao tác.')
      const key = d.company.id + ':project:' + args.idempotencyKey
      if (replay.has(key)) return structuredClone(replay.get(key))
      const code = String(args.code ?? heldProject?.code ?? '')
        .trim()
        .toUpperCase()
      if (!/^[A-Z][A-Z0-9]{1,11}$/.test(code))
        return fail('validation', 'Kiểm tra mã dự án.', { code: 'Dùng 2–12 chữ/số, bắt đầu bằng chữ.' })
      if (d.projects.some((p) => p.id !== heldProject?.id && p.code.toUpperCase() === code))
        return fail('validation', 'Mã dự án đã được dùng.', { code: 'Chọn mã khác trong tổ chức.' })
      if (!['workspace', 'private'].includes(args.access)) return fail('validation', 'Chọn chế độ truy cập.')
      const ownerId = args.ownerId ?? heldProject?.ownerId ?? d.user.id
      const internal = (id) =>
        d.members.some((m) => m.id === id && m.status === 'active' && m.role !== 'guest')
      if (!internal(ownerId))
        return fail('validation', 'Chọn người phụ trách đang hoạt động.', {
          ownerId: 'Thành viên không hợp lệ.',
        })
      for (const field of ['memberIds', 'teamIds'])
        if (args[field] !== undefined && !Array.isArray(args[field]))
          return fail('validation', 'Danh sách cộng tác không hợp lệ.')
      if (
        (args.memberIds ?? []).some((id) => !internal(id)) ||
        (args.teamIds ?? []).some((id) => !d.teams.some((t) => t.id === id && t.companyId === d.company.id))
      )
        return fail('validation', 'Chỉ chọn người và Team trong tổ chức.')
      if (!['board', 'project-issues'].includes(args.defaultView ?? 'board'))
        return fail('validation', 'Màn hình mặc định không hợp lệ.')
      for (const key of ['projectStatuses', 'projectLabels', 'taskStatuses', 'taskLabels'])
        if (args[key] != null) {
          const error = validateCatalog(args[key], {
            statuses: key.endsWith('Statuses'),
            requireGroups: key === 'taskStatuses',
          })
          if (error) return fail('validation', error, { [key]: error })
          if (
            key !== 'projectStatuses' &&
            args[key].some((x) =>
              (key === 'taskStatuses' ? d.columns : d.tags).some(
                (existing) =>
                  existing.id === x.id &&
                  (existing.projectId !== heldProject?.id ||
                    existing.domain !== (key === 'projectLabels' ? 'project' : 'task') ||
                    !heldProject),
              ),
            )
          )
            return fail('validation', 'Bản tùy chỉnh cần ID riêng, không ghi đè thư viện tổ chức.')
        }
      const labelIds = [...(args.projectLabels ?? []), ...(args.taskLabels ?? [])].map((x) => x.id)
      if (new Set(labelIds).size !== labelIds.length)
        return fail('validation', 'Nhãn dự án và nhãn công việc cần ID riêng.')
      for (const [key, oldCatalog] of [
        ['taskStatuses', taskColumns(d, heldProject?.id)],
        ['taskLabels', taskTags(d, heldProject?.id)],
      ])
        if (args[key]) {
          const sources = args[key].filter((x) => x.sourceId).map((x) => x.sourceId)
          if (
            new Set(sources).size !== sources.length ||
            sources.some((id) => !oldCatalog.some((c) => c.id === id))
          )
            return fail('validation', 'Nguồn sao chép không thuộc bộ cấu hình hiện tại.')
          if (heldProject) {
            const used = d.tasks.filter((t) => t.projectId === heldProject.id)
            const replacement = (id) => args[key].find((c) => c.id === id || c.sourceId === id)
            if (key === 'taskStatuses' && used.some((t) => !replacement(t.status)))
              return fail('validation', 'Không xóa trạng thái đang được công việc sử dụng.')
            if (key === 'taskStatuses' && used.some((t) => replacement(t.status).kind !== statusKind(d, t)))
              return fail('validation', 'Không đổi nhóm của trạng thái đang được sử dụng.')
            if (key === 'taskLabels' && used.some((t) => (t.tags ?? []).some((id) => !replacement(id))))
              return fail('validation', 'Không xóa nhãn đang được công việc sử dụng.')
          }
        }
      if (
        !(args.projectStatuses ?? projectStatuses(heldProject)).some(
          (x) => x.id === (args.state ?? 'planned'),
        )
      )
        return fail('validation', 'Trạng thái dự án không hợp lệ.')
      if (
        args.tags !== undefined &&
        (!Array.isArray(args.tags) ||
          args.tags.some(
            (id) =>
              !(args.projectLabels ?? projectTags(d, heldProject)).some(
                (t) => t.id === id && (!t.archived || heldProject?.tags?.includes(id)),
              ),
          ))
      )
        return fail('validation', 'Nhãn không hợp lệ.')
      for (const key of ['start', 'end'])
        if (
          args[key] &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(args[key]) ||
            !Number.isFinite(Date.parse(args[key])) ||
            new Date(args[key]).toISOString().slice(0, 10) !== args[key])
        )
          return fail('validation', 'Ngày không hợp lệ.', { [key]: 'Nhập ngày hợp lệ.' })
      if (args.start && args.end && args.end < args.start)
        return fail('validation', 'Ngày mục tiêu phải từ ngày bắt đầu trở đi.', {
          end: 'Không được trước ngày bắt đầu.',
        })
      if (args.sprintCadence !== undefined && !validCadence(args.sprintCadence))
        return fail('validation', 'Nhịp sprint không hợp lệ.', {
          sprintCadence: 'Chọn 1–4 tuần và một ngày bắt đầu.',
        })
      if (heldProject && args.sprintCadence === null && activeSprint(d, heldProject.id))
        return fail('validation', 'Đóng sprint đang chạy trước khi chuyển dự án sang Kanban.', {
          sprintCadence: 'Còn sprint đang chạy.',
        })
      const cadence =
        args.sprintCadence !== undefined
          ? args.sprintCadence
          : heldProject
            ? sprintCadence(heldProject)
            : DEFAULT_CADENCE
      args = {
        ...args,
        code,
        ownerId,
        defaultView: args.defaultView ?? 'board',
        sprintCadence: cadence && { weeks: cadence.weeks, weekday: cadence.weekday },
      }
    }
    if (
      ['flow.issue.save', 'flow.issue.assignSprint'].includes(name) &&
      args.sprint &&
      args.sprint !== 'Backlog'
    ) {
      const projectId = args.projectId ?? targetTask?.projectId
      if (sprintCadence(d.projects.find((p) => p.id === projectId)) === null)
        return fail('validation', 'Dự án này làm theo Kanban, không gán sprint.')
      if (!d.sprints.some((s) => s.projectId === projectId && s.title === args.sprint))
        return fail('validation', 'Sprint phải thuộc cùng dự án.')
    }
    if (
      name === 'flow.issue.save' &&
      args.epic &&
      !d.epics.some((e) => e.id === args.epic && e.projectId === (targetTask?.projectId ?? args.projectId))
    )
      return fail('validation', 'Epic phải thuộc cùng dự án.')
    if (name === 'flow.entity.save' && args.collection === 'sprints') {
      const project = d.projects.find((p) => p.id === args.projectId),
        held = d.sprints.find((s) => s.id === args.entityId),
        title = String(args.title ?? '').trim()
      if (!project) return fail('validation', 'Chọn dự án cho sprint.')
      if (!held && sprintCadence(project) === null)
        return fail('validation', 'Dự án này làm theo Kanban. Bật sprint trong hồ sơ dự án trước.')
      if (
        d.sprints.some(
          (s) =>
            s.projectId === project.id &&
            s.id !== held?.id &&
            s.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase(),
        )
      )
        return fail('validation', 'Tên sprint đã có trong dự án.', { title: 'Chọn tên khác.' })
      const clash =
        args.start && args.end ? overlappingSprint(d, project.id, args.start, args.end, held?.id) : null
      if (clash)
        return fail('validation', `Trùng lịch với ${clash.title} (${clash.start} → ${clash.end}).`, {
          start: 'Chọn ngày sau khi sprint kia kết thúc.',
        })
    }
    const response = session.call(name, args)
    if (response.value?.ok !== false && projectSave) {
      const p = d.projects.find((p) => p.id === response.value.id)
      if (p) {
        Object.assign(p, {
          companyId: d.company.id,
          workspaceId: args.workspaceId,
          access: args.access,
          ownerId: args.ownerId,
          outcome: args.outcome ?? '',
          defaultView: args.defaultView,
          state: args.state ?? 'planned',
          tags: [...new Set(args.tags ?? [])],
          sprintCadence: args.sprintCadence,
        })
        // Convert inherited definitions only inside this project, preserving semantic state.
        const statusMap = new Map(
          (args.taskStatuses ?? []).filter((x) => x.sourceId).map((x) => [x.sourceId, x.id]),
        )
        const labelMap = new Map(
          (args.taskLabels ?? []).filter((x) => x.sourceId).map((x) => [x.sourceId, x.id]),
        )
        for (const task of d.tasks.filter((t) => t.projectId === p.id)) {
          const status = statusMap.get(task.status) ?? task.status,
            tags = (task.tags ?? []).map((id) => labelMap.get(id) ?? id)
          if (status !== task.status || tags.some((id, i) => id !== task.tags[i])) {
            task.status = status
            task.tags = tags
            task.version++
          }
        }
        for (const view of d.views.filter((v) => v.projectId === p.id))
          view.status = statusMap.get(view.status) ?? view.status
        hooks.notify('remapCatalog', { d, p, statusMap })
        if (args.projectStatuses)
          p.projectStatuses = args.projectStatuses.map((x) => ({
            id: x.id,
            title: x.title.trim(),
            color: x.color,
            kind: x.kind,
          }))
        for (const [key, collection, idsKey, domain] of [
          ['taskStatuses', 'columns', 'taskStatusIds', 'task'],
          ['taskLabels', 'tags', 'taskLabelIds', 'task'],
          ['projectLabels', 'tags', 'projectLabelIds', 'project'],
        ])
          if (args[key]) {
            const oldIds = p[idsKey] ?? []
            d[collection] = d[collection].filter((x) => !oldIds.includes(x.id))
            const entries = args[key].map((x) => ({
              id: x.id,
              title: x.title.trim(),
              label: x.title.trim(),
              color: x.color,
              ...(key === 'taskStatuses' ? { kind: x.kind } : {}),
              projectId: p.id,
              domain,
            }))
            d[collection].push(...entries)
            p[idsKey] = entries.map((x) => x.id)
          }
        const grant = (subjectType, subjectId, role) => {
          const held = d.grants.find(
            (g) =>
              g.scope === 'project' &&
              g.targetId === p.id &&
              g.subjectType === subjectType &&
              g.subjectId === subjectId,
          )
          if (held) {
            if (role === 'admin') held.role = role
          } else
            d.grants.push({
              id: crypto.randomUUID(),
              scope: 'project',
              targetId: p.id,
              subjectType,
              subjectId,
              role,
            })
        }
        if (!heldProject) {
          grant('user', d.user.id, 'admin')
          for (const id of args.memberIds ?? []) grant('user', id, 'editor')
          for (const id of args.teamIds ?? []) grant('team', id, 'editor')
        }
        grant('user', args.ownerId, 'admin')
        d.organizationRevision++
        replay.set(d.company.id + ':project:' + args.idempotencyKey, structuredClone(response))
      }
    }
    if (response.value?.ok !== false && args.collection === 'pages' && name === 'flow.entity.save') {
      const p = d.pages.find((p) => p.id === response.value.id)
      if (p) {
        p.ownerId ??= d.user.id
        p.readerIds ??= []
        if (!p.projectId) p.workspaceId ??= args.workspaceId
      }
    }
    return response
  }
  return { call, scenario, sessions }
}
