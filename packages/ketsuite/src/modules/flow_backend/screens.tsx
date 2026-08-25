import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Framed, Section } from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

export const issueScreen = (_: Translator, frame: Frame, title: string, editor: JSXChild): TemplateResult => (
  <Framed
    translator={_}
    title={title}
    frame={frame}
    body={<Section title={_('flow_backend.issue.description')} body={editor} />}
  />
)
