import {
  FormPage as DesignSystemFormPage,
  type FormPageProps as DesignSystemFormPageProps,
} from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Frame } from './layout.tsx'
import { pageContextFromFrame } from './navigation.tsx'

type FormPageFrame = Pick<Frame, 'menu' | 'viewer'>

type ContextSource =
  | { frame: FormPageFrame; context?: never }
  | { frame?: FormPageFrame; context: Exclude<JSXChild, undefined> }

export type FormPageProps = Omit<DesignSystemFormPageProps, 'context'> & ContextSource

/** @deprecated Use RecordPage. Retained so existing screens keep data-ui="form-page". */
export const FormPage = (props: FormPageProps): TemplateResult => {
  if (props.context !== undefined) {
    const { frame: _frame, context, ...page } = props
    return <DesignSystemFormPage {...page} context={context} />
  }

  const { frame, context: _context, ...page } = props
  return <DesignSystemFormPage {...page} context={pageContextFromFrame(props.title, frame)} />
}
