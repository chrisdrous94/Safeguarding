'use strict';
// Dev-only jsdom smoke test: boots the app and switches between every view,
// asserting no uncaught JS error occurs. This does NOT exercise real Apps
// Script calls (no login is performed — DB starts empty, matching a fresh
// unauthenticated load) and does NOT prove Chart.js/Lucide/network behaviour,
// since jsdom doesn't fetch external <script src> resources in this setup.
// It proves the view-switching / rendering code paths themselves don't throw.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repoRoot = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

// Replace external <script src=...> tags (Tailwind/Lucide/Chart.js CDN) with
// minimal stubs of the globals they'd normally provide, rather than just
// deleting them — deleting them outright makes the very next inline script
// (`tailwind.config = {...}`) throw a ReferenceError that's an artifact of
// this test harness, not a real app bug. Chart.js is deliberately left
// unstubbed: it's lazy-loaded by the app itself (see loadChartJs()), and its
// absence here is exactly the "not fetched until needed" behaviour under test.
html = html.replace(/<script[^>]*\ssrc="[^"]*tailwindcss[^"]*"[^>]*><\/script>/, '<script>window.tailwind = { config: {} };</script>');
html = html.replace(/<script[^>]*\ssrc="[^"]*lucide[^"]*"[^>]*><\/script>/, '<script>window.lucide = { createIcons(){} };</script>');
html = html.replace(/<script[^>]*\ssrc="[^"]*chart\.js[^"]*"[^>]*><\/script>/, '');

const uncaughtErrors = [];
const consoleErrors = [];

const dom = new JSDOM(html, {
  url: 'https://example.org/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: (() => {
    const { VirtualConsole } = require('jsdom');
    const vc = new VirtualConsole();
    vc.on('error', (msg) => consoleErrors.push(String(msg)));
    vc.on('jsdomError', (err) => consoleErrors.push(err.message));
    return vc;
  })()
});

const { window } = dom;

// Minimal fetch stub — boot() only reaches network code if a saved session
// exists in localStorage, which it never does on a fresh jsdom load.
window.fetch = () => Promise.reject(new Error('network disabled in smoke test'));

window.addEventListener('error', (e) => {
  uncaughtErrors.push((e.error && e.error.stack) || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  uncaughtErrors.push('Unhandled rejection: ' + (e.reason && e.reason.stack || e.reason));
});

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  // Let DOMContentLoaded (and boot()) fire.
  await wait(200);

  if (typeof window.boot !== 'function') {
    throw new Error('boot() was not defined on window — app failed to load');
  }
  if (typeof window.go !== 'function') {
    throw new Error('go() was not defined on window — app failed to load');
  }

  const views = ['dashboard', 'concerns', 'students', 'families', 'tasks', 'analytics', 'audit', 'teacher-home'];
  for (const view of views) {
    window.go(view);
    await wait(20);
  }

  // Chronology needs a student in context; DB is empty in this test, so this
  // exercises the "no student selected" guard path rather than a real render —
  // still confirms it doesn't throw.
  window.go('chronology');
  await wait(20);

  await wait(100);

  console.log(`Views exercised: ${views.length + 1}`);
  console.log(`Console errors captured (informational, not a failure by themselves): ${consoleErrors.length}`);
  if (consoleErrors.length) {
    consoleErrors.slice(0, 10).forEach(m => console.log('  - ' + m));
  }

  if (uncaughtErrors.length) {
    console.error(`\nFAIL: ${uncaughtErrors.length} uncaught error(s) during boot/view switching:`);
    uncaughtErrors.forEach(e => console.error('  - ' + e));
    process.exitCode = 1;
    return;
  }

  console.log('\nPASS: app booted and switched every view with no uncaught errors.');
}

main().catch(err => {
  console.error('FAIL: smoke test threw:', err);
  process.exitCode = 1;
});
