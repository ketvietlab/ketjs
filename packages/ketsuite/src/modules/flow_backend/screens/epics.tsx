import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Framed, KanbanCard, KanbanGrid, linkButton, RecordForm, stack, Surface } from '../../../ui/index.ts'
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
