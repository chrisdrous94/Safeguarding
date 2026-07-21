'use strict';
// Dev-only validation: confirms the inline JS in index.html and the Apps
// Script backend both parse as valid JS. This proves syntax validity only —
// apps-script-db.gs references Apps Script globals (SpreadsheetApp,
// CacheService, LockService, Utilities, PropertiesService, MailApp) that
// don't exist outside a real deployment, so this can't (and doesn't try to)
// prove it executes correctly.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');

function checkSyntax(label, source) {
  try {
    new vm.Script(source, { filename: label });
    console.log(`OK   ${label}`);
    return true;
  } catch (err) {
    console.error(`FAIL ${label}`);
    console.error(err.message);
    return false;
  }
}

function extractInlineScripts(html) {
  // Only bare <script> tags (no src=) — external CDN tags have no inline body to check.
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return matches.map(m => m[1]);
}

let ok = true;

const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const scripts = extractInlineScripts(html);
console.log(`Found ${scripts.length} inline <script> blocks in index.html`);
ok = checkSyntax('index.html inline JS (combined)', scripts.join('\n;\n')) && ok;

const gs = fs.readFileSync(path.join(repoRoot, 'apps-script-db.gs'), 'utf8');
ok = checkSyntax('apps-script-db.gs', gs) && ok;

if (!ok) {
  process.exitCode = 1;
} else {
  console.log('\nAll syntax checks passed.');
}
