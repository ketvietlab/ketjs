import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { FormPage, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
  subtitle?: string | null
  frame: Frame
  body: TemplateResult
  /** Closes the collection: a pager, a count, whatever the list ends with. */
  footer?: TemplateResult | null
}

export const ListScreenFrame = ({
  translator: _,
  title,
  subtitle,
  frame,
  body,
  footer,
}: PageFrameProps): TemplateResult =>
  shell(
    _,
    title,
    <ListPage
      variant="operational"
      frame={frame}
      title={title}
      description={subtitle ?? undefined}
      actions={frame.extras?.['topbar.end']}
      body={body}
      footer={footer ?? undefined}
    />,
    {
      ...frame,
      chrome: null,
      topbar: false,
    },
  )

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
    {
      ...frame,
      chrome: null,
      topbar: false,
    },
  )
