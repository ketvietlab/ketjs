import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { BoardPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export const boardScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  board: JSXChild,
): TemplateResult =>
  shell(_, projectName, <BoardPage variant="operational" frame={frame} title={projectName} body={board} />, {
    ...frame,
    topbar: false,
  })
