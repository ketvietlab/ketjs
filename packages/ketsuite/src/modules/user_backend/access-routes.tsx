import { randomUUID } from 'node:crypto'
import { text, json } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { adminPage, inLocale as localized } from '../backend/screen.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import {
  AccessContext,
  AccessScope,
  dataTable,
  LinkButton,
  Notice,
  RecordPage,
  Section,
  stack,
  Tabs,
  UserSummary,
  UserWorkflow,
  ModalSheet,
  shell,
} from '../../ui/index.ts'
import type { UserRoleOption } from '../../ui/index.ts'
import type { EffectiveAccess } from '../user/authorization.ts'

const inLocale = (url: URL, target: string) => {
  const result = new URL(localized(url, target), 'http://ket.local')
  const back = url.searchParams.get('returnTo')
  if (back && /^\/admin\/users(?:\?|$)/.test(back)) result.searchParams.set('returnTo', back)
  return result.pathname + result.search
}
type Req = Parameters<Route>[1]
type Row = Record<string, any>
const blocked = (req: Req) => {
  const origin = req.headers.origin
  if (!origin) return false
  try {
    return new URL(String(origin)).host !== req.headers.host
  } catch {
    return true
  }
}
const selection = (v: Record<string, string>) =>
  Object.keys(v)
    .filter((k) => k.startsWith('role.'))
    .map((k) => k.slice(5))
const messages: Record<string, string> = {
  E_ROLE_NOT_ASSIGNABLE: 'Có vai trò không còn khả dụng. Vui lòng chọn lại.',
  E_ROLE_ALREADY_ASSIGNED: 'Vai trò đã được gán tại phạm vi này.',
  E_ROLE_SELECTION_INVALID: 'Chọn một hoặc nhiều vai trò khác nhau.',
  E_ASSIGNMENT_MEMBERSHIP_REQUIRED: 'Chưa có nơi làm việc. Chọn thêm nơi làm việc còn thiếu.',
  E_ASSIGNMENT_SCOPE_INVALID: 'Chọn công ty và chi nhánh phù hợp.',
  E_MEMBERSHIP_FORBIDDEN: 'Bạn không có quyền bổ sung nơi làm việc.',
  E_AUTHORIZATION_REVISION_CONFLICT: 'Quyền vừa thay đổi. Kiểm tra lại nội dung trước khi xác nhận.',
  E_EMAIL_UNAVAILABLE: 'Email đã được sử dụng.',
  email_check_unavailable: 'Chưa kiểm tra được email. Vui lòng thử lại.',
  'user.error.loginUnique': 'Tên đăng nhập đã được sử dụng.',
  unique: 'Tên đăng nhập đã được sử dụng.',
}
export const accessError = (result: { errors?: Array<{ field?: string; code: string }> }) =>
  result.errors
    ?.map(
      (e) =>
        messages[e.code] ??
        (e.code === 'user.error.required'
          ? 'Vui lòng điền đầy đủ thông tin và lý do.'
          : 'Không thể lưu thay đổi. Kiểm tra lại thông tin.'),
    )
    .join(' ') ?? 'Không thể lưu thay đổi.'
export async function accessOptions(ctx: ServeContext, url: URL, req: Req) {
  const [companies, roles] = (await Promise.all([
    ctx.call('company.listCompanies', { includeArchived: false }, url, req),
    ctx.call('user.listRoles', {}, url, req),
  ])) as [Row[], Row[]]
  const branches = (
    await Promise.all(
      companies.map((c) =>
        ctx.call('company.listBranches', { companyId: c.id, includeArchived: false }, url, req),
      ),
    )
  ).flat() as Row[]
  return {
    translate: ctx.translate(ctx.localeOf(url, req)),
    companies: companies.map((c) => ({ id: String(c.id), name: String(c.name) })),
    branches: branches.map((b) => ({
      id: String(b.id),
      name: String(b.name),
      companyId: String(b.companyId),
      isRoot: b.isRoot === true,
    })),
    roles,
  }
}
type OptionsFunction = typeof accessOptions
type AccessOptions = Awaited<ReturnType<OptionsFunction>>
const roleOptions = (roles: Row[]): UserRoleOption[] =>
  roles
    .filter((r) => r.mode === 'managed' && !r.healthIssues?.length)
    .map((r) => ({ id: r.id, name: r.name, description: r.description ?? '' }))
const scopeName = (s: Row, options: AccessOptions) =>
  s.scopeKind === 'tenant' || (!s.scopeKind && !s.companyId)
    ? 'Toàn tổ chức'
    : s.scopeKind === 'branch' && !options.branches.find((b) => b.id === s.branchId)?.isRoot
      ? `${options.companies.find((c) => c.id === s.companyId)?.name ?? 'Công ty'} · ${options.branches.find((b) => b.id === s.branchId)?.name ?? 'Chi nhánh'}`
      : (options.companies.find((c) => c.id === s.companyId)?.name ?? 'Công ty')
const auditScope = (key: string, options: AccessOptions) => {
  const company = options.companies.find((c) => key === `company:${c.id}`)
  if (company) return company.name
  const branch = options.branches.find((b) => key === `branch:${b.companyId}:${b.id}`)
  return branch
    ? `${options.companies.find((c) => c.id === branch.companyId)?.name ?? 'Công ty'} · ${branch.name}`
    : 'Toàn tổ chức'
}
const path = (id: string, suffix = '') => `/admin/users/${encodeURIComponent(id)}${suffix}`
const auditName = (event: string) =>
  ({
    'authorization.assignment.created': 'Gán vai trò',
    'authorization.assignment.removed': 'Gỡ vai trò',
    'authorization.user.created': 'Tạo người dùng',
  })[event] ?? 'Thay đổi quyền'
export const previewContent = (result: Row, options: AccessOptions): JSXChild =>
  !result.ok ? (
    <Notice tone="warning" title={accessError(result)} message="" />
  ) : (
    stack(
      (result.contexts ?? []).map((c: Row) => (
        <Section
          title={scopeName({ scopeKind: c.branchId ? 'branch' : 'company', ...c }, options)}
          body={stack([
            c.sensitiveChange ? (
              <Notice
                tone="warning"
                title="Có thay đổi quyền nhạy cảm"
                message="Kiểm tra kỹ vai trò và phạm vi trước khi xác nhận."
              />
            ) : null,
            c.superuser ? (
              <Notice
                title="Quyền đặc biệt đang có hiệu lực"
                message="Thay đổi vai trò chưa làm thay đổi quyền truy cập đặc biệt."
              />
            ) : c.bundles?.length ? (
              dataTable(options.translate, {
                rows: c.bundles,
                id: (b: Row) => b.key,
                columns: [
                  {
                    key: 'name',
                    label: 'Nghiệp vụ',
                    cell: (b: Row) => b.labels?.vi ?? b.labels?.en ?? 'Nghiệp vụ',
                  },
                  {
                    key: 'before',
                    label: 'Trước',
                    cell: (b: Row) =>
                      b.before === 0 ? 'Chưa có' : b.before === b.total ? 'Đầy đủ' : 'Có một phần',
                  },
                  {
                    key: 'after',
                    label: 'Sau',
                    cell: (b: Row) =>
                      b.after === 0 ? 'Không còn' : b.after === b.total ? 'Đầy đủ' : 'Có một phần',
                  },
                ],
              })
            ) : (
              <Notice
                title="Không đổi quyền sử dụng nghiệp vụ"
                message="Quyền có thể vẫn được cấp qua vai trò khác."
              />
            ),
            c.retainedBundles?.length ? (
              <Notice
                title="Nghiệp vụ vẫn được giữ"
                message={c.retainedBundles
                  .map(
                    (b: Row) =>
                      `${b.labels?.vi ?? b.labels?.en ?? 'Nghiệp vụ'}${b.complete ? '' : ' (một phần)'}`,
                  )
                  .join('; ')}
              />
            ) : null,
          ])}
        />
      )),
    )
  )

export async function renderAccess(
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  tab = 'overview',
  modal?: JSXChild,
) {
  const [user, options] = await Promise.all([
    ctx.call('user.getUser', { id }, url, req) as Promise<Row | null>,
    accessOptions(ctx, url, req),
  ])
  if (!['GET', 'POST'].includes(req.method ?? 'GET')) return text('GET', { status: 405 })
  if (!user) return text('Không tìm thấy người dùng', { status: 404 })
  const externalIdentities =
    tab === 'overview'
      ? await ctx.joint(url, req, 'user_backend:user.external-identities', { userId: id })
      : null
  const canAssign =
      user.active && user.accessKind === 'internal' && (await ctx.allows('user.assignRoles', url, req)),
    canRemove = await ctx.allows('user.unassignScopedRole', url, req)
  const names = new Map(options.roles.map((r) => [r.id, r.name])),
    companyId = url.searchParams.get('companyId') ?? user.memberships?.[0]?.companyId ?? '',
    branchId = url.searchParams.get('branchId') ?? ''
  let content: JSXChild
  if (tab === 'access') {
    const groups = new Map<string, Row[]>()
    for (const a of user.assignments ?? []) {
      const key = String(a.scopeKey ?? 'tenant')
      groups.set(key, [...(groups.get(key) ?? []), a])
    }
    content = stack([
      canAssign ? (
        <LinkButton label="Gán vai trò" href={inLocale(url, path(id, '/assign'))} variant="primary" />
      ) : null,
      ...[...groups].map(([, rows]) => (
        <AccessScope
          title={scopeName(rows[0], options)}
          children={dataTable(options.translate, {
            rows,
            id: (a: Row) => a.id,
            rowHref: (a: Row) => inLocale(url, path(id, `/role/${encodeURIComponent(a.roleId)}`)),
            columns: [
              { key: 'role', label: 'Vai trò', cell: (a: Row) => names.get(a.roleId) ?? 'Vai trò cũ' },
              {
                key: 'remove',
                label: 'Thao tác',
                cell: (a: Row) =>
                  canRemove ? (
                    <LinkButton
                      label="Gỡ"
                      href={inLocale(url, path(id, `/remove/${encodeURIComponent(a.id)}`))}
                      variant="tertiary"
                    />
                  ) : (
                    ''
                  ),
              },
            ],
          })}
        />
      )),
      ...(groups.size
        ? []
        : [<Notice title="Chưa gán vai trò" message="Gán các vai trò có sẵn theo nơi làm việc." />]),
    ])
  } else if (tab === 'effective') {
    const effective = (await ctx.call(
      'user.effectiveAccess',
      { userId: id, companyId: companyId || null, branchId: branchId || null },
      url,
      req,
    )) as EffectiveAccess
    const roleIds = new Set(effective.functions.flatMap((f) => f.paths.map((p) => p.roleId)))
    const catalogue = (await ctx.call('user.permissionBundleCatalogue', {}, url, req)) as Row
    const keys = new Set(effective.functions.map((f) => f.key))
    const effectiveBundles = (Object.values(catalogue.bundles) as Row[]).filter((b) =>
      b.functions.some((k: string) => keys.has(k)),
    )
    content = stack([
      <AccessContext
        action={inLocale(url, path(id, '/effective'))}
        companyId={companyId}
        branchId={branchId}
        companies={options.companies.filter((c) => user.memberships?.some((m: Row) => m.companyId === c.id))}
        branches={options.branches.filter((b) =>
          user.branchMemberships?.some((m: Row) => m.branchId === b.id),
        )}
      />,
      effective.superuser ? (
        <Notice title="Quyền đặc biệt đang có hiệu lực" message="" />
      ) : effective.issues.some((i) => i.code.startsWith('invalid-')) ? (
        <Notice title="Chọn nơi làm việc hợp lệ" message="" />
      ) : (
        dataTable(options.translate, {
          rows: options.roles.filter((r) => roleIds.has(r.id)),
          id: (r: Row) => r.id,
          rowHref: (r: Row) => inLocale(url, path(id, `/role/${encodeURIComponent(r.id)}`)),
          columns: [
            { key: 'name', label: 'Vai trò có hiệu lực', cell: (r: Row) => r.name },
            { key: 'description', label: 'Công việc', cell: (r: Row) => r.description ?? '' },
          ],
        })
      ),
      !effective.superuser && effectiveBundles.length ? (
        <Section
          title="Nghiệp vụ được sử dụng"
          body={
            <UserSummary
              rows={effectiveBundles.map((b) => ({
                label: b.labels?.vi ?? b.labels?.en ?? 'Nghiệp vụ',
                value: b.functions.every((k: string) => keys.has(k)) ? 'Đầy đủ' : 'Có một phần',
              }))}
            />
          }
        />
      ) : null,
      ...effective.issues
        .filter((i) => i.code.startsWith('stale-'))
        .map(() => (
          <Notice
            tone="warning"
            title="Có vai trò tạm thời không khả dụng"
            message="Liên hệ người phụ trách hệ thống; các vai trò khác vẫn được đánh giá riêng."
          />
        )),
    ])
  } else if (tab === 'audit') {
    const events = (await ctx.call(
      'user.listAuthorizationAudit',
      {
        userId: id,
        limit: 101,
        ...(url.searchParams.has('beforeRevision')
          ? {
              beforeRevision: Number(url.searchParams.get('beforeRevision')),
              beforeId: url.searchParams.get('beforeId') ?? undefined,
            }
          : {}),
      },
      url,
      req,
    )) as Row[]
    const actors = (await ctx.call(
      'user.listUsers',
      { ids: [...new Set(events.map((e) => e.actorKey).filter(Boolean))], includeArchived: true },
      url,
      req,
    )) as Row[]
    content = dataTable(options.translate, {
      rows: events.slice(0, 100),
      id: (e: Row) => e.id,
      rowHref: (e: Row) => inLocale(url, path(id, `/audit/${encodeURIComponent(e.id)}`)),
      columns: [
        { key: 'at', label: 'Thời điểm', cell: (e: Row) => String(e.occurredAt) },
        { key: 'action', label: 'Thao tác', cell: (e: Row) => auditName(e.event) },
        {
          key: 'actor',
          label: 'Người thực hiện',
          cell: (e: Row) => actors.find((a) => a.id === e.actorKey)?.name ?? 'Hệ thống',
        },
        {
          key: 'roles',
          label: 'Vai trò',
          cell: (e: Row) =>
            (e.metadata?.roleIds ?? [e.metadata?.roleId])
              .filter(Boolean)
              .map((r: string) => names.get(r) ?? 'Vai trò cũ')
              .join(', '),
        },
        { key: 'scope', label: 'Phạm vi', cell: (e: Row) => auditScope(e.scopeKey, options) },
        { key: 'reason', label: 'Lý do', cell: (e: Row) => e.reason ?? '' },
        {
          key: 'result',
          label: 'Kết quả',
          cell: (e: Row) => (e.outcome === 'ok' ? 'Thành công' : 'Bị từ chối'),
        },
      ],
    })
    if (events.length > 100) {
      const last = events[99]
      content = stack([
        content,
        <LinkButton
          label="Sự kiện cũ hơn"
          href={inLocale(
            url,
            path(
              id,
              `/audit?beforeRevision=${last.authorizationRevision}&beforeId=${encodeURIComponent(last.id)}`,
            ),
          )}
        />,
      ])
    }
  } else
    content = stack([
      <Section
        title="Thông tin người dùng"
        body={
          <UserSummary
            rows={[
              { label: 'Email', value: user.email ?? '—' },
              { label: 'Trạng thái', value: user.active ? 'Đang hoạt động' : 'Ngừng hoạt động' },
              { label: 'Vai trò đang giữ', value: String(user.assignments?.length ?? 0) },
              {
                label: 'Công ty',
                value: (user.memberships ?? [])
                  .map((m: Row) => options.companies.find((c) => c.id === m.companyId)?.name)
                  .filter(Boolean)
                  .join(', '),
              },
            ]}
          />
        }
      />,
      externalIdentities,
    ])
  return adminPage(ctx, url, req, {
    title: user.name,
    translate: false,
    active: '/admin/users',
    body: (_, frame) =>
      shell(
        _,
        user.name,
        <RecordPage
          frame={frame}
          title={user.name}
          description={user.login}
          actions={
            <LinkButton
              label="Quay lại danh sách"
              href={
                url.searchParams.get('returnTo')?.match(/^\/admin\/users(?:\?|$)/)
                  ? url.searchParams.get('returnTo')!
                  : localized(url, '/admin/users')
              }
              variant="tertiary"
            />
          }
          body={stack([
            <Tabs
              label="Hồ sơ người dùng"
              items={(
                [
                  ['overview', 'Tổng quan', ''],
                  ['access', 'Quyền truy cập', '/access'],
                  ['effective', 'Quyền hiệu lực', '/effective'],
                  ['audit', 'Nhật ký', '/audit'],
                ] as const
              ).map(([key, label, suffix]) => ({
                id: key,
                label,
                href: inLocale(url, path(id, suffix)),
                active: key === tab,
              }))}
            />,
            content,
            modal,
          ])}
        />,
        { ...frame, chrome: null, topbar: false },
      ),
  })
}

async function assignmentRoute(ctx: ServeContext, url: URL, req: Req, id: string, assignmentId?: string) {
  const removing = !!assignmentId,
    authority = removing ? 'user.unassignScopedRole' : 'user.assignRoles'
  if (!(await ctx.allows(authority, url, req))) return text('Không có quyền thực hiện', { status: 403 })
  if (!['GET', 'POST'].includes(req.method ?? 'GET')) return text('GET or POST', { status: 405 })
  if (req.method === 'POST' && blocked(req)) return text('Forbidden', { status: 403 })
  const [person, options, state] = await Promise.all([
    ctx.call('user.getUser', { id }, url, req) as Promise<Row>,
    accessOptions(ctx, url, req),
    ctx.call('user.authorizationState', {}, url, req) as Promise<{ revision: number }>,
  ])
  if (!person) return text('Không tìm thấy người dùng', { status: 404 })
  const assignment = (person.assignments ?? []).find((a: Row) => a.id === assignmentId)
  if (removing && !assignment) return seeOther(inLocale(url, path(id, '/access')))
  const values: Record<string, string> =
    req.method === 'POST'
      ? await readForm(req)
      : {
          idempotencyKey: randomUUID(),
          companyId: url.searchParams.get('companyId') ?? person.memberships?.[0]?.companyId ?? '',
          branchId: url.searchParams.get('branchId') ?? '',
          scopeKind: url.searchParams.get('branchId') ? 'branch' : 'company',
          expectedAuthorizationRevision: String(state.revision),
        }
  const args = {
    userId: id,
    roleIds: selection(values),
    scopeKind: removing ? String(assignment.scopeKind ?? 'tenant') : (values.scopeKind ?? 'company'),
    companyId: removing ? assignment.companyId : values.companyId || null,
    branchId: removing ? assignment.branchId : values.branchId || null,
    addMembership: values.addMembership === 'on',
  }
  const preview = (await ctx.call(
    'user.previewRoleAssignment',
    { ...args, ...(removing ? { assignmentId } : {}) },
    url,
    req,
  )) as Row
  let error = ''
  if (req.method === 'POST' && values.command === 'confirm') {
    if (
      !values.expectedAuthorizationRevision ||
      !Number.isSafeInteger(Number(values.expectedAuthorizationRevision))
    )
      error = 'Nội dung đã hết hạn. Kiểm tra lại trước khi xác nhận.'
    else {
      const result = (await ctx.call(
        authority,
        removing
          ? {
              assignmentId,
              userId: id,
              roleId: assignment.roleId,
              scopeKey: assignment.scopeKey ?? 'tenant',
              reason: values.reason ?? '',
              expectedAuthorizationRevision: Number(values.expectedAuthorizationRevision),
              idempotencyKey: values.idempotencyKey,
            }
          : {
              ...args,
              reason: values.reason ?? '',
              expectedAuthorizationRevision: Number(values.expectedAuthorizationRevision),
              idempotencyKey: values.idempotencyKey,
            },
        url,
        req,
      )) as Row
      if (result.ok) return seeOther(inLocale(url, path(id, '/access')))
      error = accessError(result)
    }
  }
  const review =
    !removing &&
    !!preview.ok &&
    selection(values).length > 0 &&
    ['preview', 'confirm'].includes(values.command)
  if (!removing && req.method === 'POST' && values.command === 'preview' && !preview.ok)
    error = accessError(preview)
  const body = stack([
    removing ? (
      <UserSummary
        rows={[
          {
            label: 'Vai trò',
            value: options.roles.find((r) => r.id === assignment.roleId)?.name ?? 'Vai trò cũ',
          },
          { label: 'Phạm vi', value: scopeName(assignment, options) },
        ]}
      />
    ) : null,
    <UserWorkflow
      action={inLocale(url, url.pathname)}
      cancelHref={inLocale(url, path(id, '/access'))}
      values={values}
      step={0}
      revision={state.revision}
      companies={options.companies}
      branches={options.branches}
      roles={roleOptions(options.roles).map((r) => ({
        ...r,
        assignedScopes: person.assignments
          .filter((a: Row) => a.roleId === r.id)
          .map((a: Row) => String(a.scopeKey ?? 'tenant')),
        assigned: person.assignments.some(
          (a: Row) =>
            a.roleId === r.id &&
            String(a.scopeKey ?? 'tenant') ===
              (values.scopeKind === 'tenant'
                ? 'tenant'
                : values.scopeKind === 'branch'
                  ? `branch:${values.companyId}:${values.branchId}`
                  : `company:${values.companyId}`),
        ),
      }))}
      emailCheckUrl=""
      mode={removing ? 'remove' : 'assign'}
      error={error}
      review={review}
      preview={removing || review ? previewContent(preview, options) : undefined}
    />,
  ])
  return renderAccess(
    ctx,
    url,
    req,
    id,
    'access',
    <ModalSheet
      {...{
        title: removing ? 'Gỡ vai trò' : 'Gán thêm vai trò',
        description: person.name,
        closeHref: inLocale(url, path(id, '/access')),
        closeLabel: 'Đóng',
        presentation: 'dialog',
        size: 'large',
        body,
      }}
    />,
  )
}
export const accessRoutes: Record<string, RouteEntry> = {
  '/admin/users/check-email': (ctx) => async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (blocked(req)) return text('Forbidden', { status: 403 })
    const form = await readForm(req)
    return json(await ctx.call('user.checkUserEmail', { email: form.email ?? '' }, url, req))
  },
  '/admin/users/{id}/access': (ctx) => async (url, req, p) => renderAccess(ctx, url, req, p.id, 'access'),
  '/admin/users/{id}/effective': (ctx) => async (url, req, p) =>
    renderAccess(ctx, url, req, p.id, 'effective'),
  '/admin/users/{id}/audit': (ctx) => async (url, req, p) => renderAccess(ctx, url, req, p.id, 'audit'),
  '/admin/users/{id}/assign': (ctx) => async (url, req, p) => assignmentRoute(ctx, url, req, p.id),
  '/admin/users/{id}/remove/{assignmentId}': (ctx) => async (url, req, p) =>
    assignmentRoute(ctx, url, req, p.id, p.assignmentId),
  '/admin/users/{id}/audit/{eventId}': (ctx) => async (url, req, p) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const [events, options] = await Promise.all([
      ctx.call('user.listAuthorizationAudit', { userId: p.id, id: p.eventId }, url, req) as Promise<Row[]>,
      accessOptions(ctx, url, req),
    ])
    const event = events[0]
    if (!event) return text('Không tìm thấy thay đổi', { status: 404 })
    const actors = (await ctx.call(
      'user.listUsers',
      { ids: event.actorKey ? [event.actorKey] : [], includeArchived: true },
      url,
      req,
    )) as Row[]
    return renderAccess(
      ctx,
      url,
      req,
      p.id,
      'audit',
      <ModalSheet
        {...{
          title: 'Chi tiết thay đổi quyền',
          closeLabel: 'Đóng',
          closeHref: inLocale(url, path(p.id, '/audit')),
          presentation: 'dialog',
          body: (
            <UserSummary
              rows={[
                { label: 'Thời điểm', value: String(event.occurredAt) },
                { label: 'Thao tác', value: auditName(event.event) },
                {
                  label: 'Người thực hiện',
                  value: actors.find((a) => a.id === event.actorKey)?.name ?? 'Hệ thống',
                },
                {
                  label: 'Vai trò',
                  value: (event.metadata?.roleIds ?? [event.metadata?.roleId])
                    .filter(Boolean)
                    .map((id: string) => options.roles.find((r) => r.id === id)?.name ?? 'Vai trò cũ')
                    .join(', '),
                },
                { label: 'Phạm vi', value: auditScope(event.scopeKey, options) },
                { label: 'Lý do', value: event.reason ?? '' },
                { label: 'Kết quả', value: event.outcome === 'ok' ? 'Thành công' : 'Bị từ chối' },
              ]}
            />
          ),
        }}
      />,
    )
  },
  '/admin/users/{id}/role/{roleId}': (ctx) => async (url, req, p) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const role = (await ctx.call('user.getRole', { id: p.roleId }, url, req)) as Row
    if (!role) return text('Không tìm thấy vai trò', { status: 404 })
    const options = await accessOptions(ctx, url, req)
    const catalogue = (await ctx.call('user.permissionBundleCatalogue', {}, url, req)) as Row
    const keys = new Set((role.grants ?? []).map((g: Row) => g.fnKey))
    const bundles = (Object.values(catalogue.bundles) as Row[]).filter((b) =>
      b.functions.some((k: string) => keys.has(k)),
    )
    return renderAccess(
      ctx,
      url,
      req,
      p.id,
      'access',
      <ModalSheet
        {...{
          title: role.name,
          description: 'Vai trò do hệ thống định nghĩa',
          closeHref: inLocale(url, path(p.id, '/access')),
          closeLabel: 'Đóng',
          presentation: 'dialog',
          body: (
            <UserSummary
              rows={[
                { label: 'Công việc', value: role.description ?? '' },
                ...bundles.map((b) => ({
                  label: b.labels.vi ?? b.labels.en,
                  value: b.functions.every((k: string) => keys.has(k)) ? 'Đầy đủ' : 'Có một phần',
                })),
                {
                  label: 'Tình trạng',
                  value: options.roles.find((r) => r.id === role.id)?.healthIssues?.length
                    ? 'Tạm thời không khả dụng'
                    : 'Đang có hiệu lực',
                },
              ]}
            />
          ),
        }}
      />,
    )
  },
}
