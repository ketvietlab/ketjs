/** @typedef {{dragCount?:number,onDragCheck?:(id:string)=>string,onDropTask?:(id:string,position:'before'|'after')=>void,onMoveKey?:(direction:'up'|'down'|'left'|'right')=>void}} TaskDrop */
/** Shared task interactions. The disposable runtime handles whole-row pointer gestures;
 * consumers own order, group attributes and persistence.
 * @param {TaskDrop} p @param {string} [id] */
export function taskDrag(p, id) {
  return {
    /** @param {CustomEvent<{id:string,reason?:string}>} e */
    check(e) {
      e.stopPropagation()
      e.detail.reason = p.onDragCheck?.(e.detail.id) ?? ''
    },
    /** @param {CustomEvent<{id:string,position:'before'|'after'}>} e */
    pointerDrop(e) {
      if (!p.onDropTask || e.detail.id === id) return
      e.stopPropagation()
      p.onDropTask(e.detail.id, e.detail.position)
    },
    /** @param {KeyboardEvent} e */
    key(e) {
      if (!p.onMoveKey || !e.altKey) return
      const direction = /** @type {Record<string, 'up'|'down'|'left'|'right'>} */ ({
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      })[e.key]
      if (direction) {
        e.preventDefault()
        e.stopPropagation()
        p.onMoveKey(direction)
      }
    },
  }
}
