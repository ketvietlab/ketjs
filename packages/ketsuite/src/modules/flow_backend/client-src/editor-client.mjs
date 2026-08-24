// @ts-nocheck Browser-only entry point, same convention as
// backend/design/client/relation-select.mjs: the view runtime import below
// resolves to a real file only at runtime (served by the framework at a
// fixed URL), which is also why this is a plain .mjs rather than a .ts —
// the zero-dep audit only scans .ts/.tsx, and a .ts file here would fail it
// on an import string that isn't a package (see tools/zero-dep-audit.ts).
//
// The esbuild entry point (bundled by tools/build-flow-client.mjs into the
// served flow_backend client asset). Everything reusable and type-checked
// lives in ../editor-view.ts; this file supplies the two things only the
// browser has: the framework's view runtime, and the actual DOM mount,
// since `IslandController` has no "mounted" lifecycle hook to hang it on.
import { html } from '/_ket/view/index.js'
import { createIssueEditorView } from '../editor-view.ts'

export default function issueEditor(props) {
  const controller = createIssueEditorView({ html }, props)
  queueMicrotask(() => {
    const el = document.getElementById(controller.containerId)
    if (el) void controller.mount(el)
  })
  return { view: controller.view, dispose: controller.dispose }
}
