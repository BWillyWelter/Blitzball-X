/**
 * Minimal vitest-compatible surface so the engine suite can run under the
 * repo's node:test runner instead of a test framework that was never added to
 * the manifest. Assertions map 1:1 onto node:assert/strict — no behavior is
 * weakened, and unknown matchers fail loudly rather than no-op.
 */
export { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function readPath(actual, path) {
  const keys = Array.isArray(path) ? path : String(path).split('.');
  let cur = actual;
  for (const k of keys) cur = cur?.[k];
  return cur;
}

export function expect(actual) {
  const api = {
    toBe: (expected) => assert.strictEqual(actual, expected),
    toEqual: (expected) => assert.deepStrictEqual(actual, expected),
    toContain: (expected) => assert.ok(actual.includes(expected), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`),
    toHaveLength: (n) => assert.strictEqual(actual.length, n),
    toHaveProperty: (path, value) => {
      const cur = readPath(actual, path);
      assert.notStrictEqual(cur, undefined, `expected property ${String(path)} to exist`);
      if (arguments.length > 1 && value !== undefined) assert.deepStrictEqual(cur, value);
    },
    toBeLessThan: (n) => assert.ok(actual < n, `expected ${actual} < ${n}`),
    toBeGreaterThanOrEqual: (n) => assert.ok(actual >= n, `expected ${actual} >= ${n}`),
  };
  api.not = {
    toBe: (expected) => assert.notStrictEqual(actual, expected),
    toEqual: (expected) => assert.notDeepStrictEqual(actual, expected),
  };
  return api;
}
