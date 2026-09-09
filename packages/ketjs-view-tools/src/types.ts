import type { IslandFactory, IslandProps, TemplateResult } from '@ketvietlab/ketjs-view'

export type PageMeta = {
  name: string
  content: string
}

export type PageLink = {
  rel: string
  href: string
  type?: string
}

export type PageHead = {
  title: string
  description?: string
  lang?: string
  meta?: readonly PageMeta[]
  links?: readonly PageLink[]
}

export type PageDefinition = {
  /** Override the route inferred from the file name. Must end with a slash. */
  path?: string
  head: PageHead
  view(): TemplateResult
}

export type ClientIslandDefinition = {
  /** Module path relative to ket-view.config.ts. */
  entry: string
  /** Named export containing the IslandFactory. Defaults to `default`. */
  export?: string
}

export type ViewConfig = {
  pages?: string
  publicDir?: string
  outDir?: string
  base?: string
  styles?: readonly string[]
  islands?: Readonly<Record<string, string | ClientIslandDefinition>>
  host?: string
  port?: number
}

export type ResolvedViewConfig = {
  root: string
  configFile: string
  pages: string
  publicDir: string
  outDir: string
  base: string
  styles: readonly string[]
  islands: Readonly<Record<string, ClientIslandDefinition>>
  host: string
  port: number
}

export type BuildResult = {
  outDir: string
  pages: readonly { route: string; file: string }[]
  assets: readonly string[]
}

export type StaticIslandOptions<Props extends IslandProps> = {
  key?: readonly (keyof Props & string)[]
}

export type StaticIslandFactory<Props extends IslandProps> = IslandFactory<Props>
