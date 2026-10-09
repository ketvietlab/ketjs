import manifest from '../package.json' with { type: 'json' }

// Display the published runtime this independently installed site actually consumes.
export const frameworkVersion = manifest.dependencies['@ketvietlab/ketjs-view']
