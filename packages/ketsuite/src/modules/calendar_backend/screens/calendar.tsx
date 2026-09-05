import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { BoardPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export const calendarScreen = (_: Translator, board: JSXChild, frame: Frame): TemplateResult => {
  const title = _('calendar_backend.title')
  return shell(_, title, <BoardPage variant="operational" frame={frame} title={title} body={board} />, {
    ...frame,
    topbar: false,
  })
}
