export type ContentPage = {
  slug: string
  kind: string
  route: string
  title: string
  description: string
  group: string
  order: number
  date: string | null
  html: string
  text: string
  metadata: Record<string, unknown>
  toc: { id: string; title: string; depth: number }[]
}
export type HomeData = {
  title: string
  description: string
  eyebrow: string
  headline: string
  accent: string
  command: string
  choiceTitle: string
  choiceIntro: string
  reasons: { title: string; description: string; href: string; link: string }[]
  fitTitle: string
  fitDescription: string
  fitLimit: string
  features: { title: string; description: string; href: string; visual: string }[]
}

export type DocNavItem = Pick<ContentPage, 'kind' | 'slug' | 'route' | 'title' | 'group'>
