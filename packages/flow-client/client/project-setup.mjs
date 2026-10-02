import { tr, flowLocaleTag } from './i18n.mjs'
import { html, each, signal } from '@ketvietlab/ketjs-view'
import { FlowInput, FlowButton, FlowTag } from '@ketvietlab/flow-ui'
import {
  FlowDisclosure,
  FlowHint,
  FlowTagPicker,
  FlowSetupForm,
  FlowFormGrid,
  FlowSection,
  FlowStack,
  FlowInline,
  FlowNotice,
  FlowProperties,
  FlowTextarea,
  FlowSelectField,
  FlowCheckboxField,
} from '@ketvietlab/flow-ui/workspace'
import { setupCatalog } from './setup-catalog.mjs'
import { projectStatuses, projectTags, taskColumns, taskTags, validateCatalog } from './project-catalogs.mjs'
import { canManageScope, accessFor } from './access-model.mjs'
import { SPRINT_WEEKS, DEFAULT_CADENCE, sprintCadence, nextSprint, activeSprint } from './sprint-cadence.mjs'
import { todayDate } from './timeline.mjs'

const weekdays = [1, 2, 3, 4, 5, 6, 0]
// 4 January 2026 is a Sunday, so day n of that week is weekday n.
const weekdayName = (n) =>
  new Intl.DateTimeFormat(flowLocaleTag(), { weekday: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2026, 0, 4 + n),
  )

export const projectStates = [
  {
    value: 'planned',
    get label() {
      return tr('flow.ui.planned')
    },
  },
  {
    value: 'active',
    get label() {
      return tr('flow.ui.in.progress')
    },
  },
  {
    value: 'paused',
    get label() {
      return tr('flow.ui.paused')
    },
  },
  {
    value: 'completed',
    get label() {
      return tr('flow.ui.done')
    },
  },
]
export function workspaceInheritance(data, workspaceId) {
  const workspace = data.workspaces?.find((w) => w.id === workspaceId)
  if (!workspace) return []
  const roles = {
    member: tr('flow.ui.edit'),
    editor: tr('flow.ui.edit'),
    viewer: tr('flow.ui.view.only'),
    admin: tr('flow.ui.admin'),
    owner: tr('flow.ui.admin'),
  }
  const rows =
    workspace.access === 'internal'
      ? [{ label: tr('flow.ui.internal.organization.members'), value: tr('flow.ui.edit.excludes.guests') }]
      : []
  for (const grant of data.grants ?? []) {
    if (grant.scope !== 'workspace' || grant.targetId !== workspaceId) continue
    const team = grant.subjectType === 'team'
    const subject = (team ? data.teams : data.members)?.find((x) => x.id === grant.subjectId)
    if (!subject || subject.status === 'revoked' || subject.role === 'guest') continue
    rows.push({
      label: team ? `Team · ${subject.title}` : subject.name,
      value: `${roles[grant.role] ?? grant.role}${team ? tr('flow.ui.members', [subject.memberIds.filter((id) => data.members?.some((m) => m.id === id && m.status === 'active' && m.role !== 'guest')).length]) : ''}`,
    })
  }
  return rows
}
export function createProjectSetup(ctx) {
  let draft = null
  const revision = signal(0),
    catalogError = signal(''),
    editingCatalog = signal('')
  return {
    reset() {
      draft = null
      catalogError.set('')
      editingCatalog.set('')
    },
    view() {
      revision()
      const data = ctx.data(),
        editing = ctx.route() === 'project-profile',
        project = editing ? data.projects.find((p) => p.id === ctx.project()) : null
      const allowed =
        data.workspaces?.filter(
          (w) => !w.archived && (w.id === project?.workspaceId || canManageScope(data, 'workspace', w.id)),
        ) ?? []
      if (!draft)
        draft = {
          title: project?.title ?? '',
          code: project?.code ?? '',
          description: project?.description ?? '',
          workspaceId:
            project?.workspaceId ??
            (allowed.some((w) => w.id === ctx.workspace()) ? ctx.workspace() : (allowed[0]?.id ?? '')),
          access: project?.access ?? 'workspace',
          ownerId: project?.ownerId ?? data.user.id,
          start: project?.start ?? '',
          end: project?.end ?? '',
          outcome: project?.outcome ?? '',
          defaultView: project?.defaultView ?? 'board',
          state: project?.state ?? 'planned',
          tags: project?.tags ?? [],
          memberIds: [],
          teamIds: [],
          projectStatuses: project?.projectStatuses ? structuredClone(project.projectStatuses) : null,
          projectLabels: project?.projectLabelIds ? structuredClone(projectTags(data, project)) : null,
          taskStatuses: project?.taskStatusIds
            ? taskColumns(data, project.id).map((c) => ({
                id: c.id,
                title: c.label,
                color: c.color ?? 'neutral',
                kind: c.kind,
              }))
            : null,
          taskLabels: project?.taskLabelIds ? structuredClone(taskTags(data, project.id)) : null,
          sprintCadence: ((c) => c && { ...c })(project ? sprintCadence(project) : DEFAULT_CADENCE),
        }
      const d = draft,
        disabled = !ctx.canWrite() || ctx.busy()
      const input = (id, label, extra = {}) =>
        FlowInput({
          id,
          label,
          value: d[id],
          disabled,
          error: ctx.errors()[id],
          onInput: (e) => {
            d[id] = e.target.value
          },
          ...extra,
        })
      const select = (name, label, options, extra = {}) =>
        FlowSelectField({
          name,
          label,
          value: d[name],
          options,
          disabled,
          onChange: (e) => {
            d[name] = e.target.value
            revision.set(revision() + 1)
          },
          ...extra,
        })
      const area = (id, label, placeholder) =>
        FlowTextarea({
          id,
          label,
          value: d[id],
          placeholder,
          disabled,
          onInput: (e) => {
            d[id] = e.target.value
          },
        })
      const fragment = (children) =>
        html`${each(
          children,
          (_, i) => i,
          (x) => html`${x}`,
        )}`
      const stack = (...children) => FlowStack({ children: fragment(children) })
      const section = (title, ...children) =>
        [
          tr('flow.ui.ownership.planning'),
          tr('flow.ui.invite.collaborators'),
          tr('flow.ui.current.task.configuration'),
        ].includes(title)
          ? FlowDisclosure({ title, open: editing, children: stack(...children) })
          : FlowSection({ inset: 'none', title, children: stack(...children) })
      const pair = (...children) => FlowFormGrid({ children: fragment(children) })
      const w = data.workspaces?.find((w) => w.id === d.workspaceId),
        inherited = workspaceInheritance(data, d.workspaceId)
      const accessCount = editing
        ? data.members.filter((m) => accessFor(data, project, m.id).role).length
        : new Set([
            data.user.id,
            d.ownerId,
            ...d.memberIds,
            ...data.teams.filter((t) => d.teamIds.includes(t.id)).flatMap((t) => t.memberIds),
            ...(d.access === 'workspace'
              ? data.members
                  .filter(
                    (m) =>
                      accessFor(
                        data,
                        {
                          id: 'new-project',
                          companyId: data.company.id,
                          workspaceId: d.workspaceId,
                          access: 'workspace',
                        },
                        m.id,
                      ).role,
                  )
                  .map((m) => m.id)
              : []),
          ]).size
      const catalogBase = (key) =>
        key === 'projectStatuses'
          ? projectStatuses(project)
          : key === 'taskStatuses'
            ? taskColumns(data, project?.id).map((c) => ({
                id: c.id,
                title: c.label,
                color:
                  c.color ?? { todo: 'neutral', progress: 'blue', review: 'yellow', done: 'green' }[c.kind],
                kind: c.kind,
              }))
            : key === 'projectLabels'
              ? projectTags(data, project)
              : taskTags(data, project?.id)
      const configure = (key) => {
        if (!d[key]) {
          const source = catalogBase(key)
          d[key] = source.map((x) => ({
            ...x,
            id: key === 'projectStatuses' ? x.id : 'custom-' + crypto.randomUUID(),
            sourceId: x.id,
            color: x.color ?? 'blue',
          }))
          if (key === 'projectLabels')
            d.tags = d.tags.map((id) => d[key].find((x) => x.sourceId === id)?.id ?? id)
        }
        editingCatalog.set(editingCatalog() === key ? '' : key)
        revision.set(revision() + 1)
      }
      const names = {
        projectStatuses: tr('flow.ui.project.statuses'),
        projectLabels: tr('flow.ui.project.labels'),
        taskStatuses: tr('flow.ui.task.statuses'),
        taskLabels: tr('flow.ui.task.labels'),
      }
      const catalog = (key) =>
        stack(
          FlowInline({
            children: html`${FlowButton({ label: editingCatalog() === key ? 'Xong' : tr('flow.ui.customize') + names[key], size: 'sm', disabled, onClick: () => (editingCatalog() === key ? editingCatalog.set('') : configure(key)) })}${
              d[key] && !editing
                ? FlowButton({
                    label: tr('flow.ui.use.defaults'),
                    size: 'sm',
                    variant: 'ghost',
                    disabled,
                    onClick: () => {
                      if (key === 'projectLabels') d.tags = []
                      if (key === 'projectStatuses') d.state = 'planned'
                      d[key] = null
                      editingCatalog.set('')
                      revision.set(revision() + 1)
                    },
                  })
                : null
            }`,
          }),
          editingCatalog() === key
            ? setupCatalog({
                id: key,
                items: d[key].map((x) => ({
                  ...x,
                  locked:
                    key === 'projectStatuses'
                      ? x.id === d.state
                      : editing && key === 'taskStatuses'
                        ? data.tasks.some(
                            (t) =>
                              t.projectId === project.id && (t.status === x.id || t.status === x.sourceId),
                          )
                        : false,
                  lockedKind:
                    editing &&
                    key === 'taskStatuses' &&
                    data.tasks.some(
                      (t) => t.projectId === project.id && (t.status === x.id || t.status === x.sourceId),
                    ),
                })),
                status: key.endsWith('Statuses'),
                disabled,
                onChange: (items) => {
                  d[key] = items.map(({ locked, lockedKind, ...item }) => item)
                  if (key === 'projectLabels') d.tags = d.tags.filter((id) => items.some((x) => x.id === id))
                  catalogError.set('')
                  revision.set(revision() + 1)
                },
              })
            : null,
        )
      const cadence = d.sprintCadence,
        running = editing ? activeSprint(data, project.id) : null,
        upcoming = cadence
          ? nextSprint(data, { id: project?.id ?? '', sprintCadence: cadence }, todayDate(data.timezone))
          : null
      const setCadence = (value) => {
        d.sprintCadence = value
        revision.set(revision() + 1)
      }
      const sprints = () =>
        section(
          tr('flow.cadence.title'),
          FlowCheckboxField({
            label: tr('flow.cadence.enable'),
            checked: Boolean(cadence),
            disabled: disabled || Boolean(running && cadence),
            onChange: (e) => setCadence(e.target.checked ? { ...DEFAULT_CADENCE } : null),
          }),
          cadence
            ? pair(
                FlowSelectField({
                  name: 'sprint-weeks',
                  label: tr('flow.cadence.weeks'),
                  value: String(cadence.weeks),
                  disabled,
                  options: SPRINT_WEEKS.map((n) => ({
                    value: String(n),
                    label: n === 1 ? tr('flow.cadence.oneWeek') : tr('flow.cadence.manyWeeks', [n]),
                  })),
                  onChange: (e) => setCadence({ ...cadence, weeks: Number(e.target.value) }),
                }),
                FlowSelectField({
                  name: 'sprint-weekday',
                  label: tr('flow.cadence.weekday'),
                  value: String(cadence.weekday),
                  disabled,
                  options: weekdays.map((n) => ({ value: String(n), label: weekdayName(n) })),
                  onChange: (e) => setCadence({ ...cadence, weekday: Number(e.target.value) }),
                }),
              )
            : null,
          running && cadence ? FlowHint({ children: tr('flow.cadence.running', [running.title]) }) : null,
          FlowHint({
            tone: ctx.errors().sprintCadence ? 'red' : undefined,
            children:
              ctx.errors().sprintCadence ??
              (upcoming
                ? tr('flow.cadence.next', [upcoming.title, upcoming.start, upcoming.end])
                : tr('flow.cadence.kanban')),
          }),
        )
      const choices = (key, items) =>
        stack(
          ...items.map((m) =>
            FlowCheckboxField({
              label: m.title ?? m.name,
              checked: d[key].includes(m.id),
              disabled,
              onChange: (e) => {
                d[key] = e.target.checked ? [...d[key], m.id] : d[key].filter((id) => id !== m.id)
                revision.set(revision() + 1)
              },
            }),
          ),
        )
      return FlowSetupForm({
        onSubmit: (e) => {
          e.preventDefault()
          if (disabled) return
          for (const key of Object.keys(names)) {
            if (d[key]) {
              const error = validateCatalog(d[key], {
                statuses: key.endsWith('Statuses'),
                requireGroups: key === 'taskStatuses',
              })
              if (error) {
                editingCatalog.set(key)
                catalogError.set(names[key] + ': ' + error)
                return
              }
            }
          }
          catalogError.set('')
          ctx.save(
            {
              ...d,
              collection: 'projects',
              ...(editing ? { entityId: project.id, projectId: project.id } : {}),
            },
            editing,
          )
        },
        actions: html`${FlowHint({ children: tr('flow.ui.people.with.initial.access', [accessCount]) })}${FlowButton({ label: tr('flow.ui.cancel'), onClick: ctx.close })}${FlowButton({ label: editing ? tr('flow.ui.save.profile') : tr('flow.ui.create.project'), type: 'submit', variant: 'primary', disabled: disabled || !w, loading: ctx.busy() })}`,
        children: html`
        ${section(
          tr('flow.ui.project.information'),
          pair(
            input('title', tr('flow.ui.project.name'), {
              required: true,
              placeholder: tr('flow.ui.e.g.customer.website'),
            }),
            input('code', tr('flow.ui.project.code'), { required: true, placeholder: tr('flow.ui.e.g.web') }),
          ),
          select(
            'workspaceId',
            'Workspace',
            allowed.map((w) => ({ value: w.id, label: w.title })),
            { disabled: disabled || editing },
          ),
          area('description', tr('flow.ui.description'), tr('flow.ui.context.and.scope.of.work')),
          select(
            'ownerId',
            tr('flow.ui.project.owner'),
            data.members
              .filter((m) => m.status === 'active' && m.role !== 'guest')
              .map((m) => ({ value: m.id, label: m.name })),
          ),
          stack(
            stack(
              select(
                'state',
                tr('flow.ui.project.status'),
                (d.projectStatuses ?? projectStatuses(project)).map((x) => ({ value: x.id, label: x.title })),
              ),
              catalog('projectStatuses'),
            ),
            stack(
              FlowTagPicker({
                id: 'project-tags',
                label: tr('flow.ui.project.labels.2f3739'),
                value: d.tags,
                options: d.projectLabels ?? projectTags(data, project),
                disabled,
                onChange: (ids) => {
                  d.tags = ids
                  revision.set(revision() + 1)
                },
              }),
              catalog('projectLabels'),
            ),
          ),
        )}
        ${sprints()}
        ${section(
          tr('flow.ui.ownership.planning'),
          pair(
            select('defaultView', tr('flow.ui.default.project.view'), [
              { value: 'board', label: tr('flow.ui.task.board') },
              { value: 'project-issues', label: tr('flow.ui.task.list') },
            ]),
          ),
          pair(
            input('start', tr('flow.ui.start.date'), { type: 'date' }),
            input('end', tr('flow.ui.target.date'), { type: 'date' }),
          ),
          area('outcome', tr('flow.ui.expected.outcome'), tr('flow.ui.deliverables.and.completion.criteria')),
        )}
        ${section(
          tr('flow.ui.access.1747ab'),
          select(
            'access',
            tr('flow.ui.who.can.access'),
            [
              { value: 'workspace', label: tr('flow.ui.inherit.workspace') },
              { value: 'private', label: tr('flow.ui.restricted.members') },
            ],
            { disabled: disabled || editing },
          ),
          d.access === 'workspace'
            ? FlowNotice({
                title: tr('flow.ui.inherited.from', [w?.title ?? 'Workspace']),
                children: stack(
                  w?.access === 'internal'
                    ? tr('flow.ui.internal.workspace.organization.members.can.edit.the.project')
                    : tr(
                        'flow.ui.restricted.workspace.only.the.people.and.teams.granted.access.below.can.enter',
                      ),
                  inherited.length
                    ? FlowProperties({ items: inherited })
                    : tr('flow.ui.no.members.or.teams.have.been.granted.access.to.this.workspace'),
                  tr('flow.ui.workspace.permission.changes.apply.to.this.project'),
                ),
              })
            : FlowNotice({
                title: tr('flow.ui.private.project'),
                message: tr(
                  'flow.ui.workspace.access.is.not.inherited.only.the.creator.owner.and.directly.granted.pe',
                ),
              }),
          editing
            ? FlowNotice({
                title: tr('flow.ui.change.access.scope'),
                message: tr(
                  'flow.ui.changing.the.owner.grants.admin.access.to.the.new.owner.the.old.owner.s.access.r',
                ),
              })
            : section(
                tr('flow.ui.invite.collaborators'),
                FlowNotice({
                  title: tr('flow.ui.direct.access'),
                  message: tr(
                    'flow.ui.you.and.the.owner.have.admin.access.selected.members.and.teams.can.edit.guests.c',
                  ),
                }),
                pair(
                  section(
                    tr('flow.ui.member'),
                    choices(
                      'memberIds',
                      data.members.filter(
                        (m) =>
                          m.status === 'active' &&
                          m.role !== 'guest' &&
                          m.id !== data.user.id &&
                          m.id !== d.ownerId,
                      ),
                    ),
                  ),
                  section('Team', choices('teamIds', data.teams ?? [])),
                ),
              ),
        )}
        ${section(tr('flow.ui.project.tasks'), FlowHint({ children: tr('flow.ui.uses.the.organization.library.by.default.customization.creates.a.project.specifi') }), FlowSection({ inset: 'none', title: tr('flow.ui.task.statuses.d92c22'), children: stack(editingCatalog() === 'taskStatuses' ? null : FlowInline({ children: fragment((d.taskStatuses ?? catalogBase('taskStatuses')).map((c) => FlowTag({ label: c.title, tone: c.color ?? 'neutral' }))) }), catalog('taskStatuses')) }), FlowSection({ inset: 'none', title: tr('flow.ui.task.labels.4c65bb'), children: stack(editingCatalog() === 'taskLabels' ? null : FlowInline({ children: fragment((d.taskLabels ?? catalogBase('taskLabels')).filter((t) => !t.archived).map((t) => FlowTag({ label: t.title, tone: t.color ?? 'neutral' }))) }), catalog('taskLabels')) }), FlowHint({ children: tr('flow.ui.task.types') + (data.types ?? []).map((t) => t.title).join(' · ') + tr('flow.ui.timezone') + data.timezone }))}
        ${catalogError() ? FlowHint({ tone: 'red', children: catalogError() }) : null}
      `,
      })
    },
  }
}
