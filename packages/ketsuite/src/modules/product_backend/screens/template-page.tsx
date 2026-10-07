import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

/**
 * A product template's own page. The `product.template-page` island is the whole
 * page: it renders the RecordPage, its title and actions, so the shell adds no
 * top bar or title of its own (see modal/product-modal-view.tsx).
 */
export const templatePageScreen = (
  _: Translator,
  title: string,
  island: JSXChild,
  frame: Frame,
): TemplateResult => shell(_, title, <>{island}</>, { ...frame, topbar: false, titled: false })
