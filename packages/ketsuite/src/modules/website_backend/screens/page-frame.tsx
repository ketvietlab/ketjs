import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { collectionActions, collectionControls, FormPage, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
  subtitle?: string | null
  frame: Frame
  headerActions?: JSXChild
  actions?: JSXChild
  controls?: JSXChild
  body: JSXChild
  width?: 'default' | 'wide'
  /** Closes the collection: a pager, a count, whatever the list ends with. */
  footer?: TemplateResult | null
}

export const ListScreenFrame = ({
  translator: _,
  title,
  subtitle,
  frame,
  body,
  actions,
  headerActions,
  controls,
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
      headerActions={headerActions}
      actions={collectionActions(_, frame, actions)}
      controls={collectionControls(_, title, frame, controls)}
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
  width,
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
      width={width}
    />,
    {
      ...frame,
      chrome: null,
      topbar: false,
    },
  )
