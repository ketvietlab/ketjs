import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  Framed,
  linkButton,
  Progress,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty, entryBody, when } from './shared.tsx'

export type IssueDetailControls = {
  assignee?: JSXChild
  mentions?: JSXChild
  epic?: JSXChild
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
  const children = (row.children as AnyRow[] | undefined) ?? []
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
                          href: `/admin/flow/issues/${String(item.id)}`,
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
          description={
            row.following ? _('flow_backend.comments.followingHint') : _('flow_backend.comments.quietHint')
          }
          actions={
            row.following ? (
              <RecordForm
                action={endpoint}
                hidden={{ action: 'unfollow' }}
                fields={[]}
                submit={_('flow_backend.action.unfollow')}
                submitVariant="secondary"
                submitSize="compact"
                layout="inline"
              />
            ) : undefined
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
}
