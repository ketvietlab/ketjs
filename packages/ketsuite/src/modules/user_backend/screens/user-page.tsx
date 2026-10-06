import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

/**
 * A person's own page, inside the administration shell. The record page island
 * is the content: its frame, sections and dialogs belong to the record runtime,
 * placed through the `user.record-page` joint so a deployment can stand in for it.
 * The record page carries the title, so the shell's own topbar steps aside.
 */
export const userPageScreen = (
  _: Translator,
  title: string,
  page: JSXChild,
  frame: Frame = {},
): TemplateResult =>
  shell(
    _,
    title,
    // biome-ignore lint/complexity/noUselessFragments: the shell takes a template, and the island is any child.
    <>{page}</>,
    { ...frame, titled: false, topbar: false },
  )
