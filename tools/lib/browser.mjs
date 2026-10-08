/**
 * Shared headless-Chromium bootstrap for the QA tools.
 *
 * Every browser tool needs the same three things: the bundled Chromium's system libs on
 * LD_LIBRARY_PATH, the software-GL ANGLE flags that let WebGL run without a GPU, and a
 * puppeteer instance pointed at the bundled binary. That setup used to be copy-pasted (and
 * subtly drifted) across the tools, and only `shot.mjs` extracted the libs — the rest silently
 * depended on it having run first. This module is the one place that owns it.
 */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

/**
 * The bundled Chromium needs the al2023 NSS/system libs shipped in al2023.tar.br. Extract once
 * (idempotent across tools in a session) and prepend them to LD_LIBRARY_PATH.
 */
export function ensureChromiumLibs() {
  const libDir = '/tmp/al2023/lib';
  if (!fs.existsSync(libDir)) {
    const src = path.resolve('node_modules/@sparticuz/chromium/bin/al2023.tar.br');
    fs.mkdirSync('/tmp/al2023', { recursive: true });
    fs.writeFileSync('/tmp/al2023/al2023.tar', zlib.brotliDecompressSync(fs.readFileSync(src)));
    execSync('tar -xf /tmp/al2023/al2023.tar -C /tmp/al2023');
  }
  process.env.LD_LIBRARY_PATH = `${libDir}:/tmp:${process.env.LD_LIBRARY_PATH || ''}`;
  return libDir;
}

/** The software-GL flags the WebGL tools share. Chrome's bundled args omit these. */
export const GPU_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/**
 * Launch the bundled Chromium.
 * `gpu: true` (default) adds the software-GL ANGLE flags WebGL needs; `gpu: false` is the plain
 * sandbox flags the touch/bench harnesses use (they disable rendering work themselves).
 */
export async function launchBrowser({
  gpu = true,
  args = [],
  headless,
  defaultViewport,
  protocolTimeout,
} = {}) {
  ensureChromiumLibs();
  if (gpu) chromium.setGraphicsMode = true;
  const launchArgs = gpu
    ? [...chromium.args, ...GPU_ARGS, ...args]
    : ['--no-sandbox', '--disable-setuid-sandbox', ...args];
  // The software-GL tools run the old headless shell; the touch/bench harnesses need the default
  // (new) headless, which is what supports mobile device emulation.
  const mode = headless === undefined ? (gpu ? 'shell' : true) : headless;
  const opts = { args: launchArgs, executablePath: await chromium.executablePath(), headless: mode };
  if (defaultViewport) opts.defaultViewport = defaultViewport;
  if (protocolTimeout) opts.protocolTimeout = protocolTimeout;
  return puppeteer.launch(opts);
}
