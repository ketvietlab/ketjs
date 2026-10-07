import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { IslandProps, Markup } from '@ketvietlab/ketjs-view'
import type { PageDefinition, StaticIslandFactory, StaticIslandOptions, ViewConfig } from './types.ts'

export { buildProject, checkProject, loadConfig } from './project.ts'
export { ketJsxPlugin, transformKetJsx } from './jsx-compiler.ts'
export type { KetJsxOptions, KetJsxResult } from './jsx-compiler.ts'

export type {
  BuildResult,
  ClientIslandDefinition,
  PageDefinition,
  PageHead,
  PageLink,
  PageMeta,
  PageScript,
  ResolvedViewConfig,
  StaticIslandFactory,
  StaticIslandOptions,
  ViewConfig,
} from './types.ts'

export const defineConfig = <Config extends ViewConfig>(config: Config): Config => config

export const definePage = <Page extends PageDefinition>(page: Page): Page => page

/** A content source may produce many explicit routes in one page module. */
export const definePages = <Pages extends readonly PageDefinition[]>(pages: Pages): Pages => pages

/**
 * Render an explicit client island into an otherwise inert static page.
 * The island name must also be registered in ket-view.config.ts.
 */
export function island<Props extends IslandProps>(
  name: string,
  factory: StaticIslandFactory<Props>,
  props: Props,
  options: StaticIslandOptions<Props> = {},
): Markup {
  return trustedMarkup(
    renderIsland(name, factory, props, {
      key: options.key,
      tag: 'div',
    }),
  )
}
