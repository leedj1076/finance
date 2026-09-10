// Test-only webpack loader: use the project's existing TypeScript compiler.
module.exports = function transpile(source) {
  const done = this.async()
  import('typescript').then(({ default: ts }) => {
    done(null, ts.transpileModule(source, {
      fileName: this.resourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText)
  }, done)
}
