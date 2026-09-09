export const demoStyles = `
body { margin: 0; }
[data-demo-app] { min-height: 100dvh; background: var(--kv-page-bg); }
[data-demo-app] [data-ui="icon"] { width: 18px; height: 18px; flex: 0 0 18px; }
.demo-muted { font-size: var(--kv-text-sm); color: var(--kv-text-muted); }
.demo-navigation-footer { display: grid; gap: var(--kv-space-4); }
.demo-navigation-footer [data-ui="inline"] { flex-wrap: nowrap; }
.demo-navigation-footer strong { display: block; color: var(--kv-text-main); font-size: var(--kv-text-sm); }
[data-demo-submenu] { display: grid; width: 100%; min-width: 0; }
[data-demo-submenu] [data-ui="tabs"] { width: 100%; min-width: 0; border-bottom: 0; }
[data-demo-submenu-trigger] { position: relative; display: inline-flex; height: var(--kv-table-header-height); min-height: 0; flex: none; align-items: center; padding: 0; border: 0; background: transparent; color: var(--kv-text-muted); font: inherit; font-size: var(--kv-text-sm); font-weight: var(--kv-weight-medium); cursor: pointer; }
[data-demo-submenu-trigger]:hover { color: var(--kv-text-secondary); }
[data-demo-submenu-trigger][data-active="true"] { color: var(--kv-tab-active-text); }
[data-demo-submenu-trigger][data-active="true"]::after { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; border-radius: 2px 2px 0 0; background: var(--kv-accent); content: ""; }
.demo-submenu-trigger { display: inline-flex; align-items: center; gap: var(--kv-space-1); white-space: nowrap; }
.demo-submenu-trigger [data-ui="icon"] { width: 14px; height: 14px; flex-basis: 14px; }
[data-demo-submenu-trigger] [data-ui="icon"] { transition: transform var(--kv-duration-normal) var(--kv-ease-default); }
[data-demo-submenu-trigger][aria-expanded="true"] [data-ui="icon"] { transform: rotate(180deg); }
[data-demo-submenu-children] { display: flex; min-width: 0; min-height: 2.75rem; align-items: center; gap: var(--kv-space-1); padding-block: var(--kv-space-1); border-top: 1px solid var(--kv-panel-divider); overflow-x: auto; animation: demo-submenu-enter var(--kv-duration-normal) var(--kv-ease-default); }
[data-demo-submenu-children][hidden] { display: none; }
[data-demo-submenu-child] { display: inline-flex; min-height: var(--kv-control-height-sm); flex: none; align-items: center; padding-inline: var(--kv-space-3); border-radius: var(--kv-radius-sm); color: var(--kv-text-secondary); font-size: var(--kv-text-xs); font-weight: var(--kv-weight-medium); text-decoration: none; }
[data-demo-submenu-child]:hover { background: var(--kv-interactive-hover); color: var(--kv-text-main); }
[data-demo-submenu-child][data-active="true"] { background: var(--kv-nav-selected); color: var(--kv-nav-selected-text); }
@keyframes demo-submenu-enter { from { opacity: 0; } to { opacity: 1; } }
.demo-surface-fill, .demo-surface-fill > [data-ui="surface"] { height: 100%; }
[data-demo-board][data-filtered="true"] > [data-ui="grid"] { grid-template-columns: minmax(0, 1fr); }
:is(#today, #workflow, #recent, #priority, #updates) { scroll-margin-top: var(--kv-space-4); }
.demo-overview-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--kv-space-2); align-items: stretch; }
.demo-bars { display: grid; gap: var(--kv-space-4); }
.demo-bar-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--kv-space-1) var(--kv-space-2); font-size: var(--kv-text-sm); }
.demo-bar-track { grid-column: 1 / -1; height: 6px; background: var(--kv-panel-border); }
.demo-bar-track > div { height: 100%; background: var(--kv-color-info); }
.demo-bar-track [data-tone="draft"] { background: var(--kv-color-warning); }
.demo-bar-track [data-tone="shipping"] { background: var(--kv-text-muted); }
.demo-bar-track [data-tone="done"] { background: var(--kv-color-positive); }
.demo-timeline { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--kv-space-5); }
.demo-timeline li { display: flex; align-items: flex-start; gap: var(--kv-space-3); font-size: var(--kv-text-sm); }
.demo-timeline p { margin: var(--kv-space-1) 0 0; color: var(--kv-text-secondary); overflow-wrap: anywhere; }
[data-demo-app] #bulk-form { display: none; }
@media (max-width: 64rem) { .demo-overview-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 48rem) {
  [data-demo-app] :is([data-ui="dashboard-page-actions"], [data-ui="list-page-actions"], [data-ui="record-page-actions"]) > [data-ui="action-group"] {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  [data-demo-app] :is([data-ui="dashboard-page-actions"], [data-ui="list-page-actions"], [data-ui="record-page-actions"]) [data-ui="action"] {
    width: 100%;
  }
}
`
