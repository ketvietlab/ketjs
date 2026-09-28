import { auditChange } from './audit-display.mjs'
import { mutationFeedback } from './mutation-feedback.mjs'
import { FlowLiveDoc, FlowLiveDocText, FlowLiveDocLegacyBlocks } from '@ketvietlab/flow-ui'
import { tr, flowLocaleTag, flowLocale, setFlowLocale, FLOW_LANGUAGES } from './i18n.mjs'
import {
  taskAssigneeIds,
  taskUsers,
  taskAssigneeNames,
  isAssignedTo,
  taskUserOptions,
} from './task-assignees.mjs'
import { taskColumns, taskTags, projectStatuses, statusKind, isDone } from './project-catalogs.mjs'
import { html, each, signal, batch } from '@ketvietlab/ketjs-view'
import {
  FlowShell,
  FlowDialog,
  FlowButton,
  FlowSearch,
  FlowSelect,
  FlowInput,
  FlowCheckbox,
  FlowStatus,
  FlowPriority,
  FlowAvatar,
  FlowTag,
  FlowTaskRow,
  FlowTaskCard,
  FlowEmpty,
} from '@ketvietlab/flow-ui'
import {
  FlowUserPicker,
  FlowDateField,
  FlowChoiceField,
  FlowFileDrop,
  FlowAttachment,
  FlowMediaPreview,
  FlowDisclosure,
  FlowList,
  FlowListItem,
  FlowHint,
  FlowContextPicker,
  FlowProjectDirectory,
  FlowSearchTrigger,
  FlowScopeMenu,
  FlowScopeTabs,
  FlowUserMenu,
  FlowSpotlight,
  FlowTagPicker,
  FlowColorPicker,
  FlowNavigation,
  FlowNavItem,
  FlowNavGroup,
  FlowToolbar,
  FlowProjectViews,
  FlowInline,
  FlowStack,
  FlowSection,
  FlowNotice,
  FlowToast,
  FlowMetrics,
  FlowTable,
  FlowGroup,
  FlowBoard,
  FlowRecordLayout,
  FlowRecordAsideTrigger,
  FlowProperties,
  FlowPropertyFields,
  FlowTextarea,
  FlowSelectField,
  FlowResourceCard,
  FlowCardGrid,
  FlowActivity,
  FlowSheet,
  FlowLoading,
} from '@ketvietlab/flow-ui/workspace'
import { attachFlowUI } from '@ketvietlab/flow-ui/runtime'
import { routeScope, pageRoutes, libraryReturn, managementNavigation } from './navigation.mjs'
import { routes } from './routes.mjs'
import { commandResults } from './command-search.mjs'
import { contentWidthFor } from './content-layout.mjs'
import { appliesTo, validateCustomFields } from './custom-fields.mjs'
import { createOperations, operationRoutes } from './operations.mjs'
import { flowExtensions, extensionRoutes, extensionForms } from './extensions.mjs'
import { createOrganization, organizationRoutes, organizationForms } from './organization.mjs'
import { canManageScope } from './access-model.mjs'
import { createDocuments, documentRoutes } from './documents.mjs'
import { todayDate, addDays } from './timeline.mjs'
import { sortedListTasks, taskPage, orderedTasks, taskGroupValue, taskGroups } from './task-order.mjs'
import { createTaskAutosave } from './task-autosave.mjs'
import { createProjectSetup } from './project-setup.mjs'
import { usesSprints, nextSprint } from './sprint-cadence.mjs'
import { createFirstRun } from './first-run.mjs'
import { createTaskComposer } from './task-composer.mjs'
import { createTransientNotice } from './notice.mjs'
import { createFnClient, createFileUploader } from './api.mjs'

const moreRoutes = {
  dashboard: ['flow.ui.overview', 'flow.ui.manage'],
  forms: ['flow.ui.intake.forms', 'flow.ui.setup'],
  calendar: ['flow.ui.task.calendar', 'flow.ui.planning'],
  'saved-views': ['flow.ui.saved.views', 'flow.ui.work'],
}
for (const [key, [title, group]] of Object.entries(moreRoutes))
  routes[key] = {
    get title() {
      return tr(title)
    },
    get group() {
      return tr(group)
    },
    pattern: 'workspace',
  }
Object.assign(routes, organizationRoutes)
export { routes }
const listKeys = new Set([
  'my-work',
  'all-issues',
  'issue-filter',
  'project-issues',
  'issues-archived',
  'filter-limit',
  'bulk',
])
const detailKeys = new Set(['issue', 'issue-peek', 'description', 'history', 'follow'])
export const taskModalRoutes = new Set([
  ...detailKeys,
  'issue-new',
  'subtask-new',
  'issue-move',
  'board-move',
  'issue-sprint',
  'subtask-link',
  'dependency-new',
  'issue-archive',
  'comment',
])
const documentKeys = new Set(['pages', 'all-pages', 'page-archived'])
const formDefinitions = {
  'project-new': {
    collection: 'projects',
    get title() {
      return tr('flow.ui.create.project')
    },
    back: 'projects',
  },
  'project-profile': {
    collection: 'projects',
    get title() {
      return tr('flow.ui.project.profile')
    },
    back: 'settings',
    edit: true,
  },
  'column-edit': {
    collection: 'columns',
    get title() {
      return tr('flow.ui.task.statuses.d92c22')
    },
    back: 'workspace-settings',
  },
  'type-edit': {
    collection: 'types',
    get title() {
      return tr('flow.ui.task.type')
    },
    back: 'workspace-settings',
  },
  'field-edit': {
    collection: 'fields',
    get title() {
      return tr('flow.ui.custom.fields')
    },
    back: 'workspace-settings',
  },
  'tag-edit': {
    collection: 'tags',
    get title() {
      return tr('flow.ui.shared.labels')
    },
    back: 'tags',
  },
  'sprint-new': {
    collection: 'sprints',
    get title() {
      return tr('flow.ui.create.sprint')
    },
    back: 'sprints',
  },
  'epic-new': {
    collection: 'epics',
    get title() {
      return tr('flow.ui.create.epic')
    },
    back: 'epics',
  },
  'page-new': {
    collection: 'pages',
    get title() {
      return tr('flow.ui.create.document')
    },
    back: 'pages',
  },
  'page-child': {
    collection: 'pages',
    get title() {
      return tr('flow.ui.add.child.document')
    },
    back: 'page',
  },
}
const documentModalRoutes = new Set(['page-new', 'page-child', 'page-move'])
const coreFormModals = new Set([
  ...Object.keys(formDefinitions),
  ...Object.keys(organizationForms),
  'page-move',
  'sprint-close',
  'display',
  'timezone',
  'cmdk',
])
// Extensions register their forms after this module loads, so membership is checked on use.
const formModalRoutes = { has: (key) => coreFormModals.has(key) || Object.hasOwn(extensionForms, key) }
const modalRoutes = { has: (key) => taskModalRoutes.has(key) || formModalRoutes.has(key) }
const modalFallback = (key) =>
  extensionForms[key]?.back ??
  organizationForms[key]?.back ??
  formDefinitions[key]?.back ??
  {
    'page-move': 'page',
    'sprint-close': 'sprints',
    display: 'all-issues',
    timezone: 'workspace-settings',
    cmdk: 'my-work',
  }[key] ??
  'my-work'
const tidy = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
const collect = (e) => Object.fromEntries(new FormData(e.currentTarget))
const options = (values) => values.map((value) => ({ value, label: value }))
const inline = (...children) =>
  FlowInline({
    children: html`${each(
      children,
      (_, i) => i,
      (x) => html`${x}`,
    )}`,
  })
const actions = (...children) =>
  FlowInline({
    align: 'end',
    children: html`${each(
      children,
      (_, i) => i,
      (x) => html`${x}`,
    )}`,
  })
const stack = (...children) =>
  FlowStack({
    children: html`${each(
      children,
      (_, i) => i,
      (x) => html`${x}`,
    )}`,
  })

/** Product island factory. Environment changes the transport, never the presenters. */
export function createFlowWorkspace(props = {}, dependencies = {}) {
  const transport = dependencies.call ?? createFnClient()
  const upload = dependencies.upload ?? createFileUploader()
  const companyId = signal(props.companyId ?? 'demo'),
    workspaceId = signal(props.workspaceId ?? '')
  const personalWorkspace = signal('all')
  let mounted = false
  const recentByCompany = new Map(),
    recentCommands = new Map()
  const call = (name, input = {}, options = {}) =>
    transport(name, { companyId: companyId(), workspaceId: workspaceId(), ...input }, options)
  const data = signal(null),
    loading = signal(true),
    failure = signal(null),
    busy = signal(false),
    notice = signal('')
  const feedback = createTransientNotice((value) => notice.set(value))
  const dismissedDataNotice = signal('')
  // Files dropped on a task save immediately; a failed save keeps them here for retry.
  const pendingFiles = signal(null),
    previewFile = signal('')
  const selectedView = signal(props.view ?? '')
  const savedViewOpen = signal(false)
  let savedViewDraft = { title: '', description: '' }
  const modalRoute = signal(modalRoutes.has(props.screen) ? props.screen : null)
  const activeRoute = () => modalRoute() ?? screen()
  const screen = signal(
      modalRoutes.has(props.screen) ? modalFallback(props.screen) : (props.screen ?? 'my-work'),
    ),
    record = signal(props.record ?? 'KV-142'),
    project = signal(props.project ?? 'core'),
    modalProject = signal(props.project ?? 'core'),
    modalScope = signal(props.scope ?? '')
  const query = signal(props.query ?? ''),
    status = signal(props.status ?? 'all'),
    selected = signal([]),
    theme = signal('light'),
    density = signal('compact')
  const formError = signal({}),
    commandQuery = signal(''),
    commandActive = signal(''),
    groupBy = signal('status')
  let lifetime, readController, runtime, host, observer
  let lastOp = null
  let mutationTail = Promise.resolve()
  const saveRevision = signal(0)
  const documentScope = signal(props.scope ?? ''),
    libraryFilter = signal(props.projectFilter ?? 'all'),
    librarySearch = signal(''),
    libraryVisibility = signal('shared'),
    documentReturn = signal('')
  let modalBackground = { screen: modalFallback(props.screen), url: '', record: props.record ?? 'KV-142' }
  let scrollPositions = new Map()
  const base = props.basePath ?? '/flow/'
  const canWrite = () => {
    if (data()?.capabilities?.write !== true) return false
    const access = data()?.projects.find(
      (p) => p.id === (modalRoute() ? modalProject() : project()),
    )?.accessInfo
    return scopeOf(activeRoute()) !== 'project' || !access || access.role !== 'viewer'
  }
  const scopeOf = (key) =>
    routeScope(key, modalRoute() && key === activeRoute() ? modalScope() : documentScope())
  const activeProject = () => (modalRoute() ? modalProject() : project())
  const backgroundRecord = () => (modalRoute() ? modalBackground.record : record())
  const selectedProject = () => data()?.projects.find((p) => p.id === project())
  const href = (key, params = {}) => {
    const scoped =
      routeScope(key, params.scope ?? (modalRoute() ? modalScope() : documentScope())) === 'project'
    const q = new URLSearchParams({
      company: companyId(),
      workspace: workspaceId(),
      lang: flowLocale(),
      ...(scoped ? { project: activeProject() } : {}),
      ...(listKeys.has(key) || key === 'board' ? { group: groupBy() } : {}),
      ...(pageRoutes.has(key) && !scoped ? { scope: 'workspace' } : {}),
      ...(pageRoutes.has(key) && documentReturn() ? { returnTo: documentReturn() } : {}),
      ...(extensionFor(key)?.urlParams?.() ?? {}),
      ...params,
    })
    if (!scoped) q.delete('project')
    for (const [name, value] of q) if (!value || value === 'undefined' || value === 'null') q.delete(name)
    return `${base}${key}${q.size ? `?${q}` : ''}`
  }
  const documentContext = () => {
    if (!pageRoutes.has(activeRoute()) || !data()) return
    const page = data().pages.find((p) => p.id === record())
    if (page && !['pages', 'page-new', 'page-archived'].includes(activeRoute())) {
      ;(modalRoute() ? modalProject : project).set(page.projectId ?? '')
      ;(modalRoute() ? modalScope : documentScope).set(page.projectId ? 'project' : 'workspace')
      if (typeof location !== 'undefined') {
        const url = new URL(location.href)
        if (page.projectId) {
          url.searchParams.set('project', page.projectId)
          url.searchParams.delete('scope')
        } else {
          url.searchParams.delete('project')
          url.searchParams.set('scope', 'workspace')
        }
        history.replaceState(history.state, '', url)
      }
    }
  }
  const currentTask = () => {
    saveRevision()
    const task =
      data()?.tasks.find((t) => t.id === record()) ?? (record() === 'KV-142' ? data()?.tasks[0] : null)
    return task ? { ...task, ...autosave.draft(task.id) } : null
  }
  const mapped = (t) => ({
    ...t,
    assignees: taskUsers(data(), t),
    project: data()?.projects.find((p) => p.id === t.projectId)?.title ?? '',
    status: data()?.columns.find((c) => c.id === t.status)?.kind ?? 'todo',
    statusColor: data()?.columns.find((c) => c.id === t.status)?.color,
    statusLabel: data()?.columns.find((c) => c.id === t.status)?.label ?? t.status,
  })
  const readUrl = () =>
    batch(() => {
      const url = new URL(location.href)
      savedViewOpen.set(url.searchParams.get('modal') === 'save-view')
      selectedView.set(url.searchParams.get('view') ?? '')
      const nextCompany = url.searchParams.get('company') ?? props.companyId ?? 'demo'
      const changedCompany = nextCompany !== companyId()
      if (changedCompany || (url.searchParams.get('workspace') ?? '') !== workspaceId())
        for (const x of extensions) x.reset?.()
      if (changedCompany) {
        readController?.abort()
        data.set(null)
        loading.set(true)
        failure.set(null)
        feedback.clear()
        dismissedDataNotice.set('')
        companyId.set(nextCompany)
      }
      workspaceId.set(url.searchParams.get('workspace') ?? '')
      personalWorkspace.set(url.searchParams.get('workspaceFilter') ?? 'all')
      const key = url.pathname.slice(base.length).replace(/\/$/, '') || 'my-work'
      documentScope.set(
        url.searchParams.get('scope') ?? (url.searchParams.has('project') ? 'project' : 'workspace'),
      )
      libraryFilter.set(
        url.searchParams.get('projectFilter') ??
          (key === 'all-pages' ? url.searchParams.get('project') : null) ??
          'all',
      )
      librarySearch.set(url.searchParams.get('docq') ?? '')
      libraryVisibility.set(url.searchParams.get('visibility') === 'private' ? 'private' : 'shared')
      if (routeScope(key, documentScope()) !== 'project') {
        url.searchParams.delete('project')
        if (key === 'all-pages') {
          if (libraryFilter() !== 'all') url.searchParams.set('projectFilter', libraryFilter())
          for (const name of ['group', 'q', 'status']) url.searchParams.delete(name)
        }
        history.replaceState(history.state, '', url)
      }
      documentReturn.set(libraryReturn(url.searchParams.get('returnTo'), base))
      if (modalRoutes.has(key)) {
        const stored = history.state?.flowBackground
        if (
          stored &&
          routes[stored.screen] &&
          !modalRoutes.has(stored.screen) &&
          (new URL(stored.url, url).searchParams.get('company') ?? 'demo') === companyId()
        )
          modalBackground = stored
        if (!modalBackground.url)
          modalBackground = {
            screen: modalFallback(key),
            url: `${base}${modalFallback(key)}${formModalRoutes.has(key) ? url.search : ''}`,
            record: url.searchParams.get('id') ?? 'KV-142',
          }
        screen.set(modalBackground.screen)
        modalRoute.set(key)
      } else {
        screen.set(routes[key] ? key : 'my-work')
        modalRoute.set(null)
      }
      record.set(url.searchParams.get('id') ?? 'KV-142')
      const viewUrl = modalRoute() ? new URL(modalBackground.url, url) : url
      modalProject.set(url.searchParams.get('project') ?? '')
      modalScope.set(
        url.searchParams.get('scope') ?? (url.searchParams.has('project') ? 'project' : 'workspace'),
      )
      project.set(viewUrl.searchParams.get('project') ?? '')
      documentScope.set(
        viewUrl.searchParams.get('scope') ?? (viewUrl.searchParams.has('project') ? 'project' : 'workspace'),
      )
      documentReturn.set(libraryReturn(viewUrl.searchParams.get('returnTo'), base))
      libraryFilter.set(viewUrl.searchParams.get('projectFilter') ?? 'all')
      librarySearch.set(viewUrl.searchParams.get('docq') ?? '')
      libraryVisibility.set(viewUrl.searchParams.get('visibility') === 'private' ? 'private' : 'shared')
      selectedView.set(viewUrl.searchParams.get('view') ?? '')
      for (const x of extensions) x.readUrl?.(Object.fromEntries(viewUrl.searchParams))
      documentContext()
      query.set(viewUrl.searchParams.get('q') ?? '')
      status.set(viewUrl.searchParams.get('status') ?? 'all')
      const grouping = viewUrl.searchParams.get('group') ?? 'status'
      groupBy.set(
        ['status', 'priority', 'assignee', 'sprint', 'none'].includes(grouping) ? grouping : 'status',
      )
      failure.set(null)
      formError.set({})
      for (const x of extensions) void x.sync?.()
      if (changedCompany && mounted) void reload()
    })
  const navigate = (key, params = {}, navigation = {}) => {
    if (params.project) {
      const target = data()?.projects.find((p) => p.id === params.project)
      if (target) {
        const recent = recentByCompany.get(companyId()) ?? data()?.recentProjects ?? []
        recentByCompany.set(companyId(), [target.id, ...recent.filter((id) => id !== target.id)])
      }
      if (target?.workspaceId) params = { workspace: target.workspaceId, ...params }
    }
    if (key === 'cmdk' && modalRoute() !== 'cmdk') {
      commandQuery.set('')
      commandActive.set('')
    }
    if (organizationForms[key]) organization.reset()
    for (const x of extensions) x.beforeNavigate?.(key)
    if (['project-new', 'project-profile'].includes(key)) projectSetup.reset()
    if (!modalRoutes.has(key) && (key !== screen() || (params.project && params.project !== project())))
      operations.reset()
    if (key === 'tag-edit') tagPreview.set(null)
    if (key === 'field-edit') fieldKind.set('text')
    if (key === 'column-edit') columnKind.set('todo')
    const area = host?.querySelector('[data-flow="shell-content"]')
    if (area) scrollPositions.set(screen(), area.scrollTop)
    const docArea = host?.querySelector('[data-flow="docs-scroll"]')
    if (docArea)
      scrollPositions.set(`document:${modalRoute() ? modalBackground.record : record()}`, docArea.scrollTop)
    let state = {}
    if (modalRoutes.has(key)) {
      if (!modalRoute())
        modalBackground = {
          screen: screen(),
          url: location.pathname + location.search,
          record: record(),
        }
      state = {
        flowBackground: modalBackground,
        flowModalDepth: modalRoute()
          ? (history.state?.flowModalDepth ?? 0) + (navigation.replace ? 0 : 1)
          : 1,
      }
    }
    history[navigation.replace ? 'replaceState' : 'pushState'](
      state,
      '',
      href(key, {
        ...(listKeys.has(key) || ['board', 'calendar'].includes(key) || routes[key]?.taskSearch
          ? { q: query(), status: status() }
          : {}),
        ...params,
      }),
    )
    readUrl()
    feedback.clear()
    requestAnimationFrame(() => {
      const a = host?.querySelector('[data-flow="shell-content"]')
      if (a) a.scrollTop = scrollPositions.get(screen()) ?? 0
      const d = host?.querySelector('[data-flow="docs-scroll"]')
      if (d)
        d.scrollTop = scrollPositions.get(`document:${modalRoute() ? modalBackground.record : record()}`) ?? 0
    })
  }
  const link = (key, label, icon = 'folder', params = {}, active = undefined) =>
    FlowNavItem({
      label,
      icon,
      count: key === 'inbox' ? data()?.inbox.filter((n) => !n.read).length || undefined : undefined,
      href: href(key, params),
      active:
        active ??
        (screen() === key ||
          (key === 'all-pages' && pageRoutes.has(screen()) && scopeOf(screen()) === 'workspace')),
      onClick: (e) => {
        if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(key, params)
      },
    })
  const navButton = (key, label, icon, variant = 'secondary', params = {}) =>
    FlowButton({ label, icon, variant, size: 'sm', onClick: () => navigate(key, params) })
  const reload = async () => {
    readController?.abort()
    const controller = new AbortController()
    const requestedCompany = companyId()
    readController = controller
    if (lifetime?.aborted) return
    const abort = () => controller.abort()
    lifetime?.addEventListener('abort', abort, { once: true })
    if (!data()) loading.set(true)
    try {
      const next = await call(
        'flow.workspace.bootstrap',
        {
          projectId: scopeOf(activeRoute()) === 'project' ? activeProject() : undefined,
          route: activeRoute(),
          recordId:
            taskModalRoutes.has(activeRoute()) ||
            extensionForms[activeRoute()] ||
            ['page', 'page-child', 'page-move'].includes(activeRoute())
              ? record()
              : undefined,
        },
        { signal: controller.signal },
      )
      if (!controller.signal.aborted && requestedCompany === companyId()) {
        data.set({
          ...next,
          columns: next.columns.map((c) =>
            c.labelKey
              ? {
                  ...c,
                  get label() {
                    return tr(c.labelKey)
                  },
                }
              : c,
          ),
        })
        if (next.context) {
          workspaceId.set(next.context.workspaceId)
          if (next.context.projectId && scopeOf(activeRoute()) === 'project')
            (modalRoute() ? modalProject : project).set(next.context.projectId)
          if (typeof location !== 'undefined') {
            const url = new URL(location.href)
            url.searchParams.set('company', next.context.companyId)
            if (next.context.workspaceId) url.searchParams.set('workspace', next.context.workspaceId)
            else url.searchParams.delete('workspace')
            if (next.context.projectId && scopeOf(activeRoute()) === 'project')
              url.searchParams.set('project', next.context.projectId)
            history.replaceState(history.state, '', url)
          }
        }
        documentContext()
        failure.set(next.problem ?? null)
        for (const x of extensions) void x.sync?.()
      }
    } catch (e) {
      if (e.name !== 'AbortError') failure.set({ code: e.code, message: e.message })
    } finally {
      lifetime?.removeEventListener('abort', abort)
      if (!controller.signal.aborted) loading.set(false)
    }
  }
  const mutate = (name, input = {}, success, opts = {}) => {
    if (!canWrite()) return Promise.resolve(false)
    const mutationCompany = companyId()
    const execute = async () => {
      if (mutationCompany !== companyId()) return false
      busy.set(true)
      failure.set(null)
      formError.set({})
      try {
        // Input may be async (e.g. uploading file bytes before saving their metadata).
        if (typeof input === 'function') input = await input()
        const signature = JSON.stringify([name, input])
        const key = lastOp?.signature === signature ? lastOp.key : crypto.randomUUID()
        lastOp = { signature, key }
        const value = await call(name, { ...input, idempotencyKey: key }, { signal: lifetime, key })
        lastOp = null
        if (mutationCompany !== companyId()) return false
        await reload()
        if (!opts.quiet)
          feedback.show(opts.message ? opts.message(value) : mutationFeedback(name, input, value, data()))
        if (success) success(value)
        return true
      } catch (e) {
        if (e.name !== 'AbortError') {
          const claimed = extensionValue('mutationError', e, input)
          if (!claimed) failure.set({ code: e.code, message: e.message })
          else if (claimed.message) failure.set({ code: e.code, message: claimed.message })
          formError.set(e.fields ?? {})
        }
        return false
      } finally {
        busy.set(false)
      }
    }
    const operation = mutationTail.then(execute, execute)
    mutationTail = operation.catch(() => {})
    return operation
  }
  const MAX_FILE_MB = 25
  const addFiles = (taskId, files) => {
    if (!files.length || !canWrite()) return
    const large = files.find((file) => file.size > MAX_FILE_MB * 1024 * 1024)
    if (large) {
      feedback.show(tr('flow.ui.file.too.large', [large.name, MAX_FILE_MB]))
      return
    }
    pendingFiles.set({ taskId, files })
    void mutate(
      'flow.entity.save',
      async () => ({
        collection: 'files',
        taskId,
        files: await Promise.all(
          files.map(async (file) => ({
            title: file.name,
            size: file.size,
            type: file.type,
            uploadId: (await upload(file, { signal: lifetime })).uploadId,
          })),
        ),
      }),
      () => pendingFiles.set(null),
    )
  }
  const filePreview = () => {
    const file = previewFile() && data().files.find((f) => f.id === previewFile() && f.url)
    return file
      ? FlowDialog({
          id: 'flow-file-preview',
          size: 'media',
          title: file.title,
          onRequestClose: () => previewFile.set(''),
          body: FlowMediaPreview({ title: file.title, type: file.contentType, url: file.url }),
          footer: FlowInline({
            align: 'end',
            children: html`<a data-flow="button" data-variant="secondary" data-size="md" href=${file.url + '?download=1'} download=${file.title}>${tr('flow.ui.download')}</a>`,
          }),
        })
      : null
  }
  const autosave = createTaskAutosave({
    onChange: () => saveRevision.set(saveRevision() + 1),
    save: async (id, patch) => {
      const ok = await mutate(
        'flow.issue.save',
        () => ({ id, ...patch, expectedVersion: data().tasks.find((t) => t.id === id)?.version }),
        null,
        { quiet: true },
      )
      if (!ok) throw new Error(failure()?.message ?? tr('flow.ui.unable.to.save.changes'))
    },
  })
  const statusOptions = (task) =>
    taskColumns(data(), task.projectId).map((c) => {
      const gate = transitionFor(task, c.id)
      return {
        value: c.id,
        label: c.label,
        disabled: !!gate?.blocked,
        content: FlowStatus({ status: c.kind, label: c.label, color: c.color }),
        description: gate?.message ?? '',
      }
    })
  const editTaskStatus = (task, value) => {
    const gate = transitionFor(task, value)
    if (gate?.blocked) {
      feedback.show(gate.message ?? '')
      return
    }
    if (gate?.action) {
      navigate('issue-move', { id: task.id, project: task.projectId })
      return
    }
    autosave.edit(task.id, { status: value })
  }
  const closeModal = () => {
    previewFile.set('')
    if (taskModalRoutes.has(modalRoute()) && !['issue-new', 'subtask-new'].includes(modalRoute()))
      void autosave.flush(record())
    const depth = history.state?.flowModalDepth ?? 0
    if (depth > 0) history.back()
    else {
      history.replaceState({}, '', modalBackground.url || href('my-work'))
      readUrl()
    }
  }
  const switchContext = async (nextCompany, nextWorkspace = '', afterSave = false) => {
    if (busy() && !afterSave) return
    if (nextCompany !== companyId()) {
      await autosave.flushAll()
      if (data()?.tasks.some((t) => autosave.state(t.id) === 'error')) return
    }
    pendingFiles.set(null)
    previewFile.set('')
    readController?.abort()
    feedback.clear()
    failure.set(null)
    selected.set([])
    formError.set({})
    data.set(null)
    loading.set(true)
    dismissedDataNotice.set('')
    companyId.set(nextCompany)
    workspaceId.set(nextWorkspace)
    project.set('')
    modalProject.set('')
    modalRoute.set(null)
    savedViewOpen.set(false)
    documentReturn.set('')
    documentScope.set('workspace')
    modalScope.set('workspace')
    query.set('')
    status.set('all')
    personalWorkspace.set('all')
    organization.reset()
    for (const x of extensions) x.reset?.()
    projectSetup.reset()
    operations.reset()
    const key = nextWorkspace ? 'workspace-overview' : 'organization'
    screen.set(key)
    modalBackground = { screen: key, url: '', record: '' }
    history.pushState({}, '', href(key))
    await reload()
  }
  const retryTaskSave = async () => {
    const ids = data()
      .tasks.filter((t) => autosave.state(t.id) === 'error')
      .map((t) => t.id)
    // Refresh CAS while retaining the user's pending patch in the autosave queue.
    await reload()
    for (const id of ids) await autosave.flush(id)
  }
  const composer = createTaskComposer({
    data,
    canWrite,
    project: activeProject,
    record,
    route: activeRoute,
    errors: formError,
    create: (args, done) =>
      mutate('flow.issue.save', args, (value) => {
        done()
        navigate('issue', { id: value.id, project: args.projectId }, { replace: true })
      }),
  })
  const move = (id, columnId) => {
    const task = data().tasks.find((t) => t.id === id)
    return mutate('flow.issue.move', { id, columnId, expectedVersion: task.version })
  }
  const action = (label, onClick, variant = 'secondary', icon) =>
    FlowButton({
      label,
      onClick,
      variant,
      icon,
      size: 'sm',
      disabled: !canWrite(),
      loading: busy(),
    })
  const submit = (label = tr('flow.ui.save.changes')) =>
    FlowButton({
      label,
      type: 'submit',
      variant: 'primary',
      disabled: !canWrite(),
      loading: busy(),
    })
  const taskOpen = (t) => navigate('issue', { id: t.id, project: t.projectId })
  const filtered = () =>
    orderedTasks(data().tasks).filter((t) => {
      if (screen() === 'issues-archived' ? !t.archived : t.archived) return false
      if (
        (['project-issues', 'board', 'calendar', 'bulk', 'filter-limit'].includes(screen()) ||
          routes[screen()]?.taskSearch) &&
        t.projectId !== project()
      )
        return false
      const owner = data().projects.find((p) => p.id === t.projectId)
      if (
        data().workspaces &&
        (screen() === 'my-work'
          ? personalWorkspace() !== 'all' && owner?.workspaceId !== personalWorkspace()
          : scopeOf(screen()) !== 'project' && owner?.workspaceId !== workspaceId())
      )
        return false
      if (screen() === 'my-work' && !isAssignedTo(data(), t, data().user.id)) return false
      return (
        (status() === 'all' || t.status === status()) &&
        tidy(`${t.id} ${t.title} ${taskAssigneeNames(data(), t)}`).includes(tidy(query()))
      )
    })
  const setFilter = (setter, value) => {
    setter.set(value)
    selectedView.set('')
    selected.set([])
    const url = new URL(location.href)
    url.searchParams.delete('view')
    url.searchParams.set('q', query())
    url.searchParams.set('status', status())
    history.replaceState({}, '', url)
  }
  const taskGrouping = () => (screen() === 'board' && groupBy() === 'none' ? 'status' : groupBy())
  const draggedTasks = (id) =>
    orderedTasks(
      listKeys.has(screen()) && selected().includes(id)
        ? filtered().filter((t) => selected().includes(t.id))
        : data().tasks.filter((t) => t.id === id),
    )
  const dragRejection = (id, field, value) => {
    const moving = draggedTasks(id)
    if (!moving.length) return ''
    const changed = moving.filter((t) => taskGroupValue(t, field) !== value)
    if (!changed.length && listKeys.has(screen()) && listSort() !== 'manual') return tr('flow.drag.manual')
    if (field !== 'status') return ''
    for (const t of changed) {
      const gate = transitionFor(t, value)
      if (gate?.dragMessage) return gate.dragMessage
      if (gate?.blocked) return gate.message ?? ''
      if (gate?.action && moving.length > 1) return tr('flow.drag.single')
    }
    return ''
  }
  const reorderTask = (id, targetId, position, field, value) => {
    if (!canWrite() || busy() || id === targetId) return
    const task = data().tasks.find((t) => t.id === id)
    if (!task || task.archived) return
    const moving = draggedTasks(id)
    const rejection = dragRejection(id, field, value)
    if (rejection) {
      feedback.show(rejection)
      return
    }
    const gate =
      field === 'status' && moving.length === 1 && task.status !== value ? transitionFor(task, value) : null
    if (gate?.action) {
      navigate(gate.action.key, { id: task.id, project: task.projectId })
      return
    }
    if (moving.some((t) => t.id === targetId) || !moving.length) return
    return mutate('flow.issue.reorder', {
      ...(moving.length > 1
        ? {
            ids: moving.map((t) => t.id),
            expectedVersions: Object.fromEntries(moving.map((t) => [t.id, t.version])),
          }
        : {}),
      id,
      targetId,
      position,
      groupBy: field,
      groupValue: value,
      expectedVersion: task.version,
      expectedOrderRevision: data().taskOrderRevision ?? 0,
    })
  }
  const dropAtEnd = (id, field, value) => {
    const moving = new Set(draggedTasks(id).map((t) => t.id))
    const peers = filtered().filter((t) => !moving.has(t.id) && taskGroupValue(t, field) === value)
    return reorderTask(id, peers.at(-1)?.id ?? null, 'after', field, value)
  }
  const taskDragProps = (t, field) =>
    !canWrite() || busy() || t.archived
      ? {}
      : {
          dragCount: draggedTasks(t.id).length,
          onDragCheck: (id) => dragRejection(id, field, taskGroupValue(t, field)),
          onDropTask: (id, position) => reorderTask(id, t.id, position, field, taskGroupValue(t, field)),
          onMoveKey: (direction) => {
            const value = taskGroupValue(t, field)
            const peers = filtered().filter((x) => taskGroupValue(x, field) === value)
            if (direction === 'up' || direction === 'down') {
              const moving = new Set(draggedTasks(t.id).map((x) => x.id))
              const edge =
                direction === 'up'
                  ? peers.findIndex((x) => moving.has(x.id))
                  : peers.findLastIndex((x) => moving.has(x.id))
              const target = peers[edge + (direction === 'up' ? -1 : 1)]
              if (target) reorderTask(t.id, target.id, direction === 'up' ? 'before' : 'after', field, value)
            } else if (field !== 'none') {
              const groups = taskGroups(data(), field, t.projectId)
              const target = groups[groups.findIndex((g) => g.id === value) + (direction === 'left' ? -1 : 1)]
              if (target) dropAtEnd(t.id, field, target.id)
            }
          },
        }
  const table = (
    tasks,
    dragField = null,
    contextProject = scopeOf(screen()) === 'project' ? project() : null,
    tableId = 'list',
    preserveOrder = false,
  ) =>
    FlowTable({
      label: tr('flow.ui.tasks'),
      columns: [
        FlowCheckbox({
          label: tr('flow.ui.select.all.tasks.in.group'),
          checked: tasks.length > 0 && tasks.every((t) => selected().includes(t.id)),
          indeterminate:
            tasks.some((t) => selected().includes(t.id)) && !tasks.every((t) => selected().includes(t.id)),
          disabled: !tasks.length,
          onChange: (e) => {
            const ids = new Set(tasks.map((t) => t.id))
            selected.set(
              e.target.checked
                ? [...new Set([...selected(), ...ids])]
                : selected().filter((id) => !ids.has(id)),
            )
          },
        }),
        tr('flow.ui.tasks'),
        tr('flow.ui.status'),
        tr('flow.ui.priority'),
        tr('flow.ui.assignee.558c25'),
        tr('flow.ui.due'),
      ],
      children: html`${each(
        preserveOrder ? tasks : orderedTasks(tasks),
        (t) => t.id,
        (original) => {
          saveRevision()
          const t = { ...original, ...autosave.draft(original.id) }
          const disabled =
            !canWrite() ||
            t.archived ||
            data().projects.find((p) => p.id === t.projectId)?.accessInfo?.role === 'viewer'
          return FlowTaskRow({
            ...(dragField ? taskDragProps(t, dragField) : {}),
            task: { ...mapped(t), project: t.projectId === contextProject ? '' : mapped(t).project },
            assigneeControl: FlowUserPicker({
              id: tableId + '-assignees-' + t.id,
              label: tr('flow.ui.assignee.312f99') + t.id,
              size: 'sm',
              value: taskAssigneeIds(data(), t),
              options: taskUserOptions(data(), t),
              disabled,
              onChange: (ids) => autosave.edit(t.id, { assigneeIds: ids }),
            }),
            statusControl: FlowChoiceField({
              id: tableId + '-status-' + t.id,
              label: tr('flow.ui.status.6bb83a') + t.id,
              size: 'sm',
              value: t.status,
              disabled,
              options: statusOptions(t),
              onChange: (value) => editTaskStatus(t, value),
            }),
            priorityControl: FlowChoiceField({
              id: tableId + '-priority-' + t.id,
              label: tr('flow.ui.priority.e2ea65') + t.id,
              size: 'sm',
              value: t.priority,
              disabled,
              options: [
                { value: 'normal', label: tr('flow.ui.normal') },
                { value: 'high', label: tr('flow.ui.high') },
                { value: 'urgent', label: tr('flow.ui.urgent') },
              ].map((o) => ({ ...o, content: FlowPriority({ priority: o.value }) })),
              onChange: (value) => autosave.edit(t.id, { priority: value }),
            }),
            dueControl: FlowDateField({
              overdue: !isDone(data(), t) && !!t.dueDate && t.dueDate < todayDate(data().timezone),
              id: tableId + '-due-' + t.id,
              label: tr('flow.ui.due.date.fe6fe5') + t.id,
              value: t.dueDate ?? '',
              min: t.startDate || undefined,
              disabled,
              onChange: (value) => autosave.edit(t.id, { dueDate: value }),
            }),
            statusHint: extensionValue('taskStatusHint', t),
            selected: selected().includes(t.id),
            onSelect: () =>
              selected.set(
                selected().includes(t.id) ? selected().filter((x) => x !== t.id) : [...selected(), t.id],
              ),
            onOpen: () => taskOpen(t),
          })
        },
      )}`,
    })
  const metrics = (tasks) =>
    FlowMetrics({
      items: [
        { label: tr('flow.ui.total.tasks'), value: tasks.length },
        { label: tr('flow.ui.in.progress'), value: tasks.filter((t) => t.status === 'progress').length },
        {
          label: tr('flow.ui.awaiting.acceptance.9782f0'),
          value: tasks.filter((t) => statusKind(data(), t) === 'review').length,
        },
        {
          label: tr('flow.ui.done'),
          value: tasks.filter((t) => isDone(data(), t)).length,
          tone: 'green',
        },
        {
          label: tr('flow.ui.overdue'),
          value: tasks.filter(
            (t) => !isDone(data(), t) && t.dueDate && t.dueDate < todayDate(data().timezone),
          ).length,
          tone: 'red',
        },
      ],
    })
  const groupOptions = () => [
    { value: 'status', label: tr('flow.ui.group.status') },
    { value: 'priority', label: tr('flow.ui.group.priority') },
    { value: 'assignee', label: tr('flow.ui.group.assignee') },
    { value: 'sprint', label: tr('flow.ui.group.sprint') },
    { value: 'none', label: tr('flow.ui.no.grouping') },
  ]
  const changeGroup = (value) => {
    groupBy.set(value)
    const url = new URL(modalRoute() ? modalBackground.url : location.href, location.href)
    url.searchParams.set('group', value)
    if (modalRoute()) {
      modalBackground = { ...modalBackground, url: url.pathname + url.search }
      history.replaceState({ ...history.state, flowBackground: modalBackground }, '', location.href)
    } else history.replaceState(history.state, '', url)
  }
  const workspaceFilter = () =>
    FlowSelect({
      label: tr('flow.ui.filter.by.workspace'),
      value: personalWorkspace(),
      options: [
        { value: 'all', label: tr('flow.ui.all.workspaces') },
        ...(data().workspaces ?? []).map((w) => ({ value: w.id, label: w.title })),
      ],
      onChange: (e) => {
        personalWorkspace.set(e.target.value)
        const u = new URL(location.href)
        u.searchParams.set('workspaceFilter', e.target.value)
        history.replaceState(history.state, '', u)
      },
    })
  const taskSearch = () =>
    FlowSearch({
      label: tr('flow.ui.search.tasks'),
      value: query(),
      placeholder: tr('flow.ui.search.by.name.id.or.assignee'),
      onInput: (e) => setFilter(query, e.target.value),
    })
  const hasTaskSearch = () =>
    listKeys.has(screen()) || ['board', 'calendar'].includes(screen()) || routes[screen()]?.taskSearch
  const filterbar = () =>
    FlowToolbar({
      children: html`${data().views.find((v) => v.id === (typeof location !== 'undefined' ? new URL(location.href).searchParams.get('view') : props.view)) ? FlowHint({ children: tr('flow.review.viewConditions', [data().views.find((v) => v.id === (typeof location !== 'undefined' ? new URL(location.href).searchParams.get('view') : props.view))?.title, query() || '—', data().columns.find((c) => c.id === status())?.label ?? tr('flow.ui.all.statuses')]) }) : null}${screen() === 'my-work' && data().workspaces ? workspaceFilter() : null}${FlowSelect({ label: tr('flow.ui.filter.status'), value: status(), options: [{ value: 'all', label: tr('flow.ui.all.statuses') }, ...(scopeOf(screen()) === 'project' ? taskColumns(data(), project()) : data().columns).map((c) => ({ value: c.id, label: c.label }))], onChange: (e) => setFilter(status, e.target.value) })}`,
      trailing: inline(
        listKeys.has(screen()) || screen() === 'board'
          ? FlowSelect({
              label: tr('flow.ui.group.tasks'),
              value: taskGrouping(),
              options: groupOptions().filter((o) => screen() !== 'board' || o.value !== 'none'),
              onChange: (e) => changeGroup(e.target.value),
            })
          : null,
        listKeys.has(screen())
          ? FlowSelect({
              label: tr('flow.list.sort'),
              value: listSort(),
              options: [
                { value: 'due', label: tr('flow.list.sortDue') },
                { value: 'priority', label: tr('flow.list.sortPriority') },
                { value: 'manual', label: tr('flow.list.sortManual') },
              ],
              onChange: (e) => listSort.set(e.target.value),
            })
          : null,
        navButton('display', tr('flow.ui.display'), 'settings'),
        FlowButton({
          label: tr('flow.ui.save.view'),
          icon: 'filter',
          size: 'sm',
          disabled: !canWrite(),
          onClick: openSavedView,
        }),
      ),
    })
  const listSort = signal('due'),
    listLimits = signal({})
  const bulkPreview = signal(false),
    bulkStatus = signal('done'),
    showCompleted = signal(false)
  const bulkExclusion = (t) =>
    !taskColumns(data(), t.projectId).some((c) => c.id === bulkStatus())
      ? tr('flow.ui.different.project.status.set')
      : data().projects.find((p) => p.id === t.projectId)?.accessInfo?.role === 'viewer'
        ? tr('flow.ui.view.only')
        : data().columns.find((c) => c.id === bulkStatus())?.kind === 'done'
          ? t.blockedBy.some(
              (id) =>
                !isDone(
                  data(),
                  data().tasks.find((x) => x.id === id),
                ),
            )
            ? tr('flow.ui.blocked')
            : validateCustomFields(data().fields, t.customFields, t.projectId, true)
          : null
  const issueList = () => {
    const tasks = sortedListTasks(filtered(), listSort())
    const scopeKey = JSON.stringify([
      companyId(),
      workspaceId(),
      screen(),
      project(),
      personalWorkspace(),
      query(),
      status(),
      groupBy(),
      listSort(),
    ])
    const listGroups =
      groupBy() === 'none'
        ? [{ id: 'none', items: tasks }]
        : taskGroups(data(), groupBy(), scopeOf(screen()) === 'project' ? project() : undefined).map((c) => ({
            ...c,
            items: tasks.filter((t) => taskGroupValue(t, groupBy()) === c.id),
          }))
    const visibleTasks = listGroups.flatMap(
      (c) => taskPage(c.items, listLimits()[scopeKey + ':' + c.id] ?? 10).visible,
    )
    const pagedTable = (items, id) => {
      const key = scopeKey + ':' + id,
        limit = listLimits()[key] ?? 10
      const page = taskPage(items, limit)
      return stack(
        table(
          page.visible,
          groupBy(),
          scopeOf(screen()) === 'project' ? project() : null,
          'list-' + id,
          true,
        ),
        items.length > 10
          ? FlowToolbar({
              children: FlowHint({ children: tr('flow.list.showing', [page.visible.length, items.length]) }),
              trailing: inline(
                page.remaining
                  ? FlowButton({
                      label: tr('flow.list.showMore', [Math.min(10, page.remaining), page.remaining]),
                      size: 'sm',
                      onClick: () => listLimits.set({ ...listLimits(), [key]: limit + 10 }),
                    })
                  : null,
                limit > 10
                  ? FlowButton({
                      label: tr('flow.ui.collapse'),
                      size: 'sm',
                      onClick: () => listLimits.set({ ...listLimits(), [key]: 10 }),
                    })
                  : null,
              ),
            })
          : null,
      )
    }
    return stack(
      filterbar(),
      query() || status() !== 'all'
        ? FlowToolbar({
            children: inline(
              query() ? FlowTag({ label: tr('flow.ui.search') + query() }) : null,
              status() !== 'all'
                ? FlowTag({ label: data().columns.find((c) => c.id === status())?.label ?? status() })
                : null,
            ),
            trailing: FlowButton({
              label: tr('flow.ui.clear.all.filters'),
              size: 'sm',
              onClick: () => {
                setFilter(query, '')
                setFilter(status, 'all')
              },
            }),
          })
        : null,
      screen() !== 'my-work' ? metrics(tasks) : null,
      tasks.length
        ? html`${
            groupBy() === 'none'
              ? pagedTable(tasks, 'none')
              : each(
                  taskGroups(data(), groupBy(), scopeOf(screen()) === 'project' ? project() : undefined),
                  (c) => c.id,
                  (c) => {
                    const group = tasks.filter((t) => taskGroupValue(t, groupBy()) === c.id)
                    return FlowGroup({
                      title: c.kind
                        ? FlowStatus({ status: c.kind, label: c.label, color: c.color })
                        : c.label,
                      count: group.length,
                      children: pagedTable(group, c.id),
                      onDragCheck: (id) => dragRejection(id, groupBy(), c.id),
                      onDropTask:
                        canWrite() && !busy() && screen() !== 'issues-archived'
                          ? (id) => dropAtEnd(id, groupBy(), c.id)
                          : undefined,
                    })
                  },
                )
          }`
        : FlowEmpty({
            title: tr('flow.ui.no.matching.tasks'),
            description: tr('flow.ui.change.filters.or.create.your.first.task'),
            action: FlowButton({
              label: tr('flow.ui.clear.filters'),
              onClick: () => {
                setFilter(query, '')
                setFilter(status, 'all')
              },
            }),
          }),
      screen() === 'issues-archived'
        ? FlowSection({
            title: tr('flow.ui.restore.task'),
            children: html`${each(
              tasks,
              (t) => t.id,
              (t) =>
                FlowNotice({
                  title: t.id,
                  message: `${t.title} · ${mapped(t).project} · ${t.archivedBy ?? 'Flow'} · ${t.archivedAt ? new Date(t.archivedAt).toLocaleDateString(flowLocaleTag()) : tr('flow.ui.sample.archive.data')}`,
                  action: action(tr('flow.ui.restore'), () => mutate('flow.issue.restore', { id: t.id })),
                }),
            )}`,
          })
        : null,
      bulkPreview() && selected().length
        ? FlowSection({
            title: tr('flow.ui.preview.bulk.changes'),
            children: stack(
              FlowSelectField({
                name: 'bulk-status',
                label: tr('flow.ui.new.status'),
                value: bulkStatus(),
                options: data().columns.map((c) => ({ value: c.id, label: c.label })),
                onChange: (e) => bulkStatus.set(e.target.value),
              }),
              FlowHint({
                children: tr(
                  'flow.ui.tasks.selected.blocked.tasks.cannot.be.completed.open.them.to.resolve.dependenci',
                  [selected().length],
                ),
              }),
              FlowList({
                children: html`${each(
                  data().tasks.filter((t) => selected().includes(t.id)),
                  (t) => t.id,
                  (t) =>
                    FlowListItem({
                      title: t.id + ' · ' + t.title,
                      meta: FlowTag({
                        label: bulkExclusion(t)
                          ? tr('flow.ui.excluded') + bulkExclusion(t)
                          : tr('flow.ui.will.update'),
                      }),
                    }),
                )}`,
              }),
              actions(
                FlowButton({ label: tr('flow.ui.cancel'), onClick: () => bulkPreview.set(false) }),
                action(
                  tr('flow.ui.apply'),
                  () => {
                    const ids = data()
                      .tasks.filter((t) => selected().includes(t.id) && !bulkExclusion(t))
                      .map((t) => t.id)
                    if (ids.length)
                      mutate('flow.issue.bulk', { ids, status: bulkStatus() }, () => {
                        selected.set(selected().filter((id) => !ids.includes(id)))
                        bulkPreview.set(false)
                      })
                  },
                  'primary',
                ),
              ),
            ),
          })
        : null,
      tasks.length
        ? FlowToolbar({
            children: inline(
              FlowCheckbox({
                label: tr('flow.ui.select.all.visible.tasks'),
                checked: visibleTasks.length > 0 && visibleTasks.every((t) => selected().includes(t.id)),
                onChange: () =>
                  selected.set(
                    visibleTasks.every((t) => selected().includes(t.id))
                      ? selected().filter((id) => !visibleTasks.some((t) => t.id === id))
                      : [...new Set([...selected(), ...visibleTasks.map((t) => t.id)])],
                  ),
              }),
              html`<span>${tr('flow.ui.selected', [selected().length])}</span>`,
            ),
            trailing: selected().length
              ? FlowButton({
                  label: tr('flow.ui.change') + selected().length + tr('flow.ui.tasks.05e55a'),
                  size: 'sm',
                  onClick: () => bulkPreview.set(!bulkPreview()),
                })
              : html`<span data-flow="muted">${tr('flow.ui.tasks.in.this.view', [tasks.length])}</span>`,
          })
        : null,
    )
  }
  const board = () =>
    stack(
      filterbar(),
      FlowBoard({
        columns: taskGroups(data(), taskGrouping(), project()).map((c) => {
          const field = taskGrouping()
          const tasks = filtered().filter((t) => taskGroupValue(t, field) === c.id)
          return {
            id: c.id,
            title: c.kind ? FlowStatus({ status: c.kind, label: c.label, color: c.color }) : c.label,
            count: tasks.length,
            onDragCheck: (id) => dragRejection(id, field, c.id),
            onDropTask: canWrite() && !busy() ? (id) => dropAtEnd(id, field, c.id) : undefined,
            children: stack(
              html`${each(
                field === 'status' && c.kind === 'done' && !showCompleted() ? tasks.slice(0, 3) : tasks,
                (t) => t.id,
                (t) =>
                  FlowTaskCard({
                    task: { ...mapped(t), project: undefined },
                    onOpen: () => taskOpen(t),
                    ...taskDragProps(t, field),
                  }),
              )}`,
              field === 'status' && c.kind === 'done' && tasks.length > 3
                ? FlowButton({
                    label: showCompleted()
                      ? tr('flow.ui.collapse')
                      : tr('flow.ui.show') + (tasks.length - 3) + tr('flow.ui.completed.tasks'),
                    size: 'sm',
                    onClick: () => showCompleted.set(!showCompleted()),
                  })
                : null,
            ),
          }
        }),
      }),
    )
  const taskDetail = () => {
    const t = currentTask()
    if (!t)
      return FlowEmpty({
        title: tr('flow.ui.task.not.found'),
        description: tr('flow.ui.this.task.may.have.been.moved.or.archived'),
      })
    const children = data().tasks.filter((x) => x.parentId === t.id)
    return FlowRecordLayout({
      main: stack(
        FlowToolbar({
          children: inline(
            FlowTag({ label: t.id }),
            FlowTag({
              label: data().types.find((x) => x.id === (t.type ?? 'task'))?.title ?? tr('flow.ui.tasks'),
            }),
            FlowTag({ label: t.epic ?? tr('flow.ui.no.epic') }),
          ),
          trailing: inline(
            action(
              t.followed ? tr('flow.ui.following') : tr('flow.ui.follow'),
              () => mutate('flow.issue.follow', { id: t.id }),
              t.followed ? 'primary' : 'secondary',
              'inbox',
            ),
            navButton('issue-archive', tr('flow.ui.archive'), null, 'ghost', { id: t.id }),
          ),
        }),
        FlowSection({
          children: stack(
            FlowInput({
              id: 'title',
              label: tr('flow.ui.title'),
              value: t.title,
              required: true,
              error: formError().title,
              disabled: !canWrite(),
              onInput: (e) => autosave.edit(t.id, { title: e.target.value }, { delay: 600 }),
              onBlur: () => autosave.flush(t.id),
            }),
            FlowLiveDoc({
              id: `${companyId()}-task-${t.id}`,
              label: tr('flow.ui.description'),
              text: t.description,
              snapshot: t.descriptionDoc,
              readOnly: !canWrite(),
              onChange: (value) =>
                autosave.edit(
                  t.id,
                  { description: FlowLiveDocText(value), descriptionDoc: value.snapshot },
                  { delay: 600 },
                ),
              onBlur: () => autosave.flush(t.id),
            }),
            navButton('history', tr('flow.ui.change.history'), 'clock', 'ghost', { id: t.id }),
            t.followed
              ? FlowHint({
                  children: tr(
                    'flow.ui.you.re.following.this.task.and.will.receive.status.and.discussion.updates',
                  ),
                })
              : null,
          ),
        }),
        ...extensions.map((x) => x.taskSection?.(t) ?? null),
        t.checklist?.length
          ? FlowSection({
              title: 'Checklist',
              children: stack(
                ...t.checklist.map((item) =>
                  inline(
                    FlowCheckbox({
                      label: item.text,
                      checked: item.checked,
                      disabled: !canWrite(),
                      onChange: (e) =>
                        autosave.edit(t.id, {
                          checklist: t.checklist.map((x) =>
                            x.id === item.id ? { ...x, checked: e.target.checked } : x,
                          ),
                        }),
                    }),
                    item.text,
                  ),
                ),
              ),
            })
          : null,
        FlowSection({
          children: stack(
            FlowDisclosure({
              title: tr('flow.ui.subtasks.398078', [children.length]),
              open: !!children.length,
              children: stack(
                inline(
                  navButton('subtask-new', tr('flow.ui.add.subtask'), 'plus', 'secondary', { id: t.id }),
                  navButton('subtask-link', tr('flow.ui.link.existing.task'), 'link', 'ghost', { id: t.id }),
                ),
                FlowHint({
                  children: tr(
                    'flow.ui.work.volume.rolls.up.from.subtasks.parent.tasks.are.not.counted.twice',
                  ),
                }),
                children.length
                  ? table(children, null, t.projectId, 'subtasks')
                  : FlowHint({
                      children: tr('flow.ui.split.large.deliverables.into.independently.deliverable.parts'),
                    }),
              ),
            }),
            FlowDisclosure({
              title: tr('flow.ui.dependencies', [t.blockedBy.length]),
              open: !!t.blockedBy.length,
              children: stack(
                navButton('dependency-new', tr('flow.ui.add.dependency'), 'link', 'secondary', { id: t.id }),
                ...t.blockedBy.map((id) => {
                  const target = data().tasks.find((x) => x.id === id)
                  return target
                    ? FlowListItem({
                        title: `${id} · ${target.title}`,
                        description:
                          taskAssigneeNames(data(), target) +
                          ' · ' +
                          taskColumns(data(), target.projectId).find((c) => c.id === target.status)?.label,
                        actions: inline(
                          FlowButton({
                            label: tr('flow.ui.open'),
                            size: 'sm',
                            onClick: () => taskOpen(target),
                          }),
                          action(tr('flow.ui.remove.dependency'), () =>
                            autosave.edit(t.id, { blockedBy: t.blockedBy.filter((x) => x !== id) }),
                          ),
                        ),
                      })
                    : null
                }),
              ),
            }),
            ...extensions.map((x) => x.taskLinks?.(t) ?? null),
          ),
        }),
        FlowSection({
          title: tr('flow.ui.attachments'),
          children: FlowFileDrop({
            id: `flow-task-files-${t.id}`,
            disabled: !canWrite(),
            busy: busy(),
            hint: tr('flow.ui.max.file.size', [MAX_FILE_MB]),
            pending: pendingFiles()?.taskId === t.id ? pendingFiles().files : [],
            onFiles: (files) => addFiles(t.id, files),
            onRetry: () => addFiles(t.id, pendingFiles().files),
            onDiscard: () => pendingFiles.set(null),
            children: html`${each(
              data().files.filter((f) => f.taskId === t.id),
              (f) => f.id,
              (f) =>
                FlowAttachment({
                  title: f.title,
                  meta: f.description,
                  type: f.contentType,
                  url: f.url,
                  onPreview: () => previewFile.set(f.id),
                }),
            )}`,
          }),
        }),
        FlowSection({
          title: activeRoute() === 'history' ? tr('flow.ui.change.history') : tr('flow.ui.discussion'),
          children: stack(
            FlowActivity({
              items:
                activeRoute() === 'history'
                  ? data()
                      .history.filter((h) => h.taskId === t.id)
                      .map((h) => ({
                        ...h,
                        messageKey: h.changes ? null : h.messageKey,
                        text: h.changes
                          ? tr('flow.review.taskUpdated', [h.version]) +
                            ' · ' +
                            h.changes.map((c) => auditChange(c, data())).join('; ')
                          : h.text,
                        time: h.time?.includes('T')
                          ? new Date(h.time).toLocaleString(flowLocaleTag())
                          : h.time,
                      }))
                  : data().comments.filter((c) => c.taskId === t.id),
            }),
            html`<form
              on:submit=${async (e) => {
                e.preventDefault()
                const form = e.currentTarget
                const v = collect(e)
                if (await mutate('flow.issue.comment', { id: t.id, text: v.comment })) form.reset()
              }}
            >
              ${stack(FlowTextarea({ id: 'comment', label: tr('flow.ui.comment'), placeholder: tr('flow.ui.write.a.reply.or.mention.someone'), required: true, disabled: !canWrite() }), submit(tr('flow.ui.post.comment')))}
            </form>`,
          ),
        }),
      ),
      aside: FlowPropertyFields({
        children: html`${stack(
          FlowChoiceField({
            id: 'task-status',
            icon: 'status',
            label: tr('flow.ui.status'),
            value: t.status,
            disabled: !canWrite(),
            options: statusOptions(t),
            onChange: (value) => editTaskStatus(t, value),
          }),
          FlowUserPicker({
            id: 'task-assignee',
            label: tr('flow.ui.assignee.02be53'),
            size: 'md',
            value: taskAssigneeIds(data(), t),
            options: taskUserOptions(data(), t),
            disabled: !canWrite(),
            onChange: (ids) => autosave.edit(t.id, { assigneeIds: ids }),
          }),
          FlowChoiceField({
            id: 'task-priority',
            icon: 'flag',
            label: tr('flow.ui.priority'),
            value: t.priority,
            disabled: !canWrite(),
            options: [
              { value: 'normal', label: tr('flow.ui.normal') },
              { value: 'high', label: tr('flow.ui.high') },
              { value: 'urgent', label: tr('flow.ui.urgent') },
            ].map((o) => ({ ...o, content: FlowPriority({ priority: o.value }) })),
            onChange: (value) => autosave.edit(t.id, { priority: value }),
          }),
          usesSprints(data().projects.find((p) => p.id === t.projectId))
            ? FlowSelectField({
                name: 'task-sprint',
                icon: 'layers',
                label: 'Sprint',
                value: t.sprint ?? 'Backlog',
                disabled: !canWrite(),
                options: options([
                  'Backlog',
                  ...data()
                    .sprints.filter((s) => s.projectId === t.projectId)
                    .map((s) => s.title),
                ]),
                onChange: (e) => autosave.edit(t.id, { sprint: e.target.value }),
              })
            : null,
          FlowInput({
            id: 'task-start',
            icon: 'calendar',
            label: tr('flow.ui.start.date'),
            type: 'date',
            value: t.startDate ?? '',
            disabled: !canWrite(),
            onInput: (e) => autosave.edit(t.id, { startDate: e.target.value }, { delay: 400 }),
            onBlur: () => autosave.flush(t.id),
          }),
          FlowInput({
            id: 'task-due',
            icon: 'calendar',
            label: tr('flow.ui.due.date'),
            type: 'date',
            value: t.dueDate ?? '',
            disabled: !canWrite(),
            onInput: (e) => autosave.edit(t.id, { dueDate: e.target.value }, { delay: 400 }),
            onBlur: () => autosave.flush(t.id),
          }),
          extensionValue('taskEstimate', t) ??
            FlowInput({
              id: 'task-points',
              icon: 'clock',
              label: tr('flow.ui.estimate.points'),
              type: 'number',
              min: '0',
              value: String(t.points ?? 0),
              disabled: !canWrite(),
              onInput: (e) => autosave.edit(t.id, { points: Number(e.target.value) }, { delay: 400 }),
              onBlur: () => autosave.flush(t.id),
            }),
          FlowTagPicker({
            id: 'task-tags',
            value: t.tags ?? [],
            options: taskTags(data(), t.projectId),
            disabled: !canWrite(),
            onChange: (tags) => autosave.edit(t.id, { tags }),
            onManage: () => navigate('tags'),
          }),
          FlowSelectField({
            name: 'task-epic',
            label: tr('flow.review.epic'),
            icon: 'layers',
            value: t.epic ?? '',
            disabled: !canWrite(),
            options: [
              { value: '', label: tr('flow.ui.not.linked') },
              ...data()
                .epics.filter((e) => e.projectId === t.projectId)
                .map((e) => ({ value: e.id, label: e.title })),
            ],
            onChange: (e) => autosave.edit(t.id, { epic: e.target.value || null }),
          }),
          ...data()
            .fields.filter((f) => appliesTo(f, t.projectId))
            .map((f) => {
              const icon =
                  f.id === 'env'
                    ? 'settings'
                    : f.id === 'version'
                      ? 'layers'
                      : f.kind === 'date'
                        ? 'calendar'
                        : f.kind === 'boolean'
                          ? 'check'
                          : 'list',
                value = t.customFields?.[f.id],
                change = (value) =>
                  autosave.edit(t.id, { customFields: { ...t.customFields, [f.id]: value } })
              return f.kind === 'boolean'
                ? FlowSelectField({
                    icon,
                    name: 'custom-' + f.id,
                    label: f.title + (f.required ? ' *' : ''),
                    value: value == null ? '' : String(value),
                    disabled: !canWrite(),
                    options: [
                      { value: '', label: tr('flow.ui.not.selected') },
                      { value: 'true', label: tr('flow.ui.true') },
                      { value: 'false', label: tr('flow.ui.false') },
                    ],
                    onChange: (e) => change(e.target.value === '' ? null : e.target.value === 'true'),
                  })
                : f.kind === 'multi-select'
                  ? FlowTagPicker({
                      id: 'custom-' + f.id,
                      label: f.title,
                      placeholder: tr('flow.ui.select.value'),
                      value: value ?? [],
                      options: (f.options ?? []).map((x) => ({ id: x, title: x, color: 'neutral' })),
                      disabled: !canWrite(),
                      onChange: change,
                    })
                  : f.kind === 'select'
                    ? FlowSelectField({
                        icon,
                        name: 'custom-' + f.id,
                        label: f.title + (f.required ? ' *' : ''),
                        value: value ?? '',
                        disabled: !canWrite(),
                        options: [
                          { value: '', label: tr('flow.ui.not.selected') },
                          ...(f.options ?? []).map((x) => ({ value: x, label: x })),
                        ],
                        onChange: (e) => change(e.target.value),
                      })
                    : FlowInput({
                        icon,
                        id: 'custom-' + f.id,
                        label: f.title + (f.required ? ' *' : ''),
                        type: f.kind ?? 'text',
                        value: String(value ?? ''),
                        disabled: !canWrite(),
                        onChange: (e) => change(e.target.value),
                      })
            }),
          FlowProperties({
            items: [
              { icon: 'folder', label: tr('flow.ui.projects'), value: mapped(t).project },
              { icon: 'clock', label: tr('flow.ui.version.e055ec'), value: t.version },
            ],
          }),
        )}`,
      }),
    })
  }
  const sheet = (title, body, back = 'issue') =>
    modalRoute()
      ? body
      : FlowSheet({
          title,
          children: body,
          onClose: () => navigate(back, { id: record() }),
          footer: html`<span data-flow="muted">${canWrite() ? tr('flow.ui.changes.are.saved.when.you.confirm') : tr('flow.ui.you.have.view.only.access.b9a3d0')}</span>`,
        })
  const projectSetup = createProjectSetup({
    data,
    route: activeRoute,
    project: activeProject,
    workspace: workspaceId,
    canWrite,
    busy,
    errors: formError,
    close: closeModal,
    save: (args, editing) =>
      mutate('flow.entity.save', args, (value) => {
        projectSetup.reset()
        if (editing) closeModal()
        else navigate(args.defaultView, { project: value.id, workspace: args.workspaceId }, { replace: true })
      }),
  })
  const tagPreview = signal(null),
    fieldKind = signal('text'),
    columnKind = signal('todo')
  const pageDocDrafts = new Map()
  const kanbanProject = () =>
    FlowEmpty({
      title: tr('flow.cadence.off.title'),
      description: tr('flow.cadence.off.description'),
      action: canManageScope(data(), 'project', project())
        ? navButton('project-profile', tr('flow.cadence.off.action'), 'settings', 'secondary')
        : null,
    })
  const recordForm = () => {
    if (['project-new', 'project-profile'].includes(activeRoute())) return projectSetup.view()
    if (activeRoute() === 'sprint-new' && !usesSprints(selectedProject()))
      return sheet(formDefinitions['sprint-new'].title, kanbanProject(), 'sprints')
    const original = formDefinitions[activeRoute()]
    const def = {
      ...original,
      ...(original.collection === 'pages' ? { back: activeRoute() === 'page-child' ? 'page' : 'pages' } : {}),
    }
    const parentPage = activeRoute() === 'page-child' ? data().pages.find((p) => p.id === record()) : null
    const p = data().projects.find((x) => x.id === activeProject())
    const tag = activeRoute() === 'tag-edit' ? data().tags.find((x) => x.id === record()) : null
    const upcoming =
      activeRoute() === 'sprint-new'
        ? nextSprint(data(), selectedProject(), todayDate(data().timezone))
        : null
    const pageDraftKey = `${companyId()}:${activeRoute()}:${record()}:${activeProject()}`
    if (!pageDocDrafts.has(pageDraftKey)) pageDocDrafts.set(pageDraftKey, {})
    const pageDraft = pageDocDrafts.get(pageDraftKey)
    return sheet(
      def.title,
      html`<form
        on:submit=${(e) => {
          e.preventDefault()
          const values = { ...collect(e), ...(def.collection === 'pages' ? pageDraft : {}) }
          const args = {
            ...values,
            ...(def.collection === 'pages' && !values.description && values.template
              ? {
                  description: {
                    brief: tr('flow.ui.goal.scope.deliverables.and.acceptance.criteria.owner'),
                    meeting: tr('flow.ui.meeting.purpose.decisions.action.items.assignee.due.date'),
                    guide: tr('flow.ui.purpose.prerequisites.steps.verify.results'),
                  }[values.template],
                }
              : {}),
            ...(def.collection === 'projects'
              ? { workspaceId: values.workspaceId ?? workspaceId(), access: values.access ?? 'workspace' }
              : {}),
            projectId:
              def.collection === 'pages'
                ? parentPage
                  ? parentPage.projectId
                  : scopeOf(activeRoute()) === 'workspace'
                    ? null
                    : activeProject()
                : scopeOf(activeRoute()) === 'project'
                  ? activeProject()
                  : null,
            ...(def.collection === 'pages' ? { visibility: parentPage?.visibility ?? 'shared' } : {}),
          }
          mutate(
            'flow.entity.save',
            {
              ...args,
              collection: def.collection,
              entityId: tag?.id ?? (def.edit ? p?.id : undefined),
              parentId: activeRoute() === 'page-child' ? record() : null,
            },
            (value) => {
              if (def.collection === 'pages') {
                pageDocDrafts.delete(pageDraftKey)
                navigate(
                  'page',
                  {
                    id: value.id,
                    project: args.projectId ?? '',
                    scope: args.projectId ? 'project' : 'workspace',
                  },
                  { replace: true },
                )
              } else closeModal()
            },
          )
        }}
      >
        ${stack(
          def.collection === 'pages'
            ? FlowSelectField({
                name: 'template',
                label: tr('flow.ui.start.from'),
                value: '',
                options: [
                  { value: '', label: tr('flow.ui.blank.page') },
                  { value: 'brief', label: tr('flow.ui.project.brief') },
                  { value: 'meeting', label: tr('flow.ui.meeting.notes') },
                  { value: 'guide', label: tr('flow.ui.operating.guide') },
                ],
              })
            : null,
          def.collection === 'pages'
            ? FlowNotice({
                title: tr('flow.ui.ownership'),
                message: parentPage
                  ? tr('flow.ui.child.document.of', [parentPage.title])
                  : scopeOf(activeRoute()) === 'workspace'
                    ? data().company.name
                    : (data().projects.find((p) => p.id === activeProject())?.title ??
                      tr('flow.ui.no.project.selected')),
              })
            : null,
          FlowInput({
            id: 'title',
            label: tr('flow.ui.name'),
            value: tag?.title ?? upcoming?.title ?? (def.edit ? (p?.title ?? '') : ''),
            placeholder: def.title,
            required: true,
            error: formError().title,
            disabled: !canWrite(),
          }),
          activeRoute() === 'project-new' && data().workspaces
            ? FlowSelectField({
                name: 'workspaceId',
                label: 'Workspace',
                value: workspaceId(),
                options: data()
                  .workspaces.filter((w) => !w.archived && canManageScope(data(), 'workspace', w.id))
                  .map((w) => ({ value: w.id, label: w.title })),
              })
            : null,
          activeRoute() === 'project-new' && data().workspaces
            ? FlowSelectField({
                name: 'access',
                label: tr('flow.ui.access.930ae6'),
                value: 'workspace',
                options: [
                  { value: 'workspace', label: tr('flow.ui.inherit.workspace') },
                  { value: 'private', label: tr('flow.ui.restricted.members') },
                ],
              })
            : null,
          activeRoute() === 'tag-edit'
            ? FlowColorPicker({
                id: 'tag-color',
                name: 'color',
                label: tr('flow.ui.label.color'),
                value: tagPreview() ?? tag?.color ?? 'blue',
                disabled: !canWrite(),
                onChange: tagPreview.set,
              })
            : null,
          activeRoute() === 'project-new'
            ? FlowInput({
                id: 'code',
                label: tr('flow.ui.project.code'),
                placeholder: tr('flow.ui.e.g.web'),
                required: true,
              })
            : null,
          def.collection === 'pages'
            ? FlowLiveDoc({
                id: `page-draft-${pageDraftKey}`,
                label: tr('flow.ui.content'),
                snapshot: pageDraft.liveDoc,
                text: pageDraft.description,
                readOnly: !canWrite(),
                onChange: (value) =>
                  Object.assign(pageDraft, {
                    liveDoc: value.snapshot,
                    description: FlowLiveDocText(value),
                    blocks: FlowLiveDocLegacyBlocks(value),
                  }),
              })
            : FlowTextarea({
                id: 'description',
                label: activeRoute() === 'sprint-new' ? tr('flow.ui.cycle.goal') : tr('flow.ui.description'),
                value: tag?.description ?? (def.edit ? (p?.description ?? '') : ''),
                placeholder: tr('flow.ui.context.goals.and.completion.criteria'),
                disabled: !canWrite(),
              }),
          activeRoute() === 'tag-edit'
            ? stack(
                FlowTag({
                  label: tag?.title ?? tr('flow.ui.sample.label'),
                  tone: tagPreview() ?? tag?.color ?? 'blue',
                }),
                FlowHint({
                  children: tr(
                    'flow.ui.changing.a.label.updates.every.task.and.project.using.it.keep.names.short.and.av',
                  ),
                }),
              )
            : null,
          ['sprint-new', 'epic-new'].includes(activeRoute())
            ? inline(
                FlowInput({
                  id: 'start',
                  label: tr('flow.ui.start.date'),
                  type: 'date',
                  value: upcoming?.start ?? todayDate(data().timezone),
                  required: true,
                }),
                FlowInput({
                  id: 'end',
                  label: tr('flow.ui.end.date'),
                  type: 'date',
                  value: upcoming?.end ?? addDays(todayDate(data().timezone), 13),
                  required: true,
                }),
              )
            : null,
          activeRoute() === 'epic-new'
            ? stack(
                FlowSelectField({
                  name: 'owner',
                  label: tr('flow.ui.epic.owner'),
                  value: data().user.name,
                  options: data().people.map((p) => ({ value: p, label: p })),
                }),
                FlowTextarea({ id: 'outcome', label: tr('flow.ui.target.outcome'), required: true }),
                routes.goals
                  ? FlowSelectField({
                      name: 'goalId',
                      label: tr('flow.ui.contributes.to.goal'),
                      value: '',
                      options: [
                        { value: '', label: tr('flow.ui.not.linked') },
                        ...(data().goals ?? [])
                          .filter((g) => g.workspaceId === workspaceId())
                          .map((g) => ({ value: g.id, label: g.title })),
                      ],
                    })
                  : null,
              )
            : null,
          activeRoute() === 'field-edit'
            ? FlowSelectField({
                name: 'kind',
                label: tr('flow.ui.data.type'),
                value: fieldKind(),
                onChange: (e) => fieldKind.set(e.target.value),
                disabled: !canWrite(),
                options: [
                  { value: 'text', label: tr('flow.ui.text') },
                  { value: 'number', label: tr('flow.ui.number') },
                  { value: 'date', label: tr('flow.ui.date') },
                  { value: 'select', label: tr('flow.ui.select') },
                  { value: 'multi-select', label: tr('flow.ui.multiple.select') },
                  { value: 'boolean', label: tr('flow.ui.true.false') },
                ],
              })
            : null,
          activeRoute() === 'column-edit'
            ? FlowSelectField({
                name: 'kind',
                label: tr('flow.ui.status.group'),
                value: columnKind(),
                onChange: (e) => columnKind.set(e.target.value),
                disabled: !canWrite(),
                options: [
                  { value: 'todo', label: tr('flow.ui.not.started') },
                  { value: 'progress', label: tr('flow.ui.in.progress.ae8756') },
                  { value: 'review', label: tr('flow.ui.in.review') },
                  { value: 'done', label: tr('flow.ui.done') },
                ],
              })
            : null,
          activeRoute() === 'type-edit'
            ? stack(
                FlowSelectField({
                  name: 'icon',
                  label: tr('flow.ui.icon'),
                  value: 'list',
                  options: [
                    { value: 'list', label: tr('flow.ui.tasks') },
                    { value: 'flag', label: tr('flow.ui.flag') },
                    { value: 'layers', label: tr('flow.ui.deliverable.category') },
                  ],
                }),
                FlowHint({
                  children: tr(
                    'flow.ui.describe.when.to.use.this.type.use.color.labels.for.topic.based.categorization',
                  ),
                }),
              )
            : null,
          activeRoute() === 'field-edit'
            ? stack(
                FlowSelectField({
                  name: 'required',
                  label: tr('flow.ui.required.before.completion'),
                  value: 'false',
                  options: [
                    { value: 'false', label: tr('flow.ui.no') },
                    { value: 'true', label: tr('flow.ui.yes') },
                  ],
                }),
                FlowSelectField({
                  name: 'appliesTo',
                  label: tr('flow.ui.applies.to'),
                  value: 'all',
                  options: [
                    { value: 'all', label: tr('flow.ui.all.projects.in.organization') },
                    ...data().projects.map((p) => ({ value: p.id, label: p.title })),
                  ],
                }),
                ['select', 'multi-select'].includes(fieldKind())
                  ? FlowTextarea({
                      id: 'options',
                      label: tr('flow.ui.options.one.value.per.line'),
                      required: true,
                    })
                  : null,
                FlowDisclosure({
                  title: tr('flow.ui.preview.in.task.properties'),
                  open: true,
                  children:
                    fieldKind() === 'boolean'
                      ? FlowCheckbox({ label: tr('flow.ui.sample.field'), checked: false, disabled: true })
                      : ['select', 'multi-select'].includes(fieldKind())
                        ? FlowTag({ label: tr('flow.ui.selected.value') })
                        : FlowInput({
                            id: 'field-preview',
                            label: tr('flow.ui.sample.field'),
                            type: fieldKind(),
                            disabled: true,
                          }),
                }),
              )
            : null,
          activeRoute() === 'column-edit'
            ? stack(
                FlowStatus({
                  status: columnKind(),
                  label: {
                    todo: tr('flow.ui.not.started'),
                    progress: tr('flow.ui.in.progress.ae8756'),
                    review: tr('flow.ui.awaiting.acceptance.9782f0'),
                    done: tr('flow.ui.done'),
                  }[columnKind()],
                }),
                FlowHint({
                  children: tr(
                    'flow.ui.new.statuses.are.added.to.the.organization.library.existing.tasks.keep.their.sta',
                  ),
                }),
              )
            : null,
          activeRoute() === 'column-edit'
            ? FlowNotice({
                title: tr('flow.ui.status.meaning'),
                message: tr(
                  'flow.ui.column.names.are.customizable.the.final.column.determines.whether.work.is.comple',
                ),
              })
            : null,
          actions(
            formModalRoutes.has(modalRoute())
              ? FlowButton({ label: tr('flow.ui.cancel'), onClick: closeModal })
              : navButton(def.back, tr('flow.ui.cancel')),
            submit(activeRoute() === 'tag-edit' ? tr('flow.ui.save.label') : def.title),
          ),
        )}
      </form>`,
      def.back,
    )
  }
  const taskLookup = signal('')
  const taskOperation = () => {
    const t = currentTask()
    if (!t)
      return FlowEmpty({
        title: tr('flow.ui.no.tasks.yet'),
        description: tr('flow.ui.create.a.task.before.using.this.action'),
      })
    const key = activeRoute()
    let body
    if (['issue-move', 'board-move'].includes(key)) {
      const blockers = t.blockedBy
        .map((id) => data().tasks.find((x) => x.id === id))
        .filter((x) => x && !isDone(data(), x))
      body = stack(
        FlowNotice({ title: t.id, message: t.title }),
        blockers.length
          ? FlowSection({
              inset: 'none',
              title: tr('flow.today.blockers'),
              description: tr('flow.today.blockedHelp'),
              children: FlowList({
                children: html`${each(
                  blockers,
                  (x) => x.id,
                  (x) =>
                    FlowListItem({
                      title: x.id + ' · ' + x.title,
                      description: taskAssigneeNames(data(), x),
                      meta: FlowStatus({
                        status: statusKind(data(), x),
                        label: taskColumns(data(), x.projectId).find((c) => c.id === x.status)?.label,
                      }),
                      actions: FlowButton({
                        label: tr('flow.today.openBlocker'),
                        size: 'sm',
                        onClick: () => taskOpen(x),
                      }),
                    }),
                )}`,
              }),
            })
          : null,
        ...taskColumns(data(), t.projectId).map((c) => {
          const gate = transitionFor(t, c.id),
            handover = gate?.action
          const disabled = t.status === c.id || !!gate?.blocked || (!!handover && blockers.length > 0)
          return FlowListItem({
            title: FlowStatus({ status: c.kind, label: c.label, color: c.color }),
            description: gate?.message ?? null,
            actions: FlowButton({
              label:
                t.status === c.id
                  ? tr('flow.ui.current.status')
                  : handover
                    ? handover.label
                    : tr('flow.ui.move.to', [c.label]),
              size: 'sm',
              disabled: disabled || !canWrite() || busy(),
              onClick: () =>
                handover ? navigate(handover.key, { id: t.id, project: t.projectId }) : move(t.id, c.id),
            }),
          })
        }),
      )
    } else if (key === 'issue-sprint')
      body = stack(
        ...data()
          .sprints.filter((s) => s.state !== 'closed' && s.projectId === t.projectId)
          .map((s) =>
            FlowNotice({
              title: s.title,
              message: tr('flow.ui.points.abac26', [
                s.start,
                s.end,
                data()
                  .tasks.filter((x) => x.projectId === s.projectId && x.sprint === s.title)
                  .reduce((n, x) => n + (x.points || 0), 0),
                t.sprint === s.title ? tr('flow.ui.selected.ad61dc') : s.description,
              ]),
              action: action(tr('flow.ui.assign.to.sprint'), () =>
                mutate('flow.issue.assignSprint', { id: t.id, sprint: s.title }, () =>
                  navigate('issue', { id: t.id }),
                ),
              ),
            }),
          ),
      )
    else if (['dependency-new', 'subtask-link'].includes(key))
      body = stack(
        FlowSearch({
          label: tr('flow.ui.search.related.tasks'),
          placeholder: tr('flow.ui.task.id.or.name'),
          value: taskLookup(),
          onInput: (e) => taskLookup.set(e.target.value),
        }),
        FlowNotice({
          title: key === 'dependency-new' ? tr('flow.ui.select.blocking.task') : tr('flow.ui.select.subtask'),
          message:
            key === 'dependency-new'
              ? tr('flow.ui.this.task.cannot.be.completed.until.the.selected.task.is.done')
              : tr('flow.ui.the.selected.task.keeps.its.status.and.assignee'),
        }),
        ...data()
          .tasks.filter(
            (x) =>
              x.id !== t.id &&
              !x.archived &&
              x.projectId === t.projectId &&
              tidy(x.id + ' ' + x.title).includes(tidy(taskLookup())),
          )
          .map((x) =>
            FlowNotice({
              title: x.id,
              message: `${x.title} · ${key === 'dependency-new' ? t.id + tr('flow.ui.blocked.by.20f5f4') + x.id : tr('flow.ui.current.parent') + (x.parentId ?? tr('flow.ui.none')) + ' → ' + t.id + tr('flow.ui.parent.and.subtask.work.volume.is.not.counted.twice')}`,
              action: action(tr('flow.ui.select.1171ca'), () =>
                mutate(
                  key === 'dependency-new' ? 'flow.issue.dependency' : 'flow.issue.linkChild',
                  { id: t.id, target: x.id },
                  () => navigate('issue', { id: t.id }),
                ),
              ),
            }),
          ),
      )
    else if (key === 'issue-archive')
      body = html`<form
        on:submit=${(e) => {
          e.preventDefault()
          mutate('flow.issue.archive', { id: t.id, ...collect(e) }, () => navigate('issues-archived'))
        }}
      >
        ${stack(FlowNotice({ title: tr('flow.ui.remove.task.from.active.views'), message: tr('flow.ui.archiving.is.not.completion.subtasks.remain.dependent.tasks.stay.blocked.restore', [data().tasks.filter((x) => x.parentId === t.id).length, data().tasks.filter((x) => x.blockedBy.includes(t.id) && !isDone(data(), x)).length]), tone: 'yellow' }), FlowTextarea({ id: 'reason', label: tr('flow.ui.reason.for.archiving'), required: true }), submit(tr('flow.ui.confirm.archive')))}
      </form>`
    else if (key === 'comment')
      body = html`<form
        on:submit=${(e) => {
          e.preventDefault()
          mutate('flow.issue.comment', { id: t.id, text: collect(e).text }, () =>
            navigate('issue', { id: t.id }),
          )
        }}
      >
        ${stack(FlowTextarea({ id: 'text', label: tr('flow.ui.comment'), required: true, placeholder: tr('flow.ui.reply') }), submit(tr('flow.ui.post.comment')))}
      </form>`
    else body = taskDetail()
    /** In the modal the dialog body already pads a single picker or form; only the standalone sheet needs a section. */
    return modalRoute() ? body : sheet(routes[key].title, FlowSection({ children: body }))
  }
  const resourceList = (collection, target, create) =>
    FlowSection({
      title: routes[screen()].title,
      actions: create ? navButton(create, tr('flow.ui.create.new'), 'plus', 'primary') : null,
      children: !data()[collection].some((x) => !x.archived)
        ? FlowEmpty({
            title: tr('flow.ui.no.data.yet'),
            description: tr('flow.ui.create.the.first.item.to.start.working.with.your.team'),
          })
        : FlowCardGrid({
            children: html`${each(
              data()[collection].filter(
                (x) =>
                  !x.archived &&
                  (collection === 'projects'
                    ? !data().workspaces || x.workspaceId === workspaceId()
                    : screen() === 'all-epics'
                      ? data().projects.some((p) => p.id === x.projectId && p.workspaceId === workspaceId())
                      : x.projectId === project()),
              ),
              (x) => x.id,
              (x) =>
                FlowResourceCard({
                  title: x.title,
                  description:
                    collection === 'projects'
                      ? `${data().members?.find((m) => m.id === x.ownerId)?.name ?? tr('flow.ui.unassigned.1f3799')} · ${x.end ?? tr('flow.ui.no.target.date')}`
                      : (x.description ?? ''),
                  progress: undefined,
                  meta: FlowTag({ label: collection === 'projects' ? x.code : tr('flow.ui.active') }),
                  onOpen: () => {
                    if (collection === 'projects') {
                      project.set(x.id)
                      navigate('board')
                    } else navigate(target, { id: x.id, project: x.projectId })
                  },
                }),
            )}`,
          }),
    })
  const sprints = () =>
    !usesSprints(selectedProject())
      ? kanbanProject()
      : FlowSection({
          title: tr('flow.ui.development.cycles'),
          actions: navButton('sprint-new', tr('flow.ui.create.sprint'), 'plus', 'primary'),
          children: stack(
            FlowDisclosure({
              title: tr('flow.ui.backlog.not.in.a.sprint'),
              children: stack(
                FlowHint({ children: tr('flow.ui.open.a.task.to.assign.it.to.a.sprint') }),
                table(
                  data().tasks.filter(
                    (t) => t.projectId === project() && !t.archived && (!t.sprint || t.sprint === 'Backlog'),
                  ),
                ),
              ),
            }),
            ...data()
              .sprints.filter((s) => s.projectId === project())
              .map((s) => {
                const tasks = data().tasks.filter(
                  (t) => t.projectId === s.projectId && t.sprint === s.title && !t.archived,
                )
                return FlowDisclosure({
                  title: html`<strong>${s.title}</strong> ${FlowTag({ label: { active: tr('flow.ui.active.cd07e6'), planned: tr('flow.ui.planned.89112b'), closed: tr('flow.ui.closed') }[s.state], tone: s.state === 'active' ? 'green' : 'neutral' })}`,
                  description: tr('flow.ui.points.tasks.complete', [
                    s.start,
                    s.end,
                    tasks.reduce((n, t) => n + (extensionValue('taskPoints', t) ?? (t.points || 0)), 0),
                    tasks.filter((t) => isDone(data(), t)).length,
                    tasks.length,
                  ]),
                  open: s.state === 'active',
                  children: stack(
                    FlowHint({ children: s.description }),
                    table(tasks),
                    actions(
                      s.state === 'planned'
                        ? action(
                            tr('flow.ui.start'),
                            () =>
                              mutate('flow.entity.action', {
                                collection: 'sprints',
                                entityId: s.id,
                                action: 'start',
                              }),
                            'primary',
                          )
                        : s.state === 'active'
                          ? navButton('sprint-close', tr('flow.ui.close.sprint'), 'check', 'secondary', {
                              id: s.id,
                            })
                          : navButton('sprint-report', tr('flow.ui.view.summary'), 'grid', 'secondary', {
                              id: s.id,
                            }),
                    ),
                  ),
                })
              }),
          ),
        })
  const sprintClose = () => {
    const s =
      data().sprints.find((s) => s.id === record()) ??
      data().sprints.find((s) => s.projectId === activeProject() && s.state === 'active')
    if (!s) return FlowEmpty({ title: tr('flow.ui.no.active.sprint.found') })
    const pending = data().tasks.filter(
      (t) => t.projectId === s.projectId && t.sprint === s.title && !isDone(data(), t),
    )
    return sheet(
      tr('flow.ui.close') + s.title,
      stack(
        FlowHint({
          children: tr(
            'flow.ui.unfinished.tasks.points.will.carry.over.completed.work.stays.in.this.sprint',
            [pending.length, pending.reduce((n, t) => n + (t.points || 0), 0)],
          ),
        }),
        stack(
          ...pending.map((t) =>
            FlowListItem({
              title: t.id + ' · ' + t.title,
              description: taskAssigneeNames(data(), t),
              meta: FlowTag({ label: (t.points ?? 0) + tr('flow.ui.points.250150') }),
            }),
          ),
        ),
        html`<form on:submit=${(e) => {
          e.preventDefault()
          mutate(
            'flow.entity.action',
            { collection: 'sprints', entityId: s.id, action: 'close', carryTo: collect(e).carryTo },
            () => navigate('sprint-report', { id: s.id }),
          )
        }}>${stack(
          FlowSelectField({
            name: 'carryTo',
            label: tr('flow.ui.move.remaining.work.to'),
            value: 'Backlog',
            options: [
              { value: 'Backlog', label: 'Backlog' },
              ...data()
                .sprints.filter((x) => x.projectId === s.projectId && x.id !== s.id && x.state !== 'closed')
                .map((x) => ({ value: x.title, label: x.title + ' · ' + x.start + ' → ' + x.end })),
            ],
          }),
          submit(tr('flow.ui.confirm.sprint.closure')),
        )}</form>`,
      ),
      'sprints',
    )
  }
  const pageParent = signal('')
  const pageMove = () => {
    const page = data().pages.find((p) => p.id === record())
    if (!page) return FlowEmpty({ title: tr('flow.ui.document.not.found') })
    const candidates = data().pages.filter(
      (p) =>
        p.id !== page.id &&
        !p.archived &&
        (p.projectId ?? null) === (page.projectId ?? null) &&
        (p.workspaceId ?? null) === (page.workspaceId ?? null) &&
        (p.visibility ?? 'shared') === (page.visibility ?? 'shared'),
    )
    return sheet(
      tr('flow.ui.move.document'),
      stack(
        FlowProperties({
          items: [
            {
              label: tr('flow.ui.current'),
              value:
                (data().pages.find((p) => p.id === page.parentId)?.title ?? tr('flow.ui.root')) +
                ' / ' +
                page.title,
            },
            {
              label: tr('flow.ui.ownership'),
              value:
                data().projects.find((p) => p.id === page.projectId)?.title ??
                data().workspaces.find((w) => w.id === page.workspaceId)?.title ??
                'Workspace',
            },
          ],
        }),
        FlowSelectField({
          name: 'new-parent',
          label: tr('flow.ui.new.parent.document'),
          value: pageParent(),
          options: [
            { value: '', label: tr('flow.ui.root') },
            ...candidates.map((p) => ({ value: p.id, label: p.title })),
          ],
          onChange: (e) => pageParent.set(e.target.value),
        }),
        FlowHint({
          children: tr(
            'flow.ui.new.path.ownership.and.access.stay.unchanged.only.the.tree.location.changes',
            [candidates.find((p) => p.id === pageParent())?.title ?? tr('flow.ui.root'), page.title],
          ),
        }),
        action(
          tr('flow.ui.confirm.move.69b8f6'),
          () =>
            mutate(
              'flow.entity.action',
              { collection: 'pages', entityId: page.id, action: 'move', parentId: pageParent() || null },
              () => navigate('page', { id: page.id }, { replace: true }),
            ),
          'primary',
        ),
      ),
      'pages',
    )
  }
  const settings = () =>
    FlowSection({
      title: tr('flow.ui.project.setup.863c6d', [selectedProject()?.title ?? '']),
      children: stack(
        ...extensions.map((x) => x.settingsSection?.('project-settings') ?? null),
        FlowListItem({
          title: selectedProject()?.title ?? '',
          description: tr('flow.ui.code', [
            selectedProject()?.code ?? '',
            selectedProject()?.description ?? '',
          ]),
          actions: navButton('project-profile', tr('flow.ui.edit.profile'), 'settings'),
        }),
        FlowProperties({
          items: [
            {
              label: tr('flow.ui.status'),
              value: (() => {
                const state = projectStatuses(selectedProject()).find(
                  (s) => s.id === (selectedProject()?.state ?? 'planned'),
                )
                return FlowTag({
                  label: state?.title ?? tr('flow.ui.not.set.ba42e8'),
                  tone: state?.color ?? 'neutral',
                })
              })(),
            },
            {
              label: tr('flow.ui.labels'),
              value: inline(
                ...(data().tags ?? [])
                  .filter((t) => selectedProject()?.tags?.includes(t.id))
                  .map((t) => FlowTag({ label: t.title, tone: t.color ?? 'neutral' })),
              ),
            },
            {
              label: tr('flow.ui.assignee.02be53'),
              value:
                data().members?.find((m) => m.id === selectedProject()?.ownerId)?.name ??
                tr('flow.ui.not.selected'),
            },
            {
              label: tr('flow.ui.timeline'),
              value: `${selectedProject()?.start || tr('flow.ui.not.set.ba42e8')} → ${selectedProject()?.end || tr('flow.ui.not.set.ba42e8')}`,
            },
            {
              label: tr('flow.ui.expected.outcome'),
              value: selectedProject()?.outcome || tr('flow.ui.not.recorded'),
            },
          ],
        }),
        data().workspaces
          ? inline(
              navButton('project-members', tr('flow.ui.members.permissions'), 'settings'),
              navButton('project-move', tr('flow.ui.move.workspace'), 'folder'),
            )
          : null,

        FlowSection({
          inset: 'none',
          title: tr('flow.ui.task.configuration'),
          children: stack(
            FlowHint({
              children:
                tr('flow.ui.statuses') +
                (selectedProject()?.taskStatusIds
                  ? tr('flow.ui.project.specific.set')
                  : tr('flow.ui.organization.library')) +
                tr('flow.ui.labels.6950b6') +
                (selectedProject()?.taskLabelIds
                  ? tr('flow.ui.project.specific.set')
                  : tr('flow.ui.organization.library')),
            }),
            inline(
              ...taskColumns(data(), project()).map((c) =>
                FlowStatus({ status: c.kind, label: c.label, color: c.color }),
              ),
            ),
            inline(
              ...taskTags(data(), project())
                .filter((t) => !t.archived)
                .map((t) => FlowTag({ label: t.title, tone: t.color })),
            ),
            navButton('project-profile', tr('flow.ui.customize.statuses.and.labels'), 'settings'),
          ),
        }),
        FlowSection({
          inset: 'none',
          title: tr('flow.ui.project.tools'),
          children: inline(
            routes.automations ? navButton('automations', tr('flow.ui.automations'), 'reset') : null,
            navButton('forms', tr('flow.ui.intake.forms'), 'list'),
          ),
        }),
      ),
    })
  const workspaceSettings = () =>
    FlowSection({
      title: tr('flow.ui.workspace.settings'),
      children: stack(
        FlowStack({
          gap: 'md',
          children: html`${FlowListItem({ variant: 'plain', title: data().workspaces.find((w) => w.id === workspaceId())?.title ?? 'Workspace', description: tr('flow.ui.manage.workspace.information.members.and.teams'), actions: inline(navButton('workspace-edit', tr('flow.ui.workspace.information'), 'settings', 'ghost'), navButton('workspace-members', tr('flow.ui.member'), 'user', 'ghost')) })}${FlowHint({ children: tr('flow.ui.the.shared.task.library.belongs.to.projects.with.custom.statuses.and.labels.keep', [data().company.name]) })}`,
        }),
        navButton('organization-settings', tr('flow.review.library'), 'arrow'),
        routes['workspace-integrations']
          ? navButton('workspace-integrations', tr('flow.ui.integrations'), 'link')
          : null,
      ),
    })
  const dashboard = () => {
    const projects = data().projects.filter((p) => p.workspaceId === workspaceId()),
      tasks = data().tasks.filter((t) => !t.archived && projects.some((p) => p.id === t.projectId))
    const mode =
      typeof location !== 'undefined' ? new URL(location.href).searchParams.get('risk') : props.risk
    const risk = (t) =>
      !isDone(data(), t) &&
      ((mode !== 'overdue' &&
        t.blockedBy?.some(
          (id) =>
            !isDone(
              data(),
              data().tasks.find((x) => x.id === id),
            ),
        )) ||
        (mode !== 'blocked' && t.dueDate && t.dueDate < todayDate(data().timezone)))
    return FlowSection({
      title: tr('flow.ui.workspace.decisions.needed'),
      actions: routes.workload ? navButton('workload', tr('flow.ui.balance.workload'), 'grid') : null,
      children: stack(
        FlowHint({
          children: tr('flow.ui.as.of.projects.blocked.overdue.awaiting.acceptance', [
            todayDate(data().timezone),
            projects.length,
            tasks.filter(risk).length,
            tasks.filter((t) => statusKind(data(), t) === 'review').length,
          ]),
        }),
        FlowSection({
          inset: 'none',
          title: tr('flow.ui.needs.intervention'),
          children: tasks.some(risk)
            ? table(tasks.filter(risk), null, null, 'workspace-risk')
            : FlowHint({ children: tr('flow.ui.no.overdue.or.blocked.tasks.in.this.scope') }),
        }),
        FlowSection({
          inset: 'none',
          title: tr('flow.ui.awaiting.handover.decision'),
          actions: routes['quality-inbox']
            ? navButton('quality-inbox', tr('flow.ui.open.queue'), 'check')
            : null,
          children: table(
            tasks.filter((t) => statusKind(data(), t) === 'review'),
            null,
            null,
            'workspace-review',
          ),
        }),
        FlowList({
          children: html`${each(
            [...projects].sort(
              (a, b) =>
                tasks.filter((t) => t.projectId === b.id && risk(t)).length -
                tasks.filter((t) => t.projectId === a.id && risk(t)).length,
            ),
            (p) => p.id,
            (p) =>
              FlowListItem({
                title: p.title,
                description: tr('flow.ui.tasks.need.attention.target', [
                  tasks.filter((t) => t.projectId === p.id && risk(t)).length,
                  p.end ?? tr('flow.ui.not.set'),
                ]),
                actions: navButton('board', tr('flow.ui.open.project'), 'folder', 'secondary', {
                  project: p.id,
                }),
              }),
          )}`,
        }),
        FlowDisclosure({ title: tr('flow.ui.summary.metrics'), children: metrics(tasks) }),
      ),
    })
  }
  const openSavedView = () => {
    const url = new URL(location.href)
    url.searchParams.set('modal', 'save-view')
    history.pushState({ ...history.state, flowViewModal: true }, '', url)
    savedViewOpen.set(true)
  }
  const closeSavedView = () => {
    if (history.state?.flowViewModal) history.back()
    else {
      const url = new URL(location.href)
      url.searchParams.delete('modal')
      history.replaceState(history.state, '', url)
      savedViewOpen.set(false)
    }
  }
  const savedViewDialog = () =>
    savedViewOpen()
      ? FlowDialog({
          id: 'flow-view-modal',
          title: tr('flow.ui.save.view'),
          onRequestClose: closeSavedView,
          feedback: feedbackToast(),
          body: html`<form id="flow-view-create" on:submit=${async (e) => {
            e.preventDefault()
            const ok = await mutate('flow.entity.save', {
              collection: 'views',
              ...collect(e),
              projectId: project(),
              query: query(),
              status: status(),
            })
            if (ok) {
              savedViewDraft = { title: '', description: '' }
              closeSavedView()
            }
          }}>${stack(
            FlowInput({
              id: 'title',
              label: tr('flow.ui.view.name'),
              required: true,
              disabled: !canWrite(),
              value: savedViewDraft.title,
              error: formError().title,
              onInput: (e) => {
                savedViewDraft.title = e.target.value
              },
            }),
            FlowTextarea({
              id: 'description',
              label: tr('flow.ui.notes'),
              placeholder: tr('flow.ui.describe.the.purpose.or.usage.of.this.view'),
              disabled: !canWrite(),
              value: savedViewDraft.description,
              onInput: (e) => {
                savedViewDraft.description = e.target.value
              },
            }),
            FlowNotice({
              title: tr('flow.ui.saved.conditions'),
              message: tr('flow.ui.search.status', [
                query() || tr('flow.ui.all'),
                data().columns.find((c) => c.id === status())?.label ?? tr('flow.ui.all'),
              ]),
            }),
          )}</form>`,
          footer: actions(
            FlowButton({ label: tr('flow.ui.cancel'), onClick: closeSavedView }),
            FlowButton({
              label: tr('flow.ui.save.view'),
              variant: 'primary',
              disabled: !canWrite(),
              loading: busy(),
              onClick: () => host?.querySelector('#flow-view-create')?.requestSubmit(),
            }),
          ),
        })
      : null
  const cmdk = () => {
    const groups = commandResults(data(), commandQuery(), {
      workspaceId: workspaceId(),
      recent: recentCommands.get(companyId()) ?? [],
    })
    return FlowSpotlight({
      id: 'flow-command-modal',
      feedback: feedbackToast(),
      title: routes.cmdk.title,
      query: commandQuery(),
      scope: data().company.name,
      activeId: commandActive(),
      groups,
      onQuery: (value) =>
        batch(() => {
          commandQuery.set(value)
          commandActive.set('')
        }),
      onActive: commandActive.set,
      onSelect: (id) => {
        const item = groups.flatMap((g) => g.items).find((x) => x.id === id)
        if (item) {
          recentCommands.set(
            companyId(),
            [id, ...(recentCommands.get(companyId()) ?? []).filter((x) => x !== id)].slice(0, 8),
          )
          navigate(item.route, item.params)
        }
      },
      onClose: closeModal,
    })
  }
  const display = () =>
    sheet(
      tr('flow.ui.display.options'),
      stack(
        FlowSelect({
          label: tr('flow.ui.group.tasks'),
          value: groupBy(),
          options: [
            { value: 'status', label: tr('flow.ui.group.by.status') },
            { value: 'priority', label: tr('flow.ui.group.by.priority') },
            { value: 'assignee', label: tr('flow.ui.group.by.assignee') },
            { value: 'sprint', label: tr('flow.ui.group.by.sprint') },
            { value: 'none', label: tr('flow.ui.no.grouping') },
          ],
          onChange: (e) => changeGroup(e.target.value),
        }),
        FlowSelect({
          label: tr('flow.ui.density'),
          value: density(),
          options: [
            { value: 'compact', label: tr('flow.ui.compact.36px.rows') },
            { value: 'comfortable', label: tr('flow.ui.comfortable.44px.rows') },
          ],
          onChange: (e) => density.set(e.target.value),
        }),
        FlowHint({
          children: tr(
            'flow.ui.display.changes.apply.immediately.to.the.list.these.are.personal.preferences.use',
          ),
        }),
        actions(
          FlowButton({
            label: tr('flow.ui.restore.defaults'),
            onClick: () => {
              changeGroup('status')
              density.set('comfortable')
            },
          }),
          FlowButton({
            label: tr('flow.ui.apply'),
            variant: 'primary',
            onClick: () => {
              history.replaceState({}, '', modalBackground.url)
              readUrl()
            },
          }),
        ),
      ),
      'all-issues',
    )
  const timezone = () =>
    sheet(
      tr('flow.ui.business.timezone'),
      stack(
        FlowNotice({
          title: tr('flow.ui.team.day.boundaries'),
          message: tr(
            'flow.ui.organization.timezone.current.time.changes.affect.shared.day.grouping.personal.d',
            [
              data().timezone,
              new Intl.DateTimeFormat(flowLocaleTag(), {
                timeStyle: 'short',
                timeZone: data().timezone,
              }).format(new Date()),
            ],
          ),
        }),
        FlowSelect({
          label: tr('flow.ui.timezone.2dd01b'),
          value: data().timezone,
          options: options(['Asia/Ho_Chi_Minh', 'Asia/Singapore', 'UTC']),
          onChange: (e) => mutate('flow.preferences.save', { timezone: e.target.value }),
        }),
      ),
      'settings',
    )
  const content = () => {
    const key = screen()
    if (
      isGuest() &&
      (adminRoutes.has(key) ||
        organizationRoutes[key] ||
        extensionRoutes[key]?.admin ||
        ['workspace-settings', 'tags'].includes(key))
    )
      return denied()
    if (operationRoutes.has(key)) return operations.view(key)
    if (extensionRoutes[key]) return extensionFor(key)?.view?.(key) ?? null
    if (organizationRoutes[key]) return organization.view(key)
    if (data().workspaces && key === 'workspace-settings') return workspaceSettings()
    if (scopeOf(key) === 'project' && !selectedProject())
      return FlowEmpty({
        title: tr('flow.ui.select.a.project.to.continue'),
        description: tr('flow.ui.this.link.requires.a.specific.project'),
        action: navButton('projects', tr('flow.ui.view.projects'), 'folder'),
      })
    if (formDefinitions[key]) return recordForm()
    if (listKeys.has(key)) return issueList()
    if (detailKeys.has(key)) return taskDetail()
    if (
      [
        'issue-move',
        'board-move',
        'issue-sprint',
        'subtask-link',
        'dependency-new',
        'issue-archive',
        'comment',
      ].includes(key)
    )
      return taskOperation()
    if (documentKeys.has(key)) return null
    switch (key) {
      case 'board':
        return board()
      case 'projects':
        return resourceList('projects', 'board', 'project-new')
      case 'epics':
      case 'all-epics':
        return resourceList('epics', 'epic', 'epic-new')
      case 'epic': {
        const epic =
          data().epics.find((x) => x.id === backgroundRecord() && x.projectId === project()) ??
          data().epics.find((x) => x.projectId === project())
        if (!epic)
          return FlowEmpty({
            title: tr('flow.ui.no.epics.yet'),
            action: navButton('epic-new', tr('flow.ui.create.epic.c4da32'), 'plus'),
          })
        const tasks = data().tasks.filter(
          (t) => t.projectId === project() && (t.epic === epic.id || t.epic === epic.title),
        )
        return FlowSection({
          title: epic.title,
          actions: routes['epic-map']
            ? navButton('epic-map', tr('flow.ui.dependencies.6bc581'), 'link')
            : null,
          children: stack(
            FlowHint({ children: epic.description }),
            routes.goals
              ? FlowSelectField({
                  name: 'epic-goal',
                  label: tr('flow.ui.related.goals'),
                  value: epic.goalId ?? '',
                  disabled: !canWrite(),
                  options: [
                    { value: '', label: tr('flow.ui.not.linked') },
                    ...data()
                      .goals.filter((g) => g.workspaceId === workspaceId())
                      .map((g) => ({ value: g.id, label: g.title })),
                  ],
                  onChange: (e) =>
                    mutate('flow.entity.save', {
                      collection: 'epics',
                      entityId: epic.id,
                      projectId: project(),
                      title: epic.title,
                      description: epic.description,
                      goalId: e.target.value,
                      owner: epic.owner,
                      outcome: epic.outcome,
                    }),
                })
              : null,
            FlowProperties({
              items: [
                {
                  label: tr('flow.ui.assignee.558c25'),
                  value: epic.owner ?? tr('flow.ui.unassigned.1f3799'),
                },
                { label: tr('flow.ui.target.outcome'), value: epic.outcome ?? epic.description },
                { label: tr('flow.ui.target.date'), value: epic.end ?? tr('flow.ui.not.set.ba42e8') },
                ...(routes.goals
                  ? [
                      {
                        label: tr('flow.ui.related.goals'),
                        value:
                          data().goals.find((g) => g.id === epic.goalId)?.title ?? tr('flow.ui.not.linked'),
                      },
                    ]
                  : []),
              ],
            }),
            FlowDisclosure({
              title: tr('flow.ui.milestone'),
              open: true,
              children: tasks.some((t) => t.type === 'milestone')
                ? table(tasks.filter((t) => t.type === 'milestone'))
                : FlowHint({ children: tr('flow.ui.add.a.milestone.task.and.link.it.to.this.epic') }),
            }),
            table(tasks),
            navButton('issue-new', tr('flow.ui.add.task'), 'plus'),
          ),
        })
      }
      case 'sprints':
        return sprints()
      case 'sprint-close':
        return sprintClose()
      case 'sprint-report': {
        const sprint =
          data().sprints.find((s) => s.id === backgroundRecord()) ??
          data().sprints.find((s) => s.projectId === project())
        const tasks = data().tasks.filter(
          (t) =>
            t.projectId === project() &&
            (sprint?.report ? sprint.report.taskIds.includes(t.id) : t.sprint === sprint?.title),
        )
        return FlowSection({
          title: sprint?.title ?? tr('flow.ui.sprint.summary'),
          children: stack(
            FlowHint({
              children: sprint?.report
                ? tr('flow.ui.committed.points.added.removed.completed.carried.to', [
                    sprint.report.committedPoints ?? '—',
                    sprint.report.added ?? 0,
                    sprint.report.removed ?? 0,
                    sprint.report.completed,
                    sprint.report.carried,
                    sprint.report.carryTo,
                  ])
                : tr('flow.ui.this.sprint.is.still.open.this.is.current.progress'),
            }),
            sprint?.report
              ? stack(
                  ...extensions.flatMap((x) => x.sprintSummary?.(sprint.report) ?? []),
                  ...(sprint.report.tasks ?? tasks).map((t) =>
                    FlowListItem({
                      title: t.id + ' · ' + t.title,
                      description: tr('flow.ui.points.fd5863', [
                        t.creditedPoints ?? t.points ?? 0,
                        data().columns.find((c) => c.id === t.status)?.label ?? t.status,
                      ]),
                      actions: navButton('issue', tr('flow.ui.open.task'), 'arrow', 'secondary', {
                        id: t.id,
                        project: project(),
                      }),
                    }),
                  ),
                )
              : stack(metrics(tasks), table(tasks)),
          ),
        })
      }
      case 'page':
        return null
      case 'page-move':
        return pageMove()
      case 'settings':
        return settings()
      case 'workspace-settings':
        return workspaceSettings()
      case 'tags':
        return FlowSection({
          title: tr('flow.ui.task.labels.organization'),
          actions: navButton('tag-edit', tr('flow.ui.add.label'), 'plus'),
          children: stack(
            ...data()
              .tags.filter((t) => !t.archived && !t.projectId)
              .map((t) =>
                FlowNotice({
                  title: FlowTag({ label: t.title, tone: t.color ?? 'neutral' }),
                  message: tr(
                    'flow.ui.used.by.tasks.and.projects.this.label.belongs.to.the.organization.library',
                    [
                      data().tasks.filter((x) => x.tags?.includes(t.id)).length,
                      data().projects.filter((x) => x.tags?.includes(t.id)).length,
                    ],
                  ),
                  action: inline(
                    navButton('tag-edit', tr('flow.ui.edit.label'), 'settings', 'secondary', { id: t.id }),
                    action(tr('flow.ui.archive'), () => {
                      if (confirm(tr('flow.ui.archive.label', [t.title])))
                        mutate('flow.entity.action', {
                          collection: 'tags',
                          entityId: t.id,
                          action: 'archive',
                        })
                    }),
                  ),
                }),
              ),
          ),
        })
      case 'dashboard':
        return dashboard()
      case 'cmdk':
        return cmdk()
      case 'display':
        return display()
      case 'timezone':
        return timezone()
      default:
        throw new Error(`Missing product presenter: ${key}`)
    }
  }
  const sidebar = () =>
    FlowNavigation({
      name: 'Flow',
      company: data().workspaces
        ? `${data().company.name} · ${data().workspaces.find((w) => w.id === workspaceId())?.title ?? 'Workspace'}`
        : data().company.name,
      context: data().workspaces
        ? FlowContextPicker({
            companyId: companyId(),
            workspaceId: workspaceId(),
            companies: data().companies,
            workspaces: data().workspaces,
            disabled: busy(),
            onWorkspace: (id) => void switchContext(companyId(), id),
            onManage:
              data().members?.find((m) => m.id === data().user.id)?.role === 'guest'
                ? undefined
                : () => navigate('workspace-overview'),
          })
        : null,
      children: html`${FlowSearchTrigger({ onClick: () => navigate('cmdk') })}
      ${FlowNavGroup({ title: tr('flow.ui.personal'), children: stack(link('my-work', tr('flow.ui.my.tasks'), 'inbox'), link('inbox', tr('flow.ui.inbox'), 'inbox'), ...extensionLinks('personal')) })}
      ${
        data().members?.find((m) => m.id === data().user.id)?.role !== 'guest'
          ? FlowNavGroup({
              title: 'Workspace',
              children: stack(
                link('workspace-overview', tr('flow.ui.overview'), 'grid'),
                link('all-issues', tr('flow.ui.all.tasks'), 'list'),
                ...extensionLinks('workspace'),
                link('all-pages', tr('flow.ui.workspace.documents'), 'book', { projectFilter: 'workspace' }),
              ),
            })
          : null
      }
      ${FlowProjectDirectory({
        onCreate:
          canWrite() && (!data().workspaces || canManageScope(data(), 'workspace', workspaceId()))
            ? () => navigate('project-new')
            : undefined,
        projects: data()
          .projects.filter((p) => !data().workspaces || p.workspaceId === workspaceId())
          .map((p) => ({
            id: p.id,
            title: p.title,
            active: scopeOf(screen()) === 'project' && project() === p.id,
            href: href(p.defaultView ?? 'board', { project: p.id, workspace: p.workspaceId }),
            onOpen: (e) => {
              if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              navigate(p.defaultView ?? 'board', { project: p.id, workspace: p.workspaceId })
            },
          })),
      })}
      ${!data().workspaces ? link('workspace-settings', tr('flow.ui.workspace.settings'), 'settings') : null}`,

      footer: inline(
        FlowAvatar({ name: data().user.name }),
        FlowUserMenu({
          language: flowLocale(),
          languages: FLOW_LANGUAGES,
          onLanguage: changeLanguage,
          name: data().user.name,
          companyId: companyId(),
          companies: data().companies ?? [{ id: companyId(), name: data().company.name }],
          disabled: busy(),
          onCompany: (id) => void switchContext(id),
          items: [
            { label: tr('flow.ui.personal.settings'), onClick: () => navigate('personal-settings') },
            ...(data().members?.find((m) => m.id === data().user.id)?.role === 'guest'
              ? []
              : [
                  {
                    label: tr('flow.ui.organization.d9c0c0') + data().company.name,
                    onClick: () => navigate('organization'),
                    active: managementNavigation(screen())?.scope === 'company',
                  },
                ]),
          ],
        }),
        FlowButton({
          label: theme() === 'light' ? tr('flow.ui.switch.to.dark.mode') : tr('flow.ui.switch.to.light.mode'),
          icon: theme() === 'light' ? 'moon' : 'sun',
          iconOnly: true,
          variant: 'ghost',
          onClick: () => theme.set(theme() === 'light' ? 'dark' : 'light'),
        }),
      ),
    })
  const openListView = (id) => {
    const v = data().views.find((v) => v.id === id && (v.projectId ?? 'core') === project())
    navigate('project-issues', {
      q: v?.query ?? '',
      status: v?.status ?? 'all',
      ...(v ? { view: v.id } : {}),
    })
  }
  const projectViews = () =>
    FlowToolbar({
      children: FlowProjectViews({
        selectedView: selectedView(),
        views: data().views.filter((v) => !v.archived && (v.projectId ?? 'core') === project()),
        onView: openListView,
        onSave: openSavedView,
        canSave: canWrite(),
        value: pageRoutes.has(screen()) ? 'pages' : screen(),
        options: [
          { value: 'board', label: tr('flow.ui.board'), icon: 'board' },
          { value: 'project-issues', label: tr('flow.ui.list'), icon: 'list' },
          { value: 'calendar', label: tr('flow.ui.calendar'), icon: 'calendar' },
          ...(routes.gantt ? [{ value: 'gantt', label: tr('flow.ui.timeline'), icon: 'clock' }] : []),
          ...(usesSprints(selectedProject()) ? [{ value: 'sprints', label: 'Sprint', icon: 'reset' }] : []),
          { value: 'epics', label: 'Epic', icon: 'layers' },
          { value: 'pages', label: tr('flow.ui.documents'), icon: 'book' },
          ...(routes.atlas ? [{ value: 'atlas', label: 'Atlas', icon: 'layers' }] : []),
        ],
        onChange: (key) =>
          key === 'project-issues'
            ? openListView('')
            : navigate(key, { ...(key === 'pages' ? { scope: 'project' } : {}) }),
      }),
      trailing: FlowTag({ label: data().projects.find((p) => p.id === project())?.code ?? 'KV' }),
    })
  const managementViews = () => {
    const nav = managementNavigation(screen())
    if (!nav || data().members?.find((m) => m.id === data().user.id)?.role === 'guest') return null
    return FlowScopeTabs({
      label:
        nav.scope === 'company'
          ? tr('flow.ui.organization.management', [data().company.name])
          : tr('flow.ui.workspace.management', [
              data().workspaces?.find((w) => w.id === workspaceId())?.title ?? 'Workspace',
            ]),
      value: nav.active,
      options: nav.options.map((option) => ({ ...option, href: href(option.value) })),
      onChange: (key) => navigate(key),
    })
  }
  const isGuest = () => data().members?.find((m) => m.id === data().user.id)?.role === 'guest'
  const adminRoutes = new Set([
    'settings',
    'project-profile',
    'project-members',
    'project-move',
    'automations',
    'forms',
    'github',
  ])
  const denied = () =>
    FlowEmpty({
      title: tr('flow.ui.access.denied'),
      description: tr('flow.review.accessHelp'),
      action: navButton('my-work', tr('flow.ui.my.tasks'), 'arrow'),
    })
  const projectActions = () =>
    isGuest()
      ? null
      : !canWrite()
        ? inline(
            FlowButton({
              label: tr('flow.ui.project.tools.e0b7ca'),
              disabled: true,
              disabledReason: tr('flow.review.editRequired'),
            }),
            FlowButton({
              label: tr('flow.ui.project.setup'),
              disabled: true,
              disabledReason: tr('flow.review.editRequired'),
            }),
          )
        : inline(
            FlowScopeMenu({
              label: tr('flow.ui.project.tools.e0b7ca'),
              items: [
                ...(routes.automations
                  ? [{ label: tr('flow.ui.automations'), onClick: () => navigate('automations') }]
                  : []),
                { label: tr('flow.ui.intake.forms'), onClick: () => navigate('forms') },
                ...(routes.github
                  ? [{ label: tr('flow.ui.project.github'), onClick: () => navigate('github') }]
                  : []),
              ],
            }),
            navButton('settings', tr('flow.ui.project.setup'), 'settings'),
          )
  const operations = createOperations({
    screen,
    data,
    workspaceId,
    projectId: project,
    record,
    close: closeModal,
    canWrite,
    busy,
    mutate,
    navigate,
    filtered,
    filterbar,
    workspaceFilter,
    openSavedView,
    inboxFilter: (n) =>
      personalWorkspace() === 'all' ||
      data().projects.find((p) => p.id === data().tasks.find((t) => t.id === n.taskId)?.projectId)
        ?.workspaceId === personalWorkspace(),
    themeControl: () =>
      FlowSelectField({
        name: 'personal-theme',
        label: tr('flow.ui.appearance'),
        value: theme(),
        options: [
          { value: 'light', label: tr('flow.ui.light') },
          { value: 'dark', label: tr('flow.ui.dark') },
        ],
        onChange: (e) => theme.set(e.target.value),
      }),
  })
  // Extensions see the same narrow context the built-in feature modules get; core never names them.
  const extensionContext = {
    filtered,
    filterbar,
    table,
    openTask: taskOpen,
    root: () => host,
    theme,
    params: () =>
      typeof location === 'undefined' ? props : Object.fromEntries(new URL(location.href).searchParams),
    data,
    record,
    workspaceId,
    projectId: project,
    screen,
    canWrite,
    busy,
    mutate,
    call,
    navigate,
    close: closeModal,
    feedback,
    feedbackView: () => feedbackToast(),
  }
  const extensionOwners = flowExtensions().map((x) => ({
    extension: x,
    instance: x.create(extensionContext),
  }))
  const extensions = extensionOwners.map((x) => x.instance)
  const extensionFor = (key) =>
    extensionOwners.find((x) => x.extension.routes?.[key] || x.extension.forms?.[key])?.instance
  const extensionLinks = (group) =>
    extensions.flatMap((x) => x.navigation?.(group) ?? []).map((e) => link(e.key, e.label, e.icon))
  const extensionValue = (hook, ...args) => {
    for (const x of extensions) {
      const value = x[hook]?.(...args)
      if (value != null) return value
    }
    return null
  }
  const transitionFor = (task, columnId) => extensionValue('transition', task, columnId)
  const firstRun = createFirstRun({
    call,
    reload,
    data,
    demo: props.signInDemo,
    finish: (id) => switchContext(companyId(), id, true),
  })
  const organization = createOrganization({
    settingsSection: (key, entity) => extensions.map((x) => x.settingsSection?.(key, entity) ?? null),
    data,
    workspaceId,
    projectId: activeProject,
    record,
    canWrite,
    busy,
    mutate,
    call,
    navigate,
    close: closeModal,
    isModal: () => Boolean(modalRoute()),
    switchWorkspace: (id) => switchContext(companyId(), id, true),
    params: () =>
      typeof location === 'undefined' ? props : Object.fromEntries(new URL(location.href).searchParams),
  })
  const documents = createDocuments({
    sidebar,
    data,
    workspaceId,
    project: () => (scopeOf(screen()) === 'project' ? project() : null),
    projectViews,
    projectActions,
    managementViews,
    libraryFilter,
    librarySearch,
    libraryVisibility,
    updateLibrary: (patch) => {
      const url = new URL(location.href)
      for (const [name, value] of Object.entries(patch)) url.searchParams.set(name, value)
      history.replaceState(history.state, '', url)
      librarySearch.set(url.searchParams.get('docq') ?? '')
      libraryVisibility.set(url.searchParams.get('visibility') === 'private' ? 'private' : 'shared')
    },
    documentReturn,
    returnToLibrary: () => {
      const target = libraryReturn(documentReturn(), base)
      if (target) {
        history.pushState({}, '', target)
        readUrl()
      } else navigate('all-pages')
    },
    libraryURL: () =>
      typeof location === 'undefined' ? href('all-pages') : location.pathname + location.search,
    record: backgroundRecord,
    screen,
    canWrite,
    busy,
    mutate,
    navigate,
    root: () => host,
    routeTitle: () => routes[screen()].title,
    notices: () =>
      html`${!canWrite() ? FlowNotice({ title: tr('flow.ui.view.only'), message: tr('flow.ui.you.can.read.documents.but.cannot.edit.them'), tone: 'yellow' }) : null}`,
  })
  const formModal = () => {
    const key = modalRoute()
    if (!formModalRoutes.has(key)) return null
    if (key === 'cmdk') return cmdk()
    const body =
      isGuest() && (adminRoutes.has(key) || organizationForms[key])
        ? denied()
        : extensionForms[key]
          ? extensionFor(key)?.modal?.(key)
          : organizationForms[key]
            ? organization.modal(key)
            : formDefinitions[key]
              ? recordForm()
              : key === 'page-move'
                ? pageMove()
                : key === 'sprint-close'
                  ? sprintClose()
                  : key === 'display'
                    ? display()
                    : key === 'timezone'
                      ? timezone()
                      : cmdk()
    return FlowDialog({
      id: documentModalRoutes.has(key) ? 'flow-document-modal' : 'flow-form-modal',
      title: routes[key].title,
      size:
        extensionForms[key]?.size ?? (['project-new', 'project-profile'].includes(key) ? 'setup' : 'default'),
      onRequestClose: closeModal,
      body,
      feedback: feedbackToast(),
    })
  }
  const taskModal = () => {
    const key = modalRoute()
    if (!taskModalRoutes.has(key)) return null
    const creating = ['issue-new', 'subtask-new'].includes(key)
    /** Changing status, sprint, dependency, archive or comment is one short choice: it gets a form-width dialog, not the record layout. */
    const operation = !creating && !detailKeys.has(key)
    const body = creating ? composer.view() : operation ? taskOperation() : taskDetail()
    const state = creating ? null : autosave.state(record())
    const readOnly = FlowNotice({
      title: tr('flow.ui.view.only'),
      message: tr('flow.ui.you.cannot.edit.this.task'),
      tone: 'yellow',
    })
    if (operation)
      return FlowDialog({
        id: 'flow-task-modal',
        title: routes[key].title,
        onRequestClose: closeModal,
        body: canWrite() ? body : stack(readOnly, body),
        feedback: feedbackToast(),
      })
    return FlowDialog({
      id: 'flow-task-modal',
      size: 'task',
      headerActions: FlowRecordAsideTrigger(),
      title: key === 'issue' ? tr('flow.ui.task', [currentTask()?.id ?? record()]) : routes[key].title,
      onRequestClose: closeModal,
      body: !canWrite() ? html`${FlowSection({ children: readOnly })}${body}` : body,
      feedback: feedbackToast(),
      footer: creating
        ? actions(
            html`<span data-flow="muted">${tr('flow.ui.drafts.are.kept.in.this.session')}</span>`,
            inline(
              FlowButton({ label: tr('flow.ui.cancel'), onClick: closeModal }),
              FlowButton({
                label: tr('flow.ui.create.task'),
                variant: 'primary',
                loading: busy(),
                disabled: !canWrite(),
                onClick: () => host?.querySelector('#flow-task-create')?.requestSubmit(),
              }),
            ),
          )
        : inline(
            FlowTag({
              label: !canWrite()
                ? tr('flow.ui.view.only')
                : state === 'error'
                  ? tr('flow.ui.not.saved.try.again')
                  : state === 'saving' || state === 'pending'
                    ? tr('flow.ui.autosaving')
                    : tr('flow.ui.saved'),
              tone: state === 'error' ? 'red' : 'neutral',
            }),
            html`<span data-flow="muted">${tr('flow.ui.property.changes.are.saved.automatically')}</span>`,
            state === 'error' && !failure()
              ? FlowButton({ label: tr('flow.ui.retry.save'), onClick: retryTaskSave })
              : null,
          ),
    })
  }
  const feedbackToast = () => {
    const problem = failure()
    if (problem && data()) {
      const expired = problem.code === 'fixtureSession'
      saveRevision()
      const retryAutosave = data().tasks.some((t) => autosave.state(t.id) === 'error')
      const title =
        {
          blocked: tr('flow.ui.task.is.blocked'),
          conflict: tr('flow.ui.new.version.available'),
          validation: tr('flow.ui.check.details'),
          cycle: tr('flow.ui.cannot.create.a.cycle'),
          fixtureSession: tr('flow.ui.session.expired'),
        }[problem.code] ?? tr('flow.ui.action.could.not.be.completed')
      const action = expired
        ? FlowButton({ label: tr('flow.ui.reload.page'), size: 'sm', onClick: () => location.reload() })
        : retryAutosave
          ? FlowButton({
              label: tr('flow.ui.retry.save'),
              size: 'sm',
              disabled: busy(),
              onClick: retryTaskSave,
            })
          : problem.code === 'conflict'
            ? FlowButton({
                label: tr('flow.ui.load.new.version'),
                size: 'sm',
                disabled: busy(),
                onClick: reload,
              })
            : null
      return FlowToast({
        tone: 'error',
        title,
        message: problem.message,
        action,
        onClose: () => {
          failure.set(null)
          feedback.clear()
        },
      })
    }
    if (notice())
      return FlowToast({
        message: notice().message ?? notice(),
        action: notice().target
          ? FlowButton({
              label: tr('flow.ui.open'),
              size: 'sm',
              onClick: () => navigate(notice().target.route, notice().target.params),
            })
          : null,
        onClose: feedback.clear,
        onPause: feedback.pause,
        onResume: feedback.resume,
      })
    if (data()?.notice && dismissedDataNotice() !== data().notice)
      return FlowToast({
        tone: 'warning',
        title: tr('flow.ui.incomplete.results'),
        message: data().notice,
        onClose: () => dismissedDataNotice.set(data().notice),
      })
    return null
  }
  const changeLanguage = (value) => {
    setFlowLocale(value)
    try {
      localStorage.setItem('flow.language', flowLocale())
    } catch {}
    if (typeof document !== 'undefined') document.documentElement.lang = flowLocale()
    if (typeof location !== 'undefined') {
      const url = new URL(location.href)
      url.searchParams.set('lang', flowLocale())
      history.replaceState(history.state, '', url)
    }
  }
  const view = () =>
    html`<div data-flow-ui lang=${flowLocale()} data-theme=${theme()} data-density=${density()}>
      ${firstRun.page(failure()) ?? (loading() && !data() ? FlowLoading({ label: tr('flow.ui.opening.flow') }) : !data() ? FlowEmpty({ title: failure()?.code === 'forbidden' ? tr('flow.ui.access.denied') : tr('flow.ui.unable.to.open.flow'), description: (failure()?.message ?? tr('flow.ui.try.again.to.continue')) + ' · ' + tr('flow.review.accessHelp'), action: FlowButton({ label: tr('flow.ui.try.again'), onClick: reload }) }) : documentRoutes.has(screen()) ? documents.view() : FlowShell({ title: screen() === 'issue' ? tr('flow.ui.task', [currentTask()?.id ?? '']) : (routes[screen()]?.title ?? 'Flow'), breadcrumb: scopeOf(screen()) === 'project' ? `${data().workspaces?.find((w) => w.id === workspaceId())?.title ?? data().company.name} · ${selectedProject()?.title ?? ''}` : scopeOf(screen()) === 'personal' || (organizationRoutes[screen()] ?? extensionRoutes[screen()])?.group === tr('flow.ui.organization') || ['team', 'teams', 'permissions', 'workspaces'].includes(screen()) ? data().company.name : (data().workspaces?.find((w) => w.id === workspaceId())?.title ?? data().company.name), sidebar: sidebar(), search: hasTaskSearch() ? taskSearch() : organizationRoutes[screen()] ? organization.topSearch(screen()) : null, actions: inline(scopeOf(screen()) === 'project' && selectedProject() ? projectActions() : null, extensionRoutes[screen()] ? extensionFor(screen())?.topAction?.(screen()) : organizationRoutes[screen()] ? organization.topAction(screen()) : extensionRoutes[screen()] || ['automations', 'forms', 'saved-views', 'personal-settings', 'workspace-settings', 'workspace-integrations', 'settings', 'github', 'tags'].includes(screen()) ? null : FlowButton({ label: tr('flow.ui.create.task'), icon: 'plus', variant: 'primary', size: 'sm', disabled: !canWrite(), onClick: () => navigate('issue-new') })), contentWidth: contentWidthFor(screen(), routes[screen()]), navigation: scopeOf(screen()) === 'project' && selectedProject() ? projectViews() : managementViews(), children: html`${!canWrite() ? FlowNotice({ title: tr('flow.ui.view.only'), message: tr('flow.ui.you.can.view.content.but.cannot.change.data'), tone: 'yellow' }) : null}${content()}`, footer: html`<span>${data().company.name}</span><span>${routes[screen()]?.footer === false ? '' : tr('flow.ui.september.2026.tasks', [data().tasks.length])}</span>` }))}
      ${data() ? taskModal() : null}${data() && modalRoute() ? filePreview() : null}${data() ? formModal() : null}${data() ? savedViewDialog() : null}
      ${!modalRoute() && !savedViewOpen() && !extensions.some((x) => x.ownsFeedback?.()) ? feedbackToast() : null}
    </div>`
  return {
    view,
    mount(context) {
      if (typeof location !== 'undefined') {
        let saved
        try {
          saved = localStorage.getItem('flow.language')
        } catch {}
        setFlowLocale(new URL(location.href).searchParams.get('lang') ?? saved ?? 'en')
        if (typeof document !== 'undefined') document.documentElement.lang = flowLocale()
      }
      host = context.root
      lifetime = context.lifetime
      if (typeof location !== 'undefined') readUrl()
      runtime = attachFlowUI(host)
      observer = new MutationObserver(() => {
        runtime.sync()
        for (const x of extensions) void x.afterRender?.()
      })
      observer.observe(host, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['value', 'checked', 'data-flow-value', 'data-focus-key', 'aria-selected'],
      })
      window.addEventListener('popstate', readUrl, { signal: lifetime })
      if (typeof location !== 'undefined') {
        const params = new URL(location.href).searchParams
        savedViewOpen.set(params.get('modal') === 'save-view')
        selectedView.set(params.get('view') ?? '')
      }
      window.addEventListener(
        'keydown',
        (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault()
            if (e.repeat) return
            if (modalRoute() === 'cmdk') closeModal()
            else navigate('cmdk')
          }
          if (e.key === 'Escape') {
            selected.set([])
            if (screen() === 'cmdk') navigate('my-work')
          }
        },
        { signal: lifetime },
      )
      // Mobile menu starts collapsed once shell mounts; desktop remains expanded.
      let collapsed = false
      const mobileObserver = new MutationObserver(() => {
        if (!collapsed && matchMedia('(max-width:760px)').matches) {
          const menu = host.querySelector('[data-flow="mobile-nav"]')
          if (menu) {
            menu.open = false
            const tree = host.querySelector('[data-flow="docs-tree-disclosure"]')
            if (tree) tree.open = false
            collapsed = true
            mobileObserver.disconnect()
          }
        }
      })
      mobileObserver.observe(host, { childList: true, subtree: true })
      lifetime.addEventListener('abort', () => mobileObserver.disconnect(), { once: true })
      mounted = true
      reload()
    },
    dispose() {
      feedback.dispose()
      for (const x of extensions) x.dispose?.()
      autosave.dispose()
      readController?.abort()
      observer?.disconnect()
      runtime?.dispose()
    },
  }
}
