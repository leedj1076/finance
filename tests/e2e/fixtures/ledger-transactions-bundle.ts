import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export async function buildLedgerTransactionsBrowser() {
  const root = process.cwd()
  const require = createRequire(path.join(root, 'package.json'))
  const bundled = require('next/dist/compiled/webpack/webpack')
  bundled.init()
  const webpack = bundled.webpack
  const output = await mkdtemp(path.join(tmpdir(), 'ledger-transactions-browser-'))
  const compiler = webpack({
    mode: 'development', devtool: false,
    entry: path.join(root, 'tests/e2e/fixtures/ledger-transactions-browser.tsx'),
    output: { path: output, filename: 'browser.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/,
      use: path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle-loader.cjs') }] },
    plugins: [new webpack.NormalModuleReplacementPlugin(/^\.\/actions$/, (resource: { context: string; request: string }) => {
      if (resource.context === path.join(root, 'src/features/ledger')) {
        resource.request = path.join(root, 'tests/e2e/fixtures/ledger-transactions-boundaries.ts')
      }
    }), new webpack.DefinePlugin({ 'process.env': '({})' })],
  })
  await new Promise<void>((resolve, reject) => compiler.run((error: Error | null, stats: { hasErrors(): boolean; toString(): string }) => {
    compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString())) : resolve())
  }))
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss')
  const cssPath = path.join(root, 'src/app/globals.css')
  const css = await postcss([require('@tailwindcss/postcss')({ base: root })]).process(await readFile(cssPath, 'utf8'), { from: cssPath })
  return { script: await readFile(path.join(output, 'browser.js'), 'utf8'), css: css.css,
    cleanup: () => rm(output, { recursive: true, force: true }) }
}
