try {
  const config = JSON.parse(document.getElementById('flow-environment').textContent)
  const [{ createIslandManager, domHost }, { createFlowWorkspace }, { createFnClient, createFileUploader }] =
    await Promise.all([
      import('@ketvietlab/ketjs-view'),
      import('@ketvietlab/flow-client'),
      import('@ketvietlab/flow-client/api'),
    ])
  const call = createFnClient({ headers: { 'x-flow-fixture': config.session } })
  const upload = createFileUploader({ headers: { 'x-flow-fixture': config.session } })
  const manager = createIslandManager(
    domHost(),
    { 'flow.workspace': (props) => createFlowWorkspace(props, { call, upload }) },
    { strict: true },
  )
  manager.hydrate(document)
  window.addEventListener('pagehide', () => manager.dispose(document), { once: true })
} catch (error) {
  console.error(error)
  const message = document.createElement('pre')
  message.setAttribute('role', 'alert')
  message.textContent = `Không thể khởi động Flow: ${error.message}`
  document.body.append(message)
}
