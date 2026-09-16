#!/usr/bin/env node
// ---------------------------------------------------------------
// Real, interactive mobile regression test — the interactive counterpart
// to check-site-integrity.mjs / check-locked-layout.mjs (which are static
// analysis: no browser, just reading HTML/CSS as text). This one drives an
// actual headless Chrome at a TRUE mobile viewport (390x844, a real
// Emulation.setDeviceMetricsOverride with mobile:true — not just a small
// desktop window, which behaves differently for things like tap targets
// and lazy-loading) against a local copy of the site, and performs the
// same taps/typing/clicks a real visitor would: tapping the header logo,
// picking a category, typing a search, opening a product, swapping gallery
// photos, tapping "Order on WhatsApp". Each check verifies the actual
// resulting behavior (did the URL change, did WhatsApp open with the right
// message, did the real photo load instead of staying on the placeholder),
// not just that the button exists in the HTML.
//
// Zero new dependencies: talks to Chrome directly over its DevTools
// Protocol via the built-in `fetch`/`WebSocket` globals (Node 22+), the
// same technique used ad hoc throughout this project's development.
// Needs a local Chrome/Chromium install; set CHROME_PATH to point at a
// specific binary if one isn't found automatically.
//
// Usage: node scripts/check-mobile-experience.mjs
// Exits non-zero (and prints what failed) if any check fails.
// ---------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SERVER_PORT = 8934;
const CDP_PORT = 9339;
const VIEWPORT = { width: 390, height: 844 }; // a true, common phone width — not a shrunk desktop window

const passed = [];
const violations = [];

function report(name, ok, detail) {
  if (ok) {
    passed.push(name);
    console.log(`  ✓ ${name}`);
  } else {
    violations.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function fail(message) {
  console.error(`[check-mobile-experience] ${message}`);
  process.exit(1);
}

// --- Tiny static file server, just enough to serve this repo the way
// GitHub Pages does (including its 404.html-for-any-unmatched-path
// behavior), with zero new dependencies. ---
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(filePath, (statErr, stat) => {
      if (!statErr && stat.isDirectory()) filePath = path.join(filePath, "index.html");
      fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
          fs.readFile(path.join(ROOT, "404.html"), (e404, data404) => {
            res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
            res.end(e404 ? "Not found" : data404);
          });
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
  });
  return new Promise((resolve) => server.listen(SERVER_PORT, () => resolve(server)));
}

// --- Chrome launcher ---
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const macCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const c of macCandidates) if (fs.existsSync(c)) return c;
  for (const name of ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium"]) {
    try {
      const found = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (found) return found;
    } catch {
      // not on PATH — try the next candidate
    }
  }
  return null;
}

async function launchChrome() {
  const bin = findChrome();
  if (!bin) {
    fail(
      "Could not find a Chrome/Chromium binary. Set CHROME_PATH to point at one " +
      "(e.g. CHROME_PATH=\"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\")."
    );
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "artcanopy-mobile-test-"));
  const child = spawn(
    bin,
    ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`, "about:blank"],
    { stdio: "ignore" }
  );

  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${CDP_PORT}/json/version`);
      if (res.ok) return child;
    } catch {
      // not ready yet
    }
    await sleep(250);
  }
  child.kill();
  fail("Chrome never became ready on the DevTools port.");
}

// --- Minimal CDP client (flattened sessions over one WebSocket) ---
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.msgId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const cb of this.listeners.get(msg.method) || []) cb(msg.params);
      }
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }
  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(cb);
  }
  off(method, cb) {
    this.listeners.set(method, (this.listeners.get(method) || []).filter((h) => h !== cb));
  }
}

async function connectCDP() {
  const res = await fetch(`http://localhost:${CDP_PORT}/json/version`);
  const { webSocketDebuggerUrl } = await res.json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  return new CDP(ws);
}

// --- Page helpers: real mobile viewport, real clicks/typing ---
async function openPage(cdp, url) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 2, mobile: true },
    sessionId
  );
  await cdp.send("Page.navigate", { url }, sessionId);
  await sleep(700);
  return { targetId, sessionId };
}

async function closePage(cdp, targetId) {
  await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const currentURL = (cdp, sessionId) => evaluate(cdp, sessionId, "location.href");

// A real tap: scroll the element into view, then dispatch actual
// mouse-down/mouse-up events at its on-screen center — not a scripted
// `.click()` call, so it behaves like a genuine user gesture (this matters
// for things like target="_blank" links, which some browser policies treat
// differently for script-triggered vs. real clicks).
async function tap(cdp, sessionId, selector) {
  const box = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      // getBoundingClientRect() on a multi-line inline element (e.g. a
      // product title that wraps to 2 uneven lines) returns the COMBINED
      // box spanning both lines — its geometric center can land in empty
      // space next to the shorter line, missing the actual text/link
      // entirely. getClientRects()[0] is the real box for the first
      // rendered line (and is identical to getBoundingClientRect() for
      // ordinary block-level elements), so it's always a point genuinely
      // covered by the element — the same spot a real finger would tap.
      const r = el.getClientRects()[0] || el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`
  );
  if (!box) throw new Error(`element not found: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 }, sessionId);
}

// Taps something whose click is expected to open a new tab (any
// target="_blank" link — WhatsApp, mostly). Returns the new tab's final
// URL, or null if nothing opened, and cleans up the tab either way.
async function tapAndCaptureNewTabUrl(cdp, sessionId, selector) {
  const seen = [];
  const handler = (params) => {
    if (params.targetInfo.type === "page") seen.push(params.targetInfo);
  };
  cdp.on("Target.targetCreated", handler);
  await tap(cdp, sessionId, selector);
  await sleep(500);
  cdp.off("Target.targetCreated", handler);
  if (!seen.length) return null;
  const { targetInfos } = await cdp.send("Target.getTargets");
  const info = targetInfos.find((t) => t.targetId === seen[0].targetId) || seen[0];
  await cdp.send("Target.closeTarget", { targetId: info.targetId }).catch(() => {});
  return info.url;
}

async function typeInto(cdp, sessionId, selector, text) {
  await tap(cdp, sessionId, selector); // real tap first, so the field is genuinely focused
  await cdp.send("Input.insertText", { text }, sessionId);
  await sleep(300);
}

// ---------------------------------------------------------------
// The actual checks
// ---------------------------------------------------------------

const PAGES_FOR_OVERFLOW_CHECK = [
  "/",
  "/categories/painting-sketch/",
  "/categories/resin-art/",
  "/categories/lippan-art/",
  "/categories/mosaic-art/",
  "/categories/home-deco/",
  "/categories/festival-special/",
  "/categories/gift/",
  "/categories/mirror/",
  "/products/resin-sketch-wall-panel/",
];

// The home link is "../../" from a nested category/product page — resolves
// to the site root, so check the resolved pathname rather than a literal
// "/index.html" suffix (there's no such filename in the URL anymore).
function isHomeUrl(url) {
  return new URL(url).pathname === "/";
}

// The classic "mobile is broken" symptom: something wider than the
// viewport forcing a horizontal scrollbar. Cheap to check, catches a lot.
async function testNoHorizontalOverflow(cdp) {
  for (const p of PAGES_FOR_OVERFLOW_CHECK) {
    const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}${p}`);
    const overflow = await evaluate(cdp, sessionId, "document.documentElement.scrollWidth - document.documentElement.clientWidth");
    report(`no horizontal overflow: ${p}`, overflow <= 1, overflow > 1 ? `scrollWidth exceeds the viewport by ${overflow}px` : undefined);
    await closePage(cdp, targetId);
  }
}

async function testLogoNavigatesHome(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/categories/gift/`);
  await tap(cdp, sessionId, ".brand");
  await sleep(500);
  const url = await currentURL(cdp, sessionId);
  report("tapping the header logo (from a category page) goes home", isHomeUrl(url), `landed on ${url}`);
  await closePage(cdp, targetId);
}

async function testCategoryNavNavigation(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/`);
  await tap(cdp, sessionId, 'a.category-nav-item[href="categories/resin-art/"]');
  await sleep(500);
  let url = await currentURL(cdp, sessionId);
  report('tapping the "Resin art" chip opens that category', url.endsWith("/categories/resin-art/"), `landed on ${url}`);

  await tap(cdp, sessionId, "a.category-nav-item.all");
  await sleep(500);
  url = await currentURL(cdp, sessionId);
  report('tapping "All pieces" from there goes back home', isHomeUrl(url), `landed on ${url}`);
  await closePage(cdp, targetId);
}

async function testSearchFindsExpectedResults(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/`);
  // Query derived from the page's own live data (rather than a hardcoded
  // product name) so this doesn't go stale the next time the sheet syncs.
  const setup = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const q = PRODUCTS[0].name.split(" ").pop().toLowerCase();
      const expected = PRODUCTS.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
      ).length;
      return { q, expected };
    })()`
  );
  await typeInto(cdp, sessionId, "#product-search", setup.q);
  const visible = await evaluate(cdp, sessionId, 'document.querySelectorAll("#product-grid .product-card").length');
  report(`typing "${setup.q}" into search shows the expected ${setup.expected} match(es)`, visible === setup.expected, `rendered ${visible}`);
  await closePage(cdp, targetId);
}

async function testSearchNoResults(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/`);
  await typeInto(cdp, sessionId, "#product-search", "zzqxnotarealproduct");
  const noResultsHidden = await evaluate(cdp, sessionId, 'document.getElementById("no-results").hidden');
  const cardCount = await evaluate(cdp, sessionId, 'document.querySelectorAll("#product-grid .product-card").length');
  report('typing a nonsense search shows the "no results" message', noResultsHidden === false && cardCount === 0, `hidden=${noResultsHidden}, cards=${cardCount}`);
  await closePage(cdp, targetId);
}

async function testWhatsAppButtons(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/`);
  const waPrefix = await evaluate(cdp, sessionId, '`https://wa.me/${SITE_CONFIG.whatsappNumber}?text=`');

  for (const [label, selector] of [
    ['hero "Browse & order on WhatsApp" button', "#hero-whatsapp-link"],
    ["footer WhatsApp link", "#footer-whatsapp-link"],
    ['"Ask about a custom order" button', "#custom-whatsapp-link"],
  ]) {
    // Two separate, deterministic assertions instead of one racy one:
    // wa.me links redirect through WhatsApp's own servers to
    // api.whatsapp.com, and exactly when that redirect has settled by the
    // time we read the new tab's URL isn't something worth pinning down —
    // what matters is (a) the button is wired to the right link, and
    // (b) tapping it genuinely opens a new tab at all.
    const href = await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(selector)}).getAttribute("href")`);
    report(`${label} is wired to a real WhatsApp link`, typeof href === "string" && href.startsWith(waPrefix), `got ${href}`);

    const newTabUrl = await tapAndCaptureNewTabUrl(cdp, sessionId, selector);
    report(`tapping ${label} actually opens a new WhatsApp tab`, Boolean(newTabUrl), `got ${newTabUrl}`);
  }
  await closePage(cdp, targetId);
}

async function testFooterContactLinks(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/`);
  const hrefs = await evaluate(
    cdp,
    sessionId,
    `({
      email: document.getElementById("footer-email-link").getAttribute("href"),
      phone: document.getElementById("footer-phone-link").getAttribute("href"),
    })`
  );
  const expected = await evaluate(cdp, sessionId, "({ email: SITE_CONFIG.contactEmail, number: SITE_CONFIG.whatsappNumber })");
  report("footer email link is a real mailto: link to the configured address", hrefs.email === `mailto:${expected.email}`, `got ${hrefs.email}`);
  report("footer phone link is a real tel: link to the configured number", hrefs.phone === `tel:+${expected.number}`, `got ${hrefs.phone}`);
  await closePage(cdp, targetId);
}

async function testProductCardOpensDetailPageAndPhotoLoads(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/`);
  await sleep(700); // real photo load on the grid card itself, not just DOM presence

  // Distinct from the detail-page check below: this is the grid CARD's own
  // <img>, before any navigation happens. Guards specifically against a
  // regression where every card silently stays on its placeholder forever
  // (e.g. a loading="lazy" attribute added to an <img> that's display:none
  // until "loaded" — an IntersectionObserver-based lazy load never fires
  // for an element with no layout box, so it never leaves the placeholder,
  // scroll or not — a real bug caught this way while building this check).
  const gridPhotoLoaded = await evaluate(
    cdp,
    sessionId,
    '!!document.querySelector(".product-image:not(.placeholder) img.loaded")'
  );
  report("at least one product card's real photo loads on the grid itself (not stuck on the placeholder)", gridPhotoLoaded);

  await tap(cdp, sessionId, 'a.product-title-link[href="products/resin-sketch-wall-panel/"]');
  await sleep(700);
  const url = await currentURL(cdp, sessionId);
  report("tapping a product card opens its own detail page", url.endsWith("/products/resin-sketch-wall-panel/"), `landed on ${url}`);

  await sleep(500); // real photo load, not just DOM presence
  const loaded = await evaluate(cdp, sessionId, '!!document.getElementById("product-main-img")?.classList.contains("loaded")');
  report("the product's real photo actually loads (not stuck on the placeholder)", loaded);
  await closePage(cdp, targetId);
}

async function testProductGalleryThumbnails(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/products/resin-sketch-wall-panel/`);
  const before = await evaluate(cdp, sessionId, 'document.getElementById("product-main-img").src');
  const expectedFile = await evaluate(cdp, sessionId, 'document.querySelectorAll(".product-thumb")[1].dataset.full.split("/").pop()');

  await tap(cdp, sessionId, ".product-thumb:nth-of-type(2)");
  await sleep(400);

  const after = await evaluate(cdp, sessionId, 'document.getElementById("product-main-img").src');
  report("tapping a gallery thumbnail swaps the main photo", after !== before && after.endsWith(expectedFile), `before=${before}, after=${after}, expected file=${expectedFile}`);
  await closePage(cdp, targetId);
}

async function testProductPageWhatsAppAndBackLink(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/products/resin-sketch-wall-panel/`);
  const expectedMsg = await evaluate(cdp, sessionId, `document.getElementById("product-whatsapp-link").dataset.message + "\\n" + location.href`);
  const url = await tapAndCaptureNewTabUrl(cdp, sessionId, "#product-whatsapp-link");
  const actualMsg = url ? decodeURIComponent(new URL(url).searchParams.get("text") || "") : null;
  report("the product page's WhatsApp button opens with that product's own message and page link", actualMsg === expectedMsg, `expected "${expectedMsg}", got "${actualMsg}"`);

  await tap(cdp, sessionId, ".back-link");
  await sleep(500);
  const backUrl = await currentURL(cdp, sessionId);
  report("the product page's back-link returns to All pieces (opened from home)", isHomeUrl(backUrl), `landed on ${backUrl}`);
  await closePage(cdp, targetId);
}

async function test404Page(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/this-page-does-not-exist.html`);
  const title = await evaluate(cdp, sessionId, "document.title");
  report("an unknown URL serves the custom 404 page", /not found/i.test(title), `title was "${title}"`);
  await closePage(cdp, targetId);
}

async function testAdminPageLinks(cdp) {
  const { targetId, sessionId } = await openPage(cdp, `http://localhost:${SERVER_PORT}/console-29fab579/`);
  const hrefs = await evaluate(
    cdp,
    sessionId,
    `({
      site: document.getElementById("card-site").getAttribute("href"),
      sheet: document.getElementById("card-sheet").getAttribute("href"),
      drive: document.getElementById("card-drive").getAttribute("href"),
      sync: document.getElementById("card-sync").getAttribute("href"),
    })`
  );
  const expected = await evaluate(cdp, sessionId, "SITE_CONFIG.admin");
  const expectedSiteUrl = await evaluate(cdp, sessionId, "SITE_CONFIG.siteUrl");
  report("admin page: live-site card points at the real site", hrefs.site === expectedSiteUrl, `got ${hrefs.site}`);
  report("admin page: spreadsheet card points at the real sheet", hrefs.sheet === expected.sheetUrl, `got ${hrefs.sheet}`);
  report("admin page: sync card points at the GitHub Actions workflow", hrefs.sync === expected.syncWorkflowUrl, `got ${hrefs.sync}`);
  if (expected.driveFolderUrl) {
    report("admin page: Drive-folder card points at the real folder", hrefs.drive === expected.driveFolderUrl, `got ${hrefs.drive}`);
  }
  await closePage(cdp, targetId);
}

async function safeRun(label, fn) {
  try {
    await fn();
  } catch (err) {
    report(`${label} (unexpected error)`, false, err.message);
  }
}

async function main() {
  console.log("[check-mobile-experience] starting local server + headless Chrome…\n");
  const server = await startServer();
  const chromeProcess = await launchChrome();

  try {
    const cdp = await connectCDP();
    await cdp.send("Target.setDiscoverTargets", { discover: true });

    await safeRun("layout: no horizontal overflow", () => testNoHorizontalOverflow(cdp));
    await safeRun("header logo", () => testLogoNavigatesHome(cdp));
    await safeRun("category nav", () => testCategoryNavNavigation(cdp));
    await safeRun("search (finds results)", () => testSearchFindsExpectedResults(cdp));
    await safeRun("search (no results)", () => testSearchNoResults(cdp));
    await safeRun("WhatsApp buttons", () => testWhatsAppButtons(cdp));
    await safeRun("footer contact links", () => testFooterContactLinks(cdp));
    await safeRun("product card -> detail page", () => testProductCardOpensDetailPageAndPhotoLoads(cdp));
    await safeRun("product gallery thumbnails", () => testProductGalleryThumbnails(cdp));
    await safeRun("product page WhatsApp + back-link", () => testProductPageWhatsAppAndBackLink(cdp));
    await safeRun("404 page", () => test404Page(cdp));
    await safeRun("admin page links", () => testAdminPageLinks(cdp));
  } finally {
    chromeProcess.kill();
    server.close();
  }

  console.log(`\n${violations.length ? "✗" : "✓"} ${passed.length} passed, ${violations.length} failed (mobile viewport ${VIEWPORT.width}x${VIEWPORT.height})`);
  if (violations.length) {
    console.error("\nFailed checks:");
    for (const v of violations) console.error(`  - ${v}`);
  }
  process.exitCode = violations.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
