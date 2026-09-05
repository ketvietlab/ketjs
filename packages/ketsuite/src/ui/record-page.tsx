import {
  RecordPage as DesignSystemRecordPage,
  type RecordPageProps as DesignSystemRecordPageProps,
} from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Frame } from './layout.tsx'
import { pageContextFromFrame } from './navigation.tsx'

type RecordPageFrame = Pick<Frame, 'menu' | 'viewer'>

type ContextSource =
  | { frame: RecordPageFrame; context?: never }
  | { frame?: RecordPageFrame; context: Exclude<JSXChild, undefined> }

export type RecordPageProps = Omit<DesignSystemRecordPageProps, 'context'> & ContextSource

/** The sole KetSuite contract for create, edit, detail and workflow records. */
export const RecordPage = (props: RecordPageProps): TemplateResult => {
  if (props.context !== undefined) {
    const { frame: _frame, context, ...page } = props
    return <DesignSystemRecordPage {...page} context={context} />
  }

  const { frame, context: _context, ...page } = props
  return <DesignSystemRecordPage {...page} context={pageContextFromFrame(props.title, frame)} />
}
