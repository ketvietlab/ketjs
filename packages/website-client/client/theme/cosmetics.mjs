// Core starter content: normal editable Placements, not a second theme renderer or executable KTL.
export const cosmeticsPreset = Object.freeze({
  preset: 'cosmetics',
  accent: 'green',
  font: 'sans',
  spacing: 'comfortable',
  buttons: 'square',
})

export function cosmeticsStarter(tr) {
  const t = (key) => tr(`website.cosmetics.${key}`)
  const asset = (name) => `/website-client/theme/cosmetics/${name}.svg`
  let count = 0
  const section = (type, settings, slots) => ({
    id: `cosmetics-node-${++count}`,
    type: `website.${type}`,
    settings,
    ...(slots ? { slots } : {}),
  })
  const text = (heading, body, align = 'start') =>
    section('rich_text', { heading: t(heading), body: t(body), align })
  const hero = (title, lead, cta, target, image, alt) =>
    section('hero', {
      heading: t(title),
      subheading: t(lead),
      ctaLabel: t(cta),
      ctaHref: target,
      ...(image ? { image: asset(image), alt: t(alt), imageFit: 'contain' } : {}),
    })
  const callout = (title, body, cta, target) =>
    section('callout', { heading: t(title), body: t(body), ctaLabel: t(cta), ctaHref: target })
  const product = (kind, path) => [
    section('image', { image: asset(kind), alt: t(`${kind}Alt`), imageRatio: '4:3', imageFit: 'contain' }),
    callout(`${kind}Title`, `${kind}Summary`, 'viewProduct', path),
  ]
  const collection = () =>
    section(
      'columns',
      {},
      { left: product('serum', '/serum-duong-am'), right: product('cream', '/kem-duong') },
    )
  const page = (id, path, title, layout) => ({ id: `cosmetics-${id}`, path, title: t(title), layout })
  return {
    brand: t('brand'),
    theme: { ...cosmeticsPreset, title: t('name'), logo: '', footer: t('footer') },
    menu: [
      [t('navHome'), '/'],
      [t('navProducts'), '/san-pham'],
      [t('navStory'), '/cau-chuyen'],
      [t('navCare'), '/cham-soc-da'],
    ].map(([label, href], position) => ({
      id: `cosmetics-menu-${position}`,
      label,
      href,
      parentId: null,
      position,
    })),
    media: ['collection', 'serum', 'cream'].map((key) => ({
      key,
      url: asset(key),
      alt: t(key === 'collection' ? 'homeAlt' : `${key}Alt`),
    })),
    pages: [
      page('home', '/', 'homePage', [
        hero('homeTitle', 'homeLead', 'homeCta', '/san-pham', 'collection', 'homeAlt'),
        text('collectionTitle', 'collectionBody', 'center'),
        collection(),
        callout('howTitle', 'howBody', 'howCta', '/cham-soc-da'),
        text('principlesTitle', 'principlesBody', 'center'),
      ]),
      page('products', '/san-pham', 'productsPage', [
        hero('productsTitle', 'productsLead', 'productsCta', '/cham-soc-da'),
        collection(),
      ]),
      ...[
        ['serum', '/serum-duong-am'],
        ['cream', '/kem-duong'],
      ].map(([key, path]) =>
        page(key, path, `${key}Title`, [
          hero(`${key}Title`, `${key}Lead`, 'howCta', '/cham-soc-da', key, `${key}Alt`),
          text(`${key}Title`, `${key}Summary`),
          text('useTitle', `${key}Use`),
          text('detailsTitle', 'detailsBody'),
          callout('collectionTitle', 'collectionBody', 'homeCta', '/san-pham'),
        ]),
      ),
      page('about', '/cau-chuyen', 'storyPage', [
        hero('storyTitle', 'storyLead', 'homeCta', '/san-pham', 'collection', 'homeAlt'),
        text('principlesTitle', 'storyBody'),
        text('howTitle', 'howBody'),
      ]),
      page('care', '/cham-soc-da', 'carePage', [
        hero('careTitle', 'careLead', 'careCta', '/san-pham'),
        text('howTitle', 'howBody'),
        section('faq', { heading: t('faqTitle'), body: t('faqBody') }),
      ]),
    ],
  }
}
