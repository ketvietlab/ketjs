import type { MenuNode, Translator } from '@ketvietlab/ketjs'
import type { IslandProps, IslandView, JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  KanbanCard,
  KanbanGrid,
  linkButton,
  NavGroup,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame, TableGroup } from '../../ui/index.ts'

type AnyRow = Record<string, unknown>
const empty = (_: Translator) => emptyState(_('flow_backend.empty.title'), _('flow_backend.empty.hint'))

const priorityLabel = (_: Translator, value: unknown): string => {
  const key = `flow.priority.${String(value ?? 'normal')}`
  return _.resolves(key) ? _(key) : String(value ?? '—')
}
const priorityBadge = (_: Translator, value: unknown): TemplateResult => {
  const raw = String(value ?? 'normal')
  return badge(
    priorityLabel(_, value),
    raw === 'urgent' ? 'danger' : raw === 'high' ? 'warning' : 'neutral',
    raw,
  )
}
const sprintStateBadge = (_: Translator, value: unknown): TemplateResult => {
  const raw = String(value ?? 'planned')
  const key = `flow.sprint.${raw}`
  return badge(
    _.resolves(key) ? _(key) : raw,
    raw === 'active' ? 'positive' : raw === 'closed' ? 'neutral' : 'warning',
    raw,
  )
}
const when = (value: unknown): string => {
  const raw = String(value ?? '')
  if (!raw) return '—'
  return raw.length > 10 ? raw.slice(0, 16).replace('T', ' ') : raw
}

/** Column-template presets offered when creating a project — see routes.ts's COLUMN_TEMPLATES. */
export const TEMPLATE_OPTIONS = (_: Translator) => [
  { value: 'simple', label: _('flow_backend.template.simple') },
  { value: 'kanban', label: _('flow_backend.template.kanban') },
  { value: 'scrum', label: _('flow_backend.template.scrum') },
  { value: 'custom', label: _('flow_backend.template.custom') },
]

/**
 * The sidebar's project group, filled into `backend:nav.items`.
 *
 * Flow's screens are scoped to a project, and `MenuDef.path` is a fixed
 * string — "the board of the project I am looking at" is not a path the menu
 * tree can hold. The joint exists for exactly that: the shell hands over the
 * active path, and a module that can read a record out of it contributes the
 * rows the tree could not.
 *
 * An island is handed props and nothing else — no context, no translator — so
 * the wording lives here, keyed by the `lang` the shell passes, the same way
 * mail_backend's inbox indicator handles the one other shell joint anyone
 * fills. The group is labelled with a word rather than the project's name:
 * the name needs a query, the island cannot make one, and the screen it
 * belongs to already carries it as a heading.
 */
const PROJECT_NAV = {
  vi: {
    group: 'Dự án',
    board: 'Bảng',
    issues: 'Danh sách',
    epics: 'Epic',
    sprints: 'Sprint',
    settings: 'Cài đặt',
  },
  en: {
    group: 'Project',
    board: 'Board',
    issues: 'Backlog',
    epics: 'Epics',
    sprints: 'Sprints',
    settings: 'Settings',
  },
} as const

/** `/admin/flow/projects/{id}/{screen}` — the only shape this group answers to. */
const PROJECT_PATH = /^\/admin\/flow\/projects\/([^/?#]+)\/([^/?#]+)/

export const projectNav = (props: IslandProps): IslandView => {
  const active = String(props.active ?? '')
  const english = String(props.lang ?? '')
    .toLowerCase()
    .startsWith('en')
  const words = PROJECT_NAV[english ? 'en' : 'vi']
  const found = PROJECT_PATH.exec(active)
  if (!found) return () => <></>
  const projectId = found[1] as string
  const screen = found[2] as string
  // Each path is written out rather than assembled from the segment, so the
  // repo's route invariant can still read it as a literal and check that a
  // screen actually serves it (test/backend-ui.test.ts).
  const at = (id: string, label: string, path: string): MenuNode => ({
    id: `flow.project.${id}`,
    label,
    path,
    icon: null,
    // The epic map sits under the epics screen, so the group still marks the
    // row the reader came in through rather than nothing at all.
    active: screen === id,
    children: [],
  })
  return () => (
    <NavGroup
      label={words.group}
      items={[
        at('board', words.board, `/admin/flow/projects/${projectId}/board`),
        at('issues', words.issues, `/admin/flow/projects/${projectId}/issues`),
        at('epics', words.epics, `/admin/flow/projects/${projectId}/epics`),
        at('sprints', words.sprints, `/admin/flow/projects/${projectId}/sprints`),
        at('settings', words.settings, `/admin/flow/projects/${projectId}/settings`),
      ]}
    />
  )
}

export const projectsScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('flow_backend.projects.title')}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action="/admin/flow/projects"
            fields={fields}
            errors={errors}
            submit={_('flow_backend.action.create')}
            submitVariant="primary"
          />
        }
      />,
      rows.length
        ? dataTable(_, {
            rows,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'key',
                label: _('flow_backend.field.key'),
                kind: 'identifier',
                cell: (row) => String(row.key),
              },
              {
                key: 'name',
                label: _('flow_backend.field.name'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    href: `/admin/flow/projects/${String(row.id)}/board`,
                    label: String(row.name),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
              {
                key: 'settings',
                label: '',
                align: 'end',
                cell: (row) =>
                  linkButton({
                    href: `/admin/flow/projects/${String(row.id)}/settings`,
                    label: _('flow_backend.action.settings'),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
            ],
          })
        : empty(_),
    ])}
  />
)

export const boardScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  board: JSXChild,
): TemplateResult => (
  <Framed
    translator={_}
    title={projectName}
    frame={frame}
    body={<Section title={projectName} body={board} />}
  />
)

export const mapScreen = (_: Translator, frame: Frame, epicTitle: string, map: JSXChild): TemplateResult => (
  <Framed translator={_} title={epicTitle} frame={frame} body={<Section title={epicTitle} body={map} />} />
)

export const issuesScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  endpoint: string,
  createFields: FormField[],
  rows: AnyRow[],
  groups: TableGroup<AnyRow>[] = [],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={projectName}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action={endpoint}
            fields={createFields}
            errors={errors}
            submit={_('flow_backend.action.create')}
            submitVariant="primary"
            layout="inline"
          />
        }
      />,
      rows.length || groups.length
        ? dataTable(_, {
            rows,
            groups,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'title',
                label: _('flow_backend.field.title'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    href: `/admin/flow/issues/${String(row.id)}`,
                    label: String(row.title),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
              {
                key: 'column',
                label: _('flow_backend.field.column'),
                cell: (row) => String(row.columnName ?? '—'),
              },
              {
                key: 'assignee',
                label: _('flow_backend.field.assignee'),
                cell: (row) => String(row.assigneeName ?? '—'),
              },
              {
                key: 'priority',
                label: _('flow_backend.field.priority'),
                cell: (row) => priorityBadge(_, row.priority),
              },
              {
                key: 'dueDate',
                label: _('flow_backend.field.dueDate'),
                kind: 'date',
                cell: (row) => when(row.dueDate),
              },
            ],
          })
        : empty(_),
    ])}
  />
)

export type IssueDetailControls = {
  assignee?: JSXChild
  epic?: JSXChild
  sprint?: JSXChild
  tags?: JSXChild
  dependencyTarget?: JSXChild
}

export const issueDetailScreen = (
  _: Translator,
  frame: Frame,
  row: AnyRow,
  options: {
    fields: FormField[]
    columns: AnyRow[]
    sprints: AnyRow[]
    controls?: IssueDetailControls
    editor: JSXChild
    /**
     * Which action failed, and why. This screen carries six forms; naming the
     * action is what puts a rejected dependency under the dependency form
     * instead of at the top of the save form three sections above it.
     */
    errors?: { action: string; messages: string[] }
  },
): TemplateResult => {
  const tags = (row.tags as AnyRow[] | undefined) ?? []
  const dependencies = (row.dependencies as AnyRow[] | undefined) ?? []
  const dependents = (row.dependents as AnyRow[] | undefined) ?? []
  const comments = (row.comments as AnyRow[] | undefined) ?? []
  const controls = options.controls ?? {}
  const endpoint = `/admin/flow/issues/${String(row.id)}`
  const errorsFor = (action: string): string[] | undefined =>
    options.errors?.action === action ? options.errors.messages : undefined

  return (
    <Framed
      translator={_}
      title={String(row.title)}
      frame={frame}
      body={stack([
        <Surface
          body={
            <RecordForm
              action={endpoint}
              hidden={{ action: 'save', expectedVersion: String(row.version ?? 0) }}
              fields={options.fields}
              errors={errorsFor('save')}
              submit={_('flow_backend.action.save')}
              submitVariant="primary"
            />
          }
        />,
        <Section
          title={_('flow_backend.action.move')}
          body={
            <RecordForm
              action={endpoint}
              hidden={{ action: 'move', expectedVersion: String(row.version ?? 0) }}
              fields={[
                {
                  name: 'columnId',
                  label: _('flow_backend.field.column'),
                  type: 'select',
                  required: true,
                  value: String(row.columnId ?? ''),
                  options: options.columns.map((column) => ({
                    value: String(column.id),
                    label: String(column.name),
                  })),
                },
              ]}
              errors={errorsFor('move')}
              submit={_('flow_backend.action.move')}
              submitVariant="secondary"
            />
          }
        />,
        <Section
          title={_('flow_backend.action.assignSprint')}
          body={
            <RecordForm
              action={endpoint}
              hidden={{ action: 'assignSprint', expectedVersion: String(row.version ?? 0) }}
              fields={[
                {
                  name: 'sprintId',
                  label: _('flow_backend.field.sprint'),
                  type: 'select',
                  value: String(row.sprintId ?? ''),
                  options: [
                    { value: '', label: '—' },
                    ...options.sprints.map((sprint) => ({
                      value: String(sprint.id),
                      label: String(sprint.name),
                    })),
                  ],
                },
              ]}
              errors={errorsFor('assignSprint')}
              submit={_('flow_backend.action.assignSprint')}
              submitVariant="secondary"
            />
          }
        />,
        <Section title={_('flow_backend.issue.description')} body={options.editor} />,
        <Section
          title={_('flow_backend.dependencies.title')}
          body={stack([
            dependencies.length || dependents.length
              ? dataTable(_, {
                  rows: [
                    ...dependencies.map((item) => ({ ...item, direction: 'out' as const })),
                    ...dependents.map((item) => ({ ...item, direction: 'in' as const })),
                  ] as Array<AnyRow & { direction: 'out' | 'in' }>,
                  id: (item) => String(item.id),
                  columns: [
                    {
                      key: 'relation',
                      label: _('flow_backend.field.relation'),
                      cell: (item) => {
                        const key = `flow.dependency.${String(item.relation)}`
                        const relation = _.resolves(key) ? _(key) : String(item.relation)
                        const direction = _(
                          item.direction === 'out'
                            ? 'flow_backend.dependencies.outgoing'
                            : 'flow_backend.dependencies.incoming',
                        )
                        return `${relation} (${direction})`
                      },
                    },
                    {
                      key: 'target',
                      label: _('flow_backend.dependencies.target'),
                      cell: (item) =>
                        linkButton({
                          href: `/admin/flow/issues/${String(item.direction === 'out' ? item.dependsOnIssueId : item.issueId)}`,
                          label: String(item.direction === 'out' ? item.dependsOnTitle : item.issueTitle),
                          variant: 'tertiary',
                          size: 'compact',
                        }),
                    },
                    {
                      key: 'remove',
                      label: '',
                      align: 'end',
                      cell: (item) =>
                        item.direction === 'out' ? (
                          <RecordForm
                            action={endpoint}
                            hidden={{ action: 'removeDependency', id: String(item.id) }}
                            fields={[]}
                            submit={_('flow_backend.action.remove')}
                            submitVariant="destructive"
                            submitSize="compact"
                            layout="inline"
                          />
                        ) : (
                          '—'
                        ),
                    },
                  ],
                })
              : empty(_),
            <RecordForm
              action={endpoint}
              hidden={{ action: 'addDependency' }}
              fields={[
                {
                  name: 'dependsOnIssueId',
                  label: _('flow_backend.dependencies.target'),
                  required: true,
                  control: controls.dependencyTarget,
                },
                {
                  name: 'relation',
                  label: _('flow_backend.field.relation'),
                  type: 'select',
                  value: 'blocks',
                  options: [
                    { value: 'blocks', label: _('flow_backend.dependency.blocks') },
                    { value: 'related', label: _('flow_backend.dependency.related') },
                  ],
                },
              ]}
              errors={errorsFor('addDependency')}
              submit={_('flow_backend.dependencies.add')}
              submitVariant="secondary"
            />,
          ])}
        />,
        <Section
          title={_('flow_backend.comments.title')}
          body={stack([
            <RecordForm
              action={endpoint}
              hidden={{ action: 'comment' }}
              fields={[
                {
                  name: 'body',
                  label: _('flow_backend.field.comment'),
                  type: 'textarea',
                  required: true,
                  span: 'full',
                },
              ]}
              errors={errorsFor('comment')}
              submit={_('flow_backend.action.addComment')}
              submitVariant="secondary"
            />,
            ...(comments.length
              ? comments.map((item) => (
                  <Surface
                    padding="compact"
                    body={stack([when(item.createdAt), String(item.body)], 'compact')}
                  />
                ))
              : [empty(_)]),
          ])}
        />,
        !!tags.length && (
          <Section
            title={_('flow_backend.field.tags')}
            body={stack(
              tags.map((tag) => badge(String(tag.name), 'neutral', String(tag.id))),
              'compact',
            )}
          />
        ),
      ])}
    />
  )
}

export const epicsScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  endpoint: string,
  epics: AnyRow[],
  fields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={projectName}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action={endpoint}
            hidden={{ action: 'save' }}
            fields={fields}
            errors={errors}
            submit={_('flow_backend.action.create')}
            submitVariant="primary"
          />
        }
      />,
      epics.length ? (
        <KanbanGrid
          rows={epics}
          id={(epic) => String(epic.id)}
          card={(epic) => (
            <KanbanCard
              key={String(epic.id)}
              title={String(epic.title)}
              href={String(epic.issuesHref ?? '')}
              meta={_('flow_backend.epics.issueCount', { count: Number(epic.totalCount ?? 0) })}
              actions={stack(
                [
                  linkButton({
                    href: `/admin/flow/projects/${String(epic.projectId)}/epics/${String(epic.id)}/map`,
                    label: _('flow_backend.epics.map'),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
                  <RecordForm
                    action={endpoint}
                    hidden={{ action: 'archive', id: String(epic.id) }}
                    fields={[]}
                    submit={_('flow_backend.action.archive')}
                    submitVariant="destructive"
                    submitSize="compact"
                    layout="inline"
                  />,
                ],
                'compact',
              )}
            />
          )}
        />
      ) : (
        empty(_)
      ),
    ])}
  />
)

export const sprintsScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  endpoint: string,
  sprints: AnyRow[],
  fields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={projectName}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action={endpoint}
            hidden={{ action: 'save' }}
            fields={fields}
            errors={errors}
            submit={_('flow_backend.action.create')}
            submitVariant="primary"
          />
        }
      />,
      sprints.length
        ? dataTable(_, {
            rows: sprints,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'name',
                label: _('flow_backend.field.name'),
                priority: 'primary',
                cell: (row) => String(row.name),
              },
              {
                key: 'state',
                label: _('flow_backend.field.state'),
                cell: (row) => sprintStateBadge(_, row.state),
              },
              {
                key: 'startDate',
                label: _('flow_backend.field.startDate'),
                kind: 'date',
                cell: (row) => when(row.startDate),
              },
              {
                key: 'endDate',
                label: _('flow_backend.field.endDate'),
                kind: 'date',
                cell: (row) => when(row.endDate),
              },
              {
                key: 'actions',
                label: '',
                align: 'end',
                cell: (row) =>
                  row.state === 'planned' ? (
                    <RecordActions
                      action={endpoint}
                      hidden={{ id: String(row.id) }}
                      actions={[
                        { value: 'start', label: _('flow_backend.action.start'), variant: 'secondary' },
                      ]}
                    />
                  ) : row.state === 'active' ? (
                    <RecordActions
                      action={endpoint}
                      hidden={{ id: String(row.id) }}
                      actions={[
                        { value: 'close', label: _('flow_backend.action.close'), variant: 'secondary' },
                      ]}
                    />
                  ) : (
                    '—'
                  ),
              },
            ],
          })
        : empty(_),
    ])}
  />
)

export const settingsScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  endpoint: string,
  options: {
    columns: AnyRow[]
    columnFields: FormField[]
    editingColumnId?: string
    tags: AnyRow[]
    tagFields: FormField[]
    editingTagId?: string
    /** Errors from the columns half of this screen, and from the tags half. */
    columnErrors?: string[]
    tagErrors?: string[]
  },
): TemplateResult => (
  <Framed
    translator={_}
    title={projectName}
    frame={frame}
    body={stack([
      <Section
        title={_('flow_backend.settings.columns')}
        body={stack([
          options.columns.length
            ? dataTable(_, {
                rows: options.columns,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'sequence',
                    label: _('flow_backend.field.sequence'),
                    cell: (row) => String(row.sequence),
                  },
                  {
                    key: 'name',
                    label: _('flow_backend.field.name'),
                    priority: 'primary',
                    cell: (row) => String(row.name),
                  },
                  {
                    key: 'code',
                    label: _('flow_backend.field.code'),
                    kind: 'identifier',
                    cell: (row) => String(row.code),
                  },
                  {
                    key: 'terminal',
                    label: _('flow_backend.field.terminalState'),
                    cell: (row) => (row.terminalState ? '✓' : '—'),
                  },
                  {
                    key: 'edit',
                    label: '',
                    align: 'end',
                    cell: (row) =>
                      linkButton({
                        href: `?editColumnId=${String(row.id)}`,
                        label: _('flow_backend.action.edit'),
                        variant: 'tertiary',
                        size: 'compact',
                      }),
                  },
                  {
                    key: 'archive',
                    label: '',
                    align: 'end',
                    cell: (row) =>
                      row.terminalState || row.active === false ? (
                        '—'
                      ) : (
                        <RecordForm
                          action={endpoint}
                          hidden={{ action: 'archiveColumn', id: String(row.id) }}
                          fields={[]}
                          submit={_('flow_backend.action.archive')}
                          submitVariant="destructive"
                          submitSize="compact"
                          layout="inline"
                        />
                      ),
                  },
                ],
              })
            : empty(_),
          <RecordForm
            action={endpoint}
            hidden={{ action: 'saveColumn', id: options.editingColumnId ?? '' }}
            fields={options.columnFields}
            errors={options.columnErrors}
            submit={_('flow_backend.action.save')}
            submitVariant="secondary"
          />,
        ])}
      />,
      <Section
        title={_('flow_backend.settings.tags')}
        body={stack([
          options.tags.length
            ? dataTable(_, {
                rows: options.tags,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'name',
                    label: _('flow_backend.field.name'),
                    priority: 'primary',
                    cell: (row) => String(row.name),
                  },
                  {
                    key: 'edit',
                    label: '',
                    align: 'end',
                    cell: (row) =>
                      linkButton({
                        href: `?editTagId=${String(row.id)}`,
                        label: _('flow_backend.action.edit'),
                        variant: 'tertiary',
                        size: 'compact',
                      }),
                  },
                  {
                    key: 'archive',
                    label: '',
                    align: 'end',
                    cell: (row) => (
                      <RecordForm
                        action={endpoint}
                        hidden={{ action: 'archiveTag', id: String(row.id) }}
                        fields={[]}
                        submit={_('flow_backend.action.archive')}
                        submitVariant="destructive"
                        submitSize="compact"
                        layout="inline"
                      />
                    ),
                  },
                ],
              })
            : empty(_),
          <RecordForm
            action={endpoint}
            hidden={{ action: 'saveTag', id: options.editingTagId ?? '' }}
            fields={options.tagFields}
            errors={options.tagErrors}
            submit={_('flow_backend.action.save')}
            submitVariant="secondary"
          />,
        ])}
      />,
    ])}
  />
)
