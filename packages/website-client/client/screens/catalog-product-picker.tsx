import { createRoot, domHost } from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'
import {
  Button,
  Checkbox,
  Disclosure,
  EmptyState,
  Grid,
  IconButton,
  Inline,
  ModalSheet,
  Notice,
  SearchField,
  Select,
  Stack,
  Surface,
  Switch,
  Text,
} from '@ketvietlab/design-system'
import { icon } from '../ui.tsx'
import { safeImage } from '../renderer.tsx'
import type { StudioContext } from '../types.ts'

type Candidate = {
  id: string
  name: string
  sku: string
  category: string
  brand?: string
  image: string
  visible: boolean
  active: boolean
  price?: number
}
type Page = {
  rows: Candidate[]
  total: number
  page: number
  pages: number
  pageSize: number
  groups: string[]
  brands: string[]
}

/** One bounded, disposable picker island. Modal changes are drafts until Apply, then the record Save commits them. */
export function createCatalogProductPicker(
  ctx: StudioContext,
  options: {
    productIds: string[]
    excludeIds: string[]
    collection: boolean
    groups: string[]
    source?: 'unlinked'
    maxSelection?: 1
  },
) {
  const label = (key: string, vars: Record<string, string | number> = {}) =>
    ctx.tr(`website.catalogPicker.${key}`, vars)
  const names = new Map<string, string>()
  let applied = [...options.productIds],
    exclusions = [...options.excludeIds],
    selected = [...applied]
  let target: 'productIds' | 'excludeIds' = 'productIds',
    mode = 'all',
    search = '',
    group = '',
    brand = '',
    type = '',
    status = '',
    loading = false,
    error = ''
  let result: Page = {
    rows: [],
    total: 0,
    page: 1,
    pages: 1,
    pageSize: 24,
    groups: options.groups,
    brands: [],
  }
  let abort: AbortController | undefined,
    alive = true,
    root: HTMLElement | undefined
  const areas = new Map<string, ReturnType<typeof createRoot>>()
  const touch = () => {
    if (!alive || !root) return
    for (const [key, view] of [
      ['summary', summary],
      ['body', body],
      ['actions', actions],
    ] as const) {
      const el = root.querySelector<HTMLElement>(`[data-picker-region="${key}"]`)
      if (!el) continue
      if (!areas.has(key)) {
        el.replaceChildren()
        areas.set(key, createRoot(domHost(), el as unknown as HostNode))
      }
      areas.get(key)!.render(view())
    }
  }
  const close = () => root?.querySelector<HTMLDialogElement>('dialog')?.close()
  const load = async (page = 1) => {
    abort?.abort()
    const request = new AbortController()
    abort = request
    loading = true
    error = ''
    touch()
    try {
      const next = await ctx.call<Page>(
        'website_catalog.productCandidates',
        {
          siteId: ctx.site().id,
          source: options.source,
          search,
          group,
          brand,
          type,
          status,
          mode,
          page,
          selectedIds: selected,
        },
        { signal: request.signal },
      )
      if (!alive || request.signal.aborted) return
      result = next
      for (const p of next.rows) names.set(p.id, p.name)
    } catch (e) {
      if (alive && !request.signal.aborted) error = (e as Error).message
    } finally {
      if (alive && !request.signal.aborted) {
        loading = false
        touch()
      }
    }
  }
  const focusAgain = (id: string) =>
    setTimeout(() => root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus(), 0)
  const filters = () => {
    if (!root) return
    search = root.querySelector<HTMLInputElement>('[name="pickerSearch"]')?.value || ''
    for (const key of ['group', 'brand', 'type', 'status']) {
      const value = root.querySelector<HTMLSelectElement>(`[name="picker-${key}"]`)?.value || ''
      if (key === 'group') group = value
      else if (key === 'brand') brand = value
      else if (key === 'type') type = value
      else if (key === 'status') status = value
    }
    mode = root.querySelector<HTMLInputElement>('[name="picker-selected"]')?.checked ? 'selected' : 'all'
    void load()
  }
  const summary = () => (
    <>
      <Inline
        items={[
          <Text
            children={
              options.maxSelection && applied[0]
                ? names.get(applied[0]) || label('selected', { count: applied.length })
                : label('selected', { count: applied.length })
            }
          />,
          <Button
            name="picker-open"
            label={label('manage')}
            disabled={!ctx.can('website.catalog.configure')}
          />,
          options.collection ? (
            <>
              <Text children={label('excluded', { count: exclusions.length })} />
              <Button
                name="picker-exclusions"
                label={label('manageExclusions')}
                disabled={!ctx.can('website.catalog.configure')}
              />
            </>
          ) : null,
        ]}
      />
    </>
  )
  const body = () => (
    <Stack
      items={[
        <Notice
          tone="info"
          title={label(target === 'productIds' ? 'includeTitle' : 'excludeTitle')}
          message={label('help')}
        />,
        <Disclosure
          summary={label('filters')}
          body={
            <Grid
              columns={2}
              mobileColumns={1}
              items={[
                <Select
                  id="picker-group"
                  name="picker-group"
                  label={label('group')}
                  value={group}
                  options={[
                    { value: '', label: label('allGroups') },
                    ...result.groups.map((value) => ({
                      value,
                      label: value,
                    })),
                  ]}
                />,
                <Select
                  id="picker-brand"
                  name="picker-brand"
                  label={label('brand')}
                  value={brand}
                  options={[
                    { value: '', label: label('allBrands') },
                    ...result.brands.map((value) => ({
                      value,
                      label: value,
                    })),
                  ]}
                />,
                <Select
                  id="picker-type"
                  name="picker-type"
                  label={label('type')}
                  value={type}
                  options={[
                    { value: '', label: label('allTypes') },
                    ...['goods', 'service'].map((value) => ({
                      value,
                      label: ctx.tr(`website.catalog.${value}`),
                    })),
                  ]}
                />,
                <Select
                  id="picker-status"
                  name="picker-status"
                  label={label('status')}
                  value={status}
                  options={[
                    { value: '', label: label('allStatuses') },
                    {
                      value: 'visible',
                      label: ctx.tr('website.catalog.visible'),
                    },
                    {
                      value: 'hidden',
                      label: ctx.tr('website.catalog.hidden'),
                    },
                  ]}
                />,
              ]}
            />
          }
        />,

        <div class="website-catalog-picker-toolbar">
          <Inline
            blockAlign="center"
            items={[
              <Text
                children={label('selection', {
                  selected: selected.length,
                  total: result.total,
                })}
              />,
              <Button
                name="picker-page-select"
                label={label('selectPage')}
                disabled={loading || !result.rows.length || !!options.maxSelection}
              />,
              <Button
                name="picker-page-clear"
                label={label('clearPage')}
                disabled={loading || !result.rows.length || !!options.maxSelection}
              />,
            ]}
          />
          <div class="website-catalog-picker-controls">
            <div class="website-catalog-picker-search">
              <SearchField
                id="picker-search"
                name="pickerSearch"
                label={label('search')}
                labelHidden
                placeholder={label('search')}
                autocomplete="off"
                value={search}
              />
              <Button name="picker-search" label={ctx.tr('website.search.submit')} />
            </div>
            <Switch
              id="picker-selected"
              name="picker-selected"
              label={label('chosen')}
              inline
              checked={mode === 'selected'}
            />
          </div>
        </div>,
        error ? <Notice tone="danger" title={label('error')} message={error} /> : null,
        loading ? (
          <Text children={label('loading')} />
        ) : result.rows.length ? (
          <Grid
            columns={4}
            mobileColumns={2}
            items={result.rows.map((p) => (
              <Surface
                body={
                  <Stack
                    items={[
                      <div class="website-catalog-picker-image">
                        {safeImage(p.image) ? (
                          <img src={safeImage(p.image)} alt={p.name} loading="lazy" />
                        ) : (
                          <span>{label('noImage')}</span>
                        )}
                      </div>,
                      <Checkbox
                        id={`picker-choice-${p.id}`}
                        name="picker-choice"
                        submitValue={p.id}
                        label={p.name}
                        checked={selected.includes(p.id)}
                      />,
                      <Text children={p.sku} />,
                      <Text children={p.brand || p.category} />,
                      p.visible && p.active ? null : <Text children={ctx.tr('website.catalog.hidden')} />,
                      mode === 'selected' && target === 'productIds' && !options.maxSelection ? (
                        <Inline
                          items={[
                            <Text
                              children={label('rank', {
                                rank: selected.indexOf(p.id) + 1,
                              })}
                            />,
                            <IconButton
                              id={`picker-up-${p.id}`}
                              name="picker-up"
                              value={p.id}
                              label={label('up')}
                              icon={icon('arrow-up')}
                              disabled={selected.indexOf(p.id) <= 0}
                            />,
                            <IconButton
                              id={`picker-down-${p.id}`}
                              name="picker-down"
                              value={p.id}
                              label={label('down')}
                              icon={icon('arrow-down')}
                              disabled={selected.indexOf(p.id) >= selected.length - 1}
                            />,
                          ]}
                        />
                      ) : null,
                    ]}
                  />
                }
              />
            ))}
          />
        ) : (
          <EmptyState title={label('empty')} message={label('emptyHelp')} />
        ),
      ]}
    />
  )
  const actions = () => (
    <Inline
      items={[
        <Button name="picker-prev" label={label('previous')} disabled={loading || result.page <= 1} />,
        <Text
          children={label('page', {
            page: result.page,
            pages: result.pages,
          })}
        />,
        <Button name="picker-next" label={label('next')} disabled={loading || result.page >= result.pages} />,
        <Button name="picker-cancel" label={ctx.tr('website.catalog.cancel')} />,
        <Button
          name="picker-apply"
          label={label('apply', { count: selected.length })}
          variant="primary"
          disabled={loading || !!error}
        />,
      ]}
    />
  )
  const view = () => (
    <div
      class="website-catalog-picker"
      on:click={(event: MouseEvent) => {
        root = event.currentTarget as HTMLElement
        const button = (event.target as Element).closest<HTMLButtonElement>('button')
        if (!button) return
        const action = button.name
        if ((event.target as Element).closest('[data-ui="modal-close"], [data-ui="modal-backdrop"]')) close()
        if (action === 'picker-open' || action === 'picker-exclusions') {
          target = action === 'picker-open' ? 'productIds' : 'excludeIds'
          selected = [...(target === 'productIds' ? applied : exclusions)]
          mode = 'all'
          search = ''
          group = ''
          brand = ''
          type = ''
          status = ''
          result.rows = []
          touch()
          root.querySelector<HTMLDialogElement>('dialog')?.showModal()
          void load()
        } else if (action === 'picker-search') filters()
        else if (action === 'picker-page-select' || action === 'picker-page-clear') {
          const ids = new Set(result.rows.map((p) => p.id))
          selected =
            action === 'picker-page-select'
              ? [...new Set([...selected, ...ids])]
              : selected.filter((id) => !ids.has(id))
          touch()
        } else if (action === 'picker-prev') void load(result.page - 1)
        else if (action === 'picker-next') void load(result.page + 1)
        else if (action === 'picker-apply') {
          if (target === 'productIds') {
            applied = [...selected]
            exclusions = exclusions.filter((id) => !applied.includes(id))
          } else {
            exclusions = [...selected]
            applied = applied.filter((id) => !exclusions.includes(id))
          }
          if (root) {
            root.querySelector<HTMLInputElement>('[name="productIdsJSON"]')!.value = JSON.stringify(applied)
            root.querySelector<HTMLInputElement>('[name="excludeIdsJSON"]')!.value =
              JSON.stringify(exclusions)
          }
          touch()
          close()
        } else if (action === 'picker-cancel') close()
        else if (action === 'picker-up' || action === 'picker-down') {
          const index = selected.indexOf(button.value),
            next = index + (action === 'picker-up' ? -1 : 1)
          if (index >= 0 && next >= 0 && next < selected.length) {
            ;[selected[index], selected[next]] = [selected[next], selected[index]]
            void load(result.page).then(() => focusAgain(button.id))
          }
        }
      }}
      on:change={(event: Event) => {
        root = event.currentTarget as HTMLElement
        const input = event.target as HTMLInputElement
        if (input.name === 'picker-choice') {
          selected = input.checked
            ? options.maxSelection
              ? [input.value]
              : [...new Set([...selected, input.value])]
            : selected.filter((id) => id !== input.value)
          touch()
          focusAgain(input.id)
        } else if (input.name.startsWith('picker-')) filters()
      }}
      on:keydown={(event: KeyboardEvent) => {
        if (event.key === 'Enter' && (event.target as HTMLInputElement).name === 'pickerSearch') {
          event.preventDefault()
          filters()
        }
      }}
    >
      <input type="hidden" name="productIdsJSON" value={JSON.stringify(applied)} />
      <input type="hidden" name="excludeIdsJSON" value={JSON.stringify(exclusions)} />
      <div data-picker-region="summary">{summary()}</div>
      {/* Native dialog owns focus trapping, Escape and background inertness; ModalSheet owns geometry. */}
      <dialog
        id="catalog-product-picker-dialog"
        class="website-confirm-dialog"
        aria-labelledby="catalog-product-picker-title"
        onClose={() => {
          abort?.abort()
          root
            ?.querySelector<HTMLButtonElement>(
              `[name="${target === 'productIds' ? 'picker-open' : 'picker-exclusions'}"]`,
            )
            ?.focus()
        }}
      >
        <ModalSheet
          id="catalog-product-picker"
          title={label('title')}
          mode="client"
          dialogSemantics="parent"
          presentation="dialog"
          size="large"
          height="fixed"
          closeLabel={ctx.tr('website.action.close')}
          body={<div data-picker-region="body">{body()}</div>}
          actions={<div data-picker-region="actions">{actions()}</div>}
        />
      </dialog>
    </div>
  )
  return {
    view,
    dispose() {
      alive = false
      abort?.abort()
      close()
      for (const area of areas.values()) area.dispose()
      areas.clear()
    },
  }
}
