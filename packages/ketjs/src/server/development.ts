type Closeable = { close(): Promise<unknown> }

/**
 * Stop a combined development process exactly once. HTTP closes first so a
 * watcher can bind the same port while the durable worker finishes draining.
 */
export function createDevelopmentCloser(deployment: Closeable, worker: Closeable): () => Promise<void> {
  let closing: Promise<void> | undefined
  return () => {
    closing ??= (async () => {
      await deployment.close()
      await worker.close()
    })()
    return closing
  }
}
