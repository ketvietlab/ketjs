import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { collectionActions, collectionControls, FormPage, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
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
      actions={collectionActions(_, frame)}
      body={body}
      width={width}
    />,
    {
      ...frame,
      chrome: null,
      topbar: false,
    },
  )
