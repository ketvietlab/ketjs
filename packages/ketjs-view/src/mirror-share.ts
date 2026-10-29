// Structural sharing for Mirror. Internal: not part of any package export.
//
// A fresh response is a fresh object graph even when nothing changed. Keeping the
// previous reference wherever the next value is deeply equal lets a signal write be
// a no-op for an unchanged answer, and gives unchanged rows a stable identity.

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

/**
 * Return prev wherever next is deeply equal to it. Arrays compare by index and plain
 * objects by own keys; any other value is replaced. Nothing is allocated while the
 * values stay equal: a copy starts at the first difference.
 */
export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T
  if (Array.isArray(prev) && Array.isArray(next)) {
    const length = next.length
    let out: unknown[] | null = prev.length === length ? null : []
    for (let i = 0; i < length; i++) {
      const kept = share(prev[i], next[i])
      if (out) out[i] = kept
      else if (kept !== prev[i]) {
        out = prev.slice(0, i)
        out[i] = kept
      }
    }
    return (out ?? prev) as T
  }
  if (isPlain(prev) && isPlain(next)) {
    let count = 0
    let changed = false
    for (const key in next) {
      count++
      if (!Object.hasOwn(prev, key) || share(prev[key], next[key]) !== prev[key]) {
        changed = true
        break
      }
    }
    if (!changed) {
      let prevCount = 0
      for (const _ in prev) prevCount++
      if (prevCount === count) return prev as T
    }
    const out: Record<string, unknown> = {}
    for (const key in next) out[key] = share(prev[key], next[key])
    return out as T
  }
  return next
}
