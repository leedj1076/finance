import type { NextConfig } from "next";
import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';

// Vercel cannot package file descendants of pnpm's top-level package symlink.
// Resolve the installed module rather than encoding a pnpm layout or version.
const pdfWorkerTrace = `./${relative(
  process.cwd(),
  realpathSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')),
).split(sep).join('/')}`;

const nextConfig: NextConfig = {
  // Keep PDF.js's relative Node worker import beside its package files.
  serverExternalPackages: ['pdfjs-dist'],
  outputFileTracingIncludes: {
    '/inbox': [pdfWorkerTrace],
    '/api/import': [pdfWorkerTrace],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;
