// The attributes-and-variants editor, as an island inside the product template modal.
//
// One editable copy of the template's setup lives here — attribute lines with their
// values and price extras on top, variant rows below — and nothing reaches the
// server until "Save", which sends the whole copy to `product.saveVariantSetup` in
// one call. The record modal's own views are render-pure and re-read their context
// after every command; a setup that is half-edited across two dozen controls needs
// state that survives a keystroke, which is what an island is for.
//
// It lives in the kit because it writes markup (tools/ui-audit.ts); the product
// module only supplies the setup, the labels and whether the viewer may save.

import { each, effect, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Badge, createLightbox, LightboxThumb, Notice } from '@ketvietlab/design-system'
import type { LightboxLabels } from '@ketvietlab/design-system'
import { callRecordFunction } from './record-modal.tsx'

export type VariantEditorValue = { valueId: string; name: string; priceExtra: string }
export type VariantEditorLine = {
  attributeId: string
  name: string
  createVariant: string
  displayType: string
  values: VariantEditorValue[]
}
export type VariantEditorAttribute = {
  attributeId: string
  name: string
  createVariant: string
  values: Array<{ valueId: string; name: string }>
}
export type VariantEditorVariant = {
  id: string
  valueIds: Record<string, string>
  defaultCode: string | null
  barcode: string | null
  weight: string
  volume: string
  active: boolean
  /** Primary first. */
  images: VariantEditorImage[]
}
export type VariantEditorImage = {
  mediaId: string
  attachmentId: string
  alt: string | null
  primary: boolean
}
export type VariantEditorSetup = {
  templateId: string
  listPrice: string
  lines: VariantEditorLine[]
  catalogue: VariantEditorAttribute[]
  variants: VariantEditorVariant[]
}

export type VariantEditorProps = {
  id: string
  /** The record kind announced in `ket:records-changed` after a save. */
  kind: string
  setup: VariantEditorSetup
  editable: boolean
  saveFunction: string
  /** Every label, already translated; `{name}` params are interpolated here. */
  labels: Record<string, string>
  /** The image viewer's own labels. */
  lightboxLabels: LightboxLabels
  /** Whether the viewer may add or replace, and remove, a variant's image. */
  media: { upload: boolean; remove: boolean }
}

type Row = VariantEditorVariant & { key: string; open: boolean }

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const label = (labels: Record<string, string>, key: string, params: Record<string, unknown> = {}): string =>
  (labels[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))

/** The stored file at a rendition size; the original is served until the render job made it. */
const imageUrl = (attachmentId: string, size: 'thumb' | 'medium' | 'large'): string =>
  `/files/${encodeURIComponent(attachmentId)}?size=${size}`

const IMAGE_TYPES = 'image/avif,image/gif,image/jpeg,image/png,image/webp'

const money = (amount: number): string => (Number.isFinite(amount) ? amount.toLocaleString('vi-VN') : '—')

const decimal = (value: string): number => {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

const isDecimal = (value: string): boolean => /^-?\d+(\.\d+)?$/.test(value.trim())

const inputValue = (event: Event): string =>
  event.currentTarget instanceof HTMLInputElement || event.currentTarget instanceof HTMLSelectElement
    ? event.currentTarget.value
    : ''

let rowSequence = 0
const toRows = (variants: VariantEditorVariant[]): Row[] =>
  variants.map((variant) => ({ ...variant, valueIds: { ...variant.valueIds }, key: variant.id, open: false }))

export function createVariantEditorView(props: VariantEditorProps): IslandController {
  const labels = props.labels
  const t = (key: string, params?: Record<string, unknown>) => label(labels, key, params)
  const editable = props.editable

  let saved = clone(props.setup)
  const listPrice = signal(saved.listPrice)
  const catalogue = signal(saved.catalogue)
  const lines = signal<VariantEditorLine[]>(clone(saved.lines))
  const rows = signal<Row[]>(toRows(saved.variants))
  const openChip = signal<string | null>(null)
  const saving = signal(false)
  const problem = signal<string | null>(null)
  const rowIssues = signal<Record<string, string>>({})
  const notice = signal<string | null>(null)
  const dirty = signal(false)
  /** The row whose image is uploading or being removed, and the one a file is dragged over. */
  const imageBusy = signal<string | null>(null)
  const dragOver = signal<string | null>(null)
  const viewer = createLightbox(props.lightboxLabels, props.id)

  const touch = (): void => {
    dirty.set(true)
    notice.set(null)
  }
  const setLines = (next: VariantEditorLine[]): void => {
    lines.set(next)
    touch()
  }
  const setRows = (next: Row[]): void => {
    rows.set(next)
    touch()
  }
  const updateRow = (key: string, patch: Partial<Row>): void =>
    setRows(rows().map((row) => (row.key === key ? { ...row, ...patch } : row)))

  // ── Derived ──
  const variantLines = (): VariantEditorLine[] =>
    lines().filter((line) => line.createVariant !== 'no_variant' && line.values.length > 0)

  const combinationOf = (row: Row): string | null => {
    const picked: string[] = []
    for (const line of variantLines()) {
      const valueId = row.valueIds[line.attributeId]
      if (!valueId || !line.values.some((value) => value.valueId === valueId)) return null
      picked.push(valueId)
    }
    return picked.join(',')
  }

  /** Rows sharing a combination, by row key → the other row's position (1-based). */
  const duplicates = (): Map<string, number> => {
    const seen = new Map<string, number>()
    const clash = new Map<string, number>()
    rows().forEach((row, index) => {
      if (!row.active) return
      const combination = combinationOf(row)
      if (combination == null) return
      const first = seen.get(combination)
      if (first === undefined) seen.set(combination, index)
      else {
        clash.set(row.key, first + 1)
        clash.set(rows()[first]!.key, index + 1)
      }
    })
    return clash
  }

  const incomplete = (): Set<string> =>
    new Set(
      rows()
        .filter((row) => row.active && combinationOf(row) == null)
        .map((row) => row.key),
    )

  const extraOf = (row: Row): Array<{ line: VariantEditorLine; value: VariantEditorValue }> =>
    variantLines().flatMap((line) => {
      const value = line.values.find((entry) => entry.valueId === row.valueIds[line.attributeId])
      return value ? [{ line, value }] : []
    })

  const priceOf = (row: Row): number =>
    extraOf(row).reduce((total, { value }) => total + decimal(value.priceExtra), decimal(listPrice()))

  const missingCombinations = (): Array<Record<string, string>> => {
    const groups = variantLines()
    if (!groups.length) return []
    const all = groups.reduce<Array<Record<string, string>>>(
      (acc, line) =>
        acc.flatMap((prefix) =>
          line.values.map((value) => ({ ...prefix, [line.attributeId]: value.valueId })),
        ),
      [{}],
    )
    const taken = new Set(
      rows()
        .filter((row) => row.active)
        .map(combinationOf)
        .filter((key): key is string => key != null),
    )
    return all.filter((valueIds) => !taken.has(groups.map((line) => valueIds[line.attributeId]).join(',')))
  }

  const usageOf = (attributeId: string, valueId: string): number =>
    rows().filter((row) => row.active && row.valueIds[attributeId] === valueId).length

  const invalidExtras = (): boolean =>
    lines().some((line) => line.values.some((value) => !isDecimal(value.priceExtra)))

  const blocked = (): boolean =>
    !editable || saving() || !dirty() || duplicates().size > 0 || incomplete().size > 0 || invalidExtras()

  // ── Attribute actions ──
  const addLine = (attributeId: string): void => {
    const attribute = catalogue().find((entry) => entry.attributeId === attributeId)
    if (!attribute) return
    setLines([
      ...lines(),
      {
        attributeId,
        name: attribute.name,
        createVariant: attribute.createVariant,
        displayType: 'select',
        values: [],
      },
    ])
  }

  const removeLine = (attributeId: string): void => {
    setLines(lines().filter((line) => line.attributeId !== attributeId))
    setRows(
      rows().map((row) => {
        const valueIds = { ...row.valueIds }
        delete valueIds[attributeId]
        return { ...row, valueIds }
      }),
    )
  }

  const addValue = (attributeId: string, valueId: string): void => {
    const value = catalogue()
      .find((entry) => entry.attributeId === attributeId)
      ?.values.find((entry) => entry.valueId === valueId)
    if (!value) return
    setLines(
      lines().map((line) =>
        line.attributeId === attributeId
          ? { ...line, values: [...line.values, { valueId, name: value.name, priceExtra: '0' }] }
          : line,
      ),
    )
  }

  const removeValue = (attributeId: string, valueId: string): void => {
    openChip.set(null)
    setLines(
      lines().map((line) =>
        line.attributeId === attributeId
          ? { ...line, values: line.values.filter((value) => value.valueId !== valueId) }
          : line,
      ),
    )
  }

  const setExtra = (attributeId: string, valueId: string, priceExtra: string): void =>
    setLines(
      lines().map((line) =>
        line.attributeId === attributeId
          ? {
              ...line,
              values: line.values.map((value) =>
                value.valueId === valueId ? { ...value, priceExtra } : value,
              ),
            }
          : line,
      ),
    )

  // ── Variant actions ──
  const newRow = (valueIds: Record<string, string>, open: boolean): Row => ({
    id: '',
    key: `new-${++rowSequence}`,
    valueIds,
    defaultCode: null,
    barcode: null,
    weight: '0',
    volume: '0',
    active: true,
    images: [],
    open,
  })

  // ── Images ──
  // An image is not part of the setup Save sends: it is stored and linked the moment
  // it is chosen, like the template's own main image, so it needs a saved variant.

  /** Replace a row's images here and in the saved copy, so Reset does not bring the old ones back. */
  const setImages = (row: Row, images: VariantEditorImage[]): void => {
    rows.set(rows().map((entry) => (entry.key === row.key ? { ...entry, images } : entry)))
    saved = {
      ...saved,
      variants: saved.variants.map((variant) => (variant.id === row.id ? { ...variant, images } : variant)),
    }
  }

  const uploadImage = async (row: Row, file: File): Promise<void> => {
    const replacing = row.images.length > 0
    if (!row.id || !props.media.upload || (replacing && !props.media.remove)) return
    if (imageBusy() || !file.type.startsWith('image/')) return
    imageBusy.set(row.key)
    problem.set(null)
    try {
      const body = new FormData()
      body.append('resModel', 'product.Product')
      body.append('resId', row.id)
      body.append('resField', 'media')
      body.append('public', 'false')
      body.append('file', file, file.name)
      const response = await fetch('/files', { method: 'POST', credentials: 'same-origin', body })
      const stored = (await response.json().catch(() => null)) as { id?: unknown } | null
      if (!response.ok || typeof stored?.id !== 'string') throw new Error(t('imageFailed'))
      const attached = await callRecordFunction('product_media.attachMedia', {
        id: stored.id,
        attachmentId: stored.id,
        productId: row.id,
        alt: file.name,
        primary: true,
      })
      if (!attached.ok) throw new Error(attached.message ?? attached.issues[0]?.message ?? t('imageFailed'))
      const previous = row.images.find((image) => image.primary)
      if (previous) await callRecordFunction('product_media.removeMedia', { id: previous.mediaId })
      setImages(row, [
        { mediaId: stored.id, attachmentId: stored.id, alt: file.name, primary: true },
        ...row.images.filter((image) => image !== previous),
      ])
      document.dispatchEvent(
        new CustomEvent('ket:records-changed', { detail: { kind: props.kind, ids: [saved.templateId] } }),
      )
    } catch (error) {
      problem.set(error instanceof Error ? error.message : t('imageFailed'))
    } finally {
      imageBusy.set(null)
    }
  }

  const removeImage = async (row: Row): Promise<void> => {
    const current = row.images[0]
    if (!current || !props.media.remove || imageBusy()) return
    if (!globalThis.confirm(t('imageRemoveConfirm'))) return
    imageBusy.set(row.key)
    problem.set(null)
    const result = await callRecordFunction('product_media.removeMedia', { id: current.mediaId }).catch(
      () => null,
    )
    imageBusy.set(null)
    if (!result?.ok) {
      problem.set(result && !result.ok ? (result.message ?? t('saveFailed')) : t('saveFailed'))
      return
    }
    const rest = row.images.slice(1)
    // The gallery promotes the next image to primary; mirror that here.
    setImages(
      row,
      rest.map((image, index) => ({ ...image, primary: index === 0 })),
    )
  }

  const openImages = (row: Row, trigger: EventTarget | null): void =>
    viewer.open(
      row.images.map((image) => ({
        src: imageUrl(image.attachmentId, 'large'),
        thumbnail: imageUrl(image.attachmentId, 'thumb'),
        alt: image.alt || t('image'),
        caption: image.alt,
      })),
      0,
      trigger,
    )

  const rowThumb = (row: Row, size: 'small' | 'large'): JSXChild => {
    const image = row.images[0]
    return image ? (
      LightboxThumb({
        item: {
          src: imageUrl(image.attachmentId, 'large'),
          thumbnail: imageUrl(image.attachmentId, 'thumb'),
          alt: image.alt || t('image'),
        },
        labels: props.lightboxLabels,
        size,
        onOpen: (trigger) => openImages(row, trigger),
      })
    ) : (
      <span data-ui="lightbox-empty" data-size={size}>
        {size === 'small' ? '' : t('image')}
      </span>
    )
  }

  const imageBlock = (row: Row): JSXChild => {
    // Replacing attaches then removes, so a row that already has an image needs both.
    const canUpload = editable && props.media.upload && (!row.images.length || props.media.remove)
    const busy = imageBusy() === row.key
    return (
      <div
        role="group"
        aria-label={t('image')}
        data-ui="variant-editor-image"
        data-drag={String(dragOver() === row.key)}
        data-busy={String(busy)}
        title={canUpload && row.id ? t('dropImage') : undefined}
        onDragOver={(event: DragEvent) => {
          if (!canUpload || !row.id) return
          event.preventDefault()
          dragOver.set(row.key)
        }}
        onDragLeave={(event: DragEvent) => {
          const related = event.relatedTarget
          if (related instanceof Node && (event.currentTarget as Element).contains(related)) return
          dragOver.set(null)
        }}
        onDrop={(event: DragEvent) => {
          if (!canUpload || !row.id) return
          event.preventDefault()
          dragOver.set(null)
          const file = event.dataTransfer?.files?.[0]
          if (file) void uploadImage(row, file)
        }}
      >
        {rowThumb(row, 'large')}
        <div data-ui="variant-editor-image-actions">
          {canUpload && row.id ? (
            <label data-ui="variant-editor-image-upload">
              <input
                type="file"
                autocomplete="off"
                accept={IMAGE_TYPES}
                disabled={busy}
                onChange={(event) => {
                  const input = event.currentTarget as HTMLInputElement
                  const file = input.files?.[0]
                  input.value = ''
                  if (file) void uploadImage(row, file)
                }}
              />
              <span>{row.images.length ? t('replaceImage') : t('uploadImage')}</span>
            </label>
          ) : null}
          {canUpload && !row.id ? <small>{t('imageSaveFirst')}</small> : null}
          {editable && props.media.remove && row.images.length ? (
            <button
              type="button"
              data-ui="action"
              data-variant="tertiary"
              data-size="compact"
              disabled={busy}
              onClick={() => void removeImage(row)}
            >
              {t('removeImage')}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const addRow = (): void => setRows([...rows(), newRow({}, true)])
  const generate = (): void => setRows([...rows(), ...missingCombinations().map((ids) => newRow(ids, false))])

  const removeRow = (row: Row): void => {
    // An unsaved row simply goes away; a saved one is archived on save, since it
    // may already be on documents this editor cannot see.
    if (!row.id) setRows(rows().filter((entry) => entry.key !== row.key))
    else updateRow(row.key, { active: !row.active })
  }

  const setAllActive = (active: boolean): void =>
    setRows(
      rows()
        .filter((row) => row.id || active)
        .map((row) => ({ ...row, active })),
    )

  const reset = (): void => {
    listPrice.set(saved.listPrice)
    catalogue.set(saved.catalogue)
    lines.set(clone(saved.lines))
    rows.set(toRows(saved.variants))
    rowIssues.set({})
    problem.set(null)
    openChip.set(null)
    dirty.set(false)
  }

  const save = async (): Promise<void> => {
    if (blocked()) return
    saving.set(true)
    problem.set(null)
    rowIssues.set({})
    const snapshot = rows()
    const result = await callRecordFunction<{
      setup?: VariantEditorSetup
      created?: number
      archived?: number
    }>(props.saveFunction, {
      templateId: saved.templateId,
      lines: lines().map((line) => ({
        attributeId: line.attributeId,
        values: line.values.map((value) => ({ valueId: value.valueId, priceExtra: value.priceExtra.trim() })),
      })),
      variants: snapshot.map((row) => ({
        id: row.id || null,
        valueIds: row.valueIds,
        defaultCode: row.defaultCode,
        barcode: row.barcode,
        weight: row.weight,
        volume: row.volume,
        active: row.active,
      })),
    }).catch(() => null)
    saving.set(false)
    if (!result) {
      problem.set(t('saveFailed'))
      return
    }
    if (!result.ok) {
      const byRow: Record<string, string> = {}
      for (const issue of result.issues) {
        const match = /^variants\.(\d+)(?:\.(\w+))?/.exec(issue.field ?? '')
        const row = match ? snapshot[Number(match[1])] : undefined
        if (row) byRow[row.key] = issue.message ?? issue.code
      }
      rowIssues.set(byRow)
      problem.set(result.message ?? result.issues[0]?.message ?? t('saveFailed'))
      if (Object.keys(byRow).length)
        rows.set(rows().map((row) => (byRow[row.key] ? { ...row, open: true } : row)))
      return
    }
    const next = result.value.setup
    if (next) saved = clone(next)
    reset()
    notice.set(t('saved', { created: result.value.created ?? 0, archived: result.value.archived ?? 0 }))
    document.dispatchEvent(
      new CustomEvent('ket:records-changed', { detail: { kind: props.kind, ids: [saved.templateId] } }),
    )
  }

  // ── Views ──
  const chipView = (line: VariantEditorLine, value: VariantEditorValue): TemplateResult => {
    const chipId = `${line.attributeId}:${value.valueId}`
    const open = openChip() === chipId
    const extra = decimal(value.priceExtra)
    return (
      <li data-ui="variant-editor-chip" data-open={String(open)}>
        <button
          type="button"
          data-ui="variant-editor-chip-trigger"
          aria-expanded={String(open)}
          onClick={() => openChip.set(open ? null : chipId)}
        >
          <span>{value.name}</span>
          {extra ? <small>{`${extra > 0 ? '+' : ''}${money(extra)}`}</small> : null}
        </button>
        {open ? (
          <div data-ui="variant-editor-popover" role="dialog" aria-label={value.name}>
            <label
              data-ui="field"
              data-kind="decimal"
              data-span="full"
              data-invalid={String(!isDecimal(value.priceExtra))}
            >
              <span data-ui="field-label">{t('priceExtra')}</span>
              <input
                type="text"
                autocomplete="off"
                inputmode="decimal"
                value={value.priceExtra}
                disabled={!editable}
                onInput={(event) => setExtra(line.attributeId, value.valueId, inputValue(event))}
              />
            </label>
            <small data-ui="variant-editor-hint">
              {t('appliesTo', { count: usageOf(line.attributeId, value.valueId) })}
            </small>
            <div data-ui="variant-editor-popover-actions">
              {editable ? (
                <button
                  type="button"
                  data-ui="action"
                  data-variant="tertiary"
                  data-size="compact"
                  onClick={() => removeValue(line.attributeId, value.valueId)}
                >
                  {t('removeValue')}
                </button>
              ) : null}
              <button
                type="button"
                data-ui="action"
                data-variant="secondary"
                data-size="compact"
                onClick={() => openChip.set(null)}
              >
                {t('done')}
              </button>
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  const lineView = (line: VariantEditorLine): TemplateResult => {
    const available = (
      catalogue().find((entry) => entry.attributeId === line.attributeId)?.values ?? []
    ).filter((value) => !line.values.some((held) => held.valueId === value.valueId))
    return (
      <li data-ui="variant-editor-line">
        <div data-ui="variant-editor-line-head">
          <strong>{line.name}</strong>
          {line.createVariant === 'no_variant' ? Badge({ label: t('noVariant'), tone: 'neutral' }) : null}
        </div>
        <ul data-ui="variant-editor-chips">
          {each(
            line.values,
            (value) => value.valueId,
            (value) => chipView(line, value),
          )}
          {editable && available.length ? (
            <li>
              <select
                data-ui="variant-editor-add-value"
                aria-label={t('addValue')}
                onChange={(event) => {
                  const valueId = inputValue(event)
                  if (valueId) addValue(line.attributeId, valueId)
                  if (event.currentTarget instanceof HTMLSelectElement) event.currentTarget.value = ''
                }}
              >
                <option value="">{t('addValue')}</option>
                {each(
                  available,
                  (value) => value.valueId,
                  (value) => (
                    <option value={value.valueId}>{value.name}</option>
                  ),
                )}
              </select>
            </li>
          ) : null}
        </ul>
        {editable ? (
          <button
            type="button"
            data-ui="action"
            data-variant="tertiary"
            data-size="compact"
            onClick={() => removeLine(line.attributeId)}
          >
            {t('removeAttribute')}
          </button>
        ) : null}
      </li>
    )
  }

  const attributesView = (): JSXChild => {
    const unused = catalogue().filter(
      (entry) => !lines().some((line) => line.attributeId === entry.attributeId),
    )
    return (
      <section data-ui="variant-editor-section" aria-labelledby={`${props.id}-attributes`}>
        <header data-ui="variant-editor-section-head">
          <h3 id={`${props.id}-attributes`}>{t('attributesTitle')}</h3>
          <p>{t('attributesHint')}</p>
        </header>
        {lines().length ? (
          <ul data-ui="variant-editor-lines">
            {each(
              lines(),
              (line) => line.attributeId,
              (line) => lineView(line),
            )}
          </ul>
        ) : (
          Notice({ title: t('attributesEmpty'), message: t('attributesEmptyHint') })
        )}
        {editable && unused.length ? (
          <select
            data-ui="variant-editor-add-attribute"
            aria-label={t('addAttribute')}
            onChange={(event) => {
              const attributeId = inputValue(event)
              if (attributeId) addLine(attributeId)
              if (event.currentTarget instanceof HTMLSelectElement) event.currentTarget.value = ''
            }}
          >
            <option value="">{t('addAttribute')}</option>
            {each(
              unused,
              (entry) => entry.attributeId,
              (entry) => (
                <option value={entry.attributeId}>{entry.name}</option>
              ),
            )}
          </select>
        ) : null}
      </section>
    )
  }

  const textField = (
    row: Row,
    field: 'defaultCode' | 'barcode' | 'weight' | 'volume',
    decimalField = false,
  ): JSXChild => {
    const value = String(row[field] ?? '')
    return (
      <label
        data-ui="field"
        data-kind={decimalField ? 'decimal' : 'text'}
        data-span="half"
        data-invalid={String(decimalField && !isDecimal(value))}
      >
        <span data-ui="field-label">{t(field)}</span>
        <input
          type="text"
          autocomplete="off"
          inputmode={decimalField ? 'decimal' : null}
          value={value}
          disabled={!editable}
          onInput={(event) => {
            const next = inputValue(event)
            updateRow(row.key, { [field]: decimalField ? next : next || null } as Partial<Row>)
          }}
        />
      </label>
    )
  }

  const rowStatus = (row: Row, clash: Map<string, number>, open: Set<string>): JSXChild => {
    if (!row.active) return Badge({ label: t('archived'), tone: 'neutral' })
    if (clash.has(row.key))
      return Badge({ label: t('duplicate', { row: clash.get(row.key) }), tone: 'danger' })
    if (open.has(row.key)) return Badge({ label: t('incomplete'), tone: 'warning' })
    if (!row.id) return Badge({ label: t('new'), tone: 'info' })
    // The row number already sits at the start of the row; a code-less row shows no badge.
    return row.defaultCode ? Badge({ label: row.defaultCode, tone: 'neutral' }) : ''
  }

  const rowView = (
    row: Row,
    index: number,
    clash: Map<string, number>,
    open: Set<string>,
  ): TemplateResult => {
    const breakdown = extraOf(row).filter(({ value }) => decimal(value.priceExtra) !== 0)
    return (
      <article
        data-ui="variant-editor-row"
        data-active={String(row.active)}
        data-invalid={String(clash.has(row.key) || Boolean(rowIssues()[row.key]))}
      >
        <div data-ui="variant-editor-row-head">
          <span data-ui="variant-editor-row-number">{`#${index + 1}`}</span>
          {rowThumb(row, 'small')}
          <div data-ui="variant-editor-row-values">
            {each(
              variantLines(),
              (line) => line.attributeId,
              (line) => (
                <select
                  aria-label={line.name}
                  disabled={!editable || !row.active}
                  onChange={(event) =>
                    updateRow(row.key, {
                      valueIds: { ...row.valueIds, [line.attributeId]: inputValue(event) },
                    })
                  }
                >
                  <option value="" selected={!row.valueIds[line.attributeId]}>
                    {t('choose', { name: line.name })}
                  </option>
                  {each(
                    line.values,
                    (value) => value.valueId,
                    (value) => (
                      <option
                        value={value.valueId}
                        selected={row.valueIds[line.attributeId] === value.valueId}
                      >
                        {value.name}
                      </option>
                    ),
                  )}
                </select>
              ),
            )}
          </div>
          {rowStatus(row, clash, open)}
          <span data-ui="variant-editor-row-price">{money(priceOf(row))}</span>
          <div data-ui="variant-editor-row-actions">
            <button
              type="button"
              data-ui="action"
              data-variant="tertiary"
              data-size="compact"
              aria-expanded={String(row.open)}
              onClick={() =>
                rows.set(
                  rows().map((entry) => (entry.key === row.key ? { ...entry, open: !entry.open } : entry)),
                )
              }
            >
              {row.open ? t('collapse') : t('edit')}
            </button>
            {editable ? (
              <button
                type="button"
                data-ui="action"
                data-variant="tertiary"
                data-size="compact"
                onClick={() => removeRow(row)}
              >
                {!row.id ? t('remove') : row.active ? t('archive') : t('restore')}
              </button>
            ) : null}
          </div>
        </div>
        {rowIssues()[row.key] ? <p data-ui="variant-editor-row-issue">{rowIssues()[row.key]}</p> : null}
        {row.open ? (
          <div data-ui="variant-editor-row-body">
            {imageBlock(row)}
            <div data-ui="variant-editor-fields">
              {textField(row, 'defaultCode')}
              {textField(row, 'barcode')}
              {textField(row, 'weight', true)}
              {textField(row, 'volume', true)}
            </div>
            <p data-ui="variant-editor-breakdown">
              {[
                `${t('listPrice')} ${money(decimal(listPrice()))}`,
                ...breakdown.map(
                  ({ line, value }) => `${line.name} ${value.name} +${money(decimal(value.priceExtra))}`,
                ),
              ].join(' · ')}
              {` = ${money(priceOf(row))}`}
            </p>
          </div>
        ) : null}
      </article>
    )
  }

  const variantsView = (): JSXChild => {
    const clash = duplicates()
    const open = incomplete()
    const missing = missingCombinations()
    const activeCount = rows().filter((row) => row.active).length
    return (
      <section data-ui="variant-editor-section" aria-labelledby={`${props.id}-variants`}>
        <header data-ui="variant-editor-section-head">
          <h3 id={`${props.id}-variants`}>{t('variantsTitle')}</h3>
          <p>{t('variantsCount', { active: activeCount, total: rows().length })}</p>
        </header>
        {editable && variantLines().length ? (
          <div data-ui="variant-editor-toolbar">
            <button
              type="button"
              data-ui="action"
              data-variant="secondary"
              data-size="compact"
              onClick={generate}
              disabled={!missing.length}
            >
              {t('generate')}
            </button>
            <button
              type="button"
              data-ui="action"
              data-variant="secondary"
              data-size="compact"
              onClick={addRow}
            >
              {t('addVariant')}
            </button>
            <button
              type="button"
              data-ui="action"
              data-variant="tertiary"
              data-size="compact"
              onClick={() => setAllActive(true)}
            >
              {t('activateAll')}
            </button>
            <button
              type="button"
              data-ui="action"
              data-variant="tertiary"
              data-size="compact"
              onClick={() => setAllActive(false)}
            >
              {t('archiveAll')}
            </button>
          </div>
        ) : null}
        {editable && missing.length && rows().length ? (
          <p data-ui="variant-editor-suggestion">{t('missing', { count: missing.length })}</p>
        ) : null}
        {rows().length ? (
          <div data-ui="variant-editor-rows">
            {each(
              rows(),
              (row) => row.key,
              (row) => rowView(row, rows().indexOf(row), clash, open),
            )}
          </div>
        ) : (
          Notice({
            title: t('variantsEmpty'),
            message: variantLines().length ? t('variantsEmptyHint') : t('variantsNeedAttributes'),
          })
        )}
      </section>
    )
  }

  const footerView = (): JSXChild => {
    const clash = duplicates().size
    const archiving = rows().filter(
      (row) => row.id && !row.active && saved.variants.find((v) => v.id === row.id)?.active,
    ).length
    const creating = rows().filter((row) => !row.id && row.active).length
    const parts = [
      creating ? t('summaryCreate', { count: creating }) : '',
      archiving ? t('summaryArchive', { count: archiving }) : '',
    ].filter(Boolean)
    return (
      <footer data-ui="variant-editor-footer">
        <p data-ui="variant-editor-summary" data-tone={clash ? 'danger' : 'neutral'} aria-live="polite">
          {clash
            ? t('summaryDuplicate')
            : (notice() ?? (dirty() ? parts.join(' · ') || t('summaryChanged') : ''))}
        </p>
        {editable ? (
          <div data-ui="variant-editor-footer-actions">
            <button
              type="button"
              data-ui="action"
              data-variant="secondary"
              disabled={!dirty() || saving()}
              onClick={reset}
            >
              {t('reset')}
            </button>
          </div>
        ) : null}
      </footer>
    )
  }

  // Save lives in the modal footer, outside this island: it submits this empty form,
  // and the island keeps that button's disabled and busy state in step with its own.
  const saveForm = variantEditorSaveForm(props.id)
  const saveButton = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>(`button[form="${saveForm}"]`)

  return {
    view: () => (
      <div data-ui="variant-editor" id={props.id}>
        {editable ? null : Notice({ title: t('readOnly'), message: '' })}
        {problem() ? Notice({ title: t('saveFailed'), message: problem() ?? '', tone: 'danger' }) : null}
        {attributesView()}
        {variantsView()}
        {footerView()}
        <form id={saveForm} hidden />
        {viewer.layer()}
      </div>
    ),
    mount: ({ lifetime }) => {
      viewer.attach(lifetime)
      // Capture phase, so the record modal's own submit handler never sees this form.
      document.addEventListener(
        'submit',
        (event) => {
          if (!(event.target instanceof HTMLFormElement) || event.target.id !== saveForm) return
          event.preventDefault()
          event.stopImmediatePropagation()
          if (!blocked()) void save()
        },
        { signal: lifetime, capture: true },
      )
      const stop = effect(() => {
        const button = saveButton()
        if (!button) return
        button.disabled = blocked()
        if (saving()) button.setAttribute('aria-busy', 'true')
        else button.removeAttribute('aria-busy')
      })
      lifetime.addEventListener('abort', stop)
      document.addEventListener(
        'click',
        (event) => {
          if (!openChip()) return
          const target = event.target
          // A click inside the open chip (its input, its buttons) keeps it open.
          if (
            target instanceof Element &&
            target.closest('[data-ui="variant-editor-chip"][data-open="true"]')
          )
            return
          openChip.set(null)
        },
        { signal: lifetime },
      )
    },
  }
}

/** The id of the form a Save button outside the island submits to save this editor. */
export const variantEditorSaveForm = (id: string): string => `${id}-save`

export const variantEditor = (props: IslandProps): IslandController =>
  createVariantEditorView(props as unknown as VariantEditorProps)
