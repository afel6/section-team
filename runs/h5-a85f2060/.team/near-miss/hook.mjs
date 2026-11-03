// Test-only resolve hook: with NEAR_MISS=<NN-name.mjs>, imports of lib/<name.mjs> load .team/near-miss/<NN-name.mjs>
// instead, so a near-miss runs against the suite without changing any file in lib/.
import { register } from 'node:module'

const copy = process.env.NEAR_MISS
if (copy) {
  const nearMissDir = new URL('./', import.meta.url)
  const libDir = new URL('../../lib/', import.meta.url)
  const data = { copyUrl: new URL(copy, nearMissDir).href, targetUrl: new URL(copy.replace(/^\d+-/, ''), libDir).href, libDir: libDir.href }
  const source = `
    const { copyUrl, targetUrl, libDir } = ${JSON.stringify(data)}
    export async function resolve(specifier, context, next) {
      // Relative imports inside the copy resolve as if it sat in lib/.
      const parentURL = context.parentURL === copyUrl ? targetUrl : context.parentURL
      const result = await next(specifier, { ...context, parentURL })
      return result.url === targetUrl ? { ...result, url: copyUrl, shortCircuit: true } : result
    }
  `
  register(`data:text/javascript,${encodeURIComponent(source)}`)
}
