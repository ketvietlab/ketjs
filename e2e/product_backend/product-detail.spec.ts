import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'product-detail')
const uploadFixture = join(moduleDir, 'fixtures', 'product-primary.png')

const login = async (page: Page) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('product-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    for (const tab of ['general', 'variants', 'media'] as const) {
      test(`renders ${tab} in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(`/admin/product/templates/tpl-review?tab=${tab}&lang=${locale}`)
        await expect(page.locator('[data-ui="main"]')).toBeVisible()
        await expect(page.locator('form[action="/login"]')).toHaveCount(0)
        await expect(page.locator(`[data-ui="tab"][data-active="true"]`)).toBeVisible()
        await expect(page.locator('[data-ui="chatter-loading"], [data-ui="activity-loading"]')).toHaveCount(0)

        if (tab === 'general') {
          const breadcrumbs = page.locator(
            '[data-ket-slot="product.record-header"] > [data-ui="breadcrumbs"]',
          )
          const save = page.locator('[data-ui="record-controller"] button[form="product-detail-form"]')
          await expect(breadcrumbs).toContainText(locale === 'vi' ? 'Mẫu sản phẩm' : 'Templates')
          await expect(save).toHaveText(locale === 'vi' ? 'Lưu' : 'Save')
          await expect(page.locator('#product-detail-form > [data-ui="form-actions"]')).toHaveCount(0)

          const placement = await page.evaluate(() => {
            const rect = (selector: string) =>
              document.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
            const workspace = document.querySelector<HTMLElement>(
              '[data-ui="record-workspace"][data-page-frame="false"]',
            )!
            const breadcrumbRect = rect('[data-ket-slot="product.record-header"] > [data-ui="breadcrumbs"]')
            const identityRect = rect('[data-ket-slot="product.record-header"] > [data-ui="record-identity"]')
            const actionRect = rect('[data-ui="record-controller"] button[form="product-detail-form"]')
            const topRect = workspace
              .querySelector<HTMLElement>(':scope > [data-ui="record-sheet"] > [data-ui="record-top"]')!
              .getBoundingClientRect()
            const navigationRect = workspace
              .querySelector<HTMLElement>(
                ':scope > [data-ui="record-sheet"] > [data-ui="record-navigation"]',
              )!
              .getBoundingClientRect()
            const bodyRect = workspace
              .querySelector<HTMLElement>(':scope > [data-ui="record-sheet"] > [data-ui="record-body"]')!
              .getBoundingClientRect()
            const asideRect = workspace
              .querySelector<HTMLElement>(':scope > [data-ui="record-aside"]')!
              .getBoundingClientRect()
            const generalSection = document.querySelector<HTMLElement>(
              '[data-ui="section"]:has(#product-detail-form)',
            )!
            const nestedSurface = generalSection.querySelector<HTMLElement>(
              ':scope > [data-ui="section-body"] > [data-ui="surface"]',
            )!
            return {
              breadcrumbsBeforeIdentity: breadcrumbRect.bottom <= identityRect.top,
              actionAfterIdentity: actionRect.top >= identityRect.bottom,
              actionAtIdentityRight:
                actionRect.left > identityRect.left && actionRect.top < identityRect.bottom,
              headerSpansWorkspace: Math.abs(topRect.width - workspace.getBoundingClientRect().width) < 1,
              railStartsWithBody: Math.abs(asideRect.top - bodyRect.top) < 1,
              railFollowsBody: asideRect.top >= bodyRect.bottom,
              navigationBeforeBody: navigationRect.bottom <= bodyRect.top,
              singleSectionFrame:
                getComputedStyle(generalSection).borderTopWidth === '1px' &&
                getComputedStyle(nestedSurface).borderTopWidth === '0px' &&
                getComputedStyle(nestedSurface).paddingTop === '0px',
            }
          })
          expect(placement.breadcrumbsBeforeIdentity).toBe(true)
          expect(placement.headerSpansWorkspace).toBe(true)
          expect(placement.navigationBeforeBody).toBe(true)
          expect(placement.singleSectionFrame).toBe(true)
          expect(
            viewport.name === 'desktop' ? placement.actionAtIdentityRight : placement.actionAfterIdentity,
          ).toBe(true)
          expect(viewport.name === 'desktop' ? placement.railStartsWithBody : placement.railFollowsBody).toBe(
            true,
          )
        }

        const metrics = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          // A relation field's native <select> is a 1px, opacity-0 value carrier
          // that only exists so the form submits and validates; the control the
          // reader actually sees and clicks is its trigger button.
          visibleControls: [
            ...document.querySelectorAll<HTMLElement>(
              '[data-ui="record-body"] input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), [data-ui="record-body"] select:not([data-ui="relation-native"]), [data-ui="record-body"] [data-ui="relation-trigger"]',
            ),
          ]
            .filter((control) => control.getBoundingClientRect().height > 0)
            .map((control) => control.getBoundingClientRect().height),
        }))
        expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
        // Fields share the same 32px rhythm across desktop and touch layouts.
        const fieldHeight = 32
        expect(metrics.visibleControls.every((height) => height === fieldHeight)).toBe(true)
        await page.screenshot({
          path: join(artifacts, `detail-${tab}-${locale}-${viewport.name}.png`),
          fullPage: true,
        })
      })
    }
  }
}

test('uses the semantic dark shell, rail and control surfaces', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')

  const colors = await page.evaluate(() => {
    const background = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!).backgroundColor
    return {
      sidebar: background('[data-ui="sidebar"]'),
      shell: background('[data-ui="shell"]'),
      sheet: background('[data-ui="record-sheet"]'),
      rail: background('[data-ui="record-aside"]'),
      control: background('[data-ui="form-control"]'),
    }
  })
  expect(colors).toEqual({
    sidebar: 'rgb(23, 27, 32)',
    shell: 'rgb(27, 31, 36)',
    sheet: 'rgba(0, 0, 0, 0)',
    rail: 'rgb(24, 28, 33)',
    control: 'rgb(32, 37, 43)',
  })
  await page.screenshot({ path: join(artifacts, 'detail-general-vi-desktop-dark.png'), fullPage: true })
})

test('saves atomically and manages variants and template media', async ({ page }) => {
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')
  await expect(page.getByRole('heading', { name: 'Áo khoác vận hành KETSUITE' })).toBeVisible()
  await expect(page.locator('[data-ui="chatter-error"]')).toHaveCount(0)

  await page.locator('input[name="name"]').fill('Tên không được lưu dở dang')
  await page.getByLabel('Theo dõi tồn kho').uncheck()
  await page.getByLabel('Truy xuất').selectOption('serial')
  await page.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page.locator('[data-ui="notice"][role="alert"]')).toContainText('Dữ liệu chưa hợp lệ')
  await page.reload()
  await expect(page.locator('input[name="name"]')).toHaveValue('Áo khoác vận hành KETSUITE')

  await page.getByLabel('Giá bán').fill('1399000')
  await page.getByLabel('Theo dõi tồn kho').check()
  await page.getByLabel('Truy xuất').selectOption('lot')
  await page.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page.getByLabel('Giá bán')).toHaveValue('1399000')

  await page.goto('/admin/product/templates/tpl-review?tab=variants&lang=vi')
  const attributeForm = page.locator('form[data-ui="record-form"]:has(select[name="attributeId"])')
  await attributeForm.locator('select[name="attributeId"]').selectOption('color')
  await attributeForm.locator('select[name="valueIds"]').evaluate((select) => {
    const option = document.createElement('option')
    option.value = 'color-blue,color-orange'
    option.selected = true
    select.append(option)
  })
  await attributeForm.getByRole('button', { name: 'Thêm' }).click()
  await page.getByRole('button', { name: 'Sinh biến thể' }).click()
  await expect(page.locator('[data-ui="row"]')).not.toHaveCount(0)
  await expect(page.getByRole('link', { name: /JACKET-REVIEW/ })).toBeVisible()

  await page.goto('/admin/product/templates/tpl-review?tab=media&lang=vi')
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
  await expect
    .poll(() =>
      page
        .locator('[data-ui="media-item"] img')
        .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Đặt làm ảnh chính' }).click()
  await expect(page.locator('[data-ui="media-item"][data-primary="true"] img')).toHaveAttribute(
    'alt',
    'Áo khoác vận hành màu cam',
  )
  await page.locator('[data-ui="media-file-input"]').setInputFiles(uploadFixture)
  await page.locator('[data-ui="media-upload"]').evaluate((form: HTMLFormElement) => form.requestSubmit())
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(3)
  await page.getByRole('button', { name: 'Xóa ảnh' }).last().click()
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
})
