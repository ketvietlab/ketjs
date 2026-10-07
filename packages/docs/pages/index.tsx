// File: packages/docs/pages/index.tsx
import { prepareAssets } from '../site/assets.mjs'
import { definePages } from '@ketvietlab/ketjs-view-tools'
import { readContent } from '../site/content-store.ts'
import { createPage } from '../site/pages.tsx'

const content = readContent()
prepareAssets(content)
export default definePages([
  ...content.map((page) => createPage(page.route, content)),
  createPage('/search/', content),
  createPage('/404/', content),
  createPage('/playground/', content),
])
