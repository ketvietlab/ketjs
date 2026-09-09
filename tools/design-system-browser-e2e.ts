import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { NavigationItem } from '@ketvietlab/design-system'
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
    assert.match(String(audit.text), /Public exports[\s\S]*189/u)
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
            trigger?.click()
            document.body.click()
            const positioned = document.querySelector('[data-ui="popover-panel"]')
            return {
              attached: document.documentElement.dataset.kvInteractions,
              menuClosed: menuEscapeClosed,
              menuOutsideClosed: menu instanceof HTMLDetailsElement && !menu.open,
              menuKeyboard: keyboardItem,
              focusRestored: document.activeElement === trigger,
              popoverPositioned: positioned?.getAttribute('data-runtime-positioned'),
              popoverPlacement: positioned?.getAttribute('data-runtime-placement'),
            }
          })()`,
        )
        assert.equal(interactionAudit.attached, 'attached')
        assert.equal(interactionAudit.menuClosed, true)
        assert.equal(interactionAudit.menuOutsideClosed, true)
        assert.match(String(interactionAudit.menuKeyboard), /Duplicate/u)
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
  for (const result of results) assert.ok((await readFile(String(result.path))).length > 10_000)
  process.stdout.write(`${JSON.stringify({ event: 'design_system_browser_e2e', evidenceDir, results })}\n`)
} finally {
  cdp?.close()
  app.kill('SIGTERM')
  browser.kill('SIGTERM')
  await delay(250)
  await rm(chromeProfile, { recursive: true, force: true })
}
