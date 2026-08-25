import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Framed, Section } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

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
