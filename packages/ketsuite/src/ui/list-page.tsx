// The application-level ListPage composition.
//
// The public design-system pattern deliberately knows nothing about a viewer or
// the application's menu. KetSuite does, so this thin boundary turns the active
// menu branch and live company context into the standard strip above every list.

import {
  ListPage as DesignSystemListPage,
  type ListPageProps as DesignSystemListPageProps,
} from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Frame } from './layout.tsx'
import { pageContextFromFrame } from './navigation.tsx'

type ListPageFrame = Pick<Frame, 'menu' | 'viewer'>

type ContextSource =
  | { frame: ListPageFrame; context?: never }
  | { frame?: ListPageFrame; context: Exclude<JSXChild, undefined> }

export type ListPageProps = Omit<DesignSystemListPageProps, 'context'> & ContextSource

/**
 * Every KetSuite collection carries navigation and organisation context. A
 * screen may supply a specialised context, otherwise its frame is authoritative.
 */
export const ListPage = (props: ListPageProps): TemplateResult => {
  if (props.context !== undefined) {
    const { frame: _frame, context, ...page } = props
    return <DesignSystemListPage {...page} context={context} />
  }

  const { frame, context: _context, ...page } = props
  return <DesignSystemListPage {...page} context={pageContextFromFrame(props.title, frame)} />
}
