export const demoStyles = `
body { margin: 0; }
[data-demo-app] { min-height: 100dvh; background: var(--kv-page-bg); }
[data-demo-app] [data-ui="icon"] { width: 18px; height: 18px; flex: 0 0 18px; }
.demo-muted { font-size: var(--kv-text-sm); color: var(--kv-text-muted); }
.demo-navigation-footer { display: grid; gap: var(--kv-space-4); }
.demo-navigation-footer [data-ui="inline"] { flex-wrap: nowrap; }
.demo-navigation-footer strong { display: block; color: var(--kv-text-main); font-size: var(--kv-text-sm); }
[data-demo-submenu] { display: grid; width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
[data-demo-submenu] [data-ui="tabs"] { min-width: 0; border-bottom: 0; }
[data-demo-submenu-more] { position: relative; height: var(--kv-table-header-height); border-left: 1px solid var(--kv-panel-divider); }
[data-demo-submenu-more] [data-ui="menu-trigger"] { position: relative; height: var(--kv-table-header-height); min-height: 0; padding-inline: var(--kv-space-4); border: 0; border-radius: 0; background: transparent; color: var(--kv-text-muted); }
[data-demo-submenu-more][data-active="true"] [data-ui="menu-trigger"] { color: var(--kv-tab-active-text); }
[data-demo-submenu-more][data-active="true"] [data-ui="menu-trigger"]::after { position: absolute; right: var(--kv-space-4); bottom: 0; left: var(--kv-space-4); height: 2px; border-radius: 2px 2px 0 0; background: var(--kv-accent); content: ""; }
.demo-submenu-trigger { display: inline-flex; align-items: center; gap: var(--kv-space-1); white-space: nowrap; }
.demo-submenu-trigger [data-ui="icon"] { width: 14px; height: 14px; flex-basis: 14px; }
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
