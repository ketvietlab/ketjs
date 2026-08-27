import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { FormPage, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
  subtitle?: string | null
  frame: Frame
  body: JSXChild
}

export const ListScreenFrame = ({ translator: _, title, subtitle, frame, body }: PageFrameProps): TemplateResult =>
  shell(
    _,
    title,
    <ListPage
      title={title}
      description={subtitle ?? undefined}
      actions={frame.extras?.['topbar.end']}
      body={body}
    />,
    { ...frame, chrome: null, topbar: false },
  )

export const FormScreenFrame = ({ translator: _, title, subtitle, frame, body }: PageFrameProps): TemplateResult =>
  shell(
    _,
    title,
    <FormPage
      title={title}
      description={subtitle ?? undefined}
      actions={frame.extras?.['topbar.end']}
      body={body}
    />,
    { ...frame, chrome: null, topbar: false },
  )
