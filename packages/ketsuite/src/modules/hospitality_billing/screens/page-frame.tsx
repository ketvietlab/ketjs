import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { collectionActions, collectionControls, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
  frame: Frame
  controls?: JSXChild
  body: JSXChild
  headerActions?: JSXChild
  actions?: JSXChild
}

export const ListScreenFrame = ({
  translator: _,
  title,
  frame,
  body,
  controls,
  actions,
  headerActions,
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
    />,
    { ...frame, chrome: null, topbar: false },
  )
