import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { context } from 'esbuild'
import type { BuildContext, Plugin } from 'esbuild'

export type IslandEntry = {
  entry: string
  /** File under the module asset directory, for a production build. */
  output?: string
}

export type IslandBuildConfig = {
  islands: Readonly<Record<string, IslandEntry>>
  /** Project-relative files or directories used exclusively by browser code. */
  browserOnly?: readonly string[]
}

/** A missing dependency graph, or a resolution change, invalidates that build. */
export function affectedIslandBuilds<Name>(
  inputs: ReadonlyMap<Name, ReadonlySet<string> | undefined>,
  changed: ReadonlySet<string>,
  resolutionChanged = false,
): Name[] {
  const paths = [...changed]
  return [...inputs].flatMap(([name, files]) =>
    resolutionChanged || !files || paths.some((path) => files.has(path)) ? [name] : [],
  )
}

const projectPath = (root: string, path: string): string => {
  const absolute = resolve(root, path)
  const local = relative(root, absolute)
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error(`Island build path must be inside the project: ${path}`)
  return absolute
}

const sharedRuntime: Plugin = {
  name: 'ket-shared-view-runtime',
  setup(build) {
    build.onResolve({ filter: /^@ketvietlab\/ketjs-view(?:\/jsx-runtime)?$/ }, ({ path }) => ({
      path: path.endsWith('/jsx-runtime') ? '/_ket/view/jsx-runtime.js' : '/_ket/view/index.js',
      external: true,
    }))
  },
}

/** Keeps a distinct esbuild graph and rebuild context for each island. */
export async function createIslandCompiler(
  root: string,
  config: IslandBuildConfig,
  { production = false }: { production?: boolean } = {},
): Promise<{
  build(changed: ReadonlySet<string>, resolutionChanged?: boolean): Promise<ReadonlyMap<string, Uint8Array>>
  close(): Promise<void>
}> {
  if (!config?.islands || typeof config.islands !== 'object' || Array.isArray(config.islands))
    throw new Error('ket.dev.json must declare an islands object')
  const contexts = new Map<string, { context: BuildContext; output?: string }>()
  const inputs = new Map<string, ReadonlySet<string> | undefined>()
  const close = async () => {
    await Promise.all([...contexts.values()].map(({ context }) => context.dispose()))
  }
  try {
    for (const [name, definition] of Object.entries(config.islands)) {
      if (!/^[\w][\w.:-]*$/u.test(name)) throw new Error(`Invalid island build name: ${name}`)
      if (typeof definition?.entry !== 'string') throw new Error(`Island "${name}" requires an entry path`)
      const entry = projectPath(root, definition.entry)
      const output = definition.output && projectPath(root, definition.output)
      if (production && !output) throw new Error(`Island "${name}" requires output for a production build`)
      if (production && output === entry) throw new Error(`Island "${name}" cannot overwrite its entry`)
      if (production && [...contexts.values()].some((existing) => existing.output === output))
        throw new Error(`More than one island writes ${output}`)
      const compiler = await context({
        absWorkingDir: root,
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        jsxImportSource: '@ketvietlab/ketjs-view',
        plugins: [sharedRuntime],
        metafile: true,
        write: false,
        minify: production,
        logLevel: 'silent',
      })
      contexts.set(name, { context: compiler, ...(output ? { output } : {}) })
      inputs.set(name, undefined)
    }
  } catch (error) {
    await close()
    throw error
  }
  return {
    async build(changed, resolutionChanged) {
      const built = new Map<string, Uint8Array>()
      const next = new Map<string, ReadonlySet<string>>()
      for (const name of affectedIslandBuilds(inputs, changed, resolutionChanged)) {
        const build = contexts.get(name)
        if (!build) throw new Error(`Unknown island build: ${name}`)
        const result = await build.context.rebuild()
        if (result.outputFiles?.length !== 1 || !result.metafile)
          throw new Error(`Island "${name}" must compile to a single JavaScript file`)
        built.set(name, result.outputFiles[0]!.contents)
        next.set(name, new Set(Object.keys(result.metafile.inputs).map((path) => resolve(root, path))))
      }
      if (production) {
        for (const [name, bytes] of built) {
          const output = contexts.get(name)?.output as string
          await mkdir(dirname(output), { recursive: true })
          await writeFile(output, bytes)
        }
      }
      for (const [name, files] of next) inputs.set(name, files)
      return built
    },
    close,
  }
}
