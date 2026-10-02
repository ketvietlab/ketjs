import type { ContentTypeDef, TaxonomyDef } from '@ketvietlab/ketjs'

export const contentTypes: Record<string, ContentTypeDef> = {
  page: {
    label: 'content.page',
    pluralLabel: 'content.pages',
    fields: { template: 'text?', locale: 'text?', seo: 'json?', style: 'json?' },
    detailPath: '/{slug}',
  },
  post: {
    label: 'content.post',
    pluralLabel: 'content.posts',
    fields: {
      featuredImage: 'id?',
      locale: 'text?',
      bodyDoc: 'text?',
      bodyText: 'text?',
      author: 'text?',
      category: 'id?',
      tags: 'json?',
      cover: 'text?',
      coverAlt: 'text?',
      publishedAt: 'text?',
      seo: 'json?',
    },
    taxonomies: ['category', 'tag'],
    archivePath: '/blog',
    detailPath: '/blog/{slug}',
  },
}

export const taxonomies: Record<string, TaxonomyDef> = {
  category: {
    label: 'taxonomy.category',
    pluralLabel: 'taxonomy.categories',
    hierarchical: true,
    contentTypes: ['post'],
  },
  tag: {
    label: 'taxonomy.tag',
    pluralLabel: 'taxonomy.tags',
    contentTypes: ['post'],
  },
}
