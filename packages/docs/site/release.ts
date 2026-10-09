import { frameworkVersion } from './version.generated.ts'

export { frameworkVersion }

export function expandVersion(source: string): string {
  return source.replaceAll('{{VERSION}}', frameworkVersion)
}
