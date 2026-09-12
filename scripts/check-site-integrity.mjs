#!/usr/bin/env node
// ---------------------------------------------------------------
// Basic "does the site still hang together" smoke check — the
// zero-dependency equivalent of a lint step for a plain HTML/CSS/JS
// site with no build tool. Nothing here transforms any file; it only
// reads what's already committed and fails loudly if something looks
// broken, the same way a build would fail on a real syntax error.
//
// Checks, per HTML page (index.html + every categories/*.html and
// themes/*.html):
//   1. Tags are balanced (no unclosed / mismatched tags).
//   2. Every local href="…"/src="…" (stylesheets, scripts, images,
//      favicons) resolves to a file that actually exists.
//   3. Every function called from an inline <script>…</script> block
//      is actually declared in one of that page's own <script src>
//      files (catches a typo'd function name / removed function).
// Plus, once for the whole repo:
//   4. Every .js/.mjs file parses as valid JavaScript (`node --check`).
//
// Usage: node scripts/check-site-integrity.mjs
// ---------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const violations = [];

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function findHtmlFiles() {
  const files = ["index.html"];
  if (fs.existsSync(path.join(ROOT, "404.html"))) files.push("404.html");
  for (const dir of ["categories", "themes"]) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).sort()) {
      if (f.endsWith(".html")) files.push(path.join(dir, f));
    }
  }
  return files;
}

function findJsFiles() {
  const files = [];
  const jsDir = path.join(ROOT, "js");
  if (fs.existsSync(jsDir)) {
    for (const f of fs.readdirSync(jsDir)) {
      if (f.endsWith(".js")) files.push(path.join("js", f));
    }
  }
  const scriptsDir = path.join(ROOT, "scripts");
  for (const f of fs.readdirSync(scriptsDir)) {
    if (f.endsWith(".mjs")) files.push(path.join("scripts", f));
  }
  return files;
}

function checkTagBalance(html, file) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, (m) => "<script></script>")
    .replace(/<style[\s\S]*?<\/style>/gi, (m) => "<style></style>");

  const tagRe = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/)?>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(cleaned))) {
    const closing = m[1];
    const tag = m[2].toLowerCase();
    const selfClose = m[3];
    if (closing) {
      const idx = stack.lastIndexOf(tag);
      if (idx === -1) {
        violations.push(`[html] ${file}: found a closing </${tag}> with no matching open tag.`);
      } else if (idx !== stack.length - 1) {
        const skipped = stack.slice(idx + 1);
        violations.push(
          `[html] ${file}: </${tag}> closed while <${skipped.join(">, <")}> were still open ` +
            `(never got their own closing tag).`
        );
        stack.length = idx;
      } else {
        stack.pop();
      }
    } else if (!selfClose && !VOID_ELEMENTS.has(tag)) {
      stack.push(tag);
    }
  }
  if (stack.length > 0) {
    violations.push(`[html] ${file}: unclosed tag(s) at end of file: <${stack.join(">, <")}>`);
  }
}

function checkResourceReferences(html, file) {
  const dir = path.dirname(path.join(ROOT, file));
  const attrRe = /\b(?:href|src)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(html))) {
    const ref = m[1];
    if (ref === "" || ref === "#") continue;
    if (/^(https?:)?\/\//i.test(ref)) continue; // external / protocol-relative
    if (/^(data:|mailto:|tel:|javascript:|#)/i.test(ref)) continue;

    const pathPart = ref.split(/[?#]/)[0];
    if (!pathPart) continue;

    let resolved;
    try {
      resolved = path.join(dir, decodeURIComponent(pathPart));
    } catch {
      resolved = path.join(dir, pathPart);
    }
    if (!fs.existsSync(resolved)) {
      violations.push(`[broken-ref] ${file}: "${ref}" does not resolve to an existing file.`);
    }
  }
}

function checkInlineScriptCalls(html, file) {
  const localScriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src) => !/^(https?:)?\/\//i.test(src));

  const declared = new Set();
  const dir = path.dirname(path.join(ROOT, file));
  for (const src of localScriptSrcs) {
    const resolved = path.join(dir, src);
    if (!fs.existsSync(resolved)) continue; // already reported by checkResourceReferences
    const js = fs.readFileSync(resolved, "utf8");
    for (const m of js.matchAll(/^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)) {
      declared.add(m[1]);
    }
  }

  const inlineBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const KNOWN_GLOBALS = new Set([
    "console", "JSON", "Object", "Array", "Math", "Date", "Number", "String",
    "Boolean", "fetch", "setTimeout", "setInterval", "Promise", "parseInt", "parseFloat",
  ]);
  for (const block of inlineBlocks) {
    for (const m of block.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      const name = m[1];
      if (declared.has(name) || KNOWN_GLOBALS.has(name)) continue;
      violations.push(
        `[inline-call] ${file}: inline <script> calls "${name}(...)" which isn't declared in any of this page's <script src> files.`
      );
    }
  }
}

function checkJsSyntax() {
  for (const file of findJsFiles()) {
    try {
      execFileSync(process.execPath, ["--check", path.join(ROOT, file)], { stdio: "pipe" });
    } catch (err) {
      const message = err.stderr ? err.stderr.toString().trim() : err.message;
      violations.push(`[js-syntax] ${file}: ${message.split("\n").slice(0, 3).join(" | ")}`);
    }
  }
}

for (const file of findHtmlFiles()) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  checkTagBalance(html, file);
  checkResourceReferences(html, file);
  checkInlineScriptCalls(html, file);
}
checkJsSyntax();

if (violations.length > 0) {
  console.error(`\n✗ Site integrity check failed (${violations.length} issue${violations.length > 1 ? "s" : ""}):\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error("");
  process.exit(1);
} else {
  console.log(
    `✓ Site integrity check passed — ${findHtmlFiles().length} HTML pages have balanced tags, ` +
      `valid local references, and working inline script calls; all JS files parse cleanly.`
  );
}
