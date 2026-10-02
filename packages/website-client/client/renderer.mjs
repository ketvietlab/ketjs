// Theme renderer for a page layout (`Placement[]`, the value `website.saveEntry` stores).
// Pure and isomorphic: the builder canvas (client) and public delivery (server) must call this
// same function, so what an editor sees is what a visitor gets. It never fetches, never reads the
// DOM and never executes content. Unknown sections are kept and shown as a placeholder: dropping
// them would lose data on the next save.
import { html, each } from '@ketvietlab/ketjs-view'

const imageStyle = (s) => {
  const point = (key) => (Number.isFinite(Number(s[key])) ? Math.max(0, Math.min(100, Number(s[key]))) : 50)
  const ratio = { '4:3': '4 / 3', '1:1': '1', '16:9': '16 / 9' }[s.imageRatio]
  return `object-fit:${s.imageFit === 'contain' ? 'contain' : 'cover'};object-position:${point('focalX')}% ${point('focalY')}%;${ratio ? `aspect-ratio:${ratio};width:100%;height:auto;` : ''}`
}

/** Section types this renderer draws. Real sections plus explicit Real Δ proposals in server/section-additions.mjs. */
export const SECTION_RENDERERS = {
  'website.gallery': (s) =>
    html`<section class="wt-text"><h2>${s.heading ?? ''}</h2><div class="wt-gallery">${each(
      [s.image, s.image2].filter(Boolean),
      (_, index) => index,
      (source) =>
        html`<img src=${safeImage(source)} alt=${s.alt ?? s.caption ?? ''} style=${imageStyle(s)} />`,
    )}</div><p>${s.caption ?? ''}</p></section>`,
  'website.image': (s) =>
    html`<figure class="wt-image"><img src=${safeImage(s.image)} alt=${s.alt ?? ''} style=${imageStyle(s)} /><figcaption>${s.caption ?? ''}</figcaption></figure>`,
  'website.callout': (s) =>
    html`<section class="wt-hero wt-callout"><h2>${s.heading ?? ''}</h2><p>${s.body ?? ''}</p><a class="wt-button" href=${safeHref(s.ctaHref)}>${s.ctaLabel ?? ''}</a></section>`,
  'website.quote': (s) =>
    html`<blockquote class="wt-text"><p>${s.body ?? ''}</p><cite>${s.author ?? ''}</cite></blockquote>`,
  'website.faq': (s) =>
    html`<details class="wt-text"><summary>${s.heading ?? ''}</summary><p>${s.body ?? ''}</p></details>`,
  'website.video': (s) =>
    html`<section class="wt-text"><h2>${s.heading ?? ''}</h2><video controls preload="none" src=${safeHref(s.videoUrl)}></video><p>${s.caption ?? ''}</p></section>`,
  'website.hero': (s, options = {}) => html`<section class="wt-hero">
    ${s.image ? html`<img class="wt-cover" src=${safeImage(s.image)} alt=${s.alt ?? s.subheading ?? ''} style=${imageStyle(s)} />` : null}
    ${options.headingLevel === 2 ? html`<h2 class="wt-hero__title">${s.heading ?? ''}</h2>` : html`<h1 class="wt-hero__title">${s.heading ?? ''}</h1>`}
    ${s.subheading ? html`<p class="wt-hero__lead">${s.subheading}</p>` : null}
    ${s.ctaLabel ? html`<a class="wt-button" href=${safeHref(s.ctaHref)}>${s.ctaLabel}</a>` : null}
  </section>`,
  // A form section draws what `website_form.publicForm` answered for this placement
  // (`options.data`). Public pages post it to `/forms/{id}`; the builder shows it inert.
  'website_form.form': (_s, options = {}) => {
    const form = options.data
    const text = options.formText ?? {}
    const builder = options.mode === 'builder'
    if (!form?.id)
      return builder ? html`<div class="wt-unknown" role="note">${text.missing ?? ''}</div>` : html``
    const errors = form.errors ?? {}
    const values = form.values ?? {}
    const key = `wt-form-${options.placementId ?? form.id}`
    const control = (field) => {
      const id = `${key}-${field.name}`
      const error = errors[field.name]
      const common = {
        id,
        name: field.name,
        required: field.required && !builder ? '' : null,
        disabled: builder ? '' : null,
        invalid: error ? 'true' : null,
        described: error ? `${id}-error` : null,
      }
      const message = error ? html`<small class="wt-field__error" id=${`${id}-error`}>${error}</small>` : null
      if (field.type === 'checkbox')
        return html`<div class="wt-field wt-field--check"><input type="checkbox" id=${common.id} name=${common.name} value="on" autocomplete="off" checked=${values[field.name] ? '' : null} required=${common.required} disabled=${common.disabled} aria-invalid=${common.invalid} aria-describedby=${common.described} /><label for=${id}>${field.label}</label>${message}</div>`
      const value = typeof values[field.name] === 'string' ? values[field.name] : ''
      return html`<div class="wt-field"><label for=${id}>${field.label}${field.required ? html`<span aria-hidden="true"> *</span>` : null}</label>${
        field.type === 'textarea'
          ? html`<textarea id=${common.id} name=${common.name} rows="4" maxlength=${field.maxLength} required=${common.required} disabled=${common.disabled} aria-invalid=${common.invalid} aria-describedby=${common.described}>${value}</textarea>`
          : html`<input type=${['email', 'tel', 'number'].includes(field.type) ? field.type : 'text'} id=${common.id} name=${common.name} value=${value} maxlength=${field.maxLength} autocomplete="off" required=${common.required} disabled=${common.disabled} aria-invalid=${common.invalid} aria-describedby=${common.described} />`
      }${message}</div>`
    }
    const consentId = `${key}-consent`
    const body = html`${each(
      form.fields ?? [],
      (field) => field.name,
      (field) => control(field),
    )}${
      form.consentText
        ? html`<div class="wt-field wt-field--check"><input type="checkbox" id=${consentId} name="consent" value="on" autocomplete="off" checked=${values.consent ? '' : null} required=${builder ? null : ''} disabled=${builder ? '' : null} aria-invalid=${errors.consent ? 'true' : null} aria-describedby=${errors.consent ? `${consentId}-error` : null} /><label for=${consentId}>${form.consentText}</label>${errors.consent ? html`<small class="wt-field__error" id=${`${consentId}-error`}>${errors.consent}</small>` : null}</div>`
        : null
    }`
    return html`<section class="wt-form" aria-labelledby=${`${key}-title`}>${
      // The form's own page has no other heading, so the form title is its h1 there.
      form.standalone
        ? html`<h1 class="wt-text__title" id=${`${key}-title`}>${form.heading || form.title}</h1>`
        : html`<h2 class="wt-text__title" id=${`${key}-title`}>${form.heading || form.title}</h2>`
    }${form.description ? html`<p>${form.description}</p>` : null}${form.notice ? html`<p class="wt-form__notice" role="alert">${form.notice}</p>` : null}${
      builder
        ? html`<div class="wt-form__body">${body}<span class="wt-button" aria-disabled="true">${text.send ?? ''}</span></div>`
        : html`<form class="wt-form__body" method="post" action=${`/forms/${encodeURIComponent(form.id)}`}><input type="hidden" name="_schemaVersion" value=${String(form.schemaVersion ?? '')} autocomplete="off" /><input type="hidden" name="submissionKey" value=${form.submissionKey ?? ''} autocomplete="off" /><div class="wt-form__trap" aria-hidden="true"><label for=${`${key}-honeypot`}>Website</label><input type="text" id=${`${key}-honeypot`} name="honeypot" tabindex="-1" autocomplete="off" /></div>${body}<button class="wt-button" type="submit">${text.send ?? ''}</button></form>`
    }</section>`
  },
  'website.rich_text': (
    s,
  ) => html`<section class="wt-text" data-align=${s.align === 'center' ? 'center' : 'start'}>
    ${s.heading ? html`<h2 class="wt-text__title">${s.heading}</h2>` : null}
    ${each(
      String(s.body ?? '')
        .split(/\n{2,}/)
        .filter(Boolean),
      (_, index) => index,
      (paragraph) => html`<p>${paragraph}</p>`,
    )}
  </section>`,
}

export const safeImage = (value) =>
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(value)) ? value : safeHref(value)

/** Only relative or http(s) links reach a visitor; anything else renders as an inert anchor. */
export const safeHref = (value) => {
  const text = String(value ?? '').trim()
  return /^(\/(?!\/)|https?:\/\/)/i.test(text) ? text : '#'
}

/**
 * @param {readonly any[]} layout
 * @param {{ mode?: 'public' | 'builder', selected?: string | null, unknownLabel?: (type: string) => string, sectionData?: Record<string, any>, formText?: { send?: string, missing?: string } }} [options]
 */
export function renderLayout(layout, options = {}) {
  const builder = options.mode === 'builder'
  const node = (placement) => {
    const settings = { ...(placement.settings ?? {}) }
    const profile = options.profile ?? 'guest'
    if (settings.locale && settings.locale !== 'all' && options.locale && settings.locale !== options.locale)
      return html``
    if (settings.profile && settings.profile !== 'all' && settings.profile !== profile) return html``
    const spacing = { compact: '12px', comfortable: '24px', spacious: '40px' }
    const aligns = new Set(['start', 'center', 'end'])
    const vars = ['desktop', 'tablet', 'mobile']
      .map((point) => {
        const base = settings.responsive?.desktop ?? {}
        const selected = { ...base, ...settings.responsive?.[options.viewport ?? point] }
        return `--wt-min-${point}:${Number.isInteger(selected.minWidth) ? Math.max(0, Math.min(selected.minWidth, 4096)) : 0}px;--wt-max-${point}:${Number.isInteger(selected.maxWidth) ? `${Math.max(0, Math.min(selected.maxWidth, 4096))}px` : '100%'};--wt-space-${point}:${spacing[selected.spacing] ?? '0px'};--wt-align-${point}:${aligns.has(selected.align) ? selected.align : settings.align === 'center' ? 'center' : 'start'}`
      })
      .join(';')
    if (options.href && settings.ctaHref) settings.ctaHref = options.href(settings.ctaHref)
    const draw = SECTION_RENDERERS[placement.type]
    const inner =
      placement.type === 'website.columns'
        ? html`<section class="wt-columns" data-layout=${settings.layoutMode === 'stack' ? 'stack' : 'grid'} style=${`gap:${spacing[settings.gap] ?? '24px'}`}>
            <div class="wt-columns__slot" data-builder-drop-slot=${builder ? `${placement.id}:left` : null}>${builder && !placement.slots?.left?.length ? options.emptySlot?.(`${placement.id}:left`) : null}${list(placement.slots?.left ?? [])}</div>
            <div class="wt-columns__slot" data-builder-drop-slot=${builder ? `${placement.id}:right` : null}>${builder && !placement.slots?.right?.length ? options.emptySlot?.(`${placement.id}:right`) : null}${list(placement.slots?.right ?? [])}</div>
          </section>`
        : draw
          ? draw(settings, {
              ...options,
              placementId: placement.id,
              data: options.sectionData?.[placement.id],
            })
          : html`<div class="wt-unknown" role="note">${options.unknownLabel?.(placement.type) ?? placement.type}</div>`
    if (!builder)
      return html`<div class="wt-responsive" style=${vars} data-visibility=${settings.visibility ?? 'all'}>${inner}</div>`
    return html`<div
      class="wt-node website-builder-node"
      data-builder-drop-node=${placement.id}
      data-builder-container=${placement.slots ? 'true' : null}
      style=${vars}
      data-node=${placement.id}
      data-visibility=${settings.visibility ?? 'all'}
      data-selected=${placement.id === options.selected ? 'true' : null}
    >${options.controls?.(placement)}${inner}</div>`
  }
  const list = (items) =>
    each(
      items,
      (placement, index) => placement.id ?? `index-${index}`,
      (placement) => node(placement),
    )
  return html`<div class="wt-page" data-builder-drop-slot=${builder ? '' : null} data-website-theme="default" data-theme-preset=${options.preset === 'cosmetics' ? 'cosmetics' : null}>${builder && !layout.length ? options.emptySlot?.('') : null}${list(layout)}</div>`
}

/** Every placement at any depth, parents before children. */
export function walkLayout(layout, visit, parent = null) {
  for (const placement of layout) {
    visit(placement, parent)
    for (const children of Object.values(placement.slots ?? {})) walkLayout(children, visit, placement)
  }
}
