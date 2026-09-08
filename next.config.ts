import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep PDF.js's relative Node worker import beside its package files.
  serverExternalPackages: ['pdfjs-dist'],
  outputFileTracingIncludes: {
    '/inbox': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
    '/api/import': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;
