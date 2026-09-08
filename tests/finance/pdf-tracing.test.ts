import { realpathSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { expect, test } from 'vitest'

import nextConfig from '../../next.config'

test.each(['/inbox', '/api/import'])('packages the PDF worker without symlink-directory descendants for %s', (route) => {
  const workerIncludes = nextConfig.outputFileTracingIncludes?.[route]?.filter((file) => file.endsWith('/pdf.worker.mjs')) ?? []
  expect(workerIncludes).toHaveLength(1)
  const worker = resolve(realpathSync(process.cwd()), workerIncludes[0])
  expect(statSync(worker).isFile()).toBe(true)
  // Vercel rejects files below a symlinked directory even when they exist.
  // A package-level symlink may still be traced separately by Next.
  expect(worker).toBe(realpathSync(worker))
  const decoder = realpathSync(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
  expect(dirname(worker)).toBe(dirname(decoder))
})
