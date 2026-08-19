import { defineTheme } from 'ketjs'
import { templates } from './templates.ts'
import { tokens } from './tokens.ts'

export default defineTheme({
  name: 'theme_paper',
  version: '0.1.0',
  depends: ['website'],
  templates, tokens,
})
