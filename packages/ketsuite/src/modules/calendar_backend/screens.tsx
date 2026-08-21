import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Framed, stack } from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

export const calendarScreen = (_: Translator, board: JSXChild, frame: Frame): TemplateResult => (
  <Framed translator={_} title={_('calendar_backend.title')} frame={frame} body={stack([board])} />
)
