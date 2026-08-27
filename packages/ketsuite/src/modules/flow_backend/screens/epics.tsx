import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Framed, RecordList, Section, stack } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

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
