import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { collectionActions, collectionControls, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
  subtitle?: string | null
  frame: Frame
  controls?: JSXChild
  body: JSXChild
  actions?: JSXChild
}

export const ListScreenFrame = ({
  translator: _,
  title,
  subtitle,
  frame,
  body,
  controls,
  actions,
}: PageFrameProps): TemplateResult =>
  shell(
    _,
    title,
    <ListPage
      variant="operational"
      frame={frame}
      title={title}
      description={subtitle ?? undefined}
      actions={collectionActions(_, frame, actions)}
      controls={controls ?? collectionControls(_, title, frame)}
      body={body}
    />,
    { ...frame, chrome: null, topbar: false },
  )
