// Keeps edits made during an in-flight request, and retains failed patches for retry.
export function createTaskAutosave({ save, onChange = () => {} }) {
  const entries = new Map()
  let disposed = false
  const entry = (id) => {
    if (!entries.has(id)) entries.set(id, { draft: {}, pending: {}, running: null, timer: null, error: null })
    return entries.get(id)
  }
  const flush = async (id) => {
    const e = entry(id)
    clearTimeout(e.timer)
    e.timer = null
    if (e.running) return e.running
    if (disposed || !Object.keys(e.pending).length) return
    e.running = (async () => {
      while (!disposed && Object.keys(e.pending).length) {
        const patch = { ...e.pending }
        e.pending = {}
        e.error = null
        onChange()
        try {
          await save(id, patch)
          for (const [key, value] of Object.entries(patch))
            if (e.draft[key] === value && !Object.hasOwn(e.pending, key)) delete e.draft[key]
        } catch (error) {
          e.pending = { ...patch, ...e.pending }
          e.error = error
          break
        }
      }
    })()
    onChange()
    try {
      await e.running
    } finally {
      e.running = null
      onChange()
    }
  }
  return {
    edit(id, patch, { delay = 0 } = {}) {
      if (disposed) return
      const e = entry(id)
      Object.assign(e.draft, patch)
      Object.assign(e.pending, patch)
      e.error = null
      clearTimeout(e.timer)
      onChange()
      if (delay) e.timer = setTimeout(() => flush(id), delay)
      else void flush(id)
    },
    draft: (id) => entry(id).draft,
    state(id) {
      const e = entry(id)
      return e.error ? 'error' : e.running ? 'saving' : Object.keys(e.pending).length ? 'pending' : 'saved'
    },
    flush,
    async flushAll() {
      await Promise.all([...entries.keys()].map(flush))
    },
    dispose() {
      disposed = true
      for (const e of entries.values()) clearTimeout(e.timer)
    },
  }
}
