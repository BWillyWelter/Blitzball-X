import js from '@eslint/js';
import globals from 'globals';

/**
 * Flat config for the whole repo: browser code under src/, Node code under tools/ tests/ scripts/.
 * The ruleset is the recommended core set — correctness rules (undefined names, unreachable code,
 * duplicate keys/members, unused bindings), no formatting opinions.
 */
export default [
  { ignores: ['dist/**', 'screenshots/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    rules: {
      // `_`-prefixed names are the explicit "intentionally unused" marker (loop vars,
      // placeholder params), matching the convention already used in the tests.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    // Tools, tests and scripts run under Node, but QA snippets are page-evaluated too, so the
    // browser globals belong in scope there as well.
    files: ['tools/**/*.mjs', 'tests/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['*.js', '*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // The Express API server that landed alongside the game: plain Node ESM.
    files: ['server/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  },
];
