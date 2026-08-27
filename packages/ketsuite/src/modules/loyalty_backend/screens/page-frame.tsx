import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { FormPage, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
  frame: Frame
  body: TemplateResult
}

export const ListScreenFrame = ({ translator: _, title, frame, body }: PageFrameProps): TemplateResult =>
  shell(_, title, <ListPage title={title} actions={frame.extras?.['topbar.end']} body={body} />, {
    ...frame,
    chrome: null,
    topbar: false,
  })

export const FormScreenFrame = ({ translator: _, title, frame, body }: PageFrameProps): TemplateResult =>
  shell(_, title, <FormPage title={title} actions={frame.extras?.['topbar.end']} body={body} />, {
    ...frame,
    chrome: null,
    topbar: false,
  })
