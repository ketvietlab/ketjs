import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { FormPage, inline, ListPage, shell } from '../../../ui/index.ts'
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
}: PageFrameProps): TemplateResult => {
  const frameActions = frame.extras?.['topbar.end']
  return shell(
    _,
    title,
    <ListPage
      variant="operational"
      frame={frame}
      title={title}
      description={subtitle ?? undefined}
      actions={
        actions !== undefined || frameActions !== undefined
          ? inline([actions ?? '', frameActions ?? ''])
          : undefined
      }
      body={body}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}

export const FormScreenFrame = ({
  translator: _,
  title,
  subtitle,
  frame,
  body,
}: PageFrameProps): TemplateResult =>
  shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      title={title}
      description={subtitle ?? undefined}
      actions={frame.extras?.['topbar.end']}
      body={body}
    />,
    { ...frame, chrome: null, topbar: false },
  )
