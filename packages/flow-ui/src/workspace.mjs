import { tr, trRich } from './i18n.mjs'
export { FlowColorPicker, FlowCatalogEditor, FLOW_TAG_COLORS } from './catalog-editor.mjs'
export { FlowDateField } from './date-field.mjs'
export { FlowUserPicker } from './user-picker.mjs'
export { FlowChoiceField } from './choice-field.mjs'
export {
  FlowFileDropzone,
  FlowFileDrop,
  FlowAttachment,
  FlowMediaPreview,
  attachmentKind,
} from './file-dropzone.mjs'
import { html, each } from '@ketvietlab/ketjs-view'
import { taskDrag } from './task-drag.mjs'
import {
  FlowCheckbox,
  FlowIcon,
  FlowAvatar,
  FlowButton,
  FlowTag,
  FlowProgress,
  FlowSelect,
  FlowDialog,
} from './index.mjs'
/** @typedef {import('@ketvietlab/ketjs-view').Renderable} Child */
/** @param {{label:string,href:string,icon?:Parameters<typeof FlowIcon>[0],active?:boolean,count?:string|number,onClick?:(e:Event)=>void}} p */
export const FlowNavItem = (p) =>
  html`<a
    data-flow="nav-item"
    href=${p.href}
    title=${p.label}
    aria-current=${p.active ? 'page' : null}
    on:click=${p.onClick}
    >${FlowIcon(p.icon ?? 'folder')}<span>${p.label}</span>${p.count == null ? null : html`<small>${p.count}</small>`}</a
  >`
/** Wordmark slot. Artwork comes from the product's --flow-logo-light/--flow-logo-dark; without it the label shows as text. @param {{label?:string}} [p] */
export const FlowLogo = (p = {}) => {
  const label = p.label ?? tr('flow.ui.k.tflow')
  return html`<span data-flow="logo" role="img" aria-label=${label}><span aria-hidden="true">${label}</span></span>`
}
/** @param {{company:string,name?:string}} p */
export const FlowBrand = (p) =>
  html`<div data-flow="brand">${FlowLogo({ label: p.name ?? tr('flow.ui.k.tflow') })}${p.company ? html`<small>${p.company}</small>` : null}</div>`
/** @param {{name:string,company:string,context?:Child,children:Child,footer:Child}} p */
export const FlowNavigation = (p) =>
  html`<div data-flow="navigation">
    ${FlowBrand({ name: p.name, company: p.context ? '' : p.company })}
    ${p.context ?? null}
    <details data-flow="mobile-nav" open>
      <summary>${tr('flow.ui.navigation')}</summary>
      <div data-flow="navigation-content">${p.children}</div>
    </details>
    <div data-flow="navigation-footer">${p.footer}</div>
  </div>`
/** Search entry opens the shared command dialog; it is not an editable input.
 * @param {{onClick:(event:Event)=>void,label?:string,shortcut?:string}} p */
export const FlowSearchTrigger = (p) =>
  html`<button type="button" data-flow="search-trigger" aria-label=${tr('flow.ui.search.flow')} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" on:click=${p.onClick}>${FlowIcon('search')}<span>${p.label ?? tr('flow.ui.search.7fae89')}</span><kbd aria-hidden="true">${p.shortcut ?? '⌘K'}</kbd></button>`
/** @param {{title:string,action?:Child,children:Child}} p */
export const FlowNavGroup = (p) =>
  html`<section data-flow="nav-group">
    <header><span>${p.title}</span>${p.action ?? null}</header>
    ${p.children}
  </section>`
/** @param {{children:Child,trailing?:Child,inset?:'page'|'none'}} p */
export const FlowToolbar = (p) =>
  html`<div data-flow="toolbar" data-inset=${p.inset ?? 'page'}>
    <div data-flow="inline">${p.children}</div>
    <div data-flow="inline">${p.trailing ?? null}</div>
  </div>`
/** @param {{children:Child,gap?:'sm'|'md'|'lg'}} p */
export const FlowStack = (p) => html`<div data-flow="stack" data-gap=${p.gap ?? 'md'}>${p.children}</div>`
/** @param {{children:Child,align?:'start'|'end'}} p */
export const FlowInline = (p) =>
  html`<div data-flow="inline" data-align=${p.align ?? 'start'}>${p.children}</div>`
/** @param {{title?:string,description?:string,children:Child,actions?:Child,width?:'full'|'reading',inset?:'page'|'none'}} p */
export const FlowSection = (p) =>
  html`<section data-flow="section" data-width=${p.width ?? 'full'} data-inset=${p.inset ?? 'page'}>
    ${
      p.title
        ? html`<header>
            <div data-flow="section-heading"><h2>${p.title}</h2>${p.description ? html`<p>${p.description}</p>` : null}</div>
            <div data-flow="inline">${p.actions ?? null}</div>
          </header>`
        : null
    }${p.children}
  </section>`
/** Compact scope menus; the consumer owns destinations and navigation. With `icon`, the summary is icon-only and `label` becomes its accessible name.
 * @param {{label:string,icon?:Parameters<typeof FlowIcon>[0],placement?:"up"|"down",header?:Child,items:{label:string,onClick:()=>void,active?:boolean}[]}} p */
export const FlowScopeMenu = (p) =>
  html`<details data-flow="scope-menu" data-placement=${p.placement ?? 'down'} data-variant=${p.icon ? 'icon' : null}><summary title=${p.icon ? p.label : null}>${p.icon ? html`<span data-flow="sr">${p.label}</span>${FlowIcon(p.icon)}` : html`${p.label}${FlowIcon('chevron')}`}</summary><div data-flow="scope-menu-items">${p.header ?? null}${each(
    p.items,
    (x) => x.label,
    (x) =>
      html`<button type="button" aria-current=${x.active ? 'page' : null} on:click=${(
        /** @type {MouseEvent} */ e,
      ) => {
        const menu = /** @type {HTMLElement} */ (e.currentTarget).closest('details')
        if (menu) menu.open = false
        x.onClick()
      }}>${x.label}</button>`,
  )}</div></details>`
/** User menu owns organization switching; the workspace picker only switches workspaces.
 * @param {{language?:string,languages?:{value:string,label:string}[],onLanguage?:(value:string)=>void,name:string,companyId:string,companies:{id:string,name:string}[],disabled?:boolean,onCompany:(id:string)=>void,items:Parameters<typeof FlowScopeMenu>[0]['items']}} p */
export const FlowUserMenu = (p) =>
  FlowScopeMenu({
    label: p.name,
    placement: 'up',
    items: p.items,
    header: html`<div data-flow="user-organization">${p.languages ? html`<label><span>${tr('flow.ui.language')}</span>${FlowSelect({ label: tr('flow.ui.language'), value: p.language ?? 'en', options: p.languages, onChange: (e) => p.onLanguage?.(/** @type {HTMLSelectElement} */ (e.target).value) })}</label>` : null}<label><span>${tr('flow.ui.current.organization')}</span>${FlowSelect(
      {
        label: tr('flow.ui.switch.organization'),
        value: p.companyId,
        options: p.companies.map((c) => ({ value: c.id, label: c.name })),
        disabled: p.disabled,
        onChange: /** @param {Event} e */ (e) => {
          const select = /** @type {HTMLSelectElement} */ (e.target)
          const menu = select.closest('details')
          if (menu) menu.open = false
          p.onCompany(select.value)
        },
      },
    )}</label></div>`,
  })
/** @param {{title:Child,message?:string,children?:Child,tone?:'neutral'|'green'|'yellow'|'red',action?:Child}} p */
export const FlowNotice = (p) =>
  html`<aside
    data-flow="notice"
    data-tone=${p.tone ?? 'neutral'}
    role=${p.tone === 'red' ? 'alert' : 'status'}
  >
    <div>
      <strong>${p.title}</strong>
      ${p.children ?? html`<p>${p.message}</p>`}
    </div>
    ${p.action ?? null}
  </aside>`
/** @param {{items:{label:string,value:string|number,note?:string,tone?:string}[],inset?:'page'|'none'}} p */
export const FlowMetrics = (p) =>
  html`<div data-flow="metrics" data-inset=${p.inset ?? 'page'}>
    ${each(
      p.items,
      (x) => x.label,
      (x) =>
        html`<div data-flow="metric" data-tone=${x.tone ?? 'neutral'}>
          <span>${x.label}</span
          ><strong>${x.value}</strong>${x.note ? html`<small>${x.note}</small>` : null}
        </div>`,
    )}
  </div>`
/** @param {{columns:Child[],children:Child,label:string}} p */
export const FlowTable = (p) =>
  html`<div data-flow="table-scroll">
    <table data-flow="table" data-columns=${p.columns.length} aria-label=${p.label}>
      <thead>
        <tr>
          ${each(
            p.columns,
            (_, index) => index,
            (x) => html`<th scope="col">${x}</th>`,
          )}
        </tr>
      </thead>
      <tbody>
        ${p.children}
      </tbody>
    </table>
  </div>`
/** `open` defaults to true; pass `onToggle` to remember a user's collapse across re-renders.
 * @param {{title:Child,count:number,children:Child,actions?:Child,open?:boolean,onToggle?:(open:boolean)=>void} & import("./task-drag.mjs").TaskDrop} p */
export const FlowGroup = (p) => {
  const drag = taskDrag(p)
  return html`<details data-flow="group" open=${p.open !== false} on:toggle=${(/** @type {Event} */ e) => p.onToggle?.(/** @type {HTMLDetailsElement} */ (e.currentTarget).open)} data-flow-task-drop=${p.onDropTask ? 'group' : null} on:flowtaskdrop=${drag.pointerDrop} on:flowtaskdragcheck=${drag.check}>
    <summary>
      <span data-flow="inline">${p.title}<small>${p.count}</small></span
      >${p.actions ?? null}
    </summary>
    ${p.children}
    ${!p.count && p.onDropTask ? html`<p data-flow="task-drop-empty">${tr('flow.ui.drop.tasks.in.this.group')}</p>` : null}
  </details>`
}
/** @param {{columns:{id:string,title:Child,count:number,children:Child,onDragCheck?:(id:string)=>string,onDrop?:(e:DragEvent)=>void,onDropTask?:(id:string,position:"before"|"after")=>void}[]}} p */
export const FlowBoard = (p) =>
  html`<div data-flow="board">
    ${each(
      p.columns,
      (x) => x.id,
      (x) =>
        html`<section
          data-flow="board-column"
          data-flow-task-drop=${x.onDropTask ? 'group' : null}
          on:flowtaskdrop=${taskDrag(x).pointerDrop} on:flowtaskdragcheck=${taskDrag(x).check}
          on:drop=${x.onDrop}
        >
          <header>${x.title}<small>${x.count}</small></header>
          <div data-flow="stack">${x.children}</div>
          ${!x.count && x.onDropTask ? html`<p data-flow="task-drop-empty">${tr('flow.ui.drop.tasks.here')}</p>` : null}
        </section>`,
    )}
  </div>`
/** The same property controls remain mounted when the rail becomes a popover.
 * @param {{main:Child,aside:Child,asideId?:string}} p */
export const FlowRecordLayout = (p) =>
  html`<div data-flow="record-layout">
    <div data-flow="record-main">${p.main}</div>
    <aside data-flow="record-aside" id=${p.asideId ?? 'flow-task-properties'} aria-label=${tr('flow.ui.task.properties')} data-flow-record-panel>
      <header data-flow="record-panel-header"><strong>${tr('flow.ui.task.properties')}</strong><button type="button" data-flow="button" data-variant="ghost" aria-label=${tr('flow.ui.close.properties')} popovertarget=${p.asideId ?? 'flow-task-properties'} popovertargetaction="hide">${FlowIcon('close')}</button></header>
      <div data-flow="record-panel-body">${p.aside}</div>
    </aside>
  </div>`
/** Compact-view trigger for the task rail; native popover manages light dismiss and Escape.
 * @param {{controls?:string}} [p] */
export const FlowRecordAsideTrigger = (p = {}) =>
  html`<button type="button" data-flow="record-panel-trigger" popovertarget=${p.controls ?? 'flow-task-properties'} aria-controls=${p.controls ?? 'flow-task-properties'} aria-haspopup="dialog">${FlowIcon('settings')}<span>${tr('flow.ui.properties')}</span></button>`
/** Inline editable properties; controls retain their native labels and behavior.
 * @param {{children:Child,label?:string}} p */
export const FlowPropertyFields = (p) =>
  html`<div data-flow="property-fields" role="group" aria-label=${p.label ?? tr('flow.ui.task.properties')}>${p.children}</div>`
/** @param {{items:{label:string,value:Child,icon?:Parameters<typeof FlowIcon>[0]}[]}} p */
export const FlowProperties = (p) =>
  html`<dl data-flow="properties">
    ${each(
      p.items,
      (x) => x.label,
      (x) =>
        html`<div>
          <dt>${x.icon ? FlowIcon(x.icon) : null}<span>${x.label}</span></dt>
          <dd>${x.value}</dd>
        </div>`,
    )}
  </dl>`
/** @param {{id:string,label:string,value?:string,placeholder?:string,required?:boolean,disabled?:boolean,onBlur?:(e:Event)=>void,onInput?:(e:Event)=>void}} p */
export const FlowTextarea = (p) =>
  html`<label data-flow="field" for=${p.id}
    ><span>${p.label}</span
    ><textarea
      data-flow="textarea"
      id=${p.id}
      name=${p.id}
      data-flow-value=${p.value ?? ''}
      required=${p.required ?? false}
      disabled=${p.disabled ?? false}
      placeholder=${p.placeholder ?? ''}
      on:input=${p.onInput}
      on:blur=${p.onBlur}
    >
${p.value ?? ''}</textarea>
  </label>`
/** @param {{title:string,subtitle?:string,children:Child}} p */
export const FlowDocument = (p) =>
  html`<article data-flow="document">
    <h2>${p.title}</h2>
    ${p.subtitle ? html`<p data-flow="muted">${p.subtitle}</p>` : null}${p.children}
  </article>`
/** The whole card opens `onOpen`. `icon`, `eyebrow` (a short code) and `status` (a FlowTag) share the top row; `meta` sits on the bottom edge so cards in a grid line up.
 * @param {{title:string,description:string,meta?:Child,progress?:number,icon?:Parameters<typeof FlowIcon>[0],eyebrow?:string,status?:Child,onOpen:()=>void}} p */
export const FlowResourceCard = (p) =>
  html`<button data-flow="resource-card" type="button" on:click=${p.onOpen}>
    <span data-flow="resource-head"><span data-flow="resource-symbol">${FlowIcon(p.icon ?? 'folder')}</span>${p.eyebrow ? html`<small>${p.eyebrow}</small>` : null}${p.status ?? null}</span><strong>${p.title}</strong>
    <p>${p.description}</p>
    ${p.progress === undefined ? null : FlowProgress({ value: p.progress, total: 100, label: p.title })}<span
      data-flow="inline"
      >${p.meta ?? null}</span
    >
  </button>`
/** @param {{children:Child}} p */
export const FlowCardGrid = (p) => html`<div data-flow="card-grid">${p.children}</div>`
/** @param {{items:{id:string,person:string,text:string,time:string,messageKey?:string,messageValues?:Array<string|number>}[]}} p */
export const FlowActivity = (p) =>
  html`<div data-flow="activity">
    ${each(
      p.items,
      (x) => x.id,
      (x) =>
        html`<div>
          ${FlowAvatar({ name: x.person })}
          <div>
            <strong>${x.person}</strong>
            <p>${x.messageKey ? tr(x.messageKey, x.messageValues ?? []) : x.text}</p>
            <small>${x.time}</small>
          </div>
        </div>`,
    )}
  </div>`
/** @param {{label:string,caption?:string,mode:'week'|'month',focusKey:string,focusIndex:number,days:{id:string,label:string,weekend?:boolean,today?:boolean,focused?:boolean}[],groups:{id:string,label:string,start:number,span:number}[],rows:{id:string,title:string,start:number,span:number,dateLabel:string,rawStart?:number,rawSpan?:number,onSchedule?:(change:{mode:'move'|'start'|'end',days:number})=>void,tone?:string,clippedStart?:boolean,clippedEnd?:boolean,onOpen:()=>void,onLocate?:()=>void}[]}} p */
export const FlowTimeline = (
  p,
) => html`<section data-flow="timeline-panel"><div data-flow="timeline" role="region" tabindex="0" aria-label=${p.label}
  data-mode=${p.mode} data-focus-key=${p.focusKey} data-focus-index=${p.focusIndex}
  style=${`--flow-timeline-days:${p.days.length}`}>
  <div data-flow="timeline-canvas">
    <div data-flow="timeline-head">
      <span data-flow="timeline-label">${tr('flow.ui.tasks')}</span>
      <div data-flow="timeline-scale">
        <div data-flow="timeline-months">${each(
          p.groups,
          (g) => g.id,
          (g) =>
            html`<span style=${`grid-column:${g.start} / span ${g.span}`}><span data-flow="timeline-period-label">${g.label}</span></span>`,
        )}</div>
        <div data-flow="timeline-days">${each(
          p.days,
          (d) => d.id,
          (d) =>
            html`<span data-date=${d.id} data-weekend=${d.weekend} data-today=${d.today} data-focused=${d.focused} title=${d.id}>${d.label}</span>`,
        )}</div>
      </div>
    </div>
    ${each(
      p.rows,
      (r) => r.id,
      (r) => html`<div data-flow="timeline-row">
      <div data-flow="timeline-label">
        <button data-flow="task-open" type="button" on:click=${r.onOpen} title=${`${r.id} · ${r.title}`}>${r.id} · ${r.title}</button>
        ${r.onLocate ? FlowButton({ label: tr('flow.ui.go.to.schedule.for', [r.id]), icon: 'arrow', iconOnly: true, variant: 'ghost', size: 'sm', onClick: r.onLocate }) : null}
      </div>
      <div data-flow="timeline-track">
        ${each(
          p.days.filter((d) => d.today || d.focused),
          (d) => d.id,
          (d) =>
            html`<span data-flow="timeline-marker" data-today=${d.today} style=${`grid-column:${p.days.indexOf(d) + 1}`} aria-hidden="true"></span>`,
        )}
        ${
          r.span > 0
            ? html`<div data-flow="timeline-range" data-editable=${!!r.onSchedule}
          data-raw-start=${r.rawStart ?? r.start} data-raw-span=${r.rawSpan ?? r.span}
          data-clipped-start=${r.clippedStart} data-clipped-end=${r.clippedEnd}
          style=${`grid-column:${r.start} / span ${r.span}`} data-tone=${r.tone ?? 'blue'}
          on:flowtimelineschedule=${(/** @type {CustomEvent} */ e) => r.onSchedule?.(e.detail)}
          on:keydown=${(/** @type {KeyboardEvent} */ e) => {
            if (!r.onSchedule || !e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return
            e.preventDefault()
            const mode = e.target instanceof HTMLElement ? e.target.dataset.timelineMode : 'move'
            r.onSchedule({
              mode: mode === 'start' || mode === 'end' ? mode : 'move',
              days: e.key === 'ArrowLeft' ? -1 : 1,
            })
          }}>
          <button type="button" draggable="false" data-flow="timeline-bar" data-timeline-mode="move"
            title=${`${r.title} · ${r.dateLabel}`} aria-label=${`${r.title} · ${r.dateLabel}`} on:click=${r.onOpen}>${r.title}</button>
          ${r.onSchedule && !r.clippedStart ? html`<button type="button" draggable="false" data-flow="timeline-resize" data-timeline-mode="start" aria-label=${tr('flow.ui.change.start.date.of', [r.id])} title=${tr('flow.ui.drag.to.change.start.date.alt')}></button>` : null}
          ${r.onSchedule && !r.clippedEnd ? html`<button type="button" draggable="false" data-flow="timeline-resize" data-timeline-mode="end" aria-label=${tr('flow.ui.change.due.date.of', [r.id])} title=${tr('flow.ui.drag.to.change.due.date.alt')}></button>` : null}
        </div>`
            : html`<span data-flow="timeline-unscheduled" style=${`grid-column:${Math.max(1, p.focusIndex + 1)} / span ${Math.min(14, p.days.length - Math.max(0, p.focusIndex))}`}>${r.onLocate ? tr('flow.ui.outside.visible.range') : r.dateLabel}</span>`
        }
      </div>
    </div>`,
    )}
    ${p.rows.length ? null : html`<p data-flow="timeline-empty">${tr('flow.ui.no.tasks.match.the.filters')}</p>`}
  </div>
</div>${p.caption ? html`<p data-flow="timeline-caption">${p.caption}</p>` : null}</section>`
/** @param {{days:{label:string,today?:boolean,children:Child}[]}} p */
export const FlowCalendar = (p) =>
  html`<div data-flow="calendar">
    ${each(
      p.days,
      (x) => x.label,
      (x) =>
        html`<section data-today=${String(!!x.today)}>
          <header>${x.label}</header>
          ${x.children}
        </section>`,
    )}
  </div>`
/** @param {{title:string,children:Child,footer?:Child,onClose:()=>void}} p */
export const FlowSheet = (p) =>
  html`<section data-flow="sheet" aria-label=${p.title}>
    <header>
      <h2>${p.title}</h2>
      ${FlowButton({ label: tr('flow.ui.close.5d54c2'), icon: 'close', iconOnly: true, variant: 'ghost', onClick: p.onClose })}
    </header>
    <div data-flow="sheet-body">${p.children}</div>
    ${p.footer ? html`<footer>${p.footer}</footer>` : null}
  </section>`
/** @param {{label:string}} p */
export const FlowLoading = (p) =>
  html`<div data-flow="loading" role="status" aria-busy="true">
    <span data-flow="spinner"></span><span>${p.label}</span>
    <div data-flow="skeleton"></div>
    <div data-flow="skeleton"></div>
    <div data-flow="skeleton"></div>
  </div>`
/** ERP entry opens a separate Flow tab; in-Flow navigation remains same-tab.
 * @param {{href:string,label?:string}} p */
export const FlowLaunchLink = (p) =>
  html`<a
    data-flow="launch-link"
    href=${p.href}
    target="_blank"
    rel="noopener"
    aria-label=${tr('flow.ui.new.tab', [p.label ?? tr('flow.ui.open.flow')])}
    >${FlowIcon('arrow')}${p.label ?? tr('flow.ui.open.flow')}<span data-flow="sr">${tr('flow.ui.new.tab.8f664a')}</span></a
  >`

/** @param {{name:string,label:string,icon?:Parameters<typeof FlowIcon>[0],value:string,options:{value:string,label:string}[],disabled?:boolean,onChange?:(e:Event)=>void}} p */
export const FlowSelectField = (p) =>
  html`<label data-flow="field" for=${p.name}
    ><span>${p.icon ? FlowIcon(p.icon) : null}${p.label}</span>${FlowSelect({ ...p, id: p.name })}</label
  >`

/** Host slot for the official KetAtlas viewer; the consumer owns its lifecycle.
 * @param {{label:string,children?:Child}} p */
export const FlowAtlasViewport = (p) =>
  html`<section data-flow="atlas-viewport" aria-label=${p.label}>${p.children ?? null}</section>`

/** A project onboarding surface; the diagram is illustrative, not a second viewer.
 * @param {{projectName:string,action:Child}} p */
export const FlowAtlasWelcome = (p) => html`
  <section data-flow="atlas-welcome" aria-label=${tr('flow.ui.get.started.with.atlas')}>
    <div data-flow="atlas-welcome-intro">
      <div data-flow="atlas-welcome-copy">
        <div data-flow="inline">${FlowTag({ label: tr('flow.ui.not.connected'), tone: 'yellow' })}<span data-flow="muted">${p.projectName}</span></div>
        <h2>${tr('flow.ui.one.place.to.see')}<br />${tr('flow.ui.the.entire.product.flow')}</h2>
        <p>${tr('flow.ui.connect.atlas.from.github.so.your.team.can.explore.screens.follow.each.step.and')}</p>
        <div data-flow="atlas-welcome-action">${p.action}</div>
        <span data-flow="atlas-welcome-note">${trRich('flow.ui.choose.the.repository.and.branch.to.view', [FlowIcon('link')])}</span>
      </div>
      <figure data-flow="atlas-welcome-preview" aria-label=${tr('flow.ui.atlas.illustration.from.library.to.screen.flows')}>
        <div data-flow="atlas-welcome-preview-bar"><span>${FlowIcon('layers')}Atlas</span>${FlowTag({ label: tr('flow.ui.illustration') })}</div>
        <div data-flow="atlas-welcome-source">${FlowIcon('folder')}product / workspace<span>develop</span></div>
        <div data-flow="atlas-welcome-map" aria-hidden="true">
          <div data-flow="atlas-welcome-node" data-step="first">
            <div data-flow="atlas-welcome-node-title"><span>01</span>${tr('flow.ui.task.board')}</div>
            <div data-flow="atlas-welcome-mini-board"><i></i><i></i><i></i></div>
            <small>${tr('flow.ui.starting.point')}</small>
          </div>
          <div data-flow="atlas-welcome-connector">${FlowIcon('arrow')}</div>
          <div data-flow="atlas-welcome-node" data-step="second">
            <div data-flow="atlas-welcome-node-title"><span>02</span>${tr('flow.ui.task.details')}</div>
            <div data-flow="atlas-welcome-mini-record"><i></i><i></i><i></i></div>
            <small>${trRich('flow.ui.ready.for.handover', [FlowIcon('check')])}</small>
          </div>
        </div>
        <figcaption>${tr('flow.ui.screens.with.context.flows.with.destinations')}</figcaption>
      </figure>
    </div>
    <div data-flow="atlas-welcome-setup">
      <div data-flow="atlas-welcome-section-title"><h3>${tr('flow.ui.get.started.in.3.steps')}</h3><span data-flow="muted">${tr('flow.ui.design.sources.stay.in.your.repository')}</span></div>
      <ol data-flow="atlas-welcome-steps">
        <li><span data-flow="atlas-welcome-step-number">1</span><div><h4>${tr('flow.ui.connect.github')}</h4><p>${tr('flow.ui.choose.an.authorized.repository.for.this.project')}</p></div></li>
        <li><span data-flow="atlas-welcome-step-number">2</span><div><h4>${tr('flow.ui.select.a.design.branch')}</h4><p>${tr('flow.ui.view.a.stable.version.or.follow.designs.on.a.development.branch')}</p></div></li>
        <li><span data-flow="atlas-welcome-step-number">3</span><div><h4>${tr('flow.ui.open.atlas.with.your.team')}</h4><p>${tr('flow.ui.find.screen.collections.explore.flows.and.open.screens.to.try.them')}</p></div></li>
      </ol>
    </div>
    <div data-flow="atlas-welcome-footer">
      <div>${FlowIcon('clock')}<span><strong>${tr('flow.ui.always.know.which.version.you.re.viewing')}</strong><small>${tr('flow.ui.atlas.includes.its.branch.and.commit.so.reviews.share.the.same.reference')}</small></span></div>
      <details><summary>${tr('flow.ui.what.does.the.repository.need')}</summary><p>${tr('flow.ui.a.folder')}<code>.ketatlas</code>${tr('flow.ui.containing')}<code>atlas.json</code>${tr('flow.ui.once.connected.flow.finds.atlases.on.your.branch.you.can.connect.the.repository')}</p></details>
    </div>
  </section>`

/** URL-backed navigation within a Workspace or Company; uses links, not local tab panels.
 * @param {{label:string,value:string,options:{value:string,label:string,icon:Parameters<typeof FlowIcon>[0],href:string}[],onChange:(value:string)=>void}} p */
export const FlowScopeTabs = (p) => html`<nav data-flow="scope-tabs" aria-label=${p.label}>
 ${each(
   p.options,
   (o) => o.value,
   (o) =>
     html`<a data-flow="scope-tab" href=${o.href} aria-current=${p.value === o.value ? 'page' : null} on:click=${
       /** @param {MouseEvent} e */ (e) => {
         if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
         e.preventDefault()
         p.onChange(o.value)
       }
     }>${FlowIcon(o.icon)}<span>${o.label}</span></a>`,
 )}
</nav>`

/** Project view navigation with a saved-list picker attached to its List item.
 * @param {{value:string,selectedView?:string,options:{value:string,label:string,icon:Parameters<typeof FlowIcon>[0]}[],views:{id:string,title:string}[],onChange:(value:string)=>void,onView:(id:string)=>void,onSave:()=>void,canSave?:boolean}} p */
export const FlowProjectViews = (
  p,
) => html`<nav data-flow="project-views" aria-label=${tr('flow.ui.project.views')}>
  ${each(
    p.options,
    (o) => o.value,
    (o) => html`<div data-flow="project-view" data-active=${p.value === o.value}>
    <button type="button" data-flow="project-view-link" aria-current=${p.value === o.value ? 'page' : null} on:click=${() => p.onChange(o.value)}>${FlowIcon(o.icon)}${o.label}</button>
    ${
      o.value === 'project-issues'
        ? html`<button type="button" data-flow="project-view-picker" aria-label=${tr('flow.ui.open.list.views')} popovertarget="flow-saved-view-menu"
      on:click=${
        /** @param {MouseEvent} e */ (e) => {
          const button = /** @type {HTMLElement} */ (e.currentTarget)
          const menu = /** @type {HTMLElement} */ (button.nextElementSibling)
          const rect = button.getBoundingClientRect()
          menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 288))}px`
          menu.style.top = `${rect.bottom + 4}px`
        }
      }>${FlowIcon('down')}</button>
      <div id="flow-saved-view-menu" data-flow="saved-view-menu" popover="auto" aria-label=${tr('flow.ui.list.views')}>
        <button type="button" aria-pressed=${!p.selectedView} on:click=${
          /** @param {MouseEvent} e */ (e) => {
            const menu = /** @type {HTMLElement} */ (e.currentTarget).closest('[popover]')
            if (menu instanceof HTMLElement) menu.hidePopover()
            p.onView('')
          }
        }>${tr('flow.ui.default.list')}</button>
        <span data-flow="saved-view-menu-label">${tr('flow.ui.saved.views')}</span>
        ${each(
          p.views,
          (v) => v.id,
          (v) =>
            html`<button type="button" aria-pressed=${p.selectedView === v.id} on:click=${
              /** @param {MouseEvent} e */ (e) => {
                const menu = /** @type {HTMLElement} */ (e.currentTarget).closest('[popover]')
                if (menu instanceof HTMLElement) menu.hidePopover()
                p.onView(v.id)
              }
            }>${FlowIcon('filter')}<span>${v.title}</span></button>`,
        )}
        ${p.views.length ? null : html`<p>${tr('flow.ui.no.saved.views.yet')}</p>`}
        <button type="button" disabled=${!p.canSave} on:click=${
          /** @param {MouseEvent} e */ (e) => {
            const menu = /** @type {HTMLElement} */ (e.currentTarget).closest('[popover]')
            if (menu instanceof HTMLElement) menu.hidePopover()
            p.onSave()
          }
        }>${trRich('flow.ui.save.current.view.8f90c2', [FlowIcon('plus')])}</button>
      </div>`
        : null
    }
  </div>`,
  )}
</nav>`

/** Transient feedback in the top layer; never participates in workspace layout.
 * @param {{message:string,title?:string,tone?:"success"|"error"|"warning",action?:Child,onClose:()=>void,onPause?:()=>void,onResume?:()=>void}} p */
export const FlowToast = (p) => html`<div data-flow="toast" data-tone=${p.tone ?? 'success'} popover="manual"
  on:pointerenter=${p.onPause}
  on:pointerleave=${
    /** @param {PointerEvent} e */ (e) => {
      if (!(/** @type {HTMLElement} */ (e.currentTarget).contains(document.activeElement))) p.onResume?.()
    }
  }
  on:focusin=${p.onPause}
  on:focusout=${
    /** @param {FocusEvent} e */ (e) => {
      const toast = /** @type {HTMLElement} */ (e.currentTarget)
      if (!toast.contains(/** @type {Node|null} */ (e.relatedTarget)) && !toast.matches(':hover'))
        p.onResume?.()
    }
  }>
    <span data-flow="toast-message" role=${p.tone === 'error' ? 'alert' : 'status'} aria-live=${p.tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true">${FlowIcon(p.tone === 'error' ? 'close' : p.tone === 'warning' ? 'flag' : 'check')}<span>${p.title ? html`<strong>${p.title}</strong>` : null}${p.message}</span></span>
    ${p.action ?? null}
    ${FlowButton({ label: tr('flow.ui.dismiss.notification'), icon: 'close', iconOnly: true, size: 'sm', variant: 'ghost', onClick: p.onClose })}
  </div>`

/** @typedef {{id:string,title:string,color?:'neutral'|'blue'|'green'|'yellow'|'red',archived?:boolean}} FlowLabel */
/** A controlled multi-select; selection and persistence belong to the consumer.
 * @param {{id:string,label?:string,placeholder?:string,value:string[],options:FlowLabel[],disabled?:boolean,onChange:(ids:string[])=>void,onManage?:()=>void}} p */
export const FlowTagPicker = (p) => html`<div data-flow="field">
  <span id=${`${p.id}-label`}>${FlowIcon('tag')}${p.label ?? tr('flow.ui.labels')}</span>
  <div data-flow="tag-picker">
    <div data-flow="tag-selection">
      ${each(
        p.options.filter((t) => p.value.includes(t.id)),
        (t) => t.id,
        (t) => html`<span data-flow="tag-selection-item" data-tone=${t.color ?? 'neutral'}>
        <span>${t.title}${t.archived ? tr('flow.ui.archived') : ''}</span>
        <button type="button" disabled=${p.disabled} aria-label=${`${p.placeholder ? tr('flow.ui.remove') : tr('flow.ui.remove.label')} ${t.title}`} on:click=${() => p.onChange(p.value.filter((id) => id !== t.id))}>${FlowIcon('close')}</button>
      </span>`,
      )}
      <button type="button" data-flow="tag-picker-trigger" disabled=${p.disabled} aria-label=${p.placeholder ?? tr('flow.ui.select.labels')} popovertarget=${`${p.id}-menu`}
        on:click=${
          /** @param {MouseEvent} e */ (e) => {
            const button = /** @type {HTMLElement} */ (e.currentTarget)
            const menu = /** @type {HTMLElement} */ (
              button.closest('[data-flow="tag-picker"]')?.querySelector('[popover]')
            )
            const rect = button.getBoundingClientRect()
            menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 296))}px`
            menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 340))}px`
          }
        }>${FlowIcon('plus')}${p.value.length ? tr('flow.ui.add') : (p.placeholder ?? tr('flow.ui.select.labels'))}</button>
    </div>
    <div data-flow="tag-menu" id=${`${p.id}-menu`} popover="auto" role="group" aria-labelledby=${`${p.id}-label`}>
      <input data-flow="input" type="search" placeholder=${p.placeholder ? tr('flow.ui.search.options') : tr('flow.ui.search.labels')} aria-label=${p.placeholder ? tr('flow.ui.search.options.c05398') : tr('flow.ui.search.labels.99b4f6')} on:input=${
        /** @param {Event} e */ (e) => {
          const input = /** @type {HTMLInputElement} */ (e.currentTarget)
          input.parentElement?.querySelectorAll('[data-flow="tag-option"]').forEach((node) => {
            const option = /** @type {HTMLElement} */ (node)
            option.hidden = !option.textContent
              ?.toLocaleLowerCase()
              .includes(input.value.toLocaleLowerCase().trim())
          })
        }
      } />
      <div data-flow="tag-options">
        ${each(
          p.options.filter((t) => !t.archived || p.value.includes(t.id)),
          (t) => t.id,
          (t) => html`<label data-flow="tag-option">
          <input type="checkbox" checked=${p.value.includes(t.id)} disabled=${p.disabled || t.archived} aria-label=${t.title}
            on:change=${/** @param {Event} e */ (e) => p.onChange(/** @type {HTMLInputElement} */ (e.currentTarget).checked ? [...new Set([...p.value, t.id])] : p.value.filter((id) => id !== t.id))} />
          ${FlowTag({ label: t.title, tone: t.color ?? 'neutral' })}
        </label>`,
        )}
        ${p.options.some((t) => !t.archived) ? null : html`<p>${p.placeholder ? tr('flow.ui.no.available.options') : tr('flow.ui.no.labels.yet.create.labels.in.settings')}</p>`}
      </div>
      ${p.onManage ? FlowButton({ label: tr('flow.ui.manage.labels'), icon: 'settings', variant: 'ghost', disabled: p.disabled, onClick: p.onManage }) : null}
    </div>
  </div>
</div>`

/** Compact Workspace switcher; organization context belongs in the user menu.
 * @param {{companyId:string,workspaceId:string,companies:{id:string,name:string}[],workspaces:{id:string,title:string}[],disabled?:boolean,onWorkspace:(id:string)=>void,onManage?:()=>void}} p */
export const FlowContextPicker = (p) => {
  const workspace = p.workspaces.find((w) => w.id === p.workspaceId)?.title ?? tr('flow.ui.select.workspace')
  return html`<details data-flow="context-picker">
  <summary aria-label=${tr('flow.ui.switch.workspace', [workspace])} aria-disabled=${p.disabled ? 'true' : null} on:click=${
    /** @param {MouseEvent} e */ (e) => {
      if (p.disabled) e.preventDefault()
    }
  }>
   <span data-flow="context-symbol" aria-hidden="true">${FlowIcon('layers')}</span>
   <span data-flow="context-current"><strong>${workspace}</strong></span>${FlowIcon('down')}
  </summary>
  <div data-flow="context-panel">
   <span data-flow="context-caption">Workspace</span>
   <div data-flow="context-workspaces" aria-label=${tr('flow.ui.current.workspace')}>${each(
     p.workspaces,
     (w) => w.id,
     (w) =>
       html`<button type="button" aria-current=${w.id === p.workspaceId ? 'true' : null} disabled=${p.disabled} on:click=${
         /** @param {MouseEvent} e */ (e) => {
           const menu = /** @type {HTMLElement} */ (e.currentTarget).closest('details')
           if (menu) menu.open = false
           p.onWorkspace(w.id)
         }
       }>${FlowIcon('layers')}<span>${w.title}</span>${w.id === p.workspaceId ? FlowIcon('check') : null}</button>`,
   )}</div>
   ${!p.workspaces.length ? html`<small>${tr('flow.ui.no.accessible.workspaces')}</small>` : null}
   ${
     p.onManage
       ? html`<div data-flow="context-actions">${FlowButton({
           label: tr('flow.ui.manage.workspace'),
           icon: 'settings',
           variant: 'ghost',
           onClick: /** @param {Event} e */ (e) => {
             const menu = /** @type {HTMLElement} */ (e.currentTarget).closest('details')
             if (menu) menu.open = false
             p.onManage?.()
           },
         })}</div>`
       : null
}
  </div>
 </details>`
}
/** @param {{rows:{id:string,name:string,role:string,sources:string,status?:string,actions?:Child}[]}} p */
export const FlowAccessList = (p) =>
  html`<div data-flow="access-list">${each(
    p.rows,
    (x) => x.id,
    (x) =>
      html`<div data-flow="access-row"><div>${FlowAvatar({ name: x.name })}<strong>${x.name}</strong></div><div>${FlowTag({ label: x.role })}<small>${x.sources}</small>${x.status ? html`<small>${x.status}</small>` : null}</div><div data-flow="inline" data-align="end">${x.actions ?? null}</div></div>`,
  )}</div>`
/** @param {{projects:{id:string,title:string,active?:boolean,href:string,onOpen:(e:Event)=>void}[],onCreate?:()=>void}} p */
export const FlowProjectDirectory = (p) => html`<section data-flow="project-directory">
 <header><span>${tr('flow.ui.projects')}</span><div>${p.onCreate ? FlowButton({ label: tr('flow.ui.create.project'), icon: 'plus', iconOnly: true, variant: 'ghost', size: 'sm', onClick: p.onCreate }) : null}</div></header>
 <div data-flow="project-items">${each(
   p.projects,
   (x) => x.id,
   (x) =>
     html`<div data-flow="project-directory-row">${FlowNavItem({ label: x.title, href: x.href, icon: 'folder', active: x.active, onClick: x.onOpen })}</div>`,
 )}</div>
 ${!p.projects.length ? html`<small>${tr('flow.ui.no.projects.in.this.workspace.04553e')}</small>` : null}
</section>`

/** Checkbox with visible, clickable text for settings forms. @param {{label:string,checked?:boolean,disabled?:boolean,onChange?:(e:Event)=>void}} p */
export const FlowCheckboxField = (p) =>
  html`<label data-flow="checkbox-field">${FlowCheckbox({ ...p, checked: !!p.checked })}<span>${p.label}</span></label>`

/** @typedef {{id:string,title:string,description?:string,icon:Parameters<typeof FlowIcon>[0]}} FlowCommandItem */
/** Search-first dialog. Focus stays in the combobox while active-descendant tracks results.
 * @param {{id:string,feedback?:Child,title?:string,query:string,scope:string,activeId:string,groups:{id:string,label:string,items:FlowCommandItem[]}[],onQuery:(value:string)=>void,onActive:(id:string)=>void,onSelect:(id:string)=>void,onClose:()=>void}} p */
export const FlowSpotlight = (p) => {
  const items = p.groups.flatMap((g) => g.items),
    active = items.find((x) => x.id === p.activeId) ?? items[0]
  /** @param {string} id */
  const optionId = (id) => `${p.id}-option-${encodeURIComponent(id)}`
  return FlowDialog({
    id: p.id,
    title: p.title ?? tr('flow.ui.search.flow'),
    size: 'spotlight',
    onRequestClose: p.onClose,
    feedback: p.feedback,
    body: html`<div data-flow="spotlight">
  <div data-flow="spotlight-search">${FlowIcon('search')}
   <input data-flow="spotlight-input" type="text" role="combobox" aria-label=${tr('flow.ui.search.flow')} aria-autocomplete="list" aria-expanded="true" aria-controls=${p.id + '-results'} aria-activedescendant=${active ? optionId(active.id) : null} autocomplete="off" spellcheck="false" autofocus data-flow-value=${p.query} data-flow-controlled value=${p.query} placeholder=${tr('flow.ui.search.tasks.projects.documents')}
    on:input=${/** @param {Event} e */ (e) => p.onQuery(/** @type {HTMLInputElement} */ (e.target).value)}
    on:keydown=${
      /** @param {KeyboardEvent} e */ (e) => {
        if (e.isComposing) return
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault()
          if (!items.length) return
          const i = items.findIndex((x) => x.id === active?.id)
          p.onActive(items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].id)
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          if (active) p.onSelect(active.id)
        }
      }
    } />
   ${
     p.query
       ? FlowButton({
           label: tr('flow.ui.clear.search'),
           icon: 'close',
           iconOnly: true,
           variant: 'ghost',
           size: 'sm',
           onClick: /** @param {Event} e */ (e) => {
             const input = /** @type {HTMLElement} */ (e.currentTarget).parentElement?.querySelector('input')
             p.onQuery('')
             input?.focus()
           },
         })
       : null
}
   <button type="button" data-flow="spotlight-close" aria-label=${tr('flow.ui.close.search')} on:click=${p.onClose}><kbd>Esc</kbd></button>
  </div>
  <div data-flow="spotlight-results" id=${p.id + '-results'} role="listbox" aria-label=${tr('flow.ui.search.results')}>
   ${each(
     p.groups,
     (g) => g.id,
     (g) =>
       html`<div role="group" aria-labelledby=${p.id + '-group-' + g.id}><div data-flow="spotlight-group" id=${p.id + '-group-' + g.id}>${g.label}<span>${g.items.length}</span></div>${each(
         g.items,
         (x) => x.id,
         (x) =>
           html`<div data-flow="spotlight-option" id=${optionId(x.id)} role="option" aria-selected=${String(x.id === active?.id)} on:pointermove=${() => {
             if (x.id !== active?.id) p.onActive(x.id)
           }} on:mousedown=${/** @param {Event} e */ (e) => e.preventDefault()} on:click=${() => p.onSelect(x.id)}><span data-flow="spotlight-symbol">${FlowIcon(x.icon)}</span><span data-flow="spotlight-copy"><strong>${x.title}</strong>${x.description ? html`<small>${x.description}</small>` : null}</span><span data-flow="spotlight-enter" aria-hidden="true">↵</span></div>`,
       )}</div>`,
   )}
  </div>
  ${!items.length ? html`<div data-flow="spotlight-empty">${FlowIcon('search')}<strong>${tr('flow.ui.no.results.found')}</strong><p>${tr('flow.ui.try.another.name.task.id.or.shorter.keyword')}</p></div>` : null}
  <footer data-flow="spotlight-footer"><span data-flow="spotlight-help"><span><kbd>↑</kbd><kbd>↓</kbd>${tr('flow.ui.navigate')}</span><span><kbd>↵</kbd>${tr('flow.ui.open.9ca07e')}</span></span><span data-flow="spotlight-scope" title=${p.scope}>${p.scope}</span></footer>
  <span data-flow="spotlight-announcement" role="status" aria-live="polite">${tr('flow.ui.results', [items.length, p.query ? ' cho ' + p.query : ''])}</span>
 </div>`,
  })
}

/** Paired form fields collapse to one column on narrow screens. @param {{children:Child}} p */
export const FlowFormGrid = (p) => html`<div data-flow="form-grid">${p.children}</div>`
/** Fields and their submit button on one line, bottom-aligned; wraps to a stack on narrow screens. With one field the button takes only its own width. @param {{children:Child}} p */
export const FlowFieldRow = (p) => html`<div data-flow="field-row">${p.children}</div>`
/** @param {{children:Child,actions:Child,onSubmit:(event:Event)=>void}} p */
export const FlowSetupForm = (p) =>
  html`<form data-flow="setup-form" on:submit=${p.onSubmit}><div data-flow="setup-fields">${p.children}</div><footer data-flow="setup-actions">${p.actions}</footer></form>`

/** Progressive disclosure keeps supporting detail near its task. @param {{title:Child,description?:string,children:Child,open?:boolean}} p */
export const FlowDisclosure = (p) =>
  html`<details data-flow="disclosure" open=${p.open ?? false}><summary><span>${p.title}${p.description ? html`<small>${p.description}</small>` : null}</span>${FlowIcon('chevron')}</summary><div data-flow="disclosure-body">${p.children}</div></details>`
/** Auto rows align with their parent; FlowList owns row insets and separators. Use plain for a flush row even inside a list, or row for an explicitly inset standalone row. @param {{title:Child,description?:Child,meta?:Child,actions?:Child,leading?:Child,unread?:boolean,variant?:'auto'|'row'|'plain'}} p */
export const FlowListItem = (p) =>
  html`<div data-flow="list-item" data-variant=${p.variant ?? 'auto'} data-unread=${!!p.unread}>${p.leading ? html`<div data-flow="list-leading">${p.leading}</div>` : null}<div data-flow="list-copy"><strong>${p.title}</strong>${p.description ? html`<div data-flow="list-description">${p.description}</div>` : null}${p.meta ? html`<div data-flow="list-meta">${p.meta}</div>` : null}</div>${p.actions ? html`<div data-flow="list-actions">${p.actions}</div>` : null}</div>`
/** @param {{children:Child,label?:string}} p */
export const FlowList = (p) => html`<div data-flow="list" aria-label=${p.label ?? null}>${p.children}</div>`
/** @param {{children:Child,tone?:'neutral'|'yellow'|'red'|'green'}} p */
export const FlowHint = (p) => html`<p data-flow="hint" data-tone=${p.tone ?? 'neutral'}>${p.children}</p>`
/** @param {{label:string,title:string,meta?:string,onClick:()=>void,tone?:string}} p */
export const FlowCalendarEvent = (p) =>
  html`<button type="button" data-flow="calendar-event" data-tone=${p.tone ?? 'neutral'} aria-label=${p.label} on:click=${p.onClick}><strong>${p.title}</strong>${p.meta ? html`<small>${p.meta}</small>` : null}</button>`

/** Open evidence table; on narrow screens each row becomes a labelled card.
 * @param {{label:string,columns:{id:string,label:string}[],rows:{id:string,cells:Record<string,Child>,detail?:Child}[],total:Child}} p */
/** Dense evidence rows. `size` narrows or widens a column; `actionsLabel` adds a trailing column for each row's `actions`; `more` sits under the rows.
 * A row with `onOpen` opens on a pointer click anywhere outside its own controls; keep a button in the row (e.g. FlowEvidencePerson) as the keyboard path.
 * @param {{label:string,actionsLabel?:string,columns:{id:string,label:string,size?:'narrow'|'wide'}[],rows:{id:string,cells:Record<string,Child>,actions?:Child,detail?:Child,onOpen?:()=>void}[],total:Child,more?:Child}} p */
export const FlowEvidenceTable = (p) => {
  const span = p.columns.length + (p.actionsLabel ? 1 : 0)
  return html`<table data-flow="evidence-table" aria-label=${p.label}>
 <thead><tr>${each(
   p.columns,
   (c) => c.id,
   (c) => html`<th scope="col" data-size=${c.size ?? null}>${c.label}</th>`,
 )}${p.actionsLabel ? html`<th scope="col" data-flow="evidence-actions"><span data-flow="sr">${p.actionsLabel}</span></th>` : null}</tr></thead>
 <tbody>${each(
   p.rows,
   (r) => r.id,
   (r) =>
     html`<tr data-open=${r.onOpen ? true : null} on:click=${
       r.onOpen
         ? (/** @type {Event} */ e) => {
             const t = /** @type {any} */ (e.target)
             if (!t?.closest?.('button,a,input,select,textarea,summary,label')) r.onOpen?.()
           }
         : null
     }>${each(
       p.columns,
       (c) => c.id,
       (c) => html`<td data-label=${c.label} data-size=${c.size ?? null}>${r.cells[c.id]}</td>`,
     )}${p.actionsLabel ? html`<td data-flow="evidence-actions">${r.actions ?? null}</td>` : null}</tr>${r.detail ? html`<tr data-flow="evidence-detail"><td colspan=${span}>${r.detail}</td></tr>` : null}`,
 )}</tbody>
 <tfoot>${p.more ? html`<tr data-flow="evidence-more"><td colspan=${span}>${p.more}</td></tr>` : null}<tr><td colspan=${span}>${p.total}</td></tr></tfoot>
</table>`
}
/** One cell value with an optional muted second line. `hint` is the full wording behind a shortened value. Statuses go in `value` as a FlowTag so they match every other Flow surface.
 * @param {{value:Child,meta?:Child,hint?:string}} p */
export const FlowEvidenceValue = (p) =>
  html`<span data-flow="evidence-value" title=${p.hint ?? null}><span>${p.value}</span>${p.meta ? html`<small>${p.meta}</small>` : null}</span>`
/** Person identity for dense rows: avatar, name and a muted line; the button is the keyboard path to the row's detail.
 * @param {{name:string,meta?:Child,onOpen:()=>void}} p */
export const FlowEvidencePerson = (p) =>
  html`<span data-flow="evidence-person"><button type="button" title=${p.name} on:click=${() => p.onOpen()}>${FlowAvatar({ name: p.name })}<span><span>${p.name}</span>${p.meta ? html`<small>${p.meta}</small>` : null}</span></button></span>`
/** Task identity for dense rows: muted id, one-line title that opens the task, optional context line. Records without a short id (goals) leave `id` out.
 * @param {{id?:string,title:string,meta?:Child,onOpen:()=>void}} p */
export const FlowEvidenceTask = (p) =>
  html`<span data-flow="evidence-task"><button type="button" title=${p.title} on:click=${() => p.onOpen()}>${p.id ? html`<small>${p.id}</small>` : null}<span>${p.title}</span></button>${p.meta ? html`<small>${p.meta}</small>` : null}</span>`

/** Navigation tiles for an overview: each tile is a link-like button to the place that explains the number.
 * @param {{label:string,items:{id:string,label:string,value:Child,detail?:Child,tone?:'neutral'|'green'|'yellow'|'red',visual?:Child,onClick:()=>void}[]}} p */
export const FlowStatGrid = (p) =>
  html`<div data-flow="stat-grid" role="group" aria-label=${p.label}>${each(
    p.items,
    (x) => x.id,
    (x) =>
      html`<button type="button" data-flow="stat" data-state=${x.tone ?? 'neutral'} on:click=${() => x.onClick()}><span>${x.label}</span><strong>${x.value}</strong>${x.visual ?? null}${x.detail ? html`<small>${x.detail}</small>` : null}</button>`,
  )}</div>`

/** Proportional bar; zero segments are dropped from the bar but kept in the accessible label. An unlabelled segment is spacing (e.g. headroom to the largest row) and stays out of the label.
 * @param {{label:string,segments:{id:string,label:string,value:number,tone:'green'|'yellow'|'blue'|'red'|'neutral'}[],legend?:boolean}} p */
export const FlowSegmentBar = (p) => {
  const total = p.segments.reduce((n, x) => n + x.value, 0)
  return html`<span data-flow="segment-bar"><span data-flow="segment-track" role="img" aria-label=${
    p.label +
    ': ' +
    p.segments
      .filter((x) => x.label)
      .map((x) => `${x.label} ${x.value}`)
      .join(' · ')
  }>${
    total
      ? each(
          p.segments.filter((x) => x.value > 0),
          (x) => x.id,
          (x) =>
            html`<span data-state=${x.tone} style=${`flex:${x.value}`} title=${`${x.label}: ${x.value}`}></span>`,
        )
      : null
  }</span>${
    p.legend
      ? html`<span data-flow="segment-legend">${each(
          p.segments,
          (x) => x.id,
          (x) =>
            html`<span><i data-state=${x.tone} aria-hidden="true"></i>${x.label} <b>${x.value}</b></span>`,
        )}</span>`
      : null
  }</span>`
}

/** Selectable column chart on one shared scale. `muted` dims non-working days; `current` marks today.
 * An `outlier` (e.g. an overdue backlog) is left out of the scale so it cannot flatten the other columns; if it exceeds the scale it is drawn full height and marked clipped, while its number stays exact.
 * @param {{label:string,selected?:string,onSelect:(id:string)=>void,items:{id:string,label:string,sublabel?:string,value:number,tone?:'neutral'|'red',muted?:boolean,current?:boolean,outlier?:boolean}[]}} p */
export const FlowColumnChart = (p) => {
  const max = Math.max(1, ...p.items.filter((x) => !x.outlier).map((x) => x.value))
  return html`<div data-flow="column-chart" role="group" aria-label=${p.label} style=${`--flow-columns:${p.items.length}`}>${each(
    p.items,
    (x) => x.id,
    (x) =>
      html`<button type="button" data-flow="column" aria-pressed=${String(x.id === p.selected)} data-state=${x.tone ?? 'neutral'} data-muted=${x.muted ? 'true' : null} aria-current=${x.current ? 'date' : null} aria-label=${`${x.label}${x.sublabel ? ' ' + x.sublabel : ''}: ${x.value}`} on:click=${() => p.onSelect(x.id)}><b>${x.value || ''}</b><span data-flow="column-plot"><span data-clipped=${x.value > max ? 'true' : null} style=${`height:${Math.min(1, x.value / max) * 100}%`}></span></span><span>${x.label}</span><small>${x.sublabel ?? ''}</small></button>`,
  )}</div>`
}

/** Shell-less page for signing in and first-run setup: brand line, optional numbered steps, one centred card. With onSubmit the card body is a form whose actions sit under the fields.
 * @param {{brand:string,title:string,description?:Child,steps?:{id:string,label:string,complete:boolean,current:boolean}[],stepsLabel?:string,children:Child,actions?:Child,onSubmit?:(event:Event)=>void,footer?:Child}} p */
export const FlowEntryPage = (p) => {
  const body = html`<div data-flow="entry-fields">${p.children}</div>${p.actions ? html`<div data-flow="entry-actions">${p.actions}</div>` : null}`
  return html`<main data-flow="entry-page"><div data-flow="entry-brand"><span aria-hidden="true">${FlowIcon('layers')}</span>${p.brand}</div>${
    p.steps
      ? html`<ol data-flow="entry-steps" aria-label=${p.stepsLabel ?? null}>${each(
          p.steps,
          (s) => s.id,
          (s, i) =>
            html`<li data-complete=${String(s.complete)} aria-current=${s.current ? 'step' : null}><span>${s.complete ? FlowIcon('check') : i + 1}</span>${s.label}</li>`,
        )}</ol>`
      : null
  }<section data-flow="entry-card"><header><h1>${p.title}</h1>${p.description ? html`<p>${p.description}</p>` : null}</header>${p.onSubmit ? html`<form data-flow="entry-form" on:submit=${p.onSubmit}>${body}</form>` : body}</section>${p.footer ? html`<footer data-flow="entry-footer">${p.footer}</footer>` : null}</main>`
}
/** Getting-started steps that tick themselves off from real data; open steps carry their own action.
 * @param {{title:string,description?:Child,progressLabel:string,done:number,total:number,doneLabel:string,todoLabel:string,actions?:Child,items:{id:string,title:string,description?:Child,done:boolean,action?:Child}[]}} p */
export const FlowChecklist = (p) =>
  html`<section data-flow="checklist" aria-label=${p.title}><header><div><h2>${p.title}</h2>${p.description ? html`<p>${p.description}</p>` : null}</div>${p.actions ?? null}</header><div data-flow="checklist-progress">${FlowProgress({ label: p.progressLabel, value: p.done, total: p.total })}<span>${p.progressLabel}</span></div><ol>${each(
    p.items,
    (x) => x.id,
    (x) =>
      html`<li data-done=${String(x.done)}><span data-flow="checklist-mark" role="img" aria-label=${x.done ? p.doneLabel : p.todoLabel}>${x.done ? FlowIcon('check') : null}</span><div><strong>${x.title}</strong>${x.description ? html`<small>${x.description}</small>` : null}</div>${x.done ? null : (x.action ?? null)}</li>`,
  )}</ol></section>`
/** Labelled meters for goals, sprints or load: one line of text, one bar, one muted line.
 * @param {{label:string,items:{id:string,title:Child,value:string,meta?:Child,bar:Child,onClick?:()=>void}[]}} p */
export const FlowMeterList = (p) =>
  html`<ul data-flow="meter-list" aria-label=${p.label}>${each(
    p.items,
    (x) => x.id,
    (x) =>
      html`<li><div>${x.onClick ? html`<button type="button" on:click=${() => x.onClick?.()}>${x.title}</button>` : html`<span>${x.title}</span>`}<b>${x.value}</b></div>${x.bar}${x.meta ? html`<small>${x.meta}</small>` : null}</li>`,
  )}</ul>`
