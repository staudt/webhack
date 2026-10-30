/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-vendor',
      severity: 'error',
      comment: 'vendor/nethack is reference material only.',
      from: {},
      to: { path: '^vendor/' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Undeclared workspace deps do not resolve; also catches core -> ui style imports.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'core-is-leaf',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(?!core/)' },
    },
    {
      name: 'content-testkit-only-core',
      severity: 'error',
      comment: 'content and testkit depend on core only (testkit tests may use content).',
      from: { path: '^packages/content/' },
      to: { path: '^packages/(?!(core|content)/)' },
    },
    {
      name: 'testkit-only-core',
      severity: 'error',
      from: { path: '^packages/testkit/src/' },
      to: { path: '^packages/(?!(core|testkit)/)' },
    },
    {
      name: 'testkit-tests-core-content',
      severity: 'error',
      from: { path: '^packages/testkit/test/' },
      to: { path: '^packages/(?!(core|content|testkit)/)' },
    },
    {
      name: 'ui-renderers-types-only',
      severity: 'error',
      comment: 'ui/renderers may only `import type` from core.',
      from: { path: '^packages/(ui|render-ascii|render-canvas|modern-ui)/src/' },
      to: { path: '^packages/core/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'ui-renderers-no-other-packages',
      severity: 'error',
      from: { path: '^packages/(ui|render-ascii|render-canvas|modern-ui)/src/' },
      to: {
        path: '^packages/(content|testkit|app|ui|render-ascii|render-canvas|modern-ui)/',
        pathNot: '^packages/$1/',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^vendor/' },
    moduleSystems: ['es6', 'cjs'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
