#!/usr/bin/env node
// ---------------------------------------------------------------
// Regression guard for the "locked" header/nav/hero spec.
//
// The header, category nav, and message-us button are meant to be
// pixel-identical on every page (index.html + every categories/*.html),
// styled ONLY from css/category-nav.css — no per-theme override, ever.
// The hero's total visual envelope (top border strip + hero + bottom
// border strip) is likewise locked at a fixed height across all 9 pages,
// even though each theme splits it differently (border strips inside
// the hero vs. as separate sibling divs) and pads its internal content
// differently.
//
// This script re-checks both invariants against the live CSS/HTML so a
// future per-theme edit that silently breaks either one fails fast,
// instead of only being caught by someone eyeballing a screenshot.
//
// Usage: node scripts/check-locked-layout.mjs
// Exits non-zero (and prints what broke) if anything drifted.
// ---------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts", "locked-layout.config.json"), "utf8")
);

const violations = [];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Strips trailing pseudo-class/pseudo-element segments so ".header-cta:hover"
// and ".header-cta::before" both reduce to ".header-cta" for comparison.
function baseSelector(sel) {
  return sel.trim().replace(/(::?[-\w]+(\([^)]*\))?)+$/, "").trim();
}

// Brute-force (selector, body) extraction. Deliberately naive — it does not
// understand @media nesting, but that's fine here: every rule we care about
// (.hero, each strip class, and the locked header/nav selectors) is always
// written as its own `selector { ... }` block with no braces inside the
// body, whether or not it happens to sit inside a @media wrapper.
function extractRules(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    rules.push({ selectorText: m[1], body: m[2] });
  }
  return rules;
}

function selectorListIncludes(selectorText, target) {
  return selectorText
    .split(",")
    .map(baseSelector)
    .includes(target);
}

function firstPxValue(body, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`);
  const m = body.match(re);
  return m ? parseFloat(m[1]) : null;
}

// --- Check 1: header/nav selectors must only be defined in category-nav.css ---
function checkHeaderSelectorLeaks() {
  const themeDir = path.join(ROOT, "css", "themes");
  const cssFiles = [
    "css/style.css",
    ...fs
      .readdirSync(themeDir)
      .filter((f) => f.endsWith(".css"))
      .map((f) => `css/themes/${f}`),
  ];

  for (const file of cssFiles) {
    if (file === CONFIG.headerAllowedFile) continue;
    const css = stripComments(read(file));
    for (const { selectorText } of extractRules(css)) {
      for (const part of selectorText.split(",")) {
        const base = baseSelector(part).replace(/^\./, "");
        if (CONFIG.headerLockedSelectors.includes(base)) {
          violations.push(
            `[header-leak] ${file} defines ".${base}" — locked header/nav ` +
              `rules may only live in ${CONFIG.headerAllowedFile}.`
          );
        }
      }
    }
  }
}

// --- Check 2: every page has all 8 required structural sections present ---
function checkRequiredSections() {
  for (const page of CONFIG.pages) {
    const html = read(page.html);
    const classTokens = new Set();
    for (const m of html.matchAll(/class="([^"]*)"/g)) {
      for (const token of m[1].split(/\s+/)) {
        if (token) classTokens.add(token);
      }
    }
    for (const required of CONFIG.requiredSectionClasses) {
      if (!classTokens.has(required)) {
        violations.push(`[missing-section] ${page.html} has no element with class="${required}".`);
      }
    }
  }
}

// --- Check 3: locked hero envelope (top strip + hero + bottom strip) ---
function checkHeroEnvelope() {
  for (const page of CONFIG.pages) {
    const css = stripComments(read(page.css));
    const rules = extractRules(css);

    const heroRule = rules.find((r) => selectorListIncludes(r.selectorText, ".hero"));
    if (!heroRule) {
      violations.push(`[envelope] ${page.css} has no bare ".hero" rule.`);
      continue;
    }
    const heroHeight = firstPxValue(heroRule.body, "height");
    if (heroHeight === null) {
      violations.push(`[envelope] ${page.css} ".hero" has no fixed height:Npx.`);
      continue;
    }

    let envelope = heroHeight;
    if (!page.stripInsideHero) {
      const stripRule = rules.find((r) => selectorListIncludes(r.selectorText, `.${page.stripClass}`));
      if (!stripRule) {
        violations.push(`[envelope] ${page.css} has no ".${page.stripClass}" rule.`);
        continue;
      }
      const stripHeight = firstPxValue(stripRule.body, "height");
      if (stripHeight === null) {
        violations.push(`[envelope] ${page.css} ".${page.stripClass}" has no height:Npx.`);
        continue;
      }
      envelope = heroHeight + 2 * stripHeight;
    }

    if (envelope !== CONFIG.lockedEnvelopePx) {
      violations.push(
        `[envelope] ${page.html}: top-strip+hero+bottom-strip = ${envelope}px, ` +
          `expected ${CONFIG.lockedEnvelopePx}px (hero height ${heroHeight}px in ${page.css}).`
      );
    }
  }
}

checkHeaderSelectorLeaks();
checkRequiredSections();
checkHeroEnvelope();

if (violations.length > 0) {
  console.error(`\n✗ Locked layout check failed (${violations.length} issue${violations.length > 1 ? "s" : ""}):\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nIf this change is intentional, update scripts/locked-layout.config.json " +
      "in the same commit so the new spec is recorded, not just broken.\n"
  );
  process.exit(1);
} else {
  console.log(`✓ Locked layout check passed — header/nav untouched outside ${CONFIG.headerAllowedFile}, all ${CONFIG.pages.length} pages carry the required sections, hero envelope is ${CONFIG.lockedEnvelopePx}px everywhere.`);
}
