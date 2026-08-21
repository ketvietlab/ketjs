import type { Translator } from 'ketjs'
import type { JSXChild, TemplateResult } from 'ketjs-view'
import { framed, stack } from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

export const calendarScreen = (_: Translator, board: JSXChild, frame: Frame): TemplateResult =>
  framed(_, _('calendar_backend.title'), frame, stack([board]))
