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

/**
 * Give the bundled Chromium a font configuration when the machine has none.
 *
 * A stripped container has no /etc/fonts/fonts.conf, and Chromium does not simply fall back to a
 * default font when it cannot load a config: the first form control or styled text it has to
 * rasterise takes the whole renderer process down with
 * `FATAL: SkFontMgr_FontConfigInterface.cpp Not implemented`. That failure looks like "the page is
 * broken" from the outside (puppeteer reports a detached frame mid-navigation), which is how a
 * fontless host once read as a lost WebGL context and as a touch test that stopped at check 62.
 *
 * @sparticuz/chromium ships the fonts it expects to run with (fonts.tar.br) and points
 * FONTCONFIG_PATH at /tmp/fonts, but that alone is not enough for fontconfig to pick them up — the
 * file has to be named. So: if the machine has a real config, leave the environment alone (a
 * distro's own fonts are the ones a screenshot should show); otherwise extract the bundled set and
 * name it. Idempotent, and only ever touched when there is nothing to lose.
 */
export function ensureFonts() {
  if (process.env.FONTCONFIG_FILE) return process.env.FONTCONFIG_FILE;
  if (fs.existsSync('/etc/fonts/fonts.conf')) return null;
  const dir = process.env.FONTCONFIG_PATH || '/tmp/fonts';
  const conf = path.join(dir, 'fonts.conf');
  if (!fs.existsSync(conf)) {
    const src = path.resolve('node_modules/@sparticuz/chromium/bin/fonts.tar.br');
    fs.mkdirSync(dir, { recursive: true });
    const tarPath = path.join(dir, 'fonts.tar');
    fs.writeFileSync(tarPath, zlib.brotliDecompressSync(fs.readFileSync(src)));
    execSync(`tar -xf ${tarPath} -C ${dir}`);
  }
  if (!fs.existsSync(conf)) return null; // nothing to point at; let Chromium try on its own
  process.env.FONTCONFIG_FILE = conf;
  return conf;
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
  ensureFonts();
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

/**
 * Close a browser without letting a stalled Chromium shutdown hang the tool. With a live
 * software-GL context the headless shell has been observed to take ~100 s to exit, and every
 * caller either process.exit()s afterwards or has nothing left to do — so a bounded wait plus
 * SIGKILL is safe here. Returns false when the graceful close had to be forced.
 */
export async function closeBrowser(browser, { timeout = 8000 } = {}) {
  let done = false;
  const closing = browser.close().then(() => { done = true; }, () => { done = true; });
  const stalled = await Promise.race([
    closing.then(() => false),
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(true), timeout);
      if (typeof t.unref === 'function') t.unref();
    }),
  ]);
  if (stalled) {
    const proc = typeof browser.process === 'function' ? browser.process() : null;
    if (proc && !proc.killed) {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }
  if (!done) await Promise.race([closing, new Promise((r) => setTimeout(r, 1000))]);
  return !stalled;
}
