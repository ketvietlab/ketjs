// What a declared effect list says about a function, read the same way everywhere.

/** True when a function changes state: it writes a model or enqueues a job. */
export const mutates = (effects: readonly string[]): boolean =>
  effects.some((effect) => effect.startsWith('write:') || effect.startsWith('enqueue:'))
