import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { KetTableConfig } from '@ketvietlab/design-system'
import { ketTable } from '../../packages/ketsuite/src/ui/client/ket-table-view.tsx'
import type { Frame } from '../../packages/ketsuite/src/ui/index.ts'

/**
 * A user collection screen with its KetTable island drawn the way the page
 * route draws it: the grid helper prepares the toolbar and the island config,
 * and the island's own server view renders into the screen's body.
 */
export const withGrid = <O>(
  _: Translator,
  frame: Frame,
  grid: (_: Translator, frame: Frame, options: O) => { frame: Frame; config: KetTableConfig },
  options: O,
  screen: (prepared: Frame, island: TemplateResult, config: KetTableConfig) => TemplateResult,
): TemplateResult => {
  const prepared = grid(_, frame, options)
  return screen(
    prepared.frame,
    ketTable({ id: 'test-grid', config: prepared.config }).view() as TemplateResult,
    prepared.config,
  )
}
