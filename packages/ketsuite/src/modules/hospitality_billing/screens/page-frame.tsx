import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { inline, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
  subtitle?: string | null
  frame: Frame
  body: JSXChild
  actions?: JSXChild
}

export const ListScreenFrame = ({
  translator: _,
  title,
  subtitle,
  frame,
  body,
  actions,
}: PageFrameProps): TemplateResult =>
  shell(
    _,
    title,
    <ListPage
      title={title}
      description={subtitle ?? undefined}
      actions={
        actions !== undefined || frame.extras?.['topbar.end'] !== undefined
          ? inline([actions ?? '', frame.extras?.['topbar.end'] ?? ''])
          : undefined
      }
      body={body}
    />,
    { ...frame, chrome: null, topbar: false },
  )
