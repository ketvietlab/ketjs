const dateFormat = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function blogDetails(page) {
  const metadata = page.metadata ?? {}
  const date = /^\d{4}-\d{2}-\d{2}$/.test(page.date ?? '') ? new Date(`${page.date}T00:00:00Z`) : null
  const validDate = date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === page.date
  return {
    category:
      typeof metadata.category === 'string' && metadata.category.trim() ? metadata.category : 'Engineering',
    author: typeof metadata.author === 'string' && metadata.author.trim() ? metadata.author : 'KetJS team',
    date: validDate ? page.date : null,
    dateLabel: validDate ? dateFormat.format(date) : null,
    minutes: Math.max(1, Math.ceil((page.text?.trim().split(/\s+/).filter(Boolean).length ?? 0) / 230)),
  }
}

export function blogArticles(content) {
  return content
    .filter((page) => page.kind === 'blog' && page.slug !== 'index')
    .toSorted((a, b) => {
      const aDate = blogDetails(a).date ?? ''
      const bDate = blogDetails(b).date ?? ''
      return bDate.localeCompare(aDate) || a.order - b.order || a.title.localeCompare(b.title)
    })
}

export function featuredArticle(articles) {
  return articles.find((page) => page.metadata?.featured === true) ?? articles[0] ?? null
}

export function relatedArticles(page, articles) {
  const candidates = articles.filter((item) => item.route !== page.route)
  const category = blogDetails(page).category
  return candidates
    .toSorted(
      (a, b) => Number(blogDetails(b).category === category) - Number(blogDetails(a).category === category),
    )
    .slice(0, 2)
}
