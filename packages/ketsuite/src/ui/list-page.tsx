// The application-level ListPage composition.
//
// The public design-system pattern deliberately knows nothing about a viewer or
// the application's menu. KetSuite does, so this thin boundary turns the active
// menu branch and live company context into the standard strip above every list.

import {
  LinkButton,
  ListPage as DesignSystemListPage,
  type ListPageProps as DesignSystemListPageProps,
} from '@ketvietlab/design-system'
import { renderToString, type JSXChild, type TemplateResult } from '@ketvietlab/ketjs-view'
import type { Frame } from './layout.tsx'
import { pageContextFromFrame } from './navigation.tsx'
import { icon } from './icons.ts'

type ListPageFrame = Pick<Frame, 'menu' | 'viewer' | 'chrome'>

type ContextSource =
  | { frame: ListPageFrame; context?: never }
  | { frame?: ListPageFrame; context: Exclude<JSXChild, undefined> }

export type ListPageProps = Omit<DesignSystemListPageProps, 'context'> & ContextSource

/**
 * Compatibility composition accepts nested inline layouts and extension fragments.
 * Only known bulk forms and empty inline wrappers are ignored; every other element
 * or text counts as an extra action. Rendering normalises arrays and fragment markers.
 */
const hasNonBulkActions = (actions: JSXChild): boolean => {
  // biome-ignore lint/complexity/noUselessFragments: Normalise arbitrary JSXChild into the TemplateResult required by SSR.
  const markup = renderToString(<>{actions}</>)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<form\b(?=[^>]*\bdata-ui="bulk-form")[^>]*>[\s\S]*?<\/form>/g, '')
  let remaining = markup
  for (;;) {
    const next = remaining.replace(/<div data-ui="inline">\s*<\/div>/g, '')
    if (next === remaining) return remaining.trim().length > 0
    remaining = next
  }
}

/**
 * Every KetSuite collection carries navigation and organisation context. A
 * screen may supply a specialised context, otherwise its frame is authoritative.
 * A frame's create link always belongs beside the title. Explicit headerActions
 * may replace it; tool and bulk actions share the same identity band.
 */
export const ListPage = (props: ListPageProps): TemplateResult => {
  const actionsHidden = props.actionsHidden ?? !hasNonBulkActions(props.actions)
  const create = props.frame?.chrome?.create
  const headerActions =
    props.headerActions !== undefined ? (
      (props.headerActions ?? undefined)
    ) : create ? (
      <LinkButton label={create.label} href={create.path} variant="primary" leading={icon('plus')} />
    ) : undefined
  if (props.context !== undefined) {
    const { frame: _frame, context, ...page } = props
    return (
      <DesignSystemListPage
        {...page}
        headerActions={headerActions}
        actionsHidden={actionsHidden}
        actionsPlacement="header"
        context={context}
      />
    )
  }

  const { frame, context: _context, ...page } = props
  return (
    <DesignSystemListPage
      {...page}
      headerActions={headerActions}
      actionsHidden={actionsHidden}
      actionsPlacement="header"
      context={pageContextFromFrame(props.title, frame)}
    />
  )
}
