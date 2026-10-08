import type { ContentPage } from './model.ts'

export function blogDetails(page: ContentPage): {
  category: string
  author: string
  date: string | null
  dateLabel: string | null
  minutes: number
}
export function blogArticles(content: ContentPage[]): ContentPage[]
export function featuredArticle(articles: ContentPage[]): ContentPage | null
export function relatedArticles(page: ContentPage, articles: ContentPage[]): ContentPage[]
