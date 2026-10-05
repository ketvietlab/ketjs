import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { NavigationItem, Checkbox, Tooltip, Button, Avatar } from '@ketvietlab/design-system'
import { renderToString } from '@ketvietlab/ketjs-view'

type Json = Record<string, unknown>

const freePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })

class Cdp {
  private id = 0
  private readonly socket: WebSocket
  private readonly pending = new Map<
    number,
    { resolve: (value: Json) => void; reject: (error: Error) => void }
  >()

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Json
      const held = this.pending.get(Number(message.id))
      if (!held) return
      this.pending.delete(Number(message.id))
      if (message.error) held.reject(new Error(JSON.stringify(message.error)))
      else held.resolve((message.result as Json | undefined) ?? {})
    })
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true })
    })
    return new Cdp(socket)
  }

  send(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close(): void {
    this.socket.close()
  }
}

const waitFor = async (check: () => Promise<boolean>, message: string): Promise<void> => {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check().catch(() => false)) return
    await delay(50)
  }
  throw new Error(message)
}

const evaluate = async <Value>(cdp: Cdp, expression: string): Promise<Value> => {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
  return ((response.result as Json | undefined)?.value ?? null) as Value
}

const appPort = await freePort()
const debugPort = await freePort()
const chromeProfile = await mkdtemp(join(tmpdir(), 'ketjs-design-system-browser-'))
const evidenceDir = await mkdtemp(join(tmpdir(), 'ketjs-design-system-'))
const chromePath =
  process.env.KET_BROWSER_BIN ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
const app = spawn(process.execPath, ['.build/apps/design-system/serve.js'], {
  env: { ...process.env, PORT: String(appPort) },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const browser = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-gpu',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
let diagnostics = ''
for (const process of [app, browser])
  process.stderr.on('data', (chunk: Buffer) => {
    diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-16_384)
  })

let cdp: Cdp | null = null
const results: Json[] = []
try {
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${appPort}/_ket/health`)).ok,
    `Design-system app failed to start: ${diagnostics}`,
  )
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok,
    `Chrome failed to start: ${diagnostics}`,
  )
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: 'PUT',
  })
  assert.equal(targetResponse.ok, true)
  const target = (await targetResponse.json()) as Json
  cdp = await Cdp.connect(String(target.webSocketDebuggerUrl))
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const standaloneNavigation = renderToString(
    NavigationItem({
      id: 'reports',
      label: 'Reports',
      expanded: true,
      children: [
        {
          id: 'finance',
          label: 'Finance',
          expanded: true,
          children: [{ id: 'profit', label: 'Profit', href: '/reports/profit', active: true }],
        },
      ],
    }),
  )
  const standaloneUrl = `data:text/html;charset=utf-8,${encodeURIComponent(standaloneNavigation)}`
  await cdp.send('Page.navigate', { url: standaloneUrl })
  await waitFor(
    () => evaluate<boolean>(cdp!, `document.readyState === 'complete'`),
    'Standalone NavigationItem did not render',
  )
  const standaloneAudit = await evaluate<Json>(
    cdp,
    `(() => ({
      branches: [...document.querySelectorAll('[data-ui="navigation-branch"]')].map((branch) => ({
        name: branch.getAttribute('name'),
        open: branch instanceof HTMLDetailsElement && branch.open,
      })),
      current: document.querySelector('[data-ui="navigation-item"][aria-current="page"]')?.textContent?.trim(),
    }))()`,
  )
  assert.deepEqual(standaloneAudit.branches, [
    { name: 'reports-root-branches', open: true },
    { name: 'reports-branches', open: true },
  ])
  assert.equal(standaloneAudit.current, 'Profit')

  const runtimeFixture = `<form id="inserted-choices">${renderToString(Checkbox({ id: 'inserted-mixed', name: 'all', label: 'All', checked: 'indeterminate' }))}</form><span id="existing-help">Existing description</span>${renderToString(Tooltip({ id: 'inserted-tooltip', text: 'More details', trigger: Button({ label: 'Details', describedBy: 'existing-help' }) }))}${renderToString(Avatar({ name: 'Retry image', src: 'data:image/png;base64,broken' }))}`

  // Primitive normalization: compare actual geometry and exercise native behavior.
  for (const width of [390, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 768,
    })
    const url = `http://127.0.0.1:${appPort}/primitives?theme=light`
    await cdp.send('Page.navigate', { url })
    await waitFor(
      () =>
        evaluate<boolean>(
          cdp!,
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && document.documentElement.dataset.kvInteractions === 'attached'`,
        ),
      'Primitive runtime did not attach',
    )
    await evaluate(cdp, `document.querySelector('[data-ui="avatar-image"]').loading = 'eager'`)
    await waitFor(
      () => evaluate<boolean>(cdp!, `document.querySelector('[data-ui="avatar-image"]').hidden`),
      'Avatar did not fall back after an image error',
    )
    const primitives: Json = await evaluate<Json>(
      cdp,
      `(() => {
      const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { width: r.width, height: r.height } }
      const search = document.getElementById('primitive-search')
      let inputs = 0, changes = 0
      search.addEventListener('input', () => inputs++)
      search.addEventListener('change', () => changes++)
      document.querySelector('[data-ui="field-clear"][aria-controls="primitive-search"]').click()
      const cleared = { value: search.value, focused: document.activeElement === search, inputs, changes }
      const mixed = document.getElementById('primitive-mixed')
      const initiallyMixed = mixed.indeterminate && mixed.getAttribute('aria-checked') === 'mixed'
      mixed.click()
      const choice = document.getElementById('primitive-checked-value')
      const tooltip = document.getElementById('primitive-action-tip').closest('[data-ui="tooltip"]')
      const trigger = tooltip.querySelector('button')
      trigger.focus()
      const tooltipOpen = getComputedStyle(document.getElementById('primitive-action-tip')).visibility
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const tooltipDismissed = getComputedStyle(document.getElementById('primitive-action-tip')).visibility
      const hasDescription = trigger.getAttribute('aria-describedby').split(' ').includes('primitive-action-tip')
      const form = document.getElementById('primitive-tag-form')
      let submitted = null
      form.addEventListener('submit', event => { event.preventDefault(); submitted = [...new FormData(form, event.submitter).entries()] })
      form.querySelector('button').click()
      const affix = document.getElementById('primitive-affix').closest('[data-ui="field-input"]')
      const avatar = document.querySelector('[data-ui="avatar-image"]')
      return {
        rest: rect('primitive-action-rest'), loading: rect('primitive-action-loading'),
        inputHeight: search.getBoundingClientRect().height, affixHeight: affix.getBoundingClientRect().height,
        searchType: search.type, cleared, initiallyMixed, afterMixed: mixed.indeterminate,
        selectedValue: choice.value, selectedChecked: choice.checked,
        tooltipOpen, tooltipDismissed, hasDescription, submitted, avatarFallback: avatar.hidden,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      }
    })()`,
    )
    assert.deepEqual(primitives.rest, primitives.loading, 'loading preserves action geometry')
    assert.equal(primitives.inputHeight, width < 768 ? 36 : 32)
    assert.equal(primitives.affixHeight, width < 768 ? 36 : 32)
    assert.equal(primitives.searchType, 'search')
    assert.deepEqual(primitives.cleared, { value: '', focused: true, inputs: 1, changes: 1 })
    assert.equal(primitives.initiallyMixed, true)
    assert.equal(primitives.afterMixed, false)
    assert.equal(primitives.selectedValue, 'warehouse-a')
    assert.equal(primitives.selectedChecked, true)
    assert.equal(primitives.tooltipOpen, 'visible')
    assert.equal(primitives.tooltipDismissed, 'hidden')
    assert.equal(primitives.hasDescription, true)
    assert.deepEqual(primitives.submitted, [['remove', 'warehouse-a']])
    assert.equal(primitives.avatarFallback, true)
    assert.equal(primitives.horizontalOverflow, false)
    for (const theme of ['light', 'dark']) {
      const contrast: number[] = await evaluate<number[]>(
        cdp,
        `(async () => {
        document.querySelector('[data-kv-design-system]').setAttribute('data-theme', '${theme}')
        // Read the settled theme colors after the action background transition.
        await new Promise(resolve => setTimeout(resolve, 200))
        const luminance = color => {
          const values = color.match(/[0-9.]+/g).slice(0,3).map(Number).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
        }
        return [...document.querySelectorAll('[data-ui="action"][data-variant="primary"]:is([data-tone="danger"], [data-tone="positive"])')].map(button => {
          const style = getComputedStyle(button), foreground = luminance(style.color), background = luminance(style.backgroundColor)
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        })
      })()`,
      )
      assert.equal(contrast.length, 2)
      for (const ratio of contrast) assert.ok(ratio >= 4.5, `${theme} status action contrast ${ratio}`)
    }
    await evaluate(
      cdp,
      `document.querySelector('[data-kv-design-system]').setAttribute('data-theme', 'light')`,
    )
    const inserted: Json = await evaluate<Json>(
      cdp,
      `(async () => {
      const host = document.createElement('section')
      host.innerHTML = ${JSON.stringify(runtimeFixture)}
      document.querySelector('[data-ui="primitive-harness"]').append(host)
      await new Promise(resolve => setTimeout(resolve, 0))
      const input = host.querySelector('input')
      const initiallyMixed = input.indeterminate
      input.click()
      input.click()
      const ariaMatches = input.getAttribute('aria-checked') === String(input.checked)
      input.form.reset()
      await new Promise(resolve => setTimeout(resolve, 0))
      const resetMixed = input.indeterminate && input.getAttribute('aria-checked') === 'mixed'
      const description = host.querySelector('[data-ui="tooltip"] button').getAttribute('aria-describedby')
      const image = host.querySelector('img')
      const loaded = new Promise(resolve => image.addEventListener('load', resolve, { once: true }))
      image.loading = 'eager'
      image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32"/%3E%3C/svg%3E'
      await loaded
      const imageRecovered = !image.hidden
      host.remove()
      return { initiallyMixed, ariaMatches, resetMixed, description, imageRecovered }
    })()`,
    )
    assert.deepEqual(inserted, {
      initiallyMixed: true,
      ariaMatches: true,
      resetMixed: true,
      description: 'existing-help inserted-tooltip',
      imageRecovered: true,
    })
    results.push({ kind: 'primitive-normalization', width, primitives, inserted })
    await evaluate(cdp, `document.getElementById('primitive-fields').scrollIntoView()`)
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const path = join(evidenceDir, `primitives-fields-${width}.png`)
    await writeFile(path, Buffer.from(String(capture.data), 'base64'))
    results.push({ kind: 'primitive-screenshot', width, path })
  }

  // Pinned upstream dimensions, independent of Két token values. Test actual
  // border boxes (including icon/loading content), responsive boundary and all
  // density/presentation/theme combinations so composition cannot silently drift.
  const reference = JSON.parse(await readFile('test/fixtures/polaris-dimensions.json', 'utf8'))
  for (const width of [390, 767, 768, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 768,
    })
    for (const presentation of ['default', 'grouped']) {
      const url = `http://127.0.0.1:${appPort}/layering?presentation=${presentation}`
      await cdp.send('Page.navigate', { url })
      await waitFor(
        () =>
          evaluate<boolean>(
            cdp!,
            `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(document.querySelector('[data-layering-case="dimensions"]'))`,
          ),
        `Dimension specimens did not render: ${width}/${presentation}`,
      )
      for (const theme of ['light', 'dark']) {
        const measured: Json[] = await evaluate<Json[]>(
          cdp,
          `(() => {
          document.querySelector('[data-kv-design-system]').setAttribute('data-theme', '${theme}');
          const geometry = el => {
            const s = getComputedStyle(el);
            return [el.getBoundingClientRect().height, s.fontSize, s.lineHeight, s.paddingTop, s.paddingRight, s.borderRadius].map(parseFloat);
          };
          return [...document.querySelectorAll('[data-dimension-density]')].map(root => ({
            density: root.getAttribute('data-density'),
            body: [getComputedStyle(root).fontSize, getComputedStyle(root).lineHeight].map(parseFloat),
            input: geometry(root.querySelector('[data-ui="field-control"]')),
            searchInput: geometry(root.querySelector('[data-ui="search-bar"] input[type="search"]')),
            nativeInputs: [...document.querySelectorAll('[data-layering-case="canvas-surface"] [data-ui="field-control"]')].map(geometry),
            buttons: [...root.querySelectorAll('[data-ui="action"]:not([data-size="compact"]):not([data-icon-only="true"])')].map(geometry),
            compact: geometry(root.querySelector('[data-size="compact"]')),
            iconHeight: root.querySelector('[data-icon-only="true"]').getBoundingClientRect().height,
            gap: parseFloat(getComputedStyle(root.querySelector('[data-ui="inline"]')).gap),
            rowHeight: parseFloat(getComputedStyle(root).getPropertyValue('--kv-row-height')) * 16,
          }));
        })()`,
        )
        const expected = width < 768 ? reference.mobile : reference.desktop
        for (const actual of measured) {
          const label: string = `${width}/${presentation}/${theme}/${actual.density}`
          assert.deepEqual(actual.body, expected.body, `${label}: body type`)
          assert.deepEqual(actual.input, expected.input, `${label}: input geometry`)
          assert.deepEqual(actual.searchInput, expected.input, `${label}: SearchBar input/button alignment`)
          for (const input of actual.nativeInputs as number[][])
            assert.deepEqual(input, expected.input, `${label}: native text/date input geometry`)
          for (const button of actual.buttons as number[][])
            assert.deepEqual(button, expected.button, `${label}: button geometry and input alignment`)
          assert.deepEqual(actual.compact, expected.compactButton, `${label}: compact button`)
          assert.equal(actual.iconHeight, expected.button[0], `${label}: icon button height`)
          assert.equal(actual.gap, reference.spacing.actions, `${label}: action gap`)
          if (width >= 768) assert.equal(actual.rowHeight, 40, `${label}: ERP desktop rows stay dense`)
        }
        results.push({ kind: 'polaris-dimensions', width, presentation, theme, measured })
        if (presentation === 'default' && theme === 'light' && (width === 390 || width === 1440)) {
          const capture = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
          })
          const path = join(evidenceDir, `polaris-dimensions-${width}.png`)
          await writeFile(path, Buffer.from(String(capture.data), 'base64'))
          results.push({ kind: 'polaris-dimensions-screenshot', width, path })
        }
      }
    }
  }

  // Két Design System visual contract L1–L2, by computed style: a container is framed on the canvas and
  // flat inside a white region; objects keep their boundary everywhere.
  for (const presentation of ['default', 'grouped'] as const) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
    const url = `http://127.0.0.1:${appPort}/layering?presentation=${presentation}`
    await cdp.send('Page.navigate', { url })
    await waitFor(
      () =>
        evaluate<boolean>(
          cdp!,
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(document.querySelector('[data-layering-case="modal-strip"]'))`,
        ),
      `Layering did not render (${presentation})`,
    )
    const layering: Record<string, Record<string, string> | null> = await evaluate(
      cdp,
      `(() => {
        const frame = (element) => {
          if (!element) return null
          const style = getComputedStyle(element)
          return { border: style.borderTopWidth, radius: style.borderTopLeftRadius, fill: style.backgroundColor, padding: style.paddingTop }
        }
        const at = (name, selector) => document.querySelector('[data-layering-case="' + name + '"] ' + selector)
        const size = (element) => element && getComputedStyle(element).fontSize
        const cells = [...document.querySelectorAll('[data-layering-case="modal-strip"] [data-ui="key-value"]')]
        const labels = (name) =>
          [...document.querySelectorAll('[data-layering-case="' + name + '"] [data-ui="field"]')]
            .map((field) => {
              const label = field.querySelector('[data-ui="field-label"]').getBoundingClientRect()
              const control = field.querySelector('[data-ui="field-control"]').getBoundingClientRect()
              return control.top >= label.bottom - 1 ? 'above' : 'beside'
            })
            .join(',')
        return {
          alignment: {
            columns: String(new Set([...document.querySelectorAll('[data-layering-case="single-column-form"] [data-ui="field-control"]')].map(el => el.getBoundingClientRect().left)).size),
          },
          rhythm: {
            gutter: getComputedStyle(document.querySelector('[data-kv-design-system]')).paddingLeft,
            groups: getComputedStyle(document.querySelector('[data-kv-design-system] > [data-ui="stack"]')).rowGap,
            row: String(at('canvas-table', '[data-ui="row"]').getBoundingClientRect().height),
            formRows: getComputedStyle(at('single-column-form', '[data-ui="form-grid"]')).rowGap,
            formColumns: getComputedStyle(at('single-column-form', '[data-ui="form-grid"]')).columnGap,
            surface: getComputedStyle(at('canvas-surface', '[data-ui="surface"]')).paddingLeft,
            table: getComputedStyle(at('canvas-table', '[data-ui="surface"]')).paddingLeft,
            heading: getComputedStyle(at('canvas-surface', '[data-ui="surface-head"]')).marginBottom,
            modal: getComputedStyle(at('modal', '[data-ui="modal-body"]')).paddingLeft,
          },
          canvasSurface: frame(at('canvas-surface', '[data-ui="surface"]')),
          canvasTable: frame(at('canvas-table', '[data-ui="surface"]')),
          canvasMetric: frame(at('canvas-metric', '[data-ui="metric"]')),
          outer: frame(at('surface-in-surface', '[data-ui="surface"]')),
          inner: frame(at('surface-in-surface', '[data-ui="surface"] [data-ui="surface"]')),
          modalTable: frame(at('modal-table', '[data-ui="surface"]')),
          modalTableScroll: frame(at('modal-untitled-table', '[data-ui="table-scroll"]')),
          modalSurface: frame(at('modal-surface', '[data-ui="surface"]')),
          modalWell: frame(at('modal-well', '[data-ui="surface"]')),
          modalDisclosure: frame(at('modal-disclosure', '[data-ui="disclosure"]')),
          modalMetric: frame(at('modal-metric', '[data-ui="metric"]')),
          modalCard: frame(at('modal-card', '[data-ui="content-card"]')),
          dividedFirst: frame(at('modal-divided', '[data-ui="stack"] > :first-child')),
          dividedSecond: frame(at('modal-divided', '[data-ui="stack"] > :nth-child(2)')),
          titles: {
            canvas: size(at('canvas-surface', '[data-ui="surface-title"]')),
            nested: size(at('surface-in-surface', '[data-ui="surface"] [data-ui="surface"] [data-ui="surface-title"]')),
            modalTable: size(at('modal-table', '[data-ui="surface-title"]')),
            section: size(at('modal-section', '[data-ui="section-title"]')),
            item: size(at('modal-item', '[data-ui="section"] [data-ui="section"] [data-ui="section-title"]')),
          },
          forms: { wide: labels('wide-form'), narrow: labels('narrow-form'), panel: labels('narrow-panel') },
          strip: {
            borders: cells.map((cell) => getComputedStyle(cell).borderInlineStartWidth).join(','),
            rows: String(new Set(cells.map((cell) => cell.offsetTop)).size),
          },
        }
      })()`,
    )
    assert.equal(layering.alignment?.columns, '1', `${presentation}: single-column controls share one edge`)
    assert.deepEqual(
      layering.rhythm,
      {
        gutter: '24px',
        groups: '16px',
        row: '40',
        formRows: '16px',
        formColumns: '24px', // Két form policy; the Polaris reference fixture remains 12px.
        surface: '16px',
        table: '16px',
        heading: '8px',
        modal: '16px',
      },
      `${presentation}: page, surface, table and modal share the rhythm contract`,
    )
    const transparent = 'rgba(0, 0, 0, 0)'
    for (const name of ['canvasSurface', 'canvasTable', 'canvasMetric', 'outer', 'modalCard']) {
      assert.equal(layering[name]?.border, '1px', `${presentation}: ${name} keeps its frame`)
      assert.notEqual(layering[name]?.fill, transparent, `${presentation}: ${name} keeps its fill`)
    }
    for (const name of [
      'inner',
      'modalTable',
      'modalTableScroll',
      'modalSurface',
      'modalDisclosure',
      'modalMetric',
    ]) {
      assert.equal(
        layering[name]?.border,
        '0px',
        `${presentation}: ${name} has no border inside a white region`,
      )
      assert.equal(
        layering[name]?.radius,
        '0px',
        `${presentation}: ${name} has no radius inside a white region`,
      )
      assert.equal(
        layering[name]?.fill,
        transparent,
        `${presentation}: ${name} has no fill inside a white region`,
      )
    }
    for (const name of ['inner', 'modalTable', 'modalSurface', 'modalMetric'])
      assert.equal(layering[name]?.padding, '0px', `${presentation}: ${name} adds no inset of its own`)
    assert.equal(layering.modalWell?.border, '0px', `${presentation}: a well has no border`)
    assert.notEqual(layering.modalWell?.fill, transparent, `${presentation}: a well keeps its tint`)
    assert.equal(layering.dividedFirst?.border, '0px', `${presentation}: no divider above the first group`)
    assert.equal(layering.dividedSecond?.border, '1px', `${presentation}: a divider between groups`)
    const titles = layering.titles ?? {}
    assert.equal(titles.canvas, '14px', `${presentation}: surface headingMd`)
    assert.equal(titles.section, '14px', `${presentation}: a modal group heading is headingMd`)
    assert.equal(titles.item, '13px', `${presentation}: an item heading nested in a group is headingSm`)
    assert.equal(titles.nested, titles.item, `${presentation}: a nested surface title is an item heading`)
    assert.equal(
      titles.modalTable,
      titles.section,
      `${presentation}: a table title in a modal is a group heading`,
    )
    assert.equal(titles.canvas, titles.section, `${presentation}: a group heading matches the surface title`)
    assert.ok(
      Number.parseFloat(titles.section) > Number.parseFloat(titles.item),
      `${presentation}: group heading above item heading`,
    )
    assert.deepEqual(layering.strip, { borders: '0px,1px,1px', rows: '1' }, `${presentation}: metadata strip`)
    assert.deepEqual(
      layering.forms,
      { wide: 'beside,beside', narrow: 'above,above', panel: 'above,above' },
      `${presentation}: from tablet width a label sits beside its control, and above it in a narrow column`,
    )
  }

  // Két Design System visual contract L7 below tablet width: every label goes above its control, the wide
  // form's included.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  {
    const url = `http://127.0.0.1:${appPort}/layering?presentation=default`
    await cdp.send('Page.navigate', { url })
    await waitFor(
      () =>
        evaluate<boolean>(
          cdp!,
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(document.querySelector('[data-layering-case="modal-strip"]'))`,
        ),
      'Layering did not render (mobile)',
    )
    const mobileForms = await evaluate<Record<string, string>>(
      cdp,
      `(() => {
        const labels = (name) =>
          [...document.querySelectorAll('[data-layering-case="' + name + '"] [data-ui="field"]')]
            .map((field) => {
              const label = field.querySelector('[data-ui="field-label"]').getBoundingClientRect()
              const control = field.querySelector('[data-ui="field-control"]').getBoundingClientRect()
              return control.top >= label.bottom - 1 ? 'above' : 'beside'
            })
            .join(',')
        return { wide: labels('wide-form'), panel: labels('narrow-panel') }
      })()`,
    )
    assert.deepEqual(
      mobileForms,
      { wide: 'above,above', panel: 'above,above' },
      'mobile: every label sits above its control',
    )
  }

  const viewports = [
    { key: 'desktop', width: 1440, height: 1000, mobile: false },
    { key: 'mobile', width: 390, height: 844, mobile: true },
  ] as const
  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    })
    const url = `http://127.0.0.1:${appPort}/inventory?scope=all&kind=all&decision=all`
    await cdp.send('Page.navigate', { url })
    await waitFor(
      () =>
        evaluate<boolean>(
          cdp!,
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(document.querySelector('[data-ui="inventory-page"]'))`,
        ),
      `Inventory did not render at ${viewport.key}`,
    )
    const audit: Json = await evaluate<Json>(
      cdp,
      `(() => {
        const controls = [...document.querySelectorAll('input, select, button')]
        const unnamed = controls.filter((control) => {
          const id = control.getAttribute('id')
          const explicit = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null
          return !String(control.getAttribute('aria-label') || explicit?.textContent || control.closest('label')?.textContent || control.textContent).trim()
        })
        return {
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          unnamedControls: unnamed.length,
          mainCount: document.querySelectorAll('main, [role="main"]').length,
          navItems: document.querySelectorAll('[data-ui="inventory-nav"] a').length,
          rows: document.querySelectorAll('[data-ui="inventory-table"] tbody tr').length,
          localTableOverflow: document.querySelector('[data-ui="inventory-table-wrap"]')?.scrollWidth > document.querySelector('[data-ui="inventory-table-wrap"]')?.clientWidth,
          text: document.body.innerText,
        }
      })()`,
    )
    assert.equal(audit.horizontalOverflow, false, `${viewport.key} page overflows horizontally`)
    assert.equal(audit.unnamedControls, 0, `${viewport.key} has unnamed controls`)
    assert.equal(audit.mainCount, 1, `${viewport.key} must have one main landmark`)
    assert.equal(audit.navItems, 3, `${viewport.key} documentation navigation changed`)
    assert.ok(Number(audit.rows) >= 350, `${viewport.key} inventory rows are incomplete`)
    const inventory = JSON.parse(
      await readFile('packages/design-system/src/catalogue/inventory.generated.json', 'utf8'),
    )
    assert.match(
      String(audit.text),
      new RegExp(`Public exports[\\s\\S]*${inventory.summary.publicExports}`, 'u'),
    )
    assert.match(String(audit.text), /Planned catalog[\s\S]*0/u)
    if (viewport.mobile) assert.equal(audit.localTableOverflow, false)

    for (const position of ['top', 'registry'] as const) {
      await evaluate(
        cdp,
        position === 'top'
          ? 'scrollTo({ top: 0, behavior: "instant" })'
          : 'document.querySelector("#registry").scrollIntoView({ block: "start" })',
      )
      await delay(100)
      const captured: Json = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      const bytes: Buffer = Buffer.from(String(captured.data), 'base64')
      assert.ok(bytes.length > 10_000, `${viewport.key}/${position} screenshot is too small`)
      const path = join(evidenceDir, `inventory-${viewport.key}-${position}.png`)
      await writeFile(path, bytes)
      results.push({
        viewport: viewport.key,
        position,
        width: viewport.width,
        height: viewport.height,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        path,
      })
    }
  }

  // Navigation owns optional slots, readable labels and the exact drawer boundary.
  for (const width of [390, 767, 768, 1440]) {
    for (const theme of ['light', 'dark']) {
      const mobile = width < 768
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      })
      const url = `http://127.0.0.1:${appPort}/components/application-structure?theme=${theme}&density=default`
      await cdp.send('Page.navigate', { url })
      await waitFor(
        () =>
          evaluate<boolean>(
            cdp!,
            `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && document.documentElement.dataset.kvInteractions === 'attached'`,
          ),
        'Navigation fixture did not attach',
      )
      const menu: Json = await evaluate<Json>(
        cdp,
        `(async () => {
        const example = document.querySelector('#app-navigation')
        const shell = example.querySelector('[data-ui="app-shell"]')
        const nav = example.querySelector('[data-ui="app-navigation"]')
        const toggle = example.querySelector('[data-ui="navigation-toggle"]')
        const drawer = nav.querySelector('[data-ui="navigation-drawer"]')
        const close = nav.querySelector('[data-ui="navigation-close"]')
        const backdrop = nav.querySelector('[data-ui="navigation-backdrop"]')
        if (${mobile}) { toggle.focus(); toggle.click() }
        const report = nav.querySelector('[data-ui="navigation-branch"]')
        report.querySelector('summary').click()
        report.querySelector('[data-ui="navigation-branch"] summary').click()
        await new Promise(resolve => setTimeout(resolve, 0))
        const root = report.querySelector('summary')
        const child = report.querySelector('[data-ui="navigation-item"]')
        const plain = report.querySelector('[href="#navigation-terms"]')
        const long = report.querySelector('[href="#navigation-long"]')
        const copy = plain.querySelector('[data-ui="navigation-item-copy"]')
        const plainStyle = getComputedStyle(plain)
        const icon = report.querySelector('[data-ui="icon"]')
        const iconBefore = icon.getBoundingClientRect().width
        nav.style.setProperty('--kv-text-xl', '32px')
        const iconAfter = icon.getBoundingClientRect().width
        nav.style.removeProperty('--kv-text-xl')
        const count = child.querySelector('[data-ui="navigation-item-count"]')
        const childCopy = child.querySelector('[data-ui="navigation-item-copy"]')
        const rootLabel = root.querySelector('[data-ui="navigation-item-label"]')
        const childLabel = child.querySelector('[data-ui="navigation-item-label"]')
        const childBranchLabel = report.querySelector('[data-ui="navigation-branch"] [data-ui="navigation-item-label"]')
        const box = e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })
        const text = e => { const s = getComputedStyle(e); return [s.fontSize, s.lineHeight, s.fontWeight] }
        const audit = {
          rootType: text(root), childType: text(child), rootHeight: box(root).height, childHeight: box(child).height,
          primaryRoot: getComputedStyle(root).color === getComputedStyle(shell).color,
          secondaryChild: getComputedStyle(child).color !== getComputedStyle(root).color,
          plainUnusedWidth: plain.getBoundingClientRect().right - parseFloat(plainStyle.paddingRight) - parseFloat(plainStyle.borderRightWidth) - copy.getBoundingClientRect().right,
          countGap: count.getBoundingClientRect().left - childCopy.getBoundingClientRect().right,
          childAlignment: childLabel.getBoundingClientRect().left - rootLabel.getBoundingClientRect().left,
          nestedIndent: copy.getBoundingClientRect().left - childBranchLabel.getBoundingClientRect().left,
          wrapped: long.querySelector('[data-ui="navigation-item-label"]').getBoundingClientRect().height > 20,
          clipped: [...report.querySelectorAll('[data-ui="navigation-item-label"]')].some(e => e.scrollWidth > e.clientWidth + 1),
          iconBefore, iconAfter, toggle: box(toggle), close: box(close), backdrop: box(backdrop), viewportHeight: innerHeight, viewportWidth: innerWidth,
          drawerRole: drawer.getAttribute('role'), mainInert: shell.querySelector('[data-ui="app-main"]').inert,
        }
        if (${mobile}) {
          close.click()
          audit.closed = !nav.open && !shell.querySelector('[data-ui="app-main"]').inert && document.activeElement === toggle
          toggle.focus(); toggle.click()
          await new Promise(resolve => setTimeout(resolve, 0))
          drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          audit.escapeClosed = !nav.open && document.activeElement === toggle
          toggle.focus(); toggle.click()
          await new Promise(resolve => setTimeout(resolve, 0))
          backdrop.click()
          audit.backdropClosed = !nav.open && document.activeElement === toggle
          if (${width} === 767) { toggle.focus(); toggle.click(); await new Promise(resolve => setTimeout(resolve, 0)) }
        }
        return audit
      })()`,
      )
      assert.equal(menu.viewportWidth, width, 'Measure at the requested CSS viewport width')
      assert.deepEqual(menu.rootType, ['14px', '20px', '500'])
      assert.deepEqual(menu.childType, ['13px', '20px', '400'])
      assert.equal(menu.rootHeight, mobile ? 44 : 30)
      assert.equal(menu.childHeight, mobile ? 44 : 28)
      assert.equal(menu.primaryRoot, true)
      assert.equal(menu.secondaryChild, true)
      assert.ok(Math.abs(Number(menu.plainUnusedWidth)) < 1, 'Absent slots must not consume label width')
      assert.equal(menu.countGap, 10)
      assert.equal(menu.childAlignment, 0)
      assert.equal(menu.nestedIndent, 20)
      assert.equal(menu.wrapped, true)
      assert.equal(menu.clipped, false)
      assert.equal(menu.iconBefore, 20)
      assert.equal(menu.iconAfter, 20, 'Text tokens must not resize icons')
      assert.equal(menu.drawerRole, mobile ? 'dialog' : null)
      assert.equal(menu.mainInert, mobile)
      if (mobile) {
        assert.deepEqual(menu.toggle, { width: 44, height: 44 })
        assert.deepEqual(menu.close, { width: 44, height: 44 })
        assert.equal(menu.closed, true)
        assert.equal(menu.escapeClosed, true)
        assert.equal(menu.backdropClosed, true)
        assert.ok(Number((menu.backdrop as Json).width) > 0)
        assert.ok(
          Math.abs(Number((menu.backdrop as Json).height) - Number(menu.viewportHeight)) <= 1,
          'Backdrop must cover the actual layout viewport',
        )
      }
      if (width === 767) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: 768,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        })
        await waitFor(
          () =>
            evaluate<boolean>(
              cdp!,
              `(() => {
          const example = document.querySelector('#app-navigation')
          return getComputedStyle(example.querySelector('[data-ui="navigation-toggle"]')).display === 'none' &&
            example.querySelector('[data-ui="navigation-drawer"]').getAttribute('role') === null &&
            !example.querySelector('[data-ui="app-main"]').inert && document.documentElement.dataset.kvNavigationOpen !== 'true'
        })()`,
            ),
          'Crossing 768px must release the drawer and background',
        )
      }
      results.push({ route: 'navigation-sizing', width, theme, ...menu })
    }
  }

  const reviewRoutes = [
    { key: 'catalogue-en', path: '/?theme=light&density=default', selector: '[data-ui="catalogue"]' },
    {
      key: 'application-structure-en',
      path: '/components/application-structure?theme=light&density=default',
      selector: '#application-structure',
    },
    {
      key: 'interactions-en',
      path: '/components/interactions?theme=light&density=default',
      selector: '#interactions',
    },
    {
      key: 'form-controls-en',
      path: '/components/form-controls?theme=light&density=default',
      selector: '#form-controls',
    },
    {
      key: 'data-operations-en',
      path: '/components/data-operations?theme=light&density=compact',
      selector: '#data-operations',
    },
    {
      key: 'record-workspace-en',
      path: '/components/record-workspace?theme=light&density=default',
      selector: '#record-workspace',
    },
    { key: 'list-en', path: '/surfaces?kind=list&lang=en&theme=light', selector: '[data-ui="list-page"]' },
    { key: 'list-vi', path: '/surfaces?kind=list&lang=vi&theme=light', selector: '[data-ui="list-page"]' },
    {
      key: 'record-en',
      path: '/surfaces?kind=record&lang=en&theme=light',
      selector: '[data-ui="record-page"]',
    },
    {
      key: 'record-vi',
      path: '/surfaces?kind=record&lang=vi&theme=light',
      selector: '[data-ui="record-page"]',
    },
    {
      key: 'workspace-en',
      path: '/surfaces?kind=flow&lang=en&theme=light',
      selector: '[data-pattern="workspace"]',
    },
    {
      key: 'workspace-vi',
      path: '/surfaces?kind=flow&lang=vi&theme=light',
      selector: '[data-pattern="workspace"]',
    },
    { key: 'connected-demo-vi', path: '/demo?theme=light', selector: '[data-ui="app-shell"]' },
    { key: 'connected-demo-dark-vi', path: '/demo?theme=dark', selector: '[data-ui="app-shell"]' },
    {
      key: 'submenu-demo-vi',
      path: '/demo2?theme=light',
      selector: '[data-ui="navigation-branch"][data-level="1"][open]',
    },
    {
      key: 'submenu-demo-crm-vi',
      path: '/demo2?theme=light&module=crm&child=1',
      selector:
        '[data-ui="navigation-branch"][data-level="2"][open] [data-ui="navigation-item"][aria-current="page"]',
    },
    {
      key: 'connected-demo-record-vi',
      path: '/demo?theme=light&view=record&id=SO-1041',
      selector: '[data-ui="record-page-layout"]',
    },
  ] as const
  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    })
    for (const review of reviewRoutes) {
      const url = `http://127.0.0.1:${appPort}${review.path}`
      await cdp.send('Page.navigate', { url })
      await waitFor(
        () =>
          evaluate<boolean>(
            cdp!,
            `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(review.selector)}))`,
          ),
        `${review.key} did not render at ${viewport.key}`,
      )
      const audit: Json = await evaluate<Json>(
        cdp,
        `(() => ({
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          mainCount: document.querySelectorAll('main, [role="main"]').length,
          title: document.title,
          textLength: document.body.innerText.length,
        }))()`,
      )
      assert.equal(
        audit.horizontalOverflow,
        false,
        `${review.key}/${viewport.key} page overflows horizontally`,
      )
      assert.equal(audit.mainCount, 1, `${review.key}/${viewport.key} must have one main landmark`)
      assert.ok(Number(audit.textLength) > 100, `${review.key}/${viewport.key} content is incomplete`)
      if (review.key === 'connected-demo-dark-vi') {
        const themeAudit: Json = await evaluate<Json>(
          cdp,
          `(() => {
            const root = document.querySelector('[data-demo-app]')
            const main = document.querySelector('[data-ui="app-main"]')
            return {
              theme: root?.getAttribute('data-theme'),
              rootScheme: root instanceof HTMLElement ? getComputedStyle(root).colorScheme : null,
              mainScheme: main instanceof HTMLElement ? getComputedStyle(main).colorScheme : null,
            }
          })()`,
        )
        assert.equal(themeAudit.theme, 'dark')
        assert.equal(themeAudit.rootScheme, 'dark')
        assert.equal(themeAudit.mainScheme, 'dark')
      }
      if (review.key === 'submenu-demo-vi' || review.key === 'submenu-demo-crm-vi') {
        const submenuAudit: Json = await evaluate<Json>(
          cdp,
          `(() => {
            const navigation = document.querySelector('[data-navigation-id="enterprise-navigation"]')
            const mobileTrigger = navigation?.querySelector(':scope > [data-ui="navigation-trigger"]')
            if (${JSON.stringify(viewport.key)} === 'mobile' && navigation instanceof HTMLDetailsElement && !navigation.open)
              mobileTrigger?.click()
            const topBranches = [...document.querySelectorAll('[data-ui="navigation-branch"][data-level="1"]')]
            const overview = topBranches[0]
            const crm = topBranches[1]
            const inventory = topBranches[5]
            const crmTrigger = crm?.querySelector(':scope > [data-ui="navigation-branch-trigger"]')
            if (crm instanceof HTMLDetailsElement && !crm.open) crmTrigger?.click()
            const children = crm?.querySelector(':scope > [data-ui="navigation-children"]')
            const childBranch = children?.querySelector(':scope > [data-ui="navigation-branch"]')
            const childTrigger = childBranch?.querySelector(':scope > [data-ui="navigation-branch-trigger"]')
            if (childBranch instanceof HTMLDetailsElement && !childBranch.open) childTrigger?.click()
            const triggerRect = crmTrigger instanceof HTMLElement ? crmTrigger.getBoundingClientRect() : null
            const childrenRect = children instanceof HTMLElement ? children.getBoundingClientRect() : null
            crmTrigger?.click()
            const resistsCollapse = crm instanceof HTMLDetailsElement && crm.open
            inventory?.querySelector(':scope > [data-ui="navigation-branch-trigger"]')?.click()
            const globalAccordion =
              inventory instanceof HTMLDetailsElement && inventory.open &&
              crm instanceof HTMLDetailsElement && !crm.open
            crmTrigger?.click()
            return {
              topBranches: topBranches.length,
              openTopBranches: topBranches.filter((branch) => branch instanceof HTMLDetailsElement && branch.open).length,
              crmOpen: crm instanceof HTMLDetailsElement && crm.open,
              overviewClosed: overview instanceof HTMLDetailsElement && !overview.open,
              resistsCollapse,
              globalAccordion,
              branchIndicators: document.querySelectorAll('[data-ui="navigation-branch-indicator"]').length,
              activeBranches: document.querySelectorAll('[data-ui="navigation-branch"][data-active="true"]').length,
              directChildren: children?.querySelectorAll(':scope > [data-ui="navigation-item"]').length,
              nestedBranches: children?.querySelectorAll(':scope > [data-ui="navigation-branch"]').length,
              grandchildItems: childBranch?.querySelectorAll(':scope > [data-ui="navigation-children"] > [data-ui="navigation-item"]').length,
              childBranchOpen: childBranch instanceof HTMLDetailsElement && childBranch.open,
              panelBelowParent: Boolean(triggerRect && childrenRect && childrenRect.top >= triggerRect.bottom - 1),
              horizontalSubmenuRemoved: document.querySelector('[data-demo-submenu]') === null,
              breadcrumbs: document.querySelectorAll('[data-ui="breadcrumbs"]').length,
              currentCrumb: document.querySelector('[data-ui="breadcrumb"] [aria-current="page"]')?.textContent?.trim(),
              topLevelMetrics: crmTrigger instanceof HTMLElement ? (() => {
                const styles = getComputedStyle(crmTrigger)
                const icon = crmTrigger.querySelector('[data-ui="navigation-item-leading"] [data-ui="icon"]')
                const iconRect = icon instanceof SVGElement ? icon.getBoundingClientRect() : null
                return {
                  height: crmTrigger.getBoundingClientRect().height,
                  fontSize: styles.fontSize,
                  lineHeight: styles.lineHeight,
                  gap: styles.gap,
                  padding: styles.padding,
                  iconWidth: iconRect?.width ?? null,
                  iconHeight: iconRect?.height ?? null,
                }
              })() : null,
            }
          })()`,
        )
        assert.equal(submenuAudit.topBranches, 18)
        assert.equal(submenuAudit.openTopBranches, 1)
        assert.equal(submenuAudit.crmOpen, true)
        assert.equal(submenuAudit.overviewClosed, true)
        assert.equal(submenuAudit.resistsCollapse, true)
        assert.equal(submenuAudit.globalAccordion, true)
        assert.equal(submenuAudit.branchIndicators, 0)
        assert.equal(submenuAudit.activeBranches, 0)
        assert.equal(submenuAudit.directChildren, 4)
        assert.equal(submenuAudit.nestedBranches, 1)
        assert.equal(submenuAudit.grandchildItems, 3)
        assert.equal(submenuAudit.childBranchOpen, true)
        assert.equal(submenuAudit.panelBelowParent, true)
        assert.equal(submenuAudit.horizontalSubmenuRemoved, true)
        assert.equal(submenuAudit.breadcrumbs, 1)
        assert.equal(
          submenuAudit.currentCrumb,
          review.key === 'submenu-demo-vi' ? 'Hôm nay' : 'Nguồn khách hàng',
        )
        assert.deepEqual(submenuAudit.topLevelMetrics, {
          height: viewport.mobile ? 44 : 30,
          fontSize: '14px',
          lineHeight: '20px',
          gap: '10px',
          padding: '4px 8px',
          iconWidth: 20,
          iconHeight: 20,
        })
        if (viewport.key === 'mobile') await delay(300)
      }
      if (review.key === 'application-structure-en') {
        const navigationAudit: Json = await evaluate<Json>(
          cdp,
          `(() => new Promise((resolve) => {
            const example = document.querySelector('#app-navigation')
            const navigation = example?.querySelector('[data-ui="app-navigation"]')
            const trigger = navigation?.querySelector('[data-ui="navigation-trigger"]')
            const drawer = navigation?.querySelector('[data-ui="navigation-drawer"]')
            const active = navigation?.querySelector('[data-ui="navigation-item"][aria-current="page"]')
            if (!(navigation instanceof HTMLDetailsElement) || !(trigger instanceof HTMLElement) || !(drawer instanceof HTMLElement)) {
              resolve({ found: false })
              return
            }
            const initial = {
              found: true,
              attached: document.documentElement.dataset.kvInteractions,
              triggerDisplay: getComputedStyle(trigger).display,
              drawerDisplay: getComputedStyle(drawer).display,
              drawerRole: drawer.getAttribute('role'),
              activeVisible: active instanceof HTMLElement && active.checkVisibility(),
            }
            if (${JSON.stringify(viewport.key)} === 'desktop') {
              resolve(initial)
              return
            }
            trigger.focus()
            trigger.click()
            setTimeout(() => {
              const opened = {
                open: navigation.open,
                expanded: trigger.getAttribute('data-open'),
                drawerRole: drawer.getAttribute('role'),
                ariaModal: drawer.getAttribute('aria-modal'),
                scrollLocked: document.documentElement.dataset.kvNavigationOpen,
                mainInert: navigation.closest('[data-ui="app-shell"]')?.querySelector(':scope > [data-ui="app-main"]')?.inert,
                focusedInside: drawer.contains(document.activeElement),
                activeVisibleOnOpen: active instanceof HTMLElement && active.checkVisibility(),
              }
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              requestAnimationFrame(() => resolve({
                ...initial,
                ...opened,
                closed: !navigation.open,
                focusRestored: document.activeElement === trigger,
                scrollReleased: document.documentElement.dataset.kvNavigationOpen !== 'true',
              }))
            }, 50)
          }))()`,
        )
        assert.equal(navigationAudit.found, true)
        assert.equal(navigationAudit.attached, 'attached')
        if (viewport.key === 'desktop') {
          assert.equal(navigationAudit.activeVisible, true)
          assert.equal(navigationAudit.triggerDisplay, 'none')
          assert.equal(navigationAudit.drawerDisplay, 'flex')
          assert.equal(navigationAudit.drawerRole, null)
        } else {
          assert.equal(navigationAudit.activeVisible, false)
          assert.equal(navigationAudit.activeVisibleOnOpen, true)
          assert.equal(navigationAudit.open, true)
          assert.equal(navigationAudit.expanded, 'true')
          assert.equal(navigationAudit.drawerRole, 'dialog')
          assert.equal(navigationAudit.ariaModal, 'true')
          assert.equal(navigationAudit.scrollLocked, 'true')
          assert.equal(navigationAudit.mainInert, true)
          assert.equal(navigationAudit.focusedInside, true)
          assert.equal(navigationAudit.closed, true)
          assert.equal(navigationAudit.focusRestored, true)
          assert.equal(navigationAudit.scrollReleased, true)
        }
      }
      if (review.key === 'interactions-en' && viewport.key === 'desktop') {
        const interactionAudit: Json = await evaluate<Json>(
          cdp,
          `(() => {
            const menu = document.querySelector('[data-ui="menu"][open]')
            const trigger = menu?.querySelector('[data-ui="menu-trigger"]')
            trigger?.focus()
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
            const keyboardItem = document.activeElement?.textContent?.trim()
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            const menuEscapeClosed = menu instanceof HTMLDetailsElement && !menu.open
            trigger?.focus()
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
            const closedMenuOpens = menu instanceof HTMLDetailsElement && menu.open && document.activeElement?.textContent?.trim() === 'Open record'
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            trigger?.click()
            document.body.click()
            const positioned = document.querySelector('[data-ui="popover-panel"]')
            return {
              attached: document.documentElement.dataset.kvInteractions,
              menuClosed: menuEscapeClosed,
              menuOutsideClosed: menu instanceof HTMLDetailsElement && !menu.open,
              menuKeyboard: keyboardItem,
              closedMenuOpens,
              focusRestored: document.activeElement === trigger,
              popoverPositioned: positioned?.getAttribute('data-runtime-positioned'),
              popoverPlacement: positioned?.getAttribute('data-runtime-placement'),
            }
          })()`,
        )
        assert.equal(interactionAudit.attached, 'attached')
        assert.equal(interactionAudit.menuClosed, true)
        assert.equal(interactionAudit.menuOutsideClosed, true)
        assert.match(String(interactionAudit.menuKeyboard), /Watch changes/u)
        assert.equal(interactionAudit.closedMenuOpens, true)
        assert.equal(interactionAudit.focusRestored, true)
        assert.equal(interactionAudit.popoverPositioned, 'true')
        assert.match(String(interactionAudit.popoverPlacement), /^(?:top|bottom)-(?:start|end)$/u)
      }
      if (review.key === 'data-operations-en' && viewport.key === 'desktop') {
        const hierarchyAudit: Json = await evaluate<Json>(
          cdp,
          `(() => {
            const treeItem = document.querySelector('[data-ui="tree"] [role="treeitem"][tabindex="0"]')
            treeItem?.focus()
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
            const nextTreeItem = document.activeElement?.textContent?.trim()
            const firstRow = document.querySelector('[data-ui="tree-grid-row"][tabindex="0"]')
            firstRow?.focus()
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
            return {
              nextTreeItem,
              nextTreeGridRow: document.activeElement?.textContent?.trim(),
            }
          })()`,
        )
        assert.match(String(hierarchyAudit.nextTreeItem), /Reports/u)
        assert.match(String(hierarchyAudit.nextTreeGridRow), /110 · Cash/u)
      }
      if (review.key === 'application-structure-en') {
        if (viewport.key === 'mobile') {
          await evaluate(
            cdp,
            `(() => new Promise((resolve) => {
              const trigger = document.querySelector('#app-navigation [data-ui="navigation-trigger"]')
              trigger?.focus()
              trigger?.click()
              setTimeout(resolve, 250)
            }))()`,
          )
        } else {
          await evaluate(cdp, `document.querySelector('#app-navigation')?.scrollIntoView({ block: 'start' })`)
          await delay(100)
        }
      }
      const captured: Json = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      const bytes: Buffer = Buffer.from(String(captured.data), 'base64')
      assert.ok(bytes.length > 10_000, `${review.key}/${viewport.key} screenshot is too small`)
      const path = join(evidenceDir, `${review.key}-${viewport.key}.png`)
      await writeFile(path, bytes)
      results.push({
        route: review.key,
        viewport: viewport.key,
        width: viewport.width,
        height: viewport.height,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        path,
      })
    }
  }
  for (const result of results)
    if (typeof result.path === 'string') assert.ok((await readFile(result.path)).length > 10_000)
  process.stdout.write(`${JSON.stringify({ event: 'design_system_browser_e2e', evidenceDir, results })}\n`)
} finally {
  cdp?.close()
  app.kill('SIGTERM')
  browser.kill('SIGTERM')
  await delay(250)
  await rm(chromeProfile, { recursive: true, force: true })
}
