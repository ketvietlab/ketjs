// Generate a crawler-compatible raster from the existing vector brand artwork.
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const svg = readFileSync('public/social.svg', 'utf8')
const image = new Resvg(svg, {
  font: { fontFiles: ['site/assets/Inter-Variable.ttf'], loadSystemFonts: false, defaultFontFamily: 'Inter' },
})
  .render()
  .asPng()
writeFileSync('public/social.png', image)
console.log('Generated 1200 × 630 social.png with Inter')
