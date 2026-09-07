import { KetError } from './errors.ts'
import type {
  BrowserPlanProjection,
  BrowserScreenPlan,
  ComposedBrowserResource,
  Manifest,
  Row,
} from '../types.ts'

/**
 * Project one composed screen through the current caller's function permissions.
 *
 * A rejected optional resource is absent rather than marked hidden. Its endpoint,
 * widget module and column bindings therefore never reach the browser and cannot
 * accidentally trigger a speculative fetch.
 */
export async function projectBrowserScreen(
  manifest: Manifest,
  screenId: string,
  projection: BrowserPlanProjection,
): Promise<BrowserScreenPlan | null> {
  const screen = manifest.browser.screens[screenId]
  if (!screen) return null

  const resources = new Map<string, ComposedBrowserResource>()
  resources.set(screen.primary, manifest.browser.resources[screen.primary]!)
  for (const column of screen.columns) {
    const resource = manifest.browser.resources[column.resource]
    if (resource) resources.set(resource.id, resource)
  }

  const permitted = new Set<string>()
  await Promise.all(
    [...resources.values()].map(async (resource) => {
      const requirementAllowed = await projection.allows(resource.needs)
      const endpointAllowed =
        resource.source === resource.needs ? requirementAllowed : await projection.allows(resource.source)
      if (requirementAllowed && endpointAllowed) permitted.add(resource.id)
    }),
  )
  if (!permitted.has(screen.primary)) return null

  const columns = screen.columns
    .filter((column) => permitted.has(column.resource))
    .map((column) => ({
      ...column,
      bind: { ...column.bind },
      operations: [...column.operations],
      label: projection.translate?.(column.label) ?? column.label,
    }))
  const referencedWidgets = new Set(columns.map((column) => column.widget))
  const referencedResources = new Set([screen.primary, ...columns.map((column) => column.resource)])

  return {
    version: 1,
    revision: manifest.browser.revision,
    screen: {
      id: screen.id,
      kind: screen.kind,
      contract: screen.contract,
      primary: screen.primary,
      rowKey: screen.rowKey,
      title: projection.translate?.(screen.title) ?? screen.title,
      ...(screen.description === undefined
        ? {}
        : { description: projection.translate?.(screen.description) ?? screen.description }),
      columns,
    },
    resources: Object.fromEntries(
      [...referencedResources].sort().map((id) => {
        const resource = manifest.browser.resources[id]!
        return [
          id,
          {
            ...resource,
            fields: { ...resource.fields },
            ...(resource.batch ? { batch: { ...resource.batch } } : {}),
            ...(resource.cache ? { cache: { ...resource.cache } } : {}),
            ...(id === screen.primary ? {} : { endpoint: `/_ket/fn/${resource.source}` }),
          },
        ]
      }),
    ),
    widgets: Object.fromEntries(
      [...referencedWidgets].sort().map((id) => {
        const widget = manifest.browser.widgets[id]!
        return [id, { ...widget, props: { ...widget.props } }]
      }),
    ),
  }
}

/** Keep only the declared resource projection and reject duplicate/missing keys. */
export function projectBrowserRows(resource: ComposedBrowserResource, value: unknown): Row[] {
  if (!Array.isArray(value)) {
    throw new KetError({
      code: 'E_BROWSER_RESOURCE_ROWS',
      module: resource.by,
      message: `browser resource "${resource.id}" must return an array of rows`,
    })
  }
  const seen = new Set<unknown>()
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new KetError({
        code: 'E_BROWSER_RESOURCE_ROW',
        module: resource.by,
        message: `browser resource "${resource.id}" row ${index} is not an object`,
      })
    }
    const source = candidate as Row
    const key = source[resource.key]
    if (key === undefined || key === null || seen.has(key)) {
      throw new KetError({
        code: 'E_BROWSER_RESOURCE_KEY',
        module: resource.by,
        message: `browser resource "${resource.id}" row ${index} has a missing or duplicate "${resource.key}"`,
      })
    }
    seen.add(key)
    return Object.fromEntries(Object.keys(resource.fields).map((field) => [field, source[field]]))
  })
}
