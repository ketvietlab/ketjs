import type { Placement } from './types.ts'

// A destination index is a boundary in the unmodified array (0 … length).
// Validate everything before removing the source, so invalid/cyclic drops cannot lose content.

/** Where a dragged section would land: a slot (`''` is the page itself) and a boundary in it. */
export type PlacementTarget = { destination: string; index: number }
export type PlacementSlot = {
  destination: string
  list: Placement[]
  parent: Placement | null
  slot: string | null
}
export type Point = { x: number; y: number }

export function locatePlacement(
  layout: Placement[],
  id: string,
): { list: Placement[]; index: number; placement: Placement } | null {
  for (let index = 0; index < layout.length; index++) {
    const placement = layout[index]
    if (placement.id === id) return { list: layout, index, placement }
    for (const children of Object.values(placement.slots ?? {})) {
      const found = locatePlacement(children, id)
      if (found) return found
    }
  }
  return null
}

export function placementSlots(layout: Placement[], excluded: string | null = null): PlacementSlot[] {
  const result: PlacementSlot[] = [{ destination: '', list: layout, parent: null, slot: null }]
  const visit = (nodes: Placement[]) => {
    for (const node of nodes) {
      if (node.id === excluded) continue
      for (const [slot, list] of Object.entries(node.slots ?? {})) {
        result.push({ destination: `${node.id}:${slot}`, list, parent: node, slot })
        visit(list)
      }
    }
  }
  visit(layout)
  return result
}

export function planPlacementMove(
  layout: Placement[],
  id: string,
  target: PlacementTarget | null | undefined,
) {
  const source = locatePlacement(layout, id)
  const destination = placementSlots(layout, id).find((s) => s.destination === target?.destination)
  if (
    !source ||
    !destination ||
    !target ||
    !Number.isInteger(target.index) ||
    target.index < 0 ||
    target.index > destination.list.length
  )
    return null
  const index = target.index - (source.list === destination.list && source.index < target.index ? 1 : 0)
  return { source, destination, index, noop: source.list === destination.list && source.index === index }
}

export function movePlacementAt(layout: Placement[], id: string, target: PlacementTarget | null | undefined) {
  const plan = planPlacementMove(layout, id, target)
  if (!plan || plan.noop) return false
  plan.source.list.splice(plan.source.index, 1)
  plan.destination.list.splice(plan.index, 0, plan.source.placement)
  return true
}

export function placementPosition(layout: Placement[], id: string): PlacementTarget | null {
  for (const slot of placementSlots(layout)) {
    const index = slot.list.findIndex((p) => p.id === id)
    if (index >= 0) return { destination: slot.destination, index }
  }
  return null
}

export function keyboardPlacementTarget(
  layout: Placement[],
  id: string,
  target: PlacementTarget,
  key: string,
): PlacementTarget | null {
  const slots = placementSlots(layout, id)
  let at = slots.findIndex((s) => s.destination === target.destination)
  if (at < 0) return null
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    at = Math.max(0, Math.min(slots.length - 1, at + (key === 'ArrowRight' ? 1 : -1)))
    return { destination: slots[at].destination, index: Math.min(target.index, slots[at].list.length) }
  }
  const step = key === 'ArrowUp' ? -1 : 1
  let index = key === 'Home' ? 0 : key === 'End' ? slots[at].list.length : target.index + step
  index = Math.max(0, Math.min(slots[at].list.length, index))
  // Adjacent boundaries around the source are the same place after removal. Skip that dead step.
  if (
    key.startsWith('Arrow') &&
    planPlacementMove(layout, id, { destination: target.destination, index })?.noop
  )
    index = Math.max(0, Math.min(slots[at].list.length, index + step))
  return { destination: target.destination, index }
}

export const dragThresholdReached = (origin: Point, point: Point) =>
  Math.hypot(point.x - origin.x, point.y - origin.y) >= 6
export const edgeVelocity = (point: number, start: number, end: number) => {
  const band = Math.min(56, (end - start) / 3)
  if (band <= 0 || point < start || point > end) return 0
  if (point < start + band) return -700 * (1 - (point - start) / band)
  if (point > end - band) return 700 * (1 - (end - point) / band)
  return 0
}
