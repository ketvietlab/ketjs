import type { ContentPage } from './model.ts'
export const origin: string
export const groups: string[]
export function slugify(value: string): string
export function parseContent(source: string, options: { slug: string; kind?: string }): ContentPage
export function normalizeLinks(source: string): string
