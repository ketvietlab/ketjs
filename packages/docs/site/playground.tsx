import { createCodeEditor } from './code-editor.ts'
import { Button, Select, Text, Surface, WorkspacePage } from '@ketvietlab/design-system'
import type { IslandFactory } from '@ketvietlab/ketjs-view'
import { presets } from './playground-presets.ts'
import { previewDocument } from './playground-frame.mjs'

type Compiler = typeof import('esbuild-wasm')
let compiler: Promise<Compiler> | undefined
function loadCompiler() {
  const compilerUrl = '/_vendor/playground/compiler.js'
  compiler ??= import(/* @vite-ignore */ compilerUrl)
    .then(async (module: Compiler & { default?: Compiler }) => {
      const engine = module.default ?? module
      await engine.initialize({ wasmURL: '/_vendor/playground/esbuild.wasm', worker: true })
      return engine
    })
    .catch((error) => {
      compiler = undefined
      throw error
    })
  return compiler
}

const playground: IslandFactory<Record<string, never>> = () => ({
  view: () => (
    <main id="main-content" class="playground-main">
      <WorkspacePage
        title="ketjs-view playground"
        body={
          <>
            <div class="playground-intro">
              <p>Edit TSX. Run it with the real ketjs-view runtime. No account required.</p>
              <p class="metadata">
                Browser lab · KetJS 0.2.0 preview · <a href="/learn/">Follow the learning path</a> ·{' '}
                <a href="/learn/server-project/">Run server / database labs locally</a>
              </p>
            </div>
            <div class="playground-toolbar">
              <Select
                id="playground-example"
                name="example"
                label="Example"
                value="counter"
                options={presets.map((p) => ({ value: p.id, label: p.label }))}
              />
              <Button id="playground-run" label="Run code" icon="chevron-right" variant="primary" />
              <Button id="playground-reset" label="Reset example" />
              <a id="playground-lesson" href={presets[0].lesson}>
                Read the lesson →
              </a>
            </div>
            <div class="playground-panes">
              <Surface
                title="Editor · app.tsx"
                body={
                  <div>
                    <div id="playground-code" class="playground-editor">
                      <pre>{presets[0].code}</pre>
                    </div>
                    <p id="playground-code-help" class="metadata">
                      Export a default view factory. Cmd/Ctrl + Enter runs the code. Tab moves to the next
                      control. Undo restores edits after a reset.
                    </p>
                  </div>
                }
              />
              <Surface
                title="Live preview"
                body={
                  <iframe
                    id="playground-preview"
                    title="Isolated ketjs-view preview"
                    sandbox="allow-scripts"
                    referrerpolicy="no-referrer"
                  />
                }
              />
            </div>
            <div class="playground-status">
              <Text as="h2" variant="headingMd">
                Compiler & runtime
              </Text>
              <p id="playground-status" role="status" aria-live="polite">
                Loading the compiler…
              </p>
            </div>
            <noscript>
              The interactive editor needs JavaScript. Every lesson also includes a local project you can run
              with Node 24.
            </noscript>
          </>
        }
      />
    </main>
  ),
  mount: ({ root, lifetime }) => {
    if (!(root instanceof HTMLElement)) return
    const editor = createCodeEditor(
      root.querySelector<HTMLElement>('#playground-code')!,
      presets[0].code,
      () => {
        void run()
      },
    )
    lifetime.addEventListener('abort', () => editor.destroy(), { once: true })
    const selector = root.querySelector<HTMLSelectElement>('#playground-example')!
    const frame = root.querySelector<HTMLIFrameElement>('#playground-preview')!
    const status = root.querySelector<HTMLElement>('#playground-status')!
    const button = root.querySelector<HTMLButtonElement>('#playground-run')!
    const lesson = root.querySelector<HTMLAnchorElement>('#playground-lesson')!
    let nonce = '',
      revision = 0,
      activePreset = 'counter'
    const drafts = new Map<string, string>()
    const previewColors = () => {
      const probe = document.createElement('span')
      probe.style.setProperty('transition', 'none', 'important')
      probe.style.setProperty('animation', 'none', 'important')
      root.append(probe)
      const colors = ['--kv-page-bg', '--kv-text-main', '--kv-border-default', '--kv-accent'].map((token) => {
        probe.style.color = `var(${token})`
        return getComputedStyle(probe).color
      })
      probe.remove()
      return colors
    }
    document.addEventListener(
      'ketjs:theme-change',
      () => {
        frame.contentWindow?.postMessage(
          { source: 'ketjs-playground-theme', nonce, colors: previewColors() },
          '*',
        )
      },
      { signal: lifetime },
    )
    const run = async () => {
      const current = ++revision
      button.disabled = true
      status.textContent = 'Compiling TSX…'
      try {
        const engine = await loadCompiler()
        const result = await engine.transform(editor.getValue(), {
          loader: 'tsx',
          format: 'cjs',
          jsx: 'automatic',
          jsxImportSource: '@ketvietlab/ketjs-view',
          target: 'es2022',
          sourcefile: 'app.tsx',
        })
        if (lifetime.aborted || current !== revision) return
        nonce = crypto.randomUUID()
        const colors = previewColors()
        frame.srcdoc = previewDocument(result.code, {
          runtimeUrl: new URL('/_vendor/playground/runtime.js', location.href).href,
          colors,
          nonce,
        })
        status.textContent = 'Compiled. Starting preview…'
      } catch (error) {
        if (!lifetime.aborted && current === revision)
          status.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        if (!lifetime.aborted && current === revision) button.disabled = false
      }
    }
    root.addEventListener(
      'click',
      (event) => {
        const target = (event.target as Element).closest('button')
        if (target?.id === 'playground-run') void run()
        if (target?.id === 'playground-reset') {
          editor.setValue((presets.find((p) => p.id === selector.value) ?? presets[0]).code)
          void run()
        }
      },
      { signal: lifetime },
    )
    selector.addEventListener(
      'change',
      () => {
        const preset = presets.find((p) => p.id === selector.value) ?? presets[0]
        drafts.set(activePreset, editor.getValue())
        activePreset = preset.id
        editor.setValue(drafts.get(preset.id) ?? preset.code)
        lesson.href = preset.lesson
        void run()
      },
      { signal: lifetime },
    )
    window.addEventListener(
      'message',
      (event) => {
        if (
          event.source !== frame.contentWindow ||
          event.data?.source !== 'ketjs-playground' ||
          event.data.nonce !== nonce ||
          !['error', 'ready'].includes(event.data.type)
        )
          return
        status.textContent = String(event.data.message).slice(0, 4000)
      },
      { signal: lifetime },
    )
    void run()
  },
})
export default playground
