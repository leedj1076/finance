import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export type BudgetBrowserBundle = { script: string; css: string; savedAiServerHtml: string; cleanup(): Promise<void> }

export async function buildBudgetBrowser(): Promise<BudgetBrowserBundle> {
  // Next already ships webpack; no browser-test dependency or product route.
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  const bundledReact = require.resolve('next/dist/compiled/react')
  const bundledReactJsxRuntime = require.resolve('next/dist/compiled/react/jsx-runtime')
  const bundled = require('next/dist/compiled/webpack/webpack')
  bundled.init()
  const webpack = bundled.webpack
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'budget-lifecycle-bundle-'))
  const root = process.cwd()
  const compile = (configuration: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
    const compiler = webpack(configuration)
    compiler.run((error: Error | null, stats: { hasErrors(): boolean; toString(): string }) => {
      compiler.close(() => {
        if (error) reject(error)
        else if (stats.hasErrors()) reject(new Error(stats.toString()))
        else resolve()
      })
    })
  })
  await compile({
      mode: 'development', devtool: false,
      entry: path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle.tsx'),
      output: { path: outputDirectory, filename: 'lifecycle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': path.join(root, 'src'),
        'react$': path.join(root, 'node_modules/next/dist/compiled/react'),
        'react/jsx-runtime$': path.join(root, 'node_modules/next/dist/compiled/react/jsx-runtime'),
        'react/jsx-dev-runtime$': path.join(root, 'node_modules/next/dist/compiled/react/jsx-dev-runtime'),
        'react-dom$': path.join(root, 'node_modules/next/dist/compiled/react-dom'),
        'react-dom/client$': path.join(root, 'node_modules/next/dist/compiled/react-dom/client'),
        'next/navigation$': path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle-boundaries.ts') } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/,
        use: path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle-loader.cjs') }] },
      plugins: [new webpack.NormalModuleReplacementPlugin(/^\.\/actions$/, (resource: { context: string; request: string }) => {
        if (resource.context === path.join(root, 'src/features/budgets')) {
          resource.request = path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle-boundaries.ts')
        }
      })],
  })
  await compile({
    mode: 'development', devtool: false, target: 'node',
    entry: path.join(root, 'tests/e2e/fixtures/budget-plan-item-hydration.tsx'),
    output: { path: outputDirectory, filename: 'hydration-server.cjs', library: { type: 'commonjs2' } },
    externals: {
      react: `commonjs ${bundledReact}`,
      'react/jsx-runtime': `commonjs ${bundledReactJsxRuntime}`,
    },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/,
      use: path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle-loader.cjs') }] },
  })
  const script = await readFile(path.join(outputDirectory, 'lifecycle.js'), 'utf8')
  const serverBundle = require(path.join(outputDirectory, 'hydration-server.cjs')) as {
    SavedAiPlanItem: import('react').ComponentType
  }
  const react = require(bundledReact) as typeof import('react')
  const { renderToString } = require('next/dist/compiled/react-dom/server') as typeof import('react-dom/server')
  const savedAiServerHtml = renderToString(react.createElement(serverBundle.SavedAiPlanItem))
  const tailwindRequire = createRequire(require.resolve('@tailwindcss/postcss'))
  const postcss = tailwindRequire('postcss')
  const tailwind = require('@tailwindcss/postcss')
  const cssPath = path.join(root, 'src/app/globals.css')
  const compiled = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, 'utf8'), { from: cssPath })
  // The real Next font loader is absent here. Match the approved mockup's system fallback.
  const css = compiled.css + '\n:root { --font-ibm-plex-sans-kr: "Apple SD Gothic Neo", sans-serif; }'
  return { script, css, savedAiServerHtml, cleanup: () => rm(outputDirectory, { recursive: true, force: true }) }
}
