// @ts-check
import { attachDesignSystemInteractions } from './index.js'

attachDesignSystemInteractions(document)
document.documentElement.dataset.kvInteractions = 'attached'
