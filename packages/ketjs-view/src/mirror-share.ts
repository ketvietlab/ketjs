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
    // One pass, and each child is shared exactly once. Comparing first and building
    // second would share a changed child twice, which doubles at every level.
    let out: Record<string, unknown> | null = null
    let count = 0
    for (const key in next) {
      const kept = share(prev[key], next[key])
      if (out) out[key] = kept
      else if (kept !== prev[key] || !Object.hasOwn(prev, key)) {
        // Every key before this one kept prev's value: copy those without comparing again.
        out = {}
        let copied = 0
        for (const earlier in next) {
          if (copied++ === count) break
          out[earlier] = prev[earlier]
        }
        out[key] = kept
      }
      count++
    }
    if (out) return out as T
    let prevCount = 0
    for (const _ in prev) prevCount++
    if (prevCount === count) return prev as T
    // prev has keys next dropped; every remaining value is prev's own.
    const kept: Record<string, unknown> = {}
    for (const key in next) kept[key] = prev[key]
    return kept as T
  }
  return next
}
