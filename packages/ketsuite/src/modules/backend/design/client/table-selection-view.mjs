// @ts-nocheck Shared SSR/client marker for global table selection behaviour.
export function createTableSelectionView(runtime) {
  return {
    view: () => runtime.html`<span data-ui="table-selection-runtime" hidden></span>`,
  }
}
