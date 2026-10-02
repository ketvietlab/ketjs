// Proposed SectionDef additions, NOT capabilities of the current KetJS pin.
// Production binding is blocked until these are registered upstream. The Atlas host explicitly
// composes them with real SectionDefs and runs the unchanged KetJS validator.
export const presentationSettings = {
  responsive: 'json?',
  visibility: 'text?',
  profile: 'text?',
  locale: 'text?',
  layoutMode: 'text?',
}
export const imageSettings = {
  alt: 'text?',
  focalX: 'int?',
  focalY: 'int?',
  imageFit: 'text?',
  imageRatio: 'text?',
}
export const proposedSections = {
  'website.gallery': {
    title: 'Bộ sưu tập ảnh',
    settings: {
      heading: 'text?',
      image: 'ref:website.MediaMetadata?',
      image2: 'ref:website.MediaMetadata?',
      caption: 'text?',
    },
  },
  'website.image': {
    title: 'Ảnh và chú thích',
    settings: { image: 'ref:website.MediaMetadata', alt: 'text', caption: 'text?' },
  },
  'website.callout': {
    title: 'Kêu gọi hành động',
    settings: { heading: 'text', body: 'text?', ctaLabel: 'text', ctaHref: 'text' },
  },
  'website.quote': { title: 'Trích dẫn', settings: { body: 'text', author: 'text?' } },
  'website.faq': { title: 'Câu hỏi thường gặp', settings: { heading: 'text', body: 'text' } },
  'website.video': { title: 'Video', settings: { heading: 'text?', videoUrl: 'text', caption: 'text?' } },
}
