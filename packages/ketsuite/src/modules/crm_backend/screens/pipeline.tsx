import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { CardGrid, Framed, icon, Metric, stack } from '../../../ui/index.ts'
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
 */
export const pipelineScreen = (
  _: Translator,
  frame: Frame,
  board: JSXChild,
  figures: readonly PipelineFigure[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('crm_backend.pipeline.title')}
    subtitle={_('crm_backend.pipeline.subtitle')}
    frame={frame}
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
  />
)
