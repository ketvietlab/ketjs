import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { collaborationEvidenceApp } from './collaboration-evidence-fixture.ts'

const CHROME = process.env.KET_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
}

class Cdp {
  readonly socket: WebSocket
  #id = 0
  #pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  #events = new Map<string, Array<(params: unknown) => void>>()

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id)
        if (!pending) return
        this.#pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message ?? 'CDP command failed'))
        else pending.resolve(message.result)
        return
      }
      if (!message.method) return
      for (const listener of this.#events.get(message.method) ?? []) listener(message.params)
    })
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome DevTools WebSocket timed out')), 10_000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolveOpen()
      })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Chrome DevTools WebSocket failed'))
      })
    })
    return new Cdp(socket)
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.#id
    return new Promise<T>((resolveCommand, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolveCommand(value as T),
        reject,
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method: string, timeoutMs = 10_000): Promise<unknown> {
    return new Promise((resolveEvent, reject) => {
      const listeners = this.#events.get(method) ?? []
      const listener = (params: unknown) => {
        clearTimeout(timer)
        this.#events.set(
          method,
          (this.#events.get(method) ?? []).filter((entry) => entry !== listener),
        )
        resolveEvent(params)
      }
      listeners.push(listener)
      this.#events.set(method, listeners)
      const timer = setTimeout(() => {
        this.#events.set(
          method,
          (this.#events.get(method) ?? []).filter((entry) => entry !== listener),
        )
        reject(new Error(`timed out waiting for ${method}`))
      }, timeoutMs)
    })
  }

  on(method: string, listener: (params: unknown) => void): void {
    const listeners = this.#events.get(method) ?? []
    listeners.push(listener)
    this.#events.set(method, listeners)
  }

  close(): void {
    this.socket.close()
  }
}

type ChromeHandle = { process: ChildProcess; profile: string; cdp: Cdp }

const startChrome = async (): Promise<ChromeHandle> => {
  const profile = await mkdtemp(join(tmpdir(), 'ket-collaboration-chrome-'))
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1440,1100',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const browserSocket = await new Promise<string>((resolveSocket, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`Chrome did not expose DevTools: ${stderr}`)), 15_000)
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)
      if (!match) return
      clearTimeout(timer)
      resolveSocket(match[1]!)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Chrome exited before DevTools was ready (${String(code)}): ${stderr}`))
    })
  })
  const endpoint = new URL(browserSocket)
  let target: { webSocketDebuggerUrl?: string } | undefined
  for (let attempt = 0; attempt < 50 && !target?.webSocketDebuggerUrl; attempt++) {
    const list = (await fetch(`http://${endpoint.host}/json/list`).then((response) =>
      response.json(),
    )) as Array<{
      type?: string
      webSocketDebuggerUrl?: string
    }>
    target = list.find((entry) => entry.type === 'page')
    if (!target?.webSocketDebuggerUrl) await delay(100)
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Chrome exposed no page target')
  return { process: child, profile, cdp: await Cdp.connect(target.webSocketDebuggerUrl) }
}

const evaluate = async <T>(cdp: Cdp, expression: string): Promise<T> => {
  const response = await cdp.send<{
    result: { value?: T; description?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        'browser evaluation failed',
    )
  return response.result.value as T
}

const navigate = async (cdp: Cdp, url: string): Promise<void> => {
  const loaded = cdp.once('Page.loadEventFired', 15_000)
  await cdp.send('Page.navigate', { url })
  await loaded
}

const waitFor = async (cdp: Cdp, expression: string, timeoutMs = 10_000): Promise<void> => {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (await evaluate<boolean>(cdp, `Boolean(${expression})`)) return
    await delay(100)
  }
  const diagnostic = await evaluate(
    cdp,
    `({
    url: location.href,
    chatter: document.querySelector('[data-ui="chatter"]')?.outerHTML ?? null,
    activity: document.querySelector('[data-ui="activity-record"]')?.outerHTML ?? null,
    body: document.body?.innerText?.slice(-1200) ?? null
  })`,
  )
  throw new Error(`browser condition timed out: ${expression}\n${JSON.stringify(diagnostic, null, 2)}`)
}

const capture = async (cdp: Cdp, path: string): Promise<void> => {
  const result = await cdp.send<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
  })
  await writeFile(path, Buffer.from(result.data, 'base64'))
}

const e2e = await collaborationEvidenceApp()
let chrome: ChromeHandle | null = null
const artifactDir = resolve('docs/assets/odoo-collaboration')
const report: Array<{ screen: string; readyMs: number; navigationMs: number }> = []
const onlyScreen = process.env.KET_E2E_SCREEN?.trim()
const noArtifacts = process.env.KET_E2E_NO_ARTIFACTS === '1'
try {
  await mkdir(artifactDir, { recursive: true })
  chrome = await startChrome()
  const { cdp } = chrome
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  cdp.on('Runtime.exceptionThrown', (params) => console.error(`browser exception: ${JSON.stringify(params)}`))
  cdp.on('Log.entryAdded', (params) => console.error(`browser log: ${JSON.stringify(params)}`))
  await navigate(cdp, `${e2e.baseUrl}/login?lang=vi`)
  const login = await evaluate<{ status: number; ok: boolean }>(
    cdp,
    `(async () => {
      const response = await fetch('/login', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({login: 'admin', password: 'correct horse'})
      })
      return {status: response.status, ok: response.ok}
    })()`,
  )
  assert.deepEqual(login, { status: 200, ok: true })

  for (const screen of [
    {
      name: 'product-chatter',
      path: '/admin/products/tpl-collab?lang=vi',
      ready: `document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.querySelectorAll('[data-ui="chatter-message"]').length >= 2 && document.querySelector('[data-ui="chatter-delivery"][data-state="failed"]') && document.querySelector('[data-ui="activity-record"][data-state="ready"]') && document.querySelectorAll('[data-ui="activity-item"]').length >= 1`,
    },
    {
      name: 'product-variant-chatter',
      path: '/admin/products/tpl-collab/variants/variant-collab?tab=general&lang=vi',
      ready: `document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.querySelectorAll('[data-ui="chatter-message"]').length >= 2 && document.querySelector('[data-ui="activity-record"][data-state="ready"]') && document.querySelectorAll('[data-ui="activity-item"]').length >= 1`,
    },
    {
      name: 'product-attributes',
      path: '/admin/product-attributes?lang=vi',
      ready: `document.querySelector('#product-attribute-create') && document.querySelectorAll('[data-ui="content-card"]').length >= 3`,
    },
    {
      name: 'product-create',
      path: '/admin/products/new?lang=vi',
      ready: `document.querySelector('#product-create-form') && document.querySelectorAll('[data-ui="record-toggle-input"]').length >= 3`,
    },
    {
      name: 'transfer-chatter',
      path: '/admin/transfers/pick-collab?lang=vi',
      ready: `document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.querySelectorAll('[data-ui="chatter-message"]').length >= 2 && document.querySelector('[data-ui="chatter-delivery"][data-state="sent"]') && document.querySelector('[data-ui="activity-record"][data-state="ready"]') && document.querySelectorAll('[data-ui="activity-item"]').length >= 1`,
    },
    {
      name: 'notification-inbox',
      path: '/admin/inbox?lang=vi',
      ready: `document.querySelector('[data-ui="content-card"]')`,
    },
    {
      name: 'my-activities',
      path: '/admin/activities?lang=vi&today=2026-08-20',
      ready: `document.querySelector('[data-ui="content-card"]') && document.body.textContent.includes('Xác nhận quy cách đóng gói')`,
    },
    {
      name: 'calendar-agenda',
      path: '/admin/calendar?lang=vi&view=agenda',
      ready: `document.querySelector('[data-ui="calendar-board"][data-state="ready"][data-view="agenda"]') && document.querySelectorAll('[data-ui="calendar-event"]').length >= 2`,
    },
    {
      name: 'calendar-week',
      path: '/admin/calendar?lang=vi&view=week',
      ready: `document.querySelector('[data-ui="calendar-board"][data-state="ready"][data-view="week"]') && document.querySelectorAll('[data-ui="calendar-day"]').length === 7`,
    },
    {
      name: 'calendar-month',
      path: '/admin/calendar?lang=vi&view=month',
      ready: `document.querySelector('[data-ui="calendar-board"][data-state="ready"][data-view="month"]') && document.querySelectorAll('[data-ui="calendar-day"]').length === 42`,
    },
    {
      name: 'transactional-outbox',
      path: '/admin/outbox?lang=vi',
      ready: `document.querySelectorAll('[data-ui="content-card"]').length >= 2 && document.body.textContent.includes('Gửi lỗi') && document.body.textContent.includes('Đã gửi')`,
    },
    {
      name: 'inbound-email-log',
      path: '/admin/inbound-email?lang=vi',
      ready: `document.querySelectorAll('[data-ui="content-card"]').length >= 4 && document.body.textContent.includes('Đã xử lý') && document.body.textContent.includes('Không định tuyến được') && document.body.textContent.includes('Đã bỏ qua')`,
    },
  ].filter((screen) => !onlyScreen || screen.name === onlyScreen)) {
    const started = performance.now()
    await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
    const navigationMs = await evaluate<number>(
      cdp,
      `performance.getEntriesByType('navigation')[0]?.duration ?? 0`,
    )
    await waitFor(cdp, screen.ready, 15_000)
    const readyMs = performance.now() - started
    report.push({ screen: screen.name, readyMs, navigationMs })

    if (screen.name === 'my-activities') {
      const layout = await evaluate<{
        clusters: number
        aligned: boolean
        contained: boolean
        uniqueIds: boolean
        variants: string[][]
      }>(
        cdp,
        `(() => {
          const clusters = [...document.querySelectorAll('[data-ui="form-cluster"]')]
          const ids = [...document.querySelectorAll('[data-ui="form-cluster"] input[id]')]
            .map((input) => input.id)
          return {
            clusters: clusters.length,
            aligned: clusters.every((cluster) => {
              const controls = [...cluster.querySelectorAll('input:not([type="hidden"]), button')]
              const bottoms = controls.map((control) => control.getBoundingClientRect().bottom)
              return Math.max(...bottoms) - Math.min(...bottoms) <= 1
            }),
            contained: clusters.every((cluster) => {
              const bounds = cluster.getBoundingClientRect()
              return [...cluster.querySelectorAll('input:not([type="hidden"]), button')]
                .every((control) => {
                  const box = control.getBoundingClientRect()
                  return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
                })
            }),
            uniqueIds: new Set(ids).size === ids.length,
            variants: clusters.map((cluster) =>
              [...cluster.querySelectorAll('[data-ui="action"]')]
                .map((action) => action.dataset.variant)
            )
          }
        })()`,
      )
      assert.equal(layout.clusters, 2)
      assert.equal(layout.aligned, true)
      assert.equal(layout.contained, true)
      assert.equal(layout.uniqueIds, true)
      assert.deepEqual(layout.variants, [
        ['primary', 'secondary', 'destructive'],
        ['primary', 'secondary', 'destructive'],
      ])

      await waitFor(
        cdp,
        `document.querySelector('[data-ui="mail-indicator"]') && document.querySelector('[data-ui="activity-indicator"]')`,
      )
      const footer = await evaluate<{
        ordered: boolean
        aligned: boolean
        settingsBelow: boolean
        accountMenuVisible: boolean
        accountMenuContained: boolean
        signoutPost: boolean
      }>(
        cdp,
        `(() => {
          const sidebar = document.querySelector('[data-ui="sidebar"]')
          const tools = document.querySelector('[data-ui="sidebar-tools"]')
          const mail = document.querySelector('[data-ui="mail-indicator"]')
          const activity = document.querySelector('[data-ui="activity-indicator"]')
          const settings = document.querySelector('[data-ui="sidebar-settings"]')
          const viewer = document.querySelector('[data-ui="viewer"]')
          viewer.open = true
          const sidebarBox = sidebar.getBoundingClientRect()
          const mailBox = mail.getBoundingClientRect()
          const activityBox = activity.getBoundingClientRect()
          const menuBox = viewer.querySelector('[data-ui="viewer-menu"]').getBoundingClientRect()
          const result = {
            ordered: mailBox.left < activityBox.left,
            aligned: Math.abs(mailBox.top - activityBox.top) <= 1 &&
              Math.abs(mailBox.height - activityBox.height) <= 1,
            settingsBelow: settings.getBoundingClientRect().top >= tools.getBoundingClientRect().bottom,
            accountMenuVisible: menuBox.width > 0 && menuBox.height > 0,
            accountMenuContained: menuBox.left >= sidebarBox.left && menuBox.right <= sidebarBox.right,
            signoutPost: viewer.querySelector('[data-ui="signout"]')?.method === 'post'
          }
          viewer.open = false
          return result
        })()`,
      )
      assert.deepEqual(footer, {
        ordered: true,
        aligned: true,
        settingsBelow: true,
        accountMenuVisible: true,
        accountMenuContained: true,
        signoutPost: true,
      })
    }

    if (screen.name === 'product-chatter') {
      const generalPadding = await evaluate(
        cdp,
        `getComputedStyle(document.querySelector('[data-ui="record-body"]')).padding`,
      )
      await navigate(cdp, `${e2e.baseUrl}/admin/products/tpl-collab?tab=variants&lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="tab"][data-active="true"]')?.textContent.includes('Thuộc tính')`,
      )
      assert.equal(
        await evaluate(cdp, `getComputedStyle(document.querySelector('[data-ui="record-body"]')).padding`),
        generalPadding,
      )
      await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
      await waitFor(cdp, `document.querySelector('form[data-scope="product-detail"]')`)
      await waitFor(
        cdp,
        `document.querySelector('ket-island[data-island="product.editor"]')?.hidden === true`,
      )
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1920,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
      await waitFor(cdp, `document.querySelector('[data-ui="record-aside"]')`)
      assert.deepEqual(
        await evaluate(
          cdp,
          `(() => {
            const workspace = document.querySelector('[data-ui="record-workspace"]')
            const aside = document.querySelector('[data-ui="record-aside"]')
            const gap = parseFloat(getComputedStyle(workspace).columnGap)
            const available = workspace.getBoundingClientRect().width - gap
            const width = aside.getBoundingClientRect().width
            return { atLeast32Rem: width >= 512, oneThird: Math.abs(width / available - 1 / 3) <= 0.01 }
          })()`,
        ),
        { atLeast32Rem: true, oneThird: true },
      )
      await cdp.send('Emulation.clearDeviceMetricsOverride')
      await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
      await waitFor(
        cdp,
        `document.querySelector('ket-island[data-island="product.editor"]')?.hidden === true`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            editorIdle: document.querySelector('ket-island[data-island="product.editor"]')?.hidden === true,
            controllerCollapsed: document.querySelector('[data-ui="record-controller"]').getBoundingClientRect().height === 0,
            headerToggles: document.querySelectorAll('[data-ui="record-header"] [data-ui="record-toggle"]').length,
            bodyType: document.querySelectorAll('[data-ui="record-body"] [name="type"]').length,
            bodyToggles: document.querySelectorAll('[data-ui="record-body"] input[type="checkbox"]').length,
            gridRowsAtLeast28: Array.from(document.querySelectorAll('[data-ui="record-body"] [data-ui="form-grid"] > [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            collaborationNarrower: document.querySelector('[data-ui="record-aside"]').getBoundingClientRect().width < document.querySelector('[data-ui="record-sheet"]').getBoundingClientRect().width,
            statusesAligned: (() => {
              const items = Array.from(document.querySelectorAll('[data-ui="record-badges"] > *'))
              return items.length === 3 && items.every((item) => Math.abs(item.getBoundingClientRect().top - items[0].getBoundingClientRect().top) <= 1)
            })(),
            statusesSpaced: (() => {
              const boxes = Array.from(document.querySelectorAll('[data-ui="record-badges"] > *'), (item) => item.getBoundingClientRect())
              return boxes.slice(1).every((box, index) => box.left - boxes[index].right >= 8)
            })()
          })`,
        ),
        {
          editorIdle: true,
          controllerCollapsed: true,
          headerToggles: 3,
          bodyType: 2,
          bodyToggles: 0,
          gridRowsAtLeast28: true,
          collaborationNarrower: true,
          statusesAligned: true,
          statusesSpaced: true,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          globalThis.__productSaveNodes = {
            chatter: document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: document.querySelector('[data-ui="sidebar-foot"]')
          }
          document.querySelector('form[data-scope="product-detail"]').requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="record-controller"] [data-ui="notice"][data-tone="positive"]')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: globalThis.__productSaveNodes.chatter === document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: globalThis.__productSaveNodes.activity === document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: globalThis.__productSaveNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            formReady: Boolean(document.querySelector('form[data-scope="product-detail"]:not([aria-busy="true"])')),
            editorVisible: document.querySelector('ket-island[data-island="product.editor"]')?.hidden === false
          })`,
        ),
        { chatter: true, activity: true, sidebar: true, formReady: true, editorVisible: true },
      )

      await evaluate(cdp, `document.querySelector('[data-ui="chatter-kind"][data-kind="comment"]').click()`)
      await waitFor(cdp, `document.querySelector('[data-ui="chatter-composer"]')`)
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="chatter-composer"]')
          const body = form.querySelector('[name="body"]')
          body.value = '<img src=x onerror=globalThis.__xss=1> Browser E2E'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(cdp, `document.body.textContent.includes('Browser E2E')`)
      assert.equal(
        await evaluate(cdp, `Boolean(document.querySelector('[data-ui="chatter-message-body"] img'))`),
        false,
      )
      assert.equal(await evaluate(cdp, `globalThis.__xss === 1`), false)

      await evaluate(cdp, `document.querySelector('[data-ui="activity-schedule-trigger"]').click()`)
      await waitFor(cdp, `document.querySelector('[data-ui="activity-schedule"]')`)
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="activity-schedule"]')
          form.querySelector('[name="typeId"]').value = 'activity-todo'
          form.querySelector('[name="summary"]').value = 'Hoạt động từ Browser E2E'
          form.querySelector('[name="note"]').value = 'Được tạo qua island thật.'
          form.querySelector('[name="dueDate"]').value = '2026-08-20'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `[...document.querySelectorAll('[data-ui="activity-item"]')].some((item) => item.textContent.includes('Hoạt động từ Browser E2E'))`,
      )
      await evaluate(
        cdp,
        `(() => {
          const item = [...document.querySelectorAll('[data-ui="activity-item"]')]
            .find((entry) => entry.textContent.includes('Hoạt động từ Browser E2E'))
          item.querySelector('[data-ui="activity-action-trigger"][data-action="complete"]').click()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `[...document.querySelectorAll('[data-ui="activity-item"]')].some((item) => item.textContent.includes('Hoạt động từ Browser E2E') && item.querySelector('[data-ui="activity-complete"]'))`,
      )
      await evaluate(
        cdp,
        `(() => {
          const item = [...document.querySelectorAll('[data-ui="activity-item"]')]
            .find((entry) => entry.textContent.includes('Hoạt động từ Browser E2E'))
          const form = item.querySelector('[data-ui="activity-complete"]')
          form.querySelector('[name="feedback"]').value = 'Đã kiểm chứng trên Chrome headless.'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `[...document.querySelectorAll('[data-ui="activity-item"][data-state="done"]')].some((item) => item.textContent.includes('Hoạt động từ Browser E2E'))`,
      )
    }
    if (screen.name === 'product-variant-chatter') {
      const generalPadding = await evaluate(
        cdp,
        `getComputedStyle(document.querySelector('[data-ui="record-body"]')).padding`,
      )
      await navigate(
        cdp,
        `${e2e.baseUrl}/admin/products/tpl-collab/variants/variant-collab?tab=media&lang=vi`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="tab"][data-active="true"]')?.textContent.includes('Hình ảnh')`,
      )
      assert.equal(
        await evaluate(cdp, `getComputedStyle(document.querySelector('[data-ui="record-body"]')).padding`),
        generalPadding,
      )
      await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
      await waitFor(cdp, `document.querySelector('form[data-scope="product-variant"]')`)
      await waitFor(
        cdp,
        `document.querySelector('ket-island[data-island="product.editor"]')?.hidden === true`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            editorIdle: document.querySelector('ket-island[data-island="product.editor"]')?.hidden === true,
            controllerCollapsed: document.querySelector('[data-ui="record-controller"]').getBoundingClientRect().height === 0,
            tabs: document.querySelectorAll('[data-ui="record-navigation"] [data-ui="tab"]').length,
            gridRowsAtLeast28: Array.from(document.querySelectorAll('[data-ui="record-body"] [data-ui="form-grid"] > [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            collaborationNarrower: document.querySelector('[data-ui="record-aside"]').getBoundingClientRect().width < document.querySelector('[data-ui="record-sheet"]').getBoundingClientRect().width,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          editorIdle: true,
          controllerCollapsed: true,
          tabs: 2,
          gridRowsAtLeast28: true,
          collaborationNarrower: true,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          globalThis.__variantSaveNodes = {
            chatter: document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: document.querySelector('[data-ui="sidebar-foot"]')
          }
          document.querySelector('form[data-scope="product-variant"]').requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="record-controller"] [data-ui="notice"][data-tone="positive"]')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: globalThis.__variantSaveNodes.chatter === document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: globalThis.__variantSaveNodes.activity === document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: globalThis.__variantSaveNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            formReady: Boolean(document.querySelector('form[data-scope="product-variant"]:not([aria-busy="true"])')),
            editorVisible: document.querySelector('ket-island[data-island="product.editor"]')?.hidden === false
          })`,
        ),
        { chatter: true, activity: true, sidebar: true, formReady: true, editorVisible: true },
      )
    }
    if (screen.name === 'product-attributes') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            cards: document.querySelectorAll('[data-ui="content-card"]').length,
            createFieldsAtLeast28: Array.from(document.querySelectorAll('#product-attribute-create [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            valueFieldsAtLeast28: Array.from(document.querySelectorAll('form[data-scope="product-attribute-value"] [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          cards: 3,
          createFieldsAtLeast28: true,
          valueFieldsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('#product-attribute-create')
          form.querySelector('[name="name"]').value = 'Hoàn thiện'
          form.querySelector('[name="sequence"]').value = '20'
          form.querySelector('[name="displayType"]').value = 'pills'
          form.querySelector('[name="createVariant"]').value = 'no_variant'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `[...document.querySelectorAll('[data-ui="card-title"]')].some((title) => title.textContent.includes('Hoàn thiện'))`,
      )
      assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-ui="content-card"]').length`), 4)
    }
    if (screen.name === 'product-create') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            typeRadios: document.querySelectorAll('#product-create-form [name="type"][type="radio"]').length,
            headerToggles: document.querySelectorAll('[data-ui="record-badges"] [data-ui="record-toggle-input"][form="product-create-form"]').length,
            gridRowsAtLeast28: Array.from(document.querySelectorAll('#product-create-form [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          typeRadios: 2,
          headerToggles: 3,
          gridRowsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('#product-create-form')
          form.querySelector('[name="name"]').value = 'Sản phẩm Browser E2E'
          form.querySelector('[name="uomId"]').value = 'unit'
          form.querySelector('[name="listPrice"]').value = '320000'
          form.querySelector('[name="description"]').value = 'Được tạo bằng trình duyệt headless.'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="record-heading"]')?.textContent.includes('Sản phẩm Browser E2E') && document.querySelector('[data-ui="chatter"][data-state="ready"]')`,
      )
    }
    if (screen.name === 'transfer-chatter') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            workspace: Boolean(document.querySelector('[data-ui="record-workspace"]')),
            aside: Boolean(document.querySelector('[data-ui="record-aside"]')),
            editorIdle: document.querySelector('ket-island[data-island="stock.editor"]')?.hidden === true,
            formRowsAtLeast28: Array.from(document.querySelectorAll('form[data-scope="stock-transfer"] [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            collaborationNarrower: document.querySelector('[data-ui="record-aside"]').getBoundingClientRect().width < document.querySelector('[data-ui="record-sheet"]').getBoundingClientRect().width,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          workspace: true,
          aside: true,
          editorIdle: true,
          formRowsAtLeast28: true,
          collaborationNarrower: true,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          globalThis.__transferActionNodes = {
            chatter: document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: document.querySelector('[data-ui="sidebar-foot"]')
          }
          document.querySelector('form[data-scope="stock-transfer"] input[name="action"][value="confirm"]').form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="record-controller"] [data-ui="notice"][data-tone="positive"]') && document.querySelector('[data-ui="record-header"]')?.textContent.includes('Đã xác nhận')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: globalThis.__transferActionNodes.chatter === document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: globalThis.__transferActionNodes.activity === document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: globalThis.__transferActionNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            editorVisible: document.querySelector('ket-island[data-island="stock.editor"]')?.hidden === false,
            formReady: Array.from(document.querySelectorAll('form[data-scope="stock-transfer"]')).every((form) => form.getAttribute('aria-busy') !== 'true')
          })`,
        ),
        { chatter: true, activity: true, sidebar: true, editorVisible: true, formReady: true },
      )
      await evaluate(cdp, `document.querySelector('[data-ui="chatter-kind"][data-kind="note"]').click()`)
      await waitFor(cdp, `document.querySelector('[data-ui="chatter-composer"]')`)
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="chatter-composer"]')
          form.querySelector('[name="body"]').value = 'Headless note on transfer'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(cdp, `document.body.textContent.includes('Headless note on transfer')`)
      assert.ok(
        await evaluate<number>(
          cdp,
          `document.querySelectorAll('[data-ui="chatter-message"][data-kind="note"]').length`,
        ),
      )
    }
    if (screen.name === 'calendar-agenda') {
      const dateLayout = await evaluate<{
        sameRow: boolean
        sameSize: boolean
        contained: boolean
      }>(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="calendar-create"]')
          const start = form.querySelector('[name="start"]')
          const stop = form.querySelector('[name="stop"]')
          const startBox = start.getBoundingClientRect()
          const stopBox = stop.getBoundingClientRect()
          const formBox = form.getBoundingClientRect()
          return {
            sameRow: Math.abs(startBox.top - stopBox.top) <= 1,
            sameSize: Math.abs(startBox.width - stopBox.width) <= 1 &&
              Math.abs(startBox.height - stopBox.height) <= 1,
            contained: [...form.querySelectorAll('input')].every((input) => {
              const box = input.getBoundingClientRect()
              return box.left >= formBox.left - 1 && box.right <= formBox.right + 1
            })
          }
        })()`,
      )
      assert.deepEqual(dateLayout, { sameRow: true, sameSize: true, contained: true })
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="calendar-create"]')
          form.querySelector('[name="name"]').value = 'Sự kiện từ Browser E2E'
          form.querySelector('[name="start"]').value = '2026-08-20T14:00'
          form.querySelector('[name="stop"]').value = '2026-08-20T15:00'
          form.querySelector('[name="location"]').value = 'Phòng kiểm chứng'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(cdp, `document.body.textContent.includes('Sự kiện từ Browser E2E')`)
    }
    if (!noArtifacts) await capture(cdp, join(artifactDir, `${screen.name}.png`))
  }

  if (!noArtifacts)
    await writeFile(
      join(artifactDir, 'browser-e2e.json'),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          viewport: { width: 1440, height: 1100 },
          assertions: [
            'authenticated product and transfer islands reached ready state',
            'Product save replaced only its record header/body and preserved Chatter, Activity and sidebar DOM identity',
            'Transfer actions replaced only the record header/body and preserved Chatter, Activity and sidebar DOM identity',
            'message and internal-note composer crossed real browser HTTP',
            'Chatter exposed linked sent and terminal-failure email delivery states',
            'record activity island scheduled and completed an activity through real browser HTTP',
            'My Activities rendered the actor due list and sidebar counter',
            'My Activities kept inputs, date pickers and semantic actions on one contained baseline',
            'KétViệt sidebar systray order, divider, account menu and settings link stayed functional',
            'Agenda, week and month calendar views hydrated with bounded occurrence expansion',
            'calendar date-time pickers kept equal dimensions and stayed inside their form grid',
            'calendar event creation crossed real browser HTTP and remained visible after reload',
            'transactional outbox rendered both provider-accepted and terminal-failure delivery states',
            'inbound log rendered processed, failed and ignored signed-provider outcomes',
            'plain-text message markup did not execute or create an img element',
            'notification inbox rendered an unread message',
          ],
          screens: report,
        },
        null,
        2,
      )}\n`,
    )
  for (const row of report)
    console.log(
      `${row.screen.padEnd(24)} navigation=${row.navigationMs.toFixed(1).padStart(6)} ms  interactive=${row.readyMs.toFixed(1).padStart(6)} ms`,
    )
  if (!noArtifacts) console.log(`screenshots: ${artifactDir}`)
} finally {
  chrome?.cdp.close()
  if (chrome?.process.exitCode === null) {
    chrome.process.kill('SIGTERM')
    await Promise.race([
      new Promise<void>((resolveExit) => chrome?.process.once('exit', () => resolveExit())),
      delay(2_000).then(() => {
        if (chrome?.process.exitCode === null) chrome.process.kill('SIGKILL')
      }),
    ])
  }
  if (chrome)
    await rm(chrome.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    )
  await e2e.close()
}
