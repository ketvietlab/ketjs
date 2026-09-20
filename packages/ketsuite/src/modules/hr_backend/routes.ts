import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, Translator } from '@ketvietlab/ketjs'
import { modalWorkspace } from '../../ui/index.ts'
import type { FormOption, Frame } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { withParam } from '../backend/paging.ts'
import { adminPage, inLocale, resultErrors } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import { employeeFormModal, employeesListScreen, leavesListScreen, rosterScreen } from './screens/index.ts'
import { rowListSearch } from '../backend/row-list.ts'
import { employeeListSearch, leaveListSearch } from './search.ts'
import type { EmployeeFormValues } from './screens/index.ts'

const hrSearchFunctions = {
  apply: 'hr_backend.applySearchFilter',
  saveFavorite: 'hr_backend.saveSearchFavorite',
  deleteFavorite: 'hr_backend.deleteSearchFavorite',
  setDefaultFavorite: 'hr_backend.setDefaultSearchFavorite',
}

/** A leave state, or an archived employee, in the reader's language. */
const hrGroupLabel = (_: Translator, key: string, value: unknown): string => {
  const raw = value == null ? '' : String(value)
  if (key === 'active') return _(`hr_backend.state.${raw === 'false' ? 'archived' : 'active'}`)
  if (!raw) return _('backend.chrome.groupEmpty')
  const message = `hr_backend.state.${raw}`
  return key === 'state' && _.resolves(message) ? _(message) : raw
}

const errors = (result: unknown, _: Translator) => resultErrors(result, _, 'hr_backend.error.invalid')

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

type EmployeeWriteValues = EmployeeFormValues & {
  partnerId?: string
  departmentId?: string
  jobId?: string
}

const employeeValues = (values: Record<string, unknown> = {}): EmployeeWriteValues => ({
  id: values.id == null ? undefined : String(values.id),
  code: String(values.code ?? ''),
  name: String(values.name ?? ''),
  partnerId: values.partnerId == null ? undefined : String(values.partnerId),
  userId: values.userId == null ? undefined : String(values.userId),
  departmentId: values.departmentId == null ? undefined : String(values.departmentId),
  jobId: values.jobId == null ? undefined : String(values.jobId),
  homeBranchId: String(values.homeBranchId ?? ''),
  timezone: String(values.timezone || 'Asia/Ho_Chi_Minh'),
  startDate: String(values.startDate ?? ''),
  endDate: String(values.endDate ?? ''),
  active: values.active === true || values.active === '1',
})

const employeeListPath = (url: URL): string => inLocale(url, '/admin/hr')
const employeeModalPath = (url: URL, edit?: string): string =>
  inLocale(url, edit ? `/admin/hr?edit=${encodeURIComponent(edit)}` : '/admin/hr?create=1')

const rosterPath = (url: URL, branchId?: string, weekStart?: string): string =>
  inLocale(
    url,
    branchId && weekStart
      ? `/admin/hr/roster?branch=${encodeURIComponent(branchId)}&week=${encodeURIComponent(weekStart)}`
      : '/admin/hr/roster',
  )

const rosterWorkflowPath = (url: URL, roster: AnyRow, branchId: string, weekStart: string): string =>
  inLocale(
    url,
    `/admin/hr/roster?id=${encodeURIComponent(String(roster.id))}&version=${encodeURIComponent(String(roster.version))}&branch=${encodeURIComponent(branchId)}&week=${encodeURIComponent(weekStart)}`,
  )

const leaveListUrl = (url: URL): URL => {
  const next = new URL(url.href)
  next.pathname = '/admin/hr/leaves'
  next.searchParams.delete('id')
  return next
}

const leaveListPath = (url: URL): string => {
  const next = leaveListUrl(url)
  return next.pathname + next.search
}

const branchesOf = async (ctx: ServeContext, url: URL, req: Req): Promise<Array<AnyRow>> => {
  const scope = await ctx.scopeOf(url, req)
  const ids = scope.branches ?? (scope.branch ? [scope.branch] : [])
  return [...new Set(ids)].map((id) => ({ id }))
}

const branchOptions = (rows: AnyRow[], value?: string): FormOption[] => {
  const listed = rows.map((row) => ({
    value: String(row.id),
    label:
      row.code || row.name ? `${String(row.code ?? row.id)} · ${String(row.name ?? row.id)}` : String(row.id),
  }))
  return [
    { value: '', label: '—' },
    ...(value && !listed.some((option) => option.value === value) ? [{ value, label: value }] : []),
    ...listed,
  ]
}

const saveExistingEmployee = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  values: EmployeeWriteValues,
  active: boolean,
) =>
  ctx.call(
    'hr.employee.save',
    {
      id: values.id ?? '',
      code: values.code ?? '',
      partnerId: values.partnerId ?? '',
      userId: values.userId || null,
      departmentId: values.departmentId || null,
      jobId: values.jobId || null,
      homeBranchId: values.homeBranchId ?? '',
      timezone: values.timezone || 'Asia/Ho_Chi_Minh',
      startDate: values.startDate ?? '',
      endDate: values.endDate || null,
      active,
    },
    url,
    req,
  )

const createEmployee = (ctx: ServeContext, url: URL, req: Req, values: EmployeeWriteValues) =>
  ctx.call(
    'hr.employee.create',
    {
      id: values.id || crypto.randomUUID(),
      code: values.code ?? '',
      name: values.name ?? '',
      userId: values.userId || null,
      homeBranchId: values.homeBranchId ?? '',
      timezone: values.timezone || 'Asia/Ho_Chi_Minh',
      startDate: values.startDate ?? '',
    },
    url,
    req,
  )

const employeesPage = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  rows: AnyRow[],
  branches: AnyRow[],
  values?: EmployeeWriteValues,
  rejected: readonly string[] = [],
  editing = false,
  forceModal = false,
) =>
  adminPage(ctx, url, req, {
    title: 'hr_backend.employees.title',
    active: '/admin/hr',
    body: async (_, frame: Frame) => {
      const collection = employeeListPath(url)
      const branchNames = new Map(
        branches.map((row) => [
          String(row.id),
          row.code || row.name
            ? `${String(row.code ?? row.id)} · ${String(row.name ?? row.id)}`
            : String(row.id),
        ]),
      )
      const search = await rowListSearch(ctx, url, req, {
        spec: employeeListSearch,
        rows: rows.map((row) => ({
          id: String(row.id),
          code: String(row.code),
          name: String(row.name),
          branch: branchNames.get(String(row.homeBranchId)) ?? String(row.homeBranchId),
          timezone: String(row.timezone),
          active: row.active !== false,
          editHref: employeeModalPath(url, String(row.id)),
        })),
        frame,
        name: 'hr-employee-filter',
        bodyId: 'hr-employee-list',
        functions: hrSearchFunctions,
        labels: { searchPlaceholder: _('hr_backend.employees.title') },
        groupLabel: (key, value) => hrGroupLabel(_, key, value),
      })
      const list = employeesListScreen(
        _,
        {
          action: collection,
          createHref: employeeModalPath(url),
          rows: search.rows,
          ...(search.groups ? { table: { groups: search.groups } } : {}),
        },
        search.frame,
      )
      if (!forceModal && url.searchParams.get('create') !== '1' && !url.searchParams.get('edit')) return list
      const formValues = editing
        ? values
        : {
            ...values,
            id: values?.id || crypto.randomUUID(),
          }
      return modalWorkspace(
        list,
        employeeFormModal(_, {
          action: editing && formValues?.id ? employeeModalPath(url, formValues.id) : employeeModalPath(url),
          branches: branchOptions(branches, formValues?.homeBranchId),
          cancelHref: collection,
          editing,
          errors: rejected,
          values: formValues,
        }),
      )
    },
  })

export const routes: Record<string, RouteEntry> = {
  '/admin/hr':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      const [rows, branches] = await Promise.all([
        ctx.call('hr.employee.manageList', { includeArchived: true }, url, req) as Promise<AnyRow[]>,
        branchesOf(ctx, url, req),
      ])
      const editId = url.searchParams.get('edit') ?? ''
      const editingRow = editId ? (rows.find((row) => String(row.id) === editId) ?? null) : null
      if (editId && !editingRow) return text('not found', { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        const command = form.action ?? ''
        if (command === 'archive' || command === 'restore') {
          const target = rows.find((row) => String(row.id) === String(form.id ?? ''))
          if (!target) return text('not found', { status: 404 })
          const values = employeeValues(target)
          const result = await saveExistingEmployee(ctx, url, req, values, command === 'restore')
          if ((result as { ok?: boolean }).ok) return seeOther(employeeListPath(url))
          const _ = ctx.translate(ctx.localeOf(url, req))
          return employeesPage(ctx, url, req, rows, branches, values, errors(result, _), true, true)
        }

        if (editingRow) {
          const submitted = employeeValues({ ...form, id: editingRow.id, name: editingRow.name })
          const values: EmployeeWriteValues = {
            ...submitted,
            partnerId: String(editingRow.partnerId),
            departmentId: editingRow.departmentId == null ? undefined : String(editingRow.departmentId),
            jobId: editingRow.jobId == null ? undefined : String(editingRow.jobId),
          }
          const result = await saveExistingEmployee(ctx, url, req, values, submitted.active === true)
          if ((result as { ok?: boolean }).ok) return seeOther(employeeListPath(url))
          const _ = ctx.translate(ctx.localeOf(url, req))
          return employeesPage(ctx, url, req, rows, branches, values, errors(result, _), true, true)
        }

        const values = employeeValues(form)
        const result = await createEmployee(ctx, url, req, values)
        if ((result as { ok?: boolean }).ok) return seeOther(employeeListPath(url))
        const _ = ctx.translate(ctx.localeOf(url, req))
        return employeesPage(ctx, url, req, rows, branches, values, errors(result, _), false, true)
      }
      return employeesPage(
        ctx,
        url,
        req,
        rows,
        branches,
        editingRow ? employeeValues(editingRow) : undefined,
        [],
        Boolean(editingRow),
      )
    },
  '/admin/hr/roster':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      let branchId = url.searchParams.get('branch') ?? '',
        weekStart = url.searchParams.get('week') ?? ''
      let result: unknown = { ok: true }
      if (req.method === 'POST') {
        const form = await readForm(req)
        branchId = form.branchId || url.searchParams.get('branch') || ''
        weekStart = form.weekStart || url.searchParams.get('week') || ''
        result =
          form.action === 'publish'
            ? await ctx.call(
                'hr.roster.managePublish',
                { id: url.searchParams.get('id'), version: Number(url.searchParams.get('version')) },
                url,
                req,
              )
            : form.action === 'reopen'
              ? await ctx.call(
                  'hr.roster.manageReopen',
                  { id: url.searchParams.get('id'), reason: _('hr_backend.roster.reopenReason') },
                  url,
                  req,
                )
              : await ctx.call('hr.roster.generate', { branchId, weekStart }, url, req)
        if ((result as { ok?: boolean }).ok) return seeOther(rosterPath(url, branchId, weekStart))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows =
        branchId && weekStart
          ? ((await ctx.call('hr.roster.manageList', { branchId, weekStart }, url, req)) as AnyRow[])
          : []
      return adminPage(ctx, url, req, {
        title: 'hr_backend.roster.title',
        active: '/admin/hr/roster',
        body: (_, frame) =>
          rosterScreen(
            _,
            {
              action: rosterPath(url),
              branchId,
              errors: errors(result, _),
              rows,
              weekStart,
              workflowAction: (roster) => rosterWorkflowPath(url, roster, branchId, weekStart),
            },
            frame,
          ),
      })
    },
  '/admin/hr/leaves':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      let result: unknown = { ok: true }
      if (req.method === 'POST') {
        const form = await readForm(req)
        result = await ctx.call(
          'hr.leave.manageDecision',
          { id: url.searchParams.get('id'), decision: form.action },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(leaveListPath(url))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })

      const viewUrl = leaveListUrl(url)
      const [requests, employees] = await Promise.all([
        ctx.call('hr.leave.manageList', {}, url, req) as Promise<AnyRow[]>,
        ctx.call('hr.employee.manageList', { includeArchived: true }, url, req) as Promise<AnyRow[]>,
      ])
      const employeeNames = new Map(
        employees.map((row) => [
          String(row.id),
          row.name ? `${String(row.code)} · ${String(row.name)}` : String(row.code ?? row.id),
        ]),
      )
      return adminPage(ctx, url, req, {
        title: 'hr_backend.leaves.title',
        active: '/admin/hr/leaves',
        body: async (_, frame) => {
          const search = await rowListSearch(ctx, url, req, {
            spec: leaveListSearch,
            rows: requests.map((row) => ({
              id: String(row.id),
              employee: employeeNames.get(String(row.employeeId)) ?? String(row.employeeId),
              leaveType: String(row.leaveTypeId),
              dateFrom: String(row.dateFrom),
              dateTo: String(row.dateTo),
              requestedDays: String(row.requestedDays),
              reason: row.reason == null ? undefined : String(row.reason),
              state: String(row.state),
              action: withParam(viewUrl, 'id', String(row.id), false),
            })),
            frame,
            name: 'hr-leave-filter',
            bodyId: 'hr-leave-list',
            functions: hrSearchFunctions,
            labels: { searchPlaceholder: _('hr_backend.search.leaves') },
            groupLabel: (key, value) => hrGroupLabel(_, key, value),
          })
          return leavesListScreen(_, search.frame, {
            errors: errors(result, _),
            rows: search.rows,
            ...(search.groups ? { table: { groups: search.groups } } : {}),
            total: search.groups
              ? search.groups.reduce((sum, group) => sum + group.count, 0)
              : search.rows.length,
          })
        },
      })
    },
}
