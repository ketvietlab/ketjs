import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  CardGrid,
  icon,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  Metric,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

/** One figure above the board. `icon` is a glyph name, not markup: screens own markup. */
export type PipelineFigure = {
  id: string
  label: string
  value: string
  detail?: string
  icon: string
}

/**
 * The specialized pipeline surface keeps the route-owned board intact.
 *
 * Search, team/mine filters, create permissions and view links stay in the
 * frame's list chrome. The board remains the CRM island supplied by the route,
 * including its empty, conflict and movement behavior. Figures are optional so
 * a role that can read cases but not `crm.pipeline.summary` still sees the board.
 *
 * The board is a collection, so it wears the collection header the rest of CRM
 * wears — the same identity, chrome and result count as the case list it links
 * to. A record's frame was never the right one: there is no record here.
 */
export const pipelineScreen = (
  _: Translator,
  frame: Frame,
  board: JSXChild,
  figures: readonly PipelineFigure[] = [],
  total: number | null = null,
): TemplateResult => {
  const title = _('crm_backend.pipeline.title')
  const create = frame.chrome?.create
  return shell(
    _,
    title,
    <ListPage
      title={title}
      description={_('crm_backend.pipeline.subtitle')}
      actions={
        create || frame.extras?.['topbar.end'] !== undefined
          ? inline([
              create ? <LinkButton label={create.label} href={create.path} variant="primary" /> : '',
              frame.extras?.['topbar.end'] ?? '',
            ])
          : undefined
      }
      controls={
        frame.chrome
          ? listChrome(
              _,
              title,
              {
                ...frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={total === null ? undefined : `${title}: ${String(total)}`}
      body={stack(
        [
          ...(figures.length
            ? [
                <CardGrid
                  items={figures}
                  id={(figure: PipelineFigure) => figure.id}
                  card={(figure: PipelineFigure) => (
                    <Metric
                      label={figure.label}
                      value={figure.value}
                      detail={figure.detail ?? null}
                      icon={icon(figure.icon)}
                      tone="money"
                    />
                  )}
                />,
              ]
            : []),
          board,
        ],
        'compact',
      )}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
