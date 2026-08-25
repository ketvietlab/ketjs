import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Framed,
  KanbanCard,
  KanbanGrid,
  linkButton,
  RecordForm,
  RecordList,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

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
              // The epic itself, not its issue list: the card's own actions
              // still lead to the map and the backlog, but the title is the
              // way into what the epic is for.
              href={`/admin/flow/epics/${String(epic.id)}`}
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

/**
 * Every epic across projects — the base the epic's document endpoints hang off,
 * and the way into an epic that does not start from its project.
 */
export const allEpicsScreen = (
  _: Translator,
  frame: Frame,
  title: string,
  epics: readonly AnyRow[],
): TemplateResult => (
  <Framed
    translator={_}
    title={title}
    frame={frame}
    body={stack([
      epics.length ? (
        <Section
          title={title}
          body={
            <RecordList
              rows={epics}
              id={(epic) => String(epic.id)}
              title={(epic) => String(epic.title ?? '')}
              href={(epic) => `/admin/flow/epics/${String(epic.id)}`}
              summary={(epic) => String(epic.previewText ?? '').slice(0, 140)}
              value={(epic) => String(epic.projectName ?? '')}
            />
          }
        />
      ) : (
        empty(_)
      ),
    ])}
  />
)

/**
 * One epic: its document, and what is under it.
 *
 * The grid next door answers "how much is left"; this answers "what is this
 * for", which is the question a progress count cannot. The document is placed
 * through a joint like every other Live Doc — the island is livedoc's, and this
 * screen only knows where it goes.
 */
export const epicDetailScreen = (
  _: Translator,
  frame: Frame,
  epic: AnyRow,
  document: JSXChild,
  issues: readonly AnyRow[],
): TemplateResult => (
  <Framed
    translator={_}
    title={String(epic.title ?? '')}
    frame={frame}
    body={stack([
      <Section title={_('flow_backend.epics.document')} body={document} />,
      <Section
        title={_('flow_backend.epics.issues')}
        body={
          issues.length ? (
            <RecordList
              rows={issues}
              id={(row) => String(row.id)}
              title={(row) => String(row.title ?? '')}
              href={(row) => `/admin/flow/issues/${String(row.id)}`}
              summary={(row) => String(row.columnName ?? '')}
            />
          ) : (
            empty(_)
          )
        }
      />,
    ])}
  />
)
