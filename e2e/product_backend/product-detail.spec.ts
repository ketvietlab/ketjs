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
        await page.emulateMedia({ colorScheme: 'dark' })
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
          const save = page.locator(
            '[data-ui="record-controller"] button[form="product-detail-form"]:not([data-record-save-options])',
          )
          await expect(breadcrumbs).toContainText(locale === 'vi' ? 'Mẫu sản phẩm' : 'Templates')
          await expect(save).toHaveText(locale === 'vi' ? 'Lưu & đóng' : 'Save & close')
          await expect(page.locator('#product-detail-form > [data-ui="form-actions"]')).toHaveCount(0)
          await expect(page.locator('[data-ui="record-navigation"] [data-ui="tab"]')).toHaveCount(3)
          const futureFields = page.locator(
            '[data-ui="record-workspace"][data-page-frame="false"] > [data-ui="record-sheet"] > [data-ui="record-body"] [data-future-field="true"]',
          )
          await expect(futureFields).toHaveCount(0)
          await expect(page.locator('input[name="defaultCode"]:not([type="hidden"])')).toBeDisabled()
          await expect(page.locator('input[name="barcode"]:not([type="hidden"])')).toBeDisabled()
          await expect(page.locator('input[name="origin"]')).toHaveValue('Việt Nam')
          await expect(page.locator('select[name="brandId"]')).toHaveValue('brand-ket')
          await expect(page.locator('select[name="taxId"]')).not.toHaveValue('')
          await expect(page.locator('[data-ui="form-help"]').first()).toContainText(
            locale === 'vi' ? 'Sản phẩm đã có biến thể' : 'This product has variants',
          )
          await expect(page.locator('[data-ui="record-thumbnail"] img')).toHaveAttribute(
            'alt',
            'Áo khoác vận hành màu xanh',
          )
          await expect(page.locator('[data-record-field="archive-reason"]')).toHaveCount(0)

          const placement = await page.evaluate(() => {
            const rect = (selector: string) =>
              document.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
            const workspace = document.querySelector<HTMLElement>(
              '[data-ui="record-workspace"][data-page-frame="false"]',
            )!
            const breadcrumbRect = rect('[data-ket-slot="product.record-header"] > [data-ui="breadcrumbs"]')
            const identityRect = rect('[data-ket-slot="product.record-header"] > [data-ui="record-identity"]')
            const actionRect = rect(
              '[data-ui="record-controller"] button[form="product-detail-form"]:not([data-record-save-options])',
            )
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
            const fieldLabelPlacement = ['type', 'name', 'uomId', 'listPrice'].map((name) => {
              const field = document.querySelector<HTMLElement>(
                `[data-scope="product-detail"] [data-ui="form-field"]:has([name="${name}"])`,
              )!
              const label = field.querySelector<HTMLElement>('[data-ui="form-label"]')!
              const control = field.querySelector<HTMLElement>(
                '[data-ui="form-options"], [data-ui="form-control"]:not([data-ui="relation-native"]), [data-ui="relation-trigger"]',
              )!
              const labelRect = label.getBoundingClientRect()
              const controlRect = control.getBoundingClientRect()
              return {
                inline: labelRect.right <= controlRect.left,
                stacked: labelRect.bottom <= controlRect.top,
              }
            })
            const fieldRect = (name: string) =>
              document
                .querySelector<HTMLElement>(
                  `[data-scope="product-detail"] [data-ui="form-field"]:has([name="${name}"])`,
                )!
                .getBoundingClientRect()
            const typeField = fieldRect('type')
            const nameField = fieldRect('name')
            const categoryField = fieldRect('categoryId')
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
              actionHeight: actionRect.height,
              labelsInline: fieldLabelPlacement.every((field) => field.inline),
              labelsStacked: fieldLabelPlacement.every((field) => field.stacked),
              nameBelowType: typeField.bottom <= nameField.top,
              nameMatchesCategoryWidth: Math.abs(nameField.width - categoryField.width) < 1,
            }
          })
          expect(placement.breadcrumbsBeforeIdentity).toBe(true)
          expect(placement.headerSpansWorkspace).toBe(true)
          expect(placement.navigationBeforeBody).toBe(true)
          expect(placement.singleSectionFrame).toBe(true)
          expect(placement.actionHeight).toBe(40)
          expect(viewport.name === 'desktop' ? placement.labelsInline : placement.labelsStacked).toBe(true)
          expect(placement.nameBelowType).toBe(true)
          expect(placement.nameMatchesCategoryWidth).toBe(true)
          expect(
            viewport.name === 'desktop' ? placement.actionAtIdentityRight : placement.actionAfterIdentity,
          ).toBe(true)
          expect(viewport.name === 'desktop' ? placement.railStartsWithBody : placement.railFollowsBody).toBe(
            true,
          )
        }

        if (tab === 'variants') {
          const attributePanel = page.locator(
            '[data-scope="product-variants"] [data-product-panel="attributes"]',
          )
          const variantPanel = page.locator('[data-scope="product-variants"] [data-product-panel="variants"]')
          await expect(attributePanel).toContainText(locale === 'vi' ? 'Thuộc tính' : 'Attributes')
          await expect(variantPanel).toContainText(locale === 'vi' ? 'Biến thể' : 'Variants')
          await expect(page.locator('[data-product-table="attributes"] [data-ui="row"]')).toHaveCount(3)
          await expect(page.locator('[data-product-table="attributes"]')).not.toContainText('Mùa bán hàng')
          await expect(
            page.locator('select[name="attributeId"] option', { hasText: 'Mùa bán hàng' }),
          ).toHaveCount(0)
          await expect(page.locator('[data-product-table="variants"] [data-ui="row"]')).toHaveCount(10)
          await expect(
            page.locator('[data-product-table="variants"] [data-ui="cell"][data-kind="number"]').first(),
          ).toHaveText('0')
          await expect(
            page
              .locator('[data-product-pagination="true"]')
              .getByRole('link', { name: locale === 'vi' ? 'Trang sau' : 'Next page' }),
          ).toHaveAttribute('href', /page=2/)
          await expect(
            page.getByRole('button', { name: locale === 'vi' ? 'Sinh biến thể' : 'Generate variants' }),
          ).toBeVisible()
          await expect(page.locator('[data-product-attribute-add="true"] > summary')).toContainText(
            locale === 'vi' ? 'Thêm thuộc tính' : 'Add attribute',
          )

          const placement = await page.evaluate(() => {
            const workspace = document.querySelector<HTMLElement>(
              '[data-ui="record-workspace"][data-page-frame="false"]',
            )!
            const attributes = document.querySelector<HTMLElement>('[data-product-panel="attributes"]')!
            const variants = document.querySelector<HTMLElement>('[data-product-panel="variants"]')!
            const body = workspace.querySelector<HTMLElement>(
              ':scope > [data-ui="record-sheet"] > [data-ui="record-body"]',
            )!
            const aside = workspace.querySelector<HTMLElement>(':scope > [data-ui="record-aside"]')!
            const variantTable = document.querySelector<HTMLElement>('[data-product-table="variants"]')!
            return {
              attributesBeforeVariants:
                attributes.getBoundingClientRect().bottom <= variants.getBoundingClientRect().top,
              panelsShareWidth:
                Math.abs(attributes.getBoundingClientRect().width - variants.getBoundingClientRect().width) <
                1,
              tableContained:
                variantTable.getBoundingClientRect().right <= body.getBoundingClientRect().right,
              rowsNavigate: [
                ...document.querySelectorAll('[data-product-table="variants"] [data-ui="row"]'),
              ].every((row) => row.hasAttribute('data-row-href')),
              railStartsWithBody:
                Math.abs(aside.getBoundingClientRect().top - body.getBoundingClientRect().top) < 1,
              railFollowsBody: aside.getBoundingClientRect().top >= body.getBoundingClientRect().bottom,
            }
          })
          expect(placement.attributesBeforeVariants).toBe(true)
          expect(placement.panelsShareWidth).toBe(true)
          expect(placement.tableContained).toBe(true)
          expect(placement.rowsNavigate).toBe(true)
          expect(viewport.name === 'desktop' ? placement.railStartsWithBody : placement.railFollowsBody).toBe(
            true,
          )
        }

        if (tab === 'media') {
          const galleryPanel = page.locator(
            '[data-scope="product-media"] [data-product-media-panel="gallery"]',
          )
          const variantPanel = page.locator(
            '[data-scope="product-media"] [data-product-media-panel="variants"]',
          )
          await expect(galleryPanel).toContainText(locale === 'vi' ? 'Hình ảnh sản phẩm' : 'Product images')
          await expect(variantPanel).toContainText(
            locale === 'vi' ? 'Hình ảnh theo biến thể' : 'Images by variant',
          )
          await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
          await expect(page.locator('[data-product-media-table="variants"] [data-ui="row"]')).toHaveCount(25)
          await expect(page.locator('[data-product-media-thumbnail]')).not.toHaveCount(0)
          await expect(page.locator('[data-ui="record-badges"]')).toHaveCount(0)
          await expect(
            page.getByRole('link', { name: locale === 'vi' ? 'Lưu & đóng' : 'Save & close' }),
          ).toBeVisible()
          const mediaPagination = page.locator('[data-product-media-pagination="true"]')
          await expect(mediaPagination.locator('select')).toHaveValue('25')
          await expect(mediaPagination).toContainText(
            locale === 'vi' ? '1 – 25 / 26 biến thể' : '1 – 25 / 26 variants',
          )
          await expect(
            mediaPagination.getByRole('link', {
              name: locale === 'vi' ? 'Trang sau' : 'Next page',
            }),
          ).toHaveAttribute('href', /variantPage=2/)
          await expect
            .poll(() =>
              page
                .locator('[data-scope="product-media"] img')
                .evaluateAll((images) =>
                  images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
                ),
            )
            .toBe(true)

          const placement = await page.evaluate(() => {
            const workspace = document.querySelector<HTMLElement>(
              '[data-ui="record-workspace"][data-page-frame="false"]',
            )!
            const upload = document.querySelector<HTMLElement>(
              '[data-scope="product-media"] [data-ui="media-actions"]',
            )!
            const gallery = document.querySelector<HTMLElement>(
              '[data-scope="product-media"] [data-ui="media-gallery"]',
            )!
            const body = workspace.querySelector<HTMLElement>(
              ':scope > [data-ui="record-sheet"] > [data-ui="record-body"]',
            )!
            const aside = workspace.querySelector<HTMLElement>(':scope > [data-ui="record-aside"]')!
            return {
              uploadBesideGallery:
                Math.abs(upload.getBoundingClientRect().top - gallery.getBoundingClientRect().top) < 1 &&
                upload.getBoundingClientRect().right <= gallery.getBoundingClientRect().left,
              galleryFollowsUpload:
                gallery.getBoundingClientRect().top >= upload.getBoundingClientRect().bottom,
              railStartsWithBody:
                Math.abs(aside.getBoundingClientRect().top - body.getBoundingClientRect().top) < 1,
              railFollowsBody: aside.getBoundingClientRect().top >= body.getBoundingClientRect().bottom,
            }
          })
          expect(
            viewport.name === 'desktop' ? placement.uploadBesideGallery : placement.galleryFollowsUpload,
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
        // Public dimensions distinguish 34px default fields from 30px compact pagination controls.
        const fieldHeight = tab === 'media' ? 30 : 34
        expect(metrics.visibleControls).toEqual(metrics.visibleControls.map(() => fieldHeight))
        await page.screenshot({
          path: join(artifacts, `detail-${tab}-${locale}-${viewport.name}.png`),
          fullPage: true,
        })
      })
    }
  }
}

test('paginates every variant image row in pages of 25', async ({ page }) => {
  await page.goto('/admin/product/templates/tpl-review?tab=media&lang=vi')
  await expect(page.locator('[data-product-media-table="variants"] [data-ui="row"]')).toHaveCount(25)

  await page
    .locator('[data-product-media-pagination="true"]')
    .getByRole('link', { name: 'Trang sau' })
    .click()

  await expect(page).toHaveURL(/tab=media&variantPage=2&lang=vi/)
  await expect(page.locator('[data-product-media-table="variants"] [data-ui="row"]')).toHaveCount(1)
  await expect(page.locator('[data-product-media-pagination="true"]')).toContainText('26 – 26 / 26 biến thể')
  await expect(page.getByRole('link', { name: 'Trang trước' })).toHaveAttribute('href', /variantPage=1/)
})

test('paginates visible variants in pages of 10 without exposing the implicit default', async ({ page }) => {
  await page.goto('/admin/product/templates/tpl-review?tab=variants&lang=vi')
  const rows = page.locator('[data-product-table="variants"] [data-ui="row"]')
  await expect(rows).toHaveCount(10)
  await expect(page.locator('[data-product-table="variants"]')).not.toContainText('JACKET-DEFAULT')

  await page.getByRole('link', { name: 'Trang sau' }).click()
  await expect(page).toHaveURL(/tab=variants&page=2&lang=vi/)
  await expect(rows).toHaveCount(10)
  await expect(page.getByRole('link', { name: 'Trang trước' })).toHaveAttribute('href', /page=1/)
})

test('uses the semantic dark shell, rail and control surfaces', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')

  const colors = await page.evaluate(() => {
    const background = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!).backgroundColor
    const radius = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!).borderRadius
    return {
      sidebar: background('[data-ui="sidebar"]'),
      shell: background('[data-ui="shell"]'),
      sheet: background('[data-ui="record-sheet"]'),
      rail: background('[data-ui="record-aside"]'),
      control: background('[data-ui="form-control"]'),
      railRadius: radius('[data-ui="record-aside"]'),
      chatterRadius: radius('[data-ui="record-aside"] [data-ui="chatter"]'),
    }
  })
  expect(colors).toEqual({
    sidebar: 'rgb(23, 27, 32)',
    shell: 'rgb(27, 31, 36)',
    sheet: 'rgba(0, 0, 0, 0)',
    rail: 'rgb(24, 28, 33)',
    control: 'rgb(32, 37, 43)',
    railRadius: '0px',
    chatterRadius: '0px',
  })
  await page.screenshot({ path: join(artifacts, 'detail-general-vi-desktop-dark.png'), fullPage: true })
})

test('keeps archive in the record More menu instead of a form section', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')
  await expect(page.locator('[data-record-field="archive-reason"]')).toHaveCount(0)
  const more = page.locator('[data-ui="record-more"]')
  await more.locator('summary').dispatchEvent('click')
  await expect(more).toHaveAttribute('open', '')
  await expect(more.getByRole('button', { name: 'Lưu trữ' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).not.toHaveAttribute('open', '')
})

test('hydrates the relation selector and opens its managed-record dialog', async ({ page }) => {
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')
  const category = page.locator('[data-ui="relation-trigger"][aria-label="Danh mục"]')
  await category.click()
  await expect(category).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-ui="relation-menu"]')).toBeVisible()

  await page.locator('[data-ui="relation-footer"] button').click()
  const dialog = page.locator('[data-ui="modal-sheet"][aria-modal="true"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-ui="relation-dialog-row"]').first()).toBeVisible()
  await page.screenshot({
    path: join(artifacts, 'relation-selector-managed-dialog.png'),
    fullPage: true,
  })

  await dialog.locator('[data-ui="modal-close"]').click()
  await expect(dialog).toHaveCount(0)
})

test('saves the redesigned general form while preserving hidden business flags', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')

  await expect(page.getByLabel('Có thể bán')).toBeChecked()
  await expect(page.getByLabel('Có thể mua')).toBeChecked()
  await expect(page.getByLabel('Theo dõi tồn kho')).toBeChecked()
  await page.getByLabel('Giá bán').fill('1349000')
  await page.getByLabel('Mô tả').fill('Mô tả được lưu từ layout mới.')
  await page.getByLabel('Xuất xứ').fill('Việt Nam · Cập nhật')
  const tax = await page.getByLabel('Thuế suất').inputValue()
  await page.getByRole('button', { name: 'Lưu & đóng', exact: true }).click()

  await expect(page).toHaveURL(/\/admin\/product\/templates\/tpl-review/)
  await expect(page.getByLabel('Giá bán')).toHaveValue('1349000')
  await expect(page.getByLabel('Mô tả')).toHaveValue('Mô tả được lưu từ layout mới.')
  await expect(page.getByLabel('Xuất xứ')).toHaveValue('Việt Nam · Cập nhật')
  await expect(page.getByLabel('Thuế suất')).toHaveValue(tax)
  await expect(page.locator('select[name="brandId"]')).toHaveValue('brand-ket')
  await expect(page.getByLabel('Có thể bán')).toBeChecked()
  await expect(page.getByLabel('Có thể mua')).toBeChecked()
})

test('saves atomically and manages variants and template media', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')
  await expect(page.getByRole('heading', { name: 'Áo khoác vận hành KETSUITE' })).toBeVisible()
  await expect(page.locator('[data-ui="chatter-error"]')).toHaveCount(0)

  await page.locator('input[name="name"]').fill('Tên không được lưu dở dang')
  await page.getByLabel('Theo dõi tồn kho').uncheck()
  await page.getByLabel('Truy xuất').selectOption('serial')
  await page.getByRole('button', { name: 'Lưu & đóng', exact: true }).click()
  await expect(page.locator('[data-ui="notice"][role="alert"]')).toContainText('Dữ liệu chưa hợp lệ')
  await page.reload()
  await expect(page.locator('input[name="name"]')).toHaveValue('Áo khoác vận hành KETSUITE')

  await page.getByLabel('Giá bán').fill('1399000')
  await page.getByLabel('Theo dõi tồn kho').check()
  await page.getByLabel('Truy xuất').selectOption('lot')
  await page.getByRole('button', { name: 'Lưu & đóng', exact: true }).click()
  await expect(page.getByLabel('Giá bán')).toHaveValue('1399000')

  await page.goto('/admin/product/templates/tpl-review?tab=variants&lang=vi')
  await expect(page.locator('[data-product-table="variants"]')).not.toContainText('JACKET-DEFAULT')
  await page.locator('[data-product-attribute-add="true"] > summary').click()
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
  const firstVariant = page.locator('[data-product-table="variants"] [data-ui="row"]').first()
  await expect(firstVariant).toBeVisible()
  await expect(firstVariant).toHaveAttribute('data-row-href', /\/variants\//)

  await page.goto('/admin/product/templates/tpl-review?tab=media&lang=vi')
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
  await expect
    .poll(() =>
      page
        .locator('[data-ui="media-item"] img')
        .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Đặt làm ảnh chính' }).dispatchEvent('click')
  await expect(page.locator('[data-ui="media-item"][data-primary="true"] img')).toHaveAttribute(
    'alt',
    'Áo khoác vận hành màu cam',
  )
  await page.locator('[data-ui="media-file-input"]').setInputFiles(uploadFixture)
  await page.locator('[data-ui="media-upload"]').evaluate((form: HTMLFormElement) => form.requestSubmit())
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(3)
  await page.locator('[data-ui="media-item"] button[aria-label="Xóa ảnh"]').last().click()
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
})
