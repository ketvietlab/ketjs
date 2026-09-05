import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  AttachmentPanel,
  badge,
  button,
  dataTable,
  DefinitionList,
  FormCluster,
  FormPage,
  inline,
  linkButton,
  modalForm,
  modalWorkspace,
  Notice,
  Progress,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { empty, entryBody, priorityBadge, when } from './shared.tsx'

export type IssueDetailControls = {
  assignee?: JSXChild
  mentions?: JSXChild
  epic?: JSXChild
  tags?: JSXChild
  dependencyTarget?: JSXChild
  /** A picker of issues that already exist, for putting one under this one. */
  subtaskTarget?: JSXChild
}

export type IssueDetailOptions = {
  fields: FormField[]
  columns: AnyRow[]
  sprints: AnyRow[]
  controls?: IssueDetailControls
  editor: JSXChild
  /** Files on this issue, and where a new one is posted. */
  attachments: AnyRow[]
  /** The project's own field definitions, which name the values on the row. */
  fieldDefs: AnyRow[]
  locale?: string
  dialog?: 'move' | 'assignSprint'
  submitted?: Record<string, string>
  idempotencyKey?: string
  /**
   * Which action failed, and why. This screen carries several forms; naming
   * the action keeps each rejection beside the action that produced it.
   */
  errors?: { action: string; messages: string[] }
}

export const issueDetailScreen = (
  _: Translator,
  frame: Frame,
  row: AnyRow,
  options: IssueDetailOptions,
): TemplateResult => {
  const tags = (row.tags as AnyRow[] | undefined) ?? []
  const dependencies = (row.dependencies as AnyRow[] | undefined) ?? []
  const dependents = (row.dependents as AnyRow[] | undefined) ?? []
  const comments = (row.comments as AnyRow[] | undefined) ?? []
  const children = (row.children as AnyRow[] | undefined) ?? []
  const controls = options.controls ?? {}
  const fieldValues = (row.fieldValues as Record<string, unknown> | undefined) ?? {}
  const endpoint = localized(`/admin/flow/issues/${encodeURIComponent(String(row.id))}`, options.locale ?? '')
  const attachmentEndpoint = localized(
    `/admin/flow/issues/${encodeURIComponent(String(row.id))}/attachments`,
    options.locale ?? '',
  )
  const dialogHref = (dialog: 'move' | 'assignSprint'): string => {
    const target = new URL(endpoint, 'http://ket.local')
    target.searchParams.set('dialog', dialog)
    return `${target.pathname}${target.search}`
  }
  const formId = 'flow-issue-detail-form'
  const dash = '\u2014'

  /**
   * The facts about this issue that nobody edits from here.
   *
   * A read view, not a second copy of the form below it: every one of these is
   * either set by an action of its own (the column, the sprint) or written by
   * the system (created, updated). Rendering them as inputs would offer two
   * ways to change one thing, and only one of them would be the one that
   * checks anything.
   */
  const summary = [
    { key: 'assignee', term: _('flow_backend.field.assignee'), value: String(row.assigneeName ?? dash) },
    { key: 'createdAt', term: _('flow_backend.field.createdAt'), value: when(row.createdAt) || dash },
    { key: 'epic', term: _('flow_backend.field.epic'), value: String(row.epicTitle ?? dash) },
    { key: 'updatedAt', term: _('flow_backend.field.updatedAt'), value: when(row.updatedAt) || dash },
    { key: 'sprint', term: _('flow_backend.field.sprint'), value: String(row.sprintName ?? dash) },
    { key: 'dueDate', term: _('flow_backend.field.dueDate'), value: when(row.dueDate) || dash },
    {
      key: 'estimate',
      term: _('flow_backend.field.estimate'),
      value: row.estimate == null ? dash : String(row.estimate),
    },
    { key: 'startsOn', term: _('flow_backend.field.startDate'), value: when(row.startsOn) || dash },
  ]

  /** The same, for the rail: what this issue *is* rather than who is doing it. */
  const attributes = [
    { key: 'type', term: _('flow_backend.field.type'), value: String(row.typeName ?? dash) },
    { key: 'column', term: _('flow_backend.field.column'), value: String(row.columnName ?? dash) },
    {
      key: 'priority',
      term: _('flow_backend.field.priority'),
      value: (() => {
        const key = `flow.priority.${String(row.priority ?? 'normal')}`
        return _.resolves(key) ? _(key) : String(row.priority ?? dash)
      })(),
    },
    { key: 'project', term: _('flow_backend.field.project'), value: String(row.projectName ?? dash) },
    // A project's own fields — Environment, Version, Component in the design —
    // read from what this project actually defines rather than a fixed list.
    // The values arrive keyed by field id, so the names come from the
    // definitions; a field nobody has answered still gets a row, because "not
    // filled in" is a thing worth seeing on a record.
    ...options.fieldDefs.map((def) => ({
      key: `field:${String(def.id)}`,
      term: String(def.name ?? def.code),
      value: String(fieldValues[String(def.id)] ?? '') || dash,
    })),
  ]
  const errorsFor = (action: string): string[] | undefined =>
    options.errors?.action === action ? options.errors.messages : undefined
  const activeDialog =
    options.dialog ??
    (options.errors?.action === 'move' || options.errors?.action === 'assignSprint'
      ? options.errors.action
      : undefined)
  const withIdempotency = (hidden: Record<string, string>): Record<string, string> =>
    options.idempotencyKey ? { ...hidden, idempotencyKey: options.idempotencyKey } : hidden
  const selectedColumn = options.submitted?.columnId ?? String(row.columnId ?? '')
  const columnOptions = options.columns.map((column) => ({
    value: String(column.id),
    label: String(column.name),
  }))
  if (selectedColumn && !columnOptions.some((option) => option.value === selectedColumn)) {
    columnOptions.unshift({ value: selectedColumn, label: selectedColumn })
  }
  const selectedSprint = options.submitted?.sprintId ?? String(row.sprintId ?? '')
  const sprintOptions = [
    { value: '', label: '—' },
    ...options.sprints.map((sprint) => ({
      value: String(sprint.id),
      label: String(sprint.name),
    })),
  ]
  if (selectedSprint && !sprintOptions.some((option) => option.value === selectedSprint)) {
    sprintOptions.unshift({ value: selectedSprint, label: selectedSprint })
  }
  const overlay = activeDialog
    ? modalForm({
        id: `flow-issue-${activeDialog}`,
        title: _(`flow_backend.action.${activeDialog}`),
        description: String(row.title),
        closeHref: endpoint,
        closeLabel: _('flow_backend.action.cancel'),
        form: {
          id: `flow-issue-${activeDialog}-form`,
          scope: `flow-issue-${activeDialog}`,
          action: dialogHref(activeDialog),
          submit: _(`flow_backend.action.${activeDialog}`),
          submitVariant: 'primary',
          cancelHref: endpoint,
          cancelLabel: _('flow_backend.action.cancel'),
          hidden: withIdempotency({
            action: activeDialog,
            expectedVersion: String(row.version ?? 0),
          }),
          fields:
            activeDialog === 'move'
              ? [
                  {
                    name: 'columnId',
                    label: _('flow_backend.field.column'),
                    type: 'select',
                    required: true,
                    value: selectedColumn,
                    options: columnOptions,
                  },
                ]
              : [
                  {
                    name: 'sprintId',
                    label: _('flow_backend.field.sprint'),
                    type: 'select',
                    value: selectedSprint,
                    options: sprintOptions,
                  },
                ],
          errors: errorsFor(activeDialog),
        },
      })
    : undefined

  const page = (
    <FormPage
      variant="operational"
      frame={frame}
      scope="flow-issue-detail-form-page"
      title={String(row.title)}
      description={String(row.projectName ?? '') || undefined}
      status={badge(String(row.columnName ?? dash), 'info', String(row.columnId ?? ''))}
      meta={inline([
        priorityBadge(_, row.priority),
        badge(`${_('flow_backend.field.assignee')}: ${String(row.assigneeName ?? dash)}`, 'neutral'),
      ])}
      actions={inline([
        <FormCluster
          label={_('flow_backend.issue.summary')}
          forms={[
            button({
              label: _('flow_backend.action.save'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('flow_backend.action.move'),
              href: dialogHref('move'),
              variant: 'secondary',
            }),
            linkButton({
              label: _('flow_backend.action.assignSprint'),
              href: dialogHref('assignSprint'),
              variant: 'secondary',
            }),
            // The one way out of the board that is not "done". Destructive in
            // tone because it removes the issue from every figure the project
            // reports — but it is reversible, and the button says which way.
            button({
              label: _(row.active === false ? 'flow_backend.action.restore' : 'flow_backend.action.archive'),
              type: 'submit',
              form: formId,
              name: 'action',
              value: row.active === false ? 'restore' : 'archive',
              variant: row.active === false ? 'secondary' : 'destructive',
            }),
          ]}
        />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      asideLabel={_('flow_backend.issue.attributes')}
      aside={stack([
        <DefinitionList title={_('flow_backend.issue.attributes')} items={attributes} />,
        <Section
          title={_('flow_backend.attachments.title')}
          body={
            <AttachmentPanel
              items={options.attachments.map((item) => ({
                id: String(item.id),
                name: String(item.name),
                href: `/files/${String(item.id)}`,
                size: Number(item.size ?? 0),
                mimetype: String(item.mimetype ?? ''),
              }))}
              uploadAction={attachmentEndpoint}
              emptyTitle={_('flow_backend.attachments.empty')}
              emptyHint={_('flow_backend.attachments.emptyHint')}
              chooseLabel={_('flow_backend.attachments.choose')}
              uploadLabel={_('flow_backend.attachments.upload')}
            />
          }
        />,
      ])}
      slots={{ header: 'flow.issue-header', body: 'flow.issue-body' }}
      body={stack([
        row.active === false ? (
          <Notice
            tone="warning"
            title={_('flow_backend.issue.archivedTitle')}
            message={_('flow_backend.issue.archivedBody')}
          />
        ) : null,
        <DefinitionList title={_('flow_backend.issue.summary')} items={summary} />,
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="flow-issue-detail"
              action={endpoint}
              hidden={withIdempotency({ action: 'save', expectedVersion: String(row.version ?? 0) })}
              fields={options.fields}
              errors={errorsFor('save')}
              submit={_('flow_backend.action.save')}
              submitVariant="primary"
              submitPlacement="external"
            />
          }
        />,
        <Section title={_('flow_backend.issue.description')} body={options.editor} />,
        <Section
          title={_('flow_backend.subtasks.title')}
          actions={
            <Progress
              value={row.progress == null ? null : Number(row.progress)}
              label={_('flow_backend.field.progress')}
              text={`${String(row.subtaskDone ?? 0)}/${String(row.subtaskTotal ?? 0)}`}
            />
          }
          description={
            row.parentIssueId
              ? `${_('flow_backend.subtasks.parent')}: ${String(row.parentTitle ?? row.parentIssueId)}`
              : undefined
          }
          body={stack([
            children.length
              ? dataTable(_, {
                  rows: children,
                  id: (item) => String(item.id),
                  columns: [
                    {
                      key: 'title',
                      label: _('flow_backend.field.title'),
                      priority: 'primary',
                      cell: (item) =>
                        linkButton({
                          href: localized(
                            `/admin/flow/issues/${encodeURIComponent(String(item.id))}`,
                            options.locale ?? '',
                          ),
                          label: String(item.title),
                          variant: 'tertiary',
                          size: 'compact',
                        }),
                    },
                    {
                      key: 'column',
                      label: _('flow_backend.field.column'),
                      cell: (item) => String(item.columnName ?? '\u2014'),
                    },
                    {
                      key: 'assignee',
                      label: _('flow_backend.field.assignee'),
                      cell: (item) => String(item.assigneeName ?? '\u2014'),
                    },
                    {
                      key: 'detach',
                      label: '',
                      align: 'end',
                      cell: (item) => (
                        <RecordForm
                          action={endpoint}
                          hidden={{
                            action: 'detachSubtask',
                            id: String(item.id),
                            childVersion: String(item.version ?? 0),
                          }}
                          fields={[]}
                          submit={_('flow_backend.subtasks.detach')}
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
              hidden={{ action: 'addSubtask' }}
              fields={[
                {
                  name: 'title',
                  label: _('flow_backend.subtasks.newTitle'),
                  required: true,
                  span: 'full',
                },
              ]}
              errors={errorsFor('addSubtask')}
              submit={_('flow_backend.subtasks.add')}
              submitVariant="secondary"
            />,
            // Creating a sub-task was the only way to get one. Work that already
            // exists — filed before anyone knew it belonged under something —
            // had no way in, and the route said so: "parent has no screen yet".
            controls.subtaskTarget ? (
              <RecordForm
                action={endpoint}
                hidden={{ action: 'attachSubtask' }}
                fields={[
                  {
                    name: 'childId',
                    label: _('flow_backend.subtasks.attachField'),
                    required: true,
                    control: controls.subtaskTarget,
                  },
                ]}
                errors={errorsFor('attachSubtask')}
                submit={_('flow_backend.subtasks.attach')}
                submitVariant="secondary"
              />
            ) : null,
          ])}
        />,
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
                          href: localized(
                            `/admin/flow/issues/${encodeURIComponent(
                              String(item.direction === 'out' ? item.dependsOnIssueId : item.issueId),
                            )}`,
                            options.locale ?? '',
                          ),
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
          description={
            row.following ? _('flow_backend.comments.followingHint') : _('flow_backend.comments.quietHint')
          }
          actions={
            // Both directions, always one of them. Following used to happen only
            // by being assigned, commenting or being named, and `unfollow` was
            // the only deliberate move — so watching somebody else's work meant
            // commenting on it.
            <RecordForm
              action={endpoint}
              hidden={{ action: row.following ? 'unfollow' : 'follow' }}
              fields={[]}
              submit={_(row.following ? 'flow_backend.action.unfollow' : 'flow_backend.action.follow')}
              submitVariant="secondary"
              submitSize="compact"
              layout="inline"
            />
          }
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
                ...(controls.mentions
                  ? [
                      {
                        name: 'mentionUserIds',
                        label: _('flow_backend.field.mentions'),
                        help: _('flow_backend.comments.mentionHint'),
                        control: controls.mentions,
                        span: 'full' as const,
                      },
                    ]
                  : []),
              ]}
              errors={errorsFor('comment')}
              submit={_('flow_backend.action.addComment')}
              submitVariant="secondary"
            />,
            ...(comments.length
              ? comments.map((item) => (
                  <Surface
                    padding="compact"
                    body={stack([when(item.createdAt), entryBody(_, item)], 'compact')}
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
  const workspace = shell(_, String(row.title), page, { ...frame, topbar: false, titled: false })
  return overlay ? modalWorkspace(workspace, overlay) : workspace
}
