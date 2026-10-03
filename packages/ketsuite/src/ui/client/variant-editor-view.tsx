// The attributes-and-variants editor, as an island inside the product template modal.
//
// One editable copy of the template's setup lives here — attribute lines with their
// values and price extras on top, variant rows below — and nothing reaches the
// server until "Save", which sends the whole copy to `product.saveVariantSetup` in
// one call. The record modal's own views are render-pure and re-read their context
// after every command; a setup that is half-edited across two dozen controls needs
// state that survives a keystroke, which is what an island is for.
//
// The tab reads as two steps: pick attributes and tick the values this product is
// sold in, then turn the missing combinations into variant rows and fill them in.
// Every control is a design-system one; the island listens once on its root and
// routes by control name (`values|…`, `extra|…`, `combo|…`, `field|…`) or by the
// `variantAction` button value, so no control needs its own handler.
//
// It lives in the kit because it writes markup (tools/ui-audit.ts); the product
// module only supplies the setup, the labels and whether the viewer may save.

import { each, effect, signal } from '@ketvietlab/ketjs-view'
import type {
  IslandController,
  IslandElement,
  IslandProps,
  JSXChild,
  TemplateResult,
} from '@ketvietlab/ketjs-view'
import {
  Badge,
  Button,
  CheckboxGroup,
  createLightbox,
  createRelationSelectView,
  Disclosure,
  EmptyState,
  DropZone,
  Field,
  IconButton,
  LightboxThumb,
  MoneyField,
  Notice,
  Section,
  Select,
  TextField,
} from '@ketvietlab/design-system'
import type { LightboxLabels, RelationSelectLabels } from '@ketvietlab/design-system'
import { icon } from '../icons.ts'
import { callRecordFunction } from './record-modal.tsx'
import { createVariantAttributeForm } from './variant-attribute-create.tsx'

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
  /** Separate permission for creating shared catalogue attributes. */
  createAttribute?: boolean
  saveFunction: string
  /** Every label, already translated; `{name}` params are interpolated here. */
  labels: Record<string, string>
  relationLabels: RelationSelectLabels
  /** The image viewer's own labels. */
  lightboxLabels: LightboxLabels
  /** Whether the viewer may add or replace, and remove, a variant's image. */
  media: { upload: boolean; remove: boolean }
}

type Row = VariantEditorVariant & { key: string; open: boolean }
type RowField = 'defaultCode' | 'barcode' | 'weight' | 'volume'

/** The name every action button shares; its value says which action and on what. */
const ACTION = 'variantAction'

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

const signed = (value: string): string => {
  if (!isDecimal(value)) return value.trim() || '?'
  const amount = decimal(value)
  return `${amount > 0 ? '+' : ''}${money(amount)}`
}

/** How many combinations the "missing" notice names before summing up the rest. */
const PREVIEW = 3

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
  /** Attribute lines whose price-extra disclosure the user opened. */
  const openExtras = signal<string[]>([])
  const saving = signal(false)
  const problem = signal<string | null>(null)
  const rowIssues = signal<Record<string, string>>({})
  const notice = signal<string | null>(null)
  const dirty = signal(false)
  /** The row whose image is uploading or being removed, and the one a file is dragged over. */
  const imageBusy = signal<string | null>(null)
  const dragOver = signal<string | null>(null)
  const viewer = createLightbox(props.lightboxLabels, props.id)
  let host: HTMLElement | null = null
  let disposed = false

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
  const rowOf = (key: string): Row | undefined => rows().find((row) => row.key === key)

  /** Moves focus once the render that follows a change has landed. */
  const focusSoon = (selector: string, fallback?: string): void => {
    setTimeout(() => {
      if (disposed || !host) return
      const target =
        host.querySelector<HTMLElement>(selector) ??
        (fallback ? host.querySelector<HTMLElement>(fallback) : null)
      target?.focus()
    }, 0)
  }
  const pickerTrigger = `[id="${props.id}-attribute-picker"] button`
  const actionButton = (value: string): string => `button[name="${ACTION}"][value="${value}"]`

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

  /** A combination as it reads in a row title: "Đỏ / 50 ml", or what is still to choose. */
  const combinationLabel = (valueIds: Record<string, string>): string =>
    variantLines().length
      ? variantLines()
          .map(
            (line) =>
              line.values.find((value) => value.valueId === valueIds[line.attributeId])?.name ??
              t('choose', { name: line.name }),
          )
          .join(' / ')
      : t('defaultVariant')

  const usageOf = (attributeId: string, valueId: string): number =>
    rows().filter((row) => row.active && row.valueIds[attributeId] === valueId).length

  const invalidExtras = (): boolean =>
    lines().some((line) => line.values.some((value) => !isDecimal(value.priceExtra)))

  const rowInvalid = (row: Row): boolean => !isDecimal(row.weight) || !isDecimal(row.volume)
  const invalidRows = (): boolean => rows().some(rowInvalid)

  const blocked = (): boolean =>
    !editable ||
    saving() ||
    attributeForm.open() ||
    !dirty() ||
    duplicates().size > 0 ||
    incomplete().size > 0 ||
    invalidExtras() ||
    invalidRows()

  /** Every value the line could hold: the catalogue's, then any the line keeps that it no longer lists. */
  const optionsOf = (line: VariantEditorLine): Array<{ valueId: string; name: string }> => {
    const listed = catalogue().find((entry) => entry.attributeId === line.attributeId)?.values ?? []
    return [
      ...listed,
      ...line.values.filter((value) => !listed.some((entry) => entry.valueId === value.valueId)),
    ]
  }

  const firstValueOf = (attributeId: string): string => `input[name="values|${attributeId}[]"]`

  const attributeForm = createVariantAttributeForm({
    id: props.id,
    kind: props.kind,
    enabled: editable && props.createAttribute === true,
    launcher: false,
    returnFocus: () => host?.querySelector<HTMLElement>(pickerTrigger)?.focus(),
    disabled: saving,
    t,
    added: (attribute) => {
      catalogue.set([...catalogue(), attribute])
      // Reset discards the template draft, not the newly saved shared attribute.
      saved.catalogue = [...saved.catalogue, attribute]
      setLines([
        ...lines(),
        {
          attributeId: attribute.attributeId,
          name: attribute.name,
          createVariant: attribute.createVariant,
          displayType: 'select',
          values: attribute.values.map((value) => ({ ...value, priceExtra: '0' })),
        },
      ])
      // After the form hands focus back to the picker: the next step is this line's values.
      focusSoon(firstValueOf(attribute.attributeId))
    },
  })

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
    focusSoon(firstValueOf(attributeId), pickerTrigger)
  }

  const attributePicker = createRelationSelectView(
    {
      id: `${props.id}-attribute-picker`,
      config: {
        name: 'addAttributeId',
        ariaLabel: t('addAttribute'),
        options: [],
        labels: { ...props.relationLabels, choose: t('addAttribute'), create: t('createAttribute') },
      },
    },
    {
      options: () =>
        catalogue()
          .filter((attribute) => !lines().some((line) => line.attributeId === attribute.attributeId))
          .map((attribute) => ({
            value: attribute.attributeId,
            label: attribute.name,
            description: attribute.values.map((value) => value.name).join(' · '),
          })),
      disabled: () => !editable || saving() || attributeForm.open(),
      resetAfterSelect: true,
      onSelect: (option) => addLine(option.value),
      ...(editable && props.createAttribute
        ? { onCreate: (query: string) => attributeForm.start(query) }
        : {}),
    },
  )

  const removeLine = (attributeId: string): void => {
    setLines(lines().filter((line) => line.attributeId !== attributeId))
    setRows(
      rows().map((row) => {
        const valueIds = { ...row.valueIds }
        delete valueIds[attributeId]
        return { ...row, valueIds }
      }),
    )
    openExtras.set(openExtras().filter((id) => id !== attributeId))
    focusSoon(pickerTrigger)
  }

  /** Ticks values on a line, in the catalogue's order; a value ticked again gets its saved extra back. */
  const selectValues = (attributeId: string, valueIds: string[]): void => {
    const line = lines().find((entry) => entry.attributeId === attributeId)
    if (!line) return
    const options = optionsOf(line)
    const adding = valueIds.filter((valueId) => !line.values.some((value) => value.valueId === valueId))
    if (!adding.length) return
    const savedLine = saved.lines.find((entry) => entry.attributeId === attributeId)
    const added = adding.flatMap((valueId) => {
      const option = options.find((entry) => entry.valueId === valueId)
      if (!option) return []
      const priceExtra = savedLine?.values.find((value) => value.valueId === valueId)?.priceExtra ?? '0'
      return [{ valueId, name: option.name, priceExtra }]
    })
    const order = (valueId: string) => options.findIndex((entry) => entry.valueId === valueId)
    setLines(
      lines().map((entry) =>
        entry.attributeId === attributeId
          ? {
              ...entry,
              values: [...entry.values, ...added].sort((a, b) => order(a.valueId) - order(b.valueId)),
            }
          : entry,
      ),
    )
  }

  const removeValue = (attributeId: string, valueId: string): void =>
    setLines(
      lines().map((line) =>
        line.attributeId === attributeId
          ? { ...line, values: line.values.filter((value) => value.valueId !== valueId) }
          : line,
      ),
    )

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

  const addRow = (): void => {
    const row = newRow({}, true)
    setRows([...rows(), row])
    focusSoon(`[name^="combo|${row.key}|"], [name="field|${row.key}|defaultCode"]`)
  }

  const generate = (): void => {
    const created = missingCombinations().map((ids) => newRow(ids, false))
    if (!created.length) return
    setRows([...rows(), ...created])
    focusSoon(actionButton(`toggleRow|${created[0]!.key}`))
  }

  const toggleRow = (key: string): void => {
    rows.set(rows().map((row) => (row.key === key ? { ...row, open: !row.open } : row)))
  }

  const removeRow = (key: string): void => {
    const row = rowOf(key)
    if (!row) return
    // An unsaved row simply goes away; a saved one is archived on save, since it
    // may already be on documents this editor cannot see.
    if (row.id) {
      updateRow(key, { active: !row.active })
      return
    }
    const index = rows().indexOf(row)
    const next = rows()[index + 1] ?? rows()[index - 1]
    setRows(rows().filter((entry) => entry.key !== key))
    focusSoon(next ? actionButton(`toggleRow|${next.key}`) : actionButton('addRow'), actionButton('generate'))
  }

  const setAllActive = (active: boolean): void => {
    setRows(
      rows()
        .filter((row) => row.id || active)
        .map((row) => ({ ...row, active })),
    )
    focusSoon(actionButton(active ? 'archiveAll' : 'activateAll'), actionButton('addRow'))
  }

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
    if (!editable || saving() || !row.id || !props.media.upload || (replacing && !props.media.remove)) return
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

  const reset = (): void => {
    listPrice.set(saved.listPrice)
    catalogue.set(saved.catalogue)
    lines.set(clone(saved.lines))
    rows.set(toRows(saved.variants))
    rowIssues.set({})
    problem.set(null)
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

  // ── Events ──
  // Buttons: one name, the action in the value. Inputs: the name says what they edit.
  const onClick = (event: Event): void => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button || button.name !== ACTION || button.disabled || !editableAction(button.value)) return
    const [action, key = ''] = button.value.split('|')
    if (action === 'toggleRow') toggleRow(key)
    else if (action === 'selectAll') {
      const line = lines().find((entry) => entry.attributeId === key)
      if (line)
        selectValues(
          key,
          optionsOf(line).map((value) => value.valueId),
        )
      focusSoon(firstValueOf(key))
    } else if (action === 'removeLine') removeLine(key)
    else if (action === 'removeRow') removeRow(key)
    else if (action === 'generate') generate()
    else if (action === 'addRow') addRow()
    else if (action === 'activateAll') setAllActive(true)
    else if (action === 'archiveAll') setAllActive(false)
    else if (action === 'removeImage') {
      const row = rowOf(key)
      if (row) void removeImage(row)
    } else if (action === 'reset') {
      reset()
      focusSoon(pickerTrigger)
    }
  }
  /** Opening and closing a row is reading, not editing; everything else needs the permission. */
  const editableAction = (value: string): boolean => value.startsWith('toggleRow|') || (editable && !saving())

  const onChange = (event: Event): void => {
    const control = event.target
    if (!editable || saving()) return
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      const match = /^values\|(.+)\[\]$/.exec(control.name)
      if (!match) return
      if (control.checked) selectValues(match[1]!, [control.value])
      else removeValue(match[1]!, control.value)
    } else if (control instanceof HTMLSelectElement) {
      const [kind, key, attributeId] = control.name.split('|')
      const row = kind === 'combo' && key ? rowOf(key) : undefined
      if (row && attributeId)
        updateRow(row.key, { valueIds: { ...row.valueIds, [attributeId]: control.value } })
    } else if (control instanceof HTMLInputElement && control.type === 'file') {
      const [kind, key] = control.name.split('|')
      const row = kind === 'image' && key ? rowOf(key) : undefined
      const file = control.files?.[0]
      control.value = ''
      if (row && file) void uploadImage(row, file)
    }
  }

  const onInput = (event: Event): void => {
    const control = event.target
    if (!editable || saving() || !(control instanceof HTMLInputElement)) return
    const [kind, key, name] = control.name.split('|')
    if (!key || !name) return
    if (kind === 'extra') setExtra(key, name, control.value)
    else if (kind === 'field' && ['defaultCode', 'barcode', 'weight', 'volume'].includes(name)) {
      const decimalField = name === 'weight' || name === 'volume'
      updateRow(key, { [name]: decimalField ? control.value : control.value || null } as Partial<Row>)
    }
  }

  /** The value a managed control should show, or undefined for controls this island does not own. */
  const expectedValue = (name: string): string | undefined => {
    const [kind, key, name2] = name.split('|')
    if (!key || !name2) return undefined
    if (kind === 'extra')
      return lines()
        .find((line) => line.attributeId === key)
        ?.values.find((value) => value.valueId === name2)?.priceExtra
    const row = rowOf(key)
    if (!row) return undefined
    if (kind === 'combo') return row.valueIds[name2] ?? ''
    if (kind === 'field') return String(row[name2 as RowField] ?? '')
    return undefined
  }

  // The renderer writes attributes, which a control stops following once the user has
  // touched it. After Reset, a failed save or an unticked value, bring the live state
  // back in line with the draft — except the text the user is typing in right now.
  const syncControls = (): void => {
    if (!host) return
    for (const input of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name^="values|"]')) {
      const attributeId = input.name.slice('values|'.length, -2)
      const want =
        lines()
          .find((line) => line.attributeId === attributeId)
          ?.values.some((value) => value.valueId === input.value) ?? false
      if (input.checked !== want) input.checked = want
    }
    for (const control of host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input[name^="extra|"], input[name^="field|"], select[name^="combo|"]',
    )) {
      if (control === document.activeElement && control instanceof HTMLInputElement) continue
      const want = expectedValue(control.name)
      if (want !== undefined && control.value !== want) control.value = want
    }
  }

  // ── Views ──
  const extrasView = (line: VariantEditorLine): JSXChild => {
    const set = line.values.filter((value) => !isDecimal(value.priceExtra) || decimal(value.priceExtra) !== 0)
    const invalid = line.values.some((value) => !isDecimal(value.priceExtra))
    return (
      <div data-ui="variant-editor-extras" data-attribute={line.attributeId}>
        {Disclosure({
          summary: set.length
            ? t('priceExtrasSet', {
                list: set.map((value) => `${value.name} ${signed(value.priceExtra)}`).join(', '),
              })
            : t('priceExtrasNone'),
          open: invalid || openExtras().includes(line.attributeId),
          body: (
            <div data-ui="variant-editor-extra-fields">
              {each(
                line.values,
                (value) => value.valueId,
                (value) =>
                  MoneyField({
                    id: `${props.id}-extra-${line.attributeId}-${value.valueId}`,
                    name: `extra|${line.attributeId}|${value.valueId}`,
                    label: value.name,
                    value: value.priceExtra,
                    step: 'any',
                    disabled: !editable || saving(),
                    help: t('appliesTo', { count: usageOf(line.attributeId, value.valueId) }),
                    error: isDecimal(value.priceExtra) ? null : t('invalidNumber'),
                  }),
              )}
            </div>
          ),
        })}
      </div>
    )
  }

  const lineView = (line: VariantEditorLine): TemplateResult => {
    const options = optionsOf(line)
    const shown = editable ? options : line.values
    const selected = new Set(line.values.map((value) => value.valueId))
    const noVariant = line.createVariant === 'no_variant'
    return (
      <li data-ui="variant-editor-line" data-empty={String(!line.values.length)}>
        <div data-ui="variant-editor-line-main">
          {CheckboxGroup({
            id: `${props.id}-values-${line.attributeId}`,
            name: `values|${line.attributeId}`,
            label: line.name,
            span: 'full',
            disabled: !editable || saving(),
            options: shown.map((value) => ({
              value: value.valueId,
              label: value.name,
              checked: selected.has(value.valueId),
            })),
            help: noVariant
              ? t('noVariantHint')
              : line.values.length
                ? t('valuesSelected', { count: line.values.length, total: options.length })
                : t('valuesNone'),
          })}
          <div data-ui="variant-editor-line-actions">
            {noVariant ? Badge({ label: t('noVariant'), tone: 'neutral' }) : null}
            {editable && selected.size < options.length
              ? Button({
                  name: ACTION,
                  value: `selectAll|${line.attributeId}`,
                  label: t('selectAll'),
                  variant: 'tertiary',
                  size: 'compact',
                  disabled: saving(),
                })
              : null}
            {editable
              ? IconButton({
                  name: ACTION,
                  value: `removeLine|${line.attributeId}`,
                  label: t('removeAttributeNamed', { name: line.name }),
                  icon: icon('x'),
                  size: 'compact',
                  disabled: saving(),
                })
              : null}
          </div>
        </div>
        {line.values.length ? extrasView(line) : null}
      </li>
    )
  }

  const attributesView = (): TemplateResult =>
    Section({
      eyebrow: t('stepAttributes'),
      title: t('attributesTitle'),
      description: t('attributesHint'),
      actions: editable ? (
        <div data-ui="variant-editor-picker" id={`${props.id}-attribute-picker`}>
          {attributePicker.view()}
        </div>
      ) : undefined,
      body: (
        <div data-ui="variant-editor-body">
          {lines().length ? (
            <ul data-ui="variant-editor-lines">
              {each(
                lines(),
                (line) => line.attributeId,
                (line) => lineView(line),
              )}
            </ul>
          ) : (
            EmptyState({
              title: t('attributesEmpty'),
              message: editable ? t('attributesEmptyHint') : '',
            })
          )}
          {attributeForm.view()}
        </div>
      ),
    })

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

  const imageBlock = (row: Row, bodyId: string): JSXChild => {
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
        onDragOver={(event: DragEvent) => {
          event.preventDefault()
          if (!canUpload || !row.id || busy || saving()) return
          dragOver.set(row.key)
        }}
        onDragLeave={(event: DragEvent) => {
          const related = event.relatedTarget
          if (related instanceof Node && (event.currentTarget as Element).contains(related)) return
          dragOver.set(null)
        }}
        onDrop={(event: DragEvent) => {
          event.preventDefault()
          if (!canUpload || !row.id || busy || saving()) return
          dragOver.set(null)
          const file = event.dataTransfer?.files?.[0]
          if (file) void uploadImage(row, file)
        }}
      >
        {canUpload && row.id
          ? DropZone({
              id: `${bodyId}-image`,
              name: `image|${row.key}`,
              label: row.images.length ? t('replaceImage') : t('uploadImage'),
              accept: IMAGE_TYPES,
              disabled: busy || saving(),
              status: t('dropImage'),
              preview: row.images[0]
                ? { src: imageUrl(row.images[0].attachmentId, 'thumb'), alt: row.images[0].alt || t('image') }
                : null,
              dragging: dragOver() === row.key,
              span: 'full',
            })
          : rowThumb(row, 'large')}
        <div data-ui="variant-editor-image-actions">
          {canUpload && row.id && row.images.length ? rowThumb(row, 'small') : null}
          {canUpload && !row.id ? <small data-ui="variant-editor-hint">{t('imageSaveFirst')}</small> : null}
          {editable && props.media.remove && row.images.length
            ? Button({
                name: ACTION,
                value: `removeImage|${row.key}`,
                label: t('removeImage'),
                variant: 'tertiary',
                size: 'compact',
                disabled: busy || saving(),
              })
            : null}
        </div>
      </div>
    )
  }

  const rowField = (row: Row, bodyId: string, field: RowField): JSXChild => {
    const value = String(row[field] ?? '')
    const common = {
      id: `${bodyId}-${field}`,
      name: `field|${row.key}|${field}`,
      label: t(field),
      value,
      disabled: !editable || saving(),
    }
    return field === 'weight' || field === 'volume'
      ? Field({
          ...common,
          type: 'decimal',
          step: 'any',
          error: isDecimal(value) ? null : t('invalidNumber'),
        })
      : TextField(common)
  }

  const rowStatus = (row: Row, clash: Map<string, number>, open: Set<string>): JSXChild => {
    if (!row.active) return Badge({ label: t('archived'), tone: 'neutral' })
    if (clash.has(row.key))
      return Badge({ label: t('duplicate', { row: clash.get(row.key) }), tone: 'danger' })
    if (rowInvalid(row)) return Badge({ label: t('rowInvalid'), tone: 'danger' })
    if (open.has(row.key)) return Badge({ label: t('incomplete'), tone: 'warning' })
    if (!row.id) return Badge({ label: t('new'), tone: 'info' })
    return null
  }

  const rowView = (
    row: Row,
    index: number,
    clash: Map<string, number>,
    open: Set<string>,
  ): TemplateResult => {
    const bodyId = `${props.id}-row-${row.key}`
    // Every row repeats the same short action labels; the combination names them.
    const titleId = `${bodyId}-title`
    const breakdown = extraOf(row).filter(({ value }) => decimal(value.priceExtra) !== 0)
    const issue = rowIssues()[row.key]
    return (
      <article
        data-ui="variant-editor-row"
        role="listitem"
        data-active={String(row.active)}
        data-open={String(row.open)}
        data-invalid={String(clash.has(row.key) || Boolean(issue) || rowInvalid(row))}
      >
        <div data-ui="variant-editor-row-head">
          <span data-ui="variant-editor-row-number">{`#${index + 1}`}</span>
          {rowThumb(row, 'small')}
          <div data-ui="variant-editor-row-title">
            <strong id={titleId} data-incomplete={String(open.has(row.key))}>
              {combinationLabel(row.valueIds)}
            </strong>
            {row.defaultCode ? <small>{row.defaultCode}</small> : null}
          </div>
          <div data-ui="variant-editor-row-meta">
            {rowStatus(row, clash, open)}
            <span data-ui="variant-editor-row-price">{money(priceOf(row))}</span>
          </div>
          <div data-ui="variant-editor-row-actions">
            {Button({
              name: ACTION,
              value: `toggleRow|${row.key}`,
              label: row.open ? t('collapse') : editable ? t('edit') : t('details'),
              variant: 'tertiary',
              size: 'compact',
              expanded: row.open,
              controls: row.open ? bodyId : null,
              describedBy: titleId,
            })}
            {editable
              ? Button({
                  name: ACTION,
                  value: `removeRow|${row.key}`,
                  label: !row.id ? t('remove') : row.active ? t('archive') : t('restore'),
                  variant: 'tertiary',
                  size: 'compact',
                  disabled: saving(),
                  describedBy: titleId,
                })
              : null}
          </div>
        </div>
        {issue ? <p data-ui="variant-editor-row-issue">{issue}</p> : null}
        {row.open ? (
          <div data-ui="variant-editor-row-body" id={bodyId}>
            {imageBlock(row, bodyId)}
            <div data-ui="variant-editor-fields">
              {each(
                variantLines(),
                (line) => line.attributeId,
                (line) =>
                  Select({
                    id: `${bodyId}-${line.attributeId}`,
                    name: `combo|${row.key}|${line.attributeId}`,
                    label: line.name,
                    value: row.valueIds[line.attributeId] ?? '',
                    disabled: !editable || !row.active || saving(),
                    options: [
                      { value: '', label: t('choose', { name: line.name }) },
                      ...line.values.map((value) => ({ value: value.valueId, label: value.name })),
                    ],
                  }),
              )}
              {rowField(row, bodyId, 'defaultCode')}
              {rowField(row, bodyId, 'barcode')}
              {rowField(row, bodyId, 'weight')}
              {rowField(row, bodyId, 'volume')}
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

  const missingView = (missing: Array<Record<string, string>>): JSXChild => {
    const names = missing.slice(0, PREVIEW).map(combinationLabel)
    const rest = missing.length - names.length
    return Notice({
      tone: 'info',
      title: t('missing', { count: missing.length }),
      message: rest > 0 ? `${names.join(', ')} ${t('missingMore', { count: rest })}` : names.join(', '),
      actions: Button({
        name: ACTION,
        value: 'generate',
        label: t('generate', { count: missing.length }),
        variant: 'primary',
        size: 'compact',
        leading: icon('plus'),
        disabled: saving(),
      }),
    })
  }

  const variantsView = (): TemplateResult => {
    const clash = duplicates()
    const open = incomplete()
    const missing = editable ? missingCombinations() : []
    const activeCount = rows().filter((row) => row.active).length
    const toolbar = editable && (variantLines().length > 0 || rows().length > 0)
    return Section({
      eyebrow: t('stepVariants'),
      title: t('variantsTitle'),
      description: rows().length ? t('variantsCount', { active: activeCount, total: rows().length }) : null,
      actions: toolbar ? (
        <div data-ui="variant-editor-toolbar">
          {Button({
            name: ACTION,
            value: 'addRow',
            label: t('addVariant'),
            variant: 'secondary',
            size: 'compact',
            leading: icon('plus'),
            disabled: saving(),
          })}
          {rows().some((row) => row.id && !row.active)
            ? Button({
                name: ACTION,
                value: 'activateAll',
                label: t('activateAll'),
                variant: 'tertiary',
                size: 'compact',
                disabled: saving(),
              })
            : null}
          {activeCount
            ? Button({
                name: ACTION,
                value: 'archiveAll',
                label: t('archiveAll'),
                variant: 'tertiary',
                size: 'compact',
                disabled: saving(),
              })
            : null}
        </div>
      ) : undefined,
      body: (
        <div data-ui="variant-editor-body">
          {missing.length ? missingView(missing) : null}
          {rows().length ? (
            <div data-ui="variant-editor-rows" role="list">
              {each(
                rows(),
                (row) => row.key,
                (row) => rowView(row, rows().indexOf(row), clash, open),
              )}
            </div>
          ) : missing.length ? null : (
            EmptyState({
              title: t('variantsEmpty'),
              message: variantLines().length ? t('variantsEmptyHint') : t('variantsNeedAttributes'),
            })
          )}
        </div>
      ),
    })
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
    const invalid = invalidExtras() || invalidRows()
    return (
      <footer data-ui="variant-editor-footer">
        <p
          data-ui="variant-editor-summary"
          data-tone={clash || invalid ? 'danger' : 'neutral'}
          aria-live="polite"
        >
          {saving()
            ? t('saving')
            : clash
              ? t('summaryDuplicate')
              : invalid
                ? t('summaryInvalid')
                : (notice() ?? (dirty() ? parts.join(' · ') || t('summaryChanged') : ''))}
        </p>
        {editable
          ? Button({
              name: ACTION,
              value: 'reset',
              label: t('reset'),
              variant: 'secondary',
              size: 'compact',
              disabled: !dirty() || saving(),
            })
          : null}
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
      // biome-ignore lint/a11y/noStaticElementInteractions: delegates events from the native controls inside, which keep their own keyboard behaviour.
      // biome-ignore lint/a11y/useKeyWithClickEvents: every click it routes comes from a native button, which already handles Enter and Space.
      <div
        data-ui="variant-editor"
        id={props.id}
        aria-busy={saving() ? 'true' : null}
        onClick={onClick}
        onChange={onChange}
        onInput={onInput}
      >
        {editable ? null : Notice({ title: t('readOnly'), message: '' })}
        {problem() ? Notice({ title: t('saveFailed'), message: problem() ?? '', tone: 'danger' }) : null}
        {attributesView()}
        {variantsView()}
        {footerView()}
        <form id={saveForm} data-record-dirty={dirty() ? 'true' : null} hidden />
        {viewer.layer()}
      </div>
    ),
    mount: ({ root, lifetime }) => {
      host = root as unknown as HTMLElement
      lifetime.addEventListener('abort', () => {
        disposed = true
        host = null
      })
      attributeForm.attach(host, lifetime)
      const pickerRoot = host.querySelector<HTMLElement>(`[id="${props.id}-attribute-picker"]`)
      if (pickerRoot) attributePicker.mount?.({ root: pickerRoot as unknown as IslandElement, lifetime })
      lifetime.addEventListener('abort', () => attributePicker.dispose?.())
      viewer.attach(lifetime)
      // A price-extra disclosure stays as the user left it across renders.
      host.addEventListener(
        'toggle',
        (event) => {
          const details = event.target
          if (!(details instanceof HTMLDetailsElement)) return
          const attributeId = details.closest<HTMLElement>('[data-ui="variant-editor-extras"]')?.dataset
            .attribute
          if (!attributeId) return
          const others = openExtras().filter((id) => id !== attributeId)
          openExtras.set(details.open ? [...others, attributeId] : others)
        },
        { signal: lifetime, capture: true },
      )
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
      const stopSave = effect(() => {
        const button = saveButton()
        if (!button) return
        button.disabled = blocked()
        if (saving()) button.setAttribute('aria-busy', 'true')
        else button.removeAttribute('aria-busy')
      })
      const stopSync = effect(() => {
        lines()
        rows()
        queueMicrotask(syncControls)
      })
      lifetime.addEventListener('abort', () => {
        stopSave()
        stopSync()
      })
    },
  }
}

/** The id of the form a Save button outside the island submits to save this editor. */
export const variantEditorSaveForm = (id: string): string => `${id}-save`

export const variantEditor = (props: IslandProps): IslandController =>
  createVariantEditorView(props as unknown as VariantEditorProps)
