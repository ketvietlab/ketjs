import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { LinkButton } from '@ketvietlab/design-system'
import type { Frame } from './layout.tsx'
import { bulkActions, listChrome } from './chrome.tsx'
import { inline } from './primitives.tsx'
import { icon } from './icons.ts'

export const collectionActions = (_: Translator, frame: Frame, extra?: JSXChild): JSXChild =>
  frame.chrome?.create ||
  frame.chrome?.selection ||
  extra !== undefined ||
  frame.extras?.['topbar.end'] !== undefined
    ? inline([
        frame.chrome?.create ? (
          <LinkButton
            label={frame.chrome.create.label}
            href={frame.chrome.create.path}
            variant="primary"
            leading={icon('plus')}
          />
        ) : (
          ''
        ),
        frame.chrome?.selection ? bulkActions(_, frame.chrome.selection) : '',
        extra ?? '',
        frame.extras?.['topbar.end'] ?? '',
      ])
    : undefined

export const collectionControls = (_: Translator, title: string, frame: Frame): JSXChild =>
  frame.chrome
    ? listChrome(
        _,
        title,
        { ...frame.chrome, layout: 'command', section: undefined, create: null, selection: null },
        false,
      )
    : undefined
