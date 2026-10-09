export const counters = () => ({
  enabled: false,
  schemaRefinements: 0,
  validationRuleCalls: 0,
  formRenders: 0,
  statusRenders: 0,
  fieldRenders: 0,
  uneditedFieldRenders: 0,
  derivedReads: 0,
  adapterEffects: 0,
  valueWrites: 0,
  disabledWrites: 0,
  attributeCalls: 0,
  textWrites: 0,
  domMutationRecords: 0,
})
export const countField = (metrics, name, target) => {
  if (!metrics.enabled) return
  metrics.fieldRenders++
  if (name !== target) metrics.uneditedFieldRenders++
}
export const resetCounters = (metrics) => {
  for (const key of Object.keys(metrics)) if (typeof metrics[key] === 'number') metrics[key] = 0
}

// Installed before mounting a counting trial so React's value tracker sees the wrapper.
// Timing trials run without these prototype wrappers or a MutationObserver.
export function trace(root, metrics) {
  const undo = []
  const owned = (node) => node === root || root.contains(node)
  const setter = (proto, name, counter) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    if (!descriptor?.set) return
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(value) {
        if (metrics.enabled && owned(this)) metrics[counter]++
        return descriptor.set.call(this, value)
      },
    })
    undo.push(() => Object.defineProperty(proto, name, descriptor))
  }
  for (const proto of [
    HTMLInputElement.prototype,
    HTMLSelectElement.prototype,
    HTMLTextAreaElement.prototype,
  ])
    setter(proto, 'value', 'valueWrites')
  for (const proto of [
    HTMLInputElement.prototype,
    HTMLSelectElement.prototype,
    HTMLTextAreaElement.prototype,
    HTMLButtonElement.prototype,
  ])
    setter(proto, 'disabled', 'disabledWrites')
  setter(Node.prototype, 'textContent', 'textWrites')
  setter(Node.prototype, 'nodeValue', 'textWrites')
  for (const name of ['setAttribute', 'removeAttribute']) {
    const original = Element.prototype[name]
    Element.prototype[name] = function (...args) {
      if (metrics.enabled && owned(this)) {
        metrics.attributeCalls++
        if (this instanceof HTMLFormElement && name === 'setAttribute' && args[0] === 'aria-busy')
          metrics.adapterEffects++
      }
      return original.apply(this, args)
    }
    undo.push(() => {
      Element.prototype[name] = original
    })
  }
  const observer = new MutationObserver((records) => {
    if (metrics.enabled) metrics.domMutationRecords += records.length
  })
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
  return {
    drain() {
      metrics.domMutationRecords += observer.takeRecords().length
    },
    stop() {
      observer.disconnect()
      for (const restore of undo.reverse()) restore()
    },
  }
}
