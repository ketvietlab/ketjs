/**
 * The rows one checkbox click changes, in the order the reader sees them.
 *
 * A plain click changes only the clicked row. With `extend` (Shift held) and an
 * anchor still on screen, it changes every visible row from the anchor to the
 * clicked row, in either direction. An anchor that scrolled away with a page or
 * a collapsed group falls back to the single row instead of guessing a range.
 */
export const selectionRange = (
  visible: readonly string[],
  anchor: string | null,
  id: string,
  extend: boolean,
): string[] => {
  const from = extend && anchor !== null ? visible.indexOf(anchor) : -1
  const to = visible.indexOf(id)
  return from >= 0 && to >= 0 ? visible.slice(Math.min(from, to), Math.max(from, to) + 1) : [id]
}
