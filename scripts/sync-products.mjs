#!/usr/bin/env node
// ---------------------------------------------------------------
// Pulls the operator's Google Sheet (published as CSV) + downloads
// each product's photo from Google Drive, resizes/compresses it, then
// regenerates js/products-data.js. Safe to run repeatedly (overwrites,
// never deletes existing images). See README.md "Connecting the product
// sheet" for how to set up the sheet + Drive folder.
//
// Usage:
//   SHEET_CSV_URL="https://docs.google.com/.../pub?output=csv" node scripts/sync-products.mjs
//
// Run manually any time, or via the scheduled GitHub Action
// (.github/workflows/sync-products.yml) which also supports an
// on-demand "Run workflow" button in the GitHub Actions tab.
// ---------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IMAGES_DIR = path.join(ROOT, "images");
const OUTPUT_FILE = path.join(ROOT, "js", "products-data.js");
// CATEGORIES lives in its own tiny file so product detail pages (which only
// ever need CATEGORIES, for the category-nav — never PRODUCTS) don't have
// to load the whole catalog just to get an 8-item list.
const CATEGORIES_FILE = path.join(ROOT, "js", "categories-data.js");
const PRODUCTS_DIR = path.join(ROOT, "products");

// One themed static page per product (see generateProductPages below). Each
// category's page is styled by its own theme CSS + Google Font pairing —
// this mirrors that so a product page reads as part of its category, not a
// generic bolt-on. Keep in sync with scripts/locked-layout.config.json and
// each categories/*.html's own <link> tags if a theme's fonts/CSS file ever
// changes.
const CATEGORY_META = {
  "Painting sketch": {
    slug: "painting-sketch",
    themeCss: "css/themes/theme-22-painting-art.css",
    fontsHref: "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Karla:wght@400;500;600;700&family=Caveat:wght@500;600&display=swap",
  },
  "Resin art": {
    slug: "resin-art",
    themeCss: "css/themes/theme-24-liquid-resin.css",
    fontsHref: "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
  },
  "Lippan art": {
    slug: "lippan-art",
    themeCss: "css/themes/theme-17-lippan-mudwork.css",
    fontsHref: "https://fonts.googleapis.com/css2?family=Rakkas&family=Mukta:wght@400;500;600&display=swap",
  },
  "Mosaic art": {
    slug: "mosaic-art",
    themeCss: "css/themes/theme-18-mosaic-fragments.css",
    fontsHref: "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Jost:wght@300;400;500&display=swap",
  },
  "Home deco": {
    slug: "home-deco",
    themeCss: "css/themes/theme-29-heritage-decor.css",
    fontsHref: "https://fonts.googleapis.com/css2?family=Rozha+One&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
  },
  "Festival special": {
    slug: "festival-special",
    themeCss: "css/themes/theme-20-diya-rangoli.css",
    fontsHref: "https://fonts.googleapis.com/css2?family=Yeseva+One&family=Karla:wght@400;500;700&display=swap",
  },
  "Gift": {
    slug: "gift",
    themeCss: "css/themes/theme-31-wrapped-gift-story.css",
    fontsHref: "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;1,500&family=Jost:wght@400;500&display=swap",
  },
  "Mirror": {
    slug: "mirror",
    themeCss: "css/themes/theme-26-prism-reflection.css",
    fontsHref: "https://fonts.googleapis.com/css2?family=Italiana&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
  },
};

// A product can carry more than one category tag, and can be clicked from
// more than one context: its own category's grid, or the neutral "All
// pieces" homepage grid. Rather than pick one fixed theme per product
// (which felt jarring — clicking from the neutral homepage into a
// heavily-themed category page), every product gets a themed variant per
// category it's tagged with, PLUS this neutral "All pieces"-styled variant
// as its canonical page and the one used when clicked from the homepage.
const ALL_PIECES_META = {
  slug: null,
  themeCss: "css/style.css",
  fontsHref: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Outfit:wght@400;500;600;700&display=swap",
};

// JSON.stringify doesn't escape "</script>", which would otherwise let a
// stray sequence in a product name/description prematurely close the
// <script type="application/ld+json"> tag it's embedded in.
function jsonLdSafe(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function productPageHTML(product, meta, categoryName) {
  const name = escapeHTML(product.name);
  const desc = escapeHTML(product.description);
  const tagsHTML = (product.categories || [])
    .map((c) => `<span class="tag">${escapeHTML(c)}</span>`)
    .join("");
  // Every variant of a product's page (one per category tag, plus the
  // neutral "All pieces" one) is the same content in a different theme —
  // canonical always points at the neutral page so search engines see one
  // URL per product, not several near-duplicates.
  const canonicalUrl = `https://nikhil-goyal24680.github.io/ArtCanopy/products/${product.id}/`;
  const imageUrl = `https://nikhil-goyal24680.github.io/ArtCanopy/images/${product.image}`;
  const backLinkHref = categoryName ? `../../categories/${meta.slug}/` : "../../";
  const backLinkText = categoryName || "All pieces";
  // Main photo first, then any extras — this is the gallery order, main
  // image shown by default with the rest as click-to-swap thumbnails.
  const allImages = [{ image: product.image, imageSmall: product.imageSmall }, ...(product.extraImages || [])];

  // Structured data for Google's Product/Offer rich results — every field
  // here is already real data from the sheet, nothing invented. Availability
  // is MadeToOrder (not InStock) since that's what this whole site's copy
  // already says about every piece. priceNumeric strips the currency
  // symbol/commas since schema.org's price wants a bare number.
  const priceNumeric = String(product.price).replace(/[^0-9.]/g, "");
  const productLd = jsonLdSafe({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: imageUrl,
    url: canonicalUrl,
    ...(product.size ? { size: product.size } : {}),
    ...(priceNumeric
      ? {
          offers: {
            "@type": "Offer",
            url: canonicalUrl,
            price: priceNumeric,
            priceCurrency: "INR",
            availability: "https://schema.org/MadeToOrder",
          },
        }
      : {}),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/png" href="../../images/brand/favicon-32.png">
<link rel="apple-touch-icon" href="../../images/brand/apple-touch-icon.png">
<title>${name} — Art Destiny</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Art Destiny">
<meta property="og:title" content="${name} — Art Destiny">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:image" content="${imageUrl}">
<script type="application/ld+json">${productLd}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${meta.fontsHref}" rel="stylesheet">
<link rel="stylesheet" href="../../${meta.themeCss}">
<link rel="stylesheet" href="../../css/category-nav.css">
<link rel="stylesheet" href="../../css/site-wide.css">
<link rel="stylesheet" href="../../css/product-detail.css">
</head>
<body>

  <a href="#main-content" class="skip-link">Skip to content</a>

  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="../../" aria-label="Art Destiny — back to home"><img src="../../images/brand/artdestiny-logo.png" alt="Art Destiny" class="brand-logo"></a>
      <a class="btn btn-whatsapp header-cta" id="header-whatsapp-link" href="#" target="_blank" rel="noopener">Message us</a>
    </div>
  </header>

  <nav class="category-nav" id="category-nav" aria-label="Art categories"></nav>

  <main class="product-detail" id="main-content">
    <div class="container product-detail-grid">
      <div class="product-gallery">
        <div class="product-image placeholder" id="product-main-image">
          <span>Photo coming soon</span>
          <img
            id="product-main-img"
            src="../../images/${product.image}"
            alt="${name}"
            onload="this.closest('.product-image').classList.remove('placeholder'); this.classList.add('loaded')"
            onerror="this.remove()"
          >
        </div>
        ${allImages.length > 1 ? `<div class="product-thumbs">
          ${allImages.map((img, i) => `
          <button type="button" class="product-thumb${i === 0 ? " active" : ""}" data-full="../../images/${img.image}" aria-label="View image ${i + 1} of ${allImages.length}">
            <img src="../../images/${img.imageSmall || img.image}" alt="" loading="lazy" onerror="this.closest('.product-thumb').remove()">
          </button>`).join("")}
        </div>` : ""}
      </div>
      <div class="product-detail-body">
        <a class="back-link" href="${backLinkHref}">&larr; Back to ${escapeHTML(backLinkText)}</a>
        ${tagsHTML ? `<div class="product-tags">${tagsHTML}</div>` : ""}
        <h1>${name}</h1>
        <p class="product-price product-detail-price">${escapeHTML(product.price)}</p>
        ${product.size ? `<p class="product-detail-size">Size: ${escapeHTML(product.size)}</p>` : ""}
        <p class="product-desc product-detail-desc">${desc}</p>
        <a class="btn btn-whatsapp" id="product-whatsapp-link" href="#" target="_blank" rel="noopener" data-message="${escapeHTML(product.whatsappMessage)}" data-product-name="${name}" data-category="${escapeHTML(categoryName || "All")}" data-price="${priceNumeric}">Order on WhatsApp</a>
        <p class="product-detail-note">Resin care: keep out of direct sunlight and wipe clean with a soft, dry cloth to keep the finish looking its best.</p>
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="brand"><img src="../../images/brand/artdestiny-logo.png" alt="Art Destiny" class="brand-logo"></div>
      <p class="footer-contact">
        <a id="footer-email-link" href="#"></a>
        <span aria-hidden="true">&middot;</span>
        <a id="footer-phone-link" href="#"></a>
      </p>
      <div class="footer-links">
        <a id="footer-whatsapp-link" href="#" target="_blank" rel="noopener">WhatsApp</a>
        <a id="footer-instagram-link" href="#" target="_blank" rel="noopener">Instagram</a>
      </div>
      <p class="footer-policies" id="footer-policies" hidden></p>
      <p class="footer-note">&copy; <span id="footer-year"></span> Art Destiny. All pieces handmade to order.</p>
    </div>
  </footer>

  <script src="../../js/config.js"></script>
  <script src="../../js/categories-data.js"></script>
  <script src="../../js/main.js"></script>
  <script>initProductPage("category-nav", ${JSON.stringify(categoryName)}); initAnalytics();</script>
</body>
</html>
`;
}

// Regenerates products/<id>/index.html (neutral, "All pieces"-themed,
// canonical) plus products/<id>--<category-slug>/index.html for every
// category a product is tagged with — each its own folder so the URL has
// no .html extension. Fully generated — like js/products-data.js, never
// hand-edit a file under products/. Stale folders (a product or a category
// tag removed from the sheet) are deleted so products/ never drifts out of
// sync with the current catalog.
export function generateProductPages(products) {
  fs.mkdirSync(PRODUCTS_DIR, { recursive: true });

  function writePage(dirName, html) {
    const dir = path.join(PRODUCTS_DIR, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
  }

  const expected = new Set();
  for (const product of products) {
    expected.add(product.id);
    writePage(product.id, productPageHTML(product, ALL_PIECES_META, null));

    for (const category of product.categories || []) {
      const meta = CATEGORY_META[category];
      if (!meta) continue; // unknown/typo'd category — sync already warns about this elsewhere
      const dirName = `${product.id}--${meta.slug}`;
      expected.add(dirName);
      writePage(dirName, productPageHTML(product, meta, category));
    }
  }

  for (const existing of fs.readdirSync(PRODUCTS_DIR, { withFileTypes: true })) {
    if (existing.isDirectory() && !expected.has(existing.name)) {
      fs.rmSync(path.join(PRODUCTS_DIR, existing.name), { recursive: true, force: true });
    }
  }

  return expected.size;
}

const SITE_URL = "https://nikhil-goyal24680.github.io/ArtCanopy/";

// Regenerates sitemap.xml from the current catalog — homepage, all 8
// category pages (always live regardless of current stock), and each
// product's neutral/canonical URL only (never the per-category themed
// variants, so the sitemap always agrees with each page's own <link
// rel="canonical">). lastmod is "today" for every entry on every run —
// simple and honest given this whole file regenerates from scratch each
// sync, rather than tracking real per-page change history.
export function generateSitemap(products) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: SITE_URL, priority: "1.0" },
    ...Object.values(CATEGORY_META).map((meta) => ({ loc: `${SITE_URL}categories/${meta.slug}/`, priority: "0.8" })),
    ...products.map((p) => ({ loc: `${SITE_URL}products/${p.id}/`, priority: "0.6" })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join("\n")}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml);
}

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";
const DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY || "";

// Every downloaded photo is re-encoded at two widths — a full size for the
// image itself and a smaller one for `srcset`, so a phone on the product
// grid doesn't download a desktop-sized file. Photos are never upscaled
// past their original size.
const IMAGE_MAIN_WIDTH = 1400;
const IMAGE_SMALL_WIDTH = 600;
const JPEG_QUALITY = 78;

const CATEGORIES = [
  "Painting sketch",
  "Resin art",
  "Lippan art",
  "Mosaic art",
  "Home deco",
  "Festival special",
  "Gift",
  "Mirror",
];

function fail(message) {
  console.error(`[sync-products] ${message}`);
  process.exit(1);
}

// Counts products in the currently-committed js/products-data.js by
// counting a field every product object has — cheaper and less fragile
// than actually importing/evaluating the file just to get a length.
function getPreviousProductCount() {
  if (!fs.existsSync(OUTPUT_FILE)) return 0;
  const prevSrc = fs.readFileSync(OUTPUT_FILE, "utf8");
  const matches = prevSrc.match(/"whatsappMessage":/g);
  return matches ? matches.length : 0;
}

// Matches exactly the filenames this script itself creates for a product:
// <id>.ext, <id>-sm.ext, <id>-altN.ext, <id>-altN-sm.ext — never anything
// under images/brand/ or images/decor/ (subdirectories aren't touched here).
const PRODUCT_IMAGE_RE = /^(.+?)(-alt\d+)?(-sm)?\.(jpe?g|png)$/i;

// A product removed (or renamed) from the sheet previously left its old
// photo(s) behind forever — this only ever deletes a file whose id-prefix
// doesn't match any product in THIS run, so it can't touch a photo for a
// product that still exists.
function pruneOrphanedProductImages(usedIds) {
  for (const entry of fs.readdirSync(IMAGES_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(PRODUCT_IMAGE_RE);
    if (!m || usedIds.has(m[1])) continue;
    fs.unlinkSync(path.join(IMAGES_DIR, entry.name));
    console.log(`[sync-products] pruned orphaned image: images/${entry.name} (product "${m[1]}" no longer exists)`);
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip — handled together with \n above for CRLF line endings
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function rowsToObjects(rows) {
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((key, i) => { obj[key] = (row[i] || "").trim(); });
    return obj;
  });
}

function slugify(name, used) {
  let base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (!base) base = "item";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  used.add(candidate);
  return candidate;
}

function extractDriveFileId(link) {
  if (!link) return null;
  const trimmed = link.trim();
  let m = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) return trimmed; // a bare file ID was pasted
  return null;
}

function extractDriveFolderId(link) {
  if (!link) return null;
  const m = link.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Retries a flaky network call with exponential backoff — Drive's endpoints
// (especially the anonymous download one used below) intermittently
// rate-limit or interstitial-block bursty traffic, and a transient failure
// here otherwise reads as a permanent one (a warning, a dropped photo).
async function withRetry(fn, { attempts = 3, baseDelayMs = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

// Lists the image files inside a publicly-shared ("Anyone with the link")
// Drive folder, via the Drive API. Needs an API key (GOOGLE_DRIVE_API_KEY) —
// unlike downloadDriveImage below, there's no unauthenticated endpoint for
// listing a folder's contents. See README.md "Connecting the product sheet"
// for how to create one. Paginates rather than trusting a single
// pageSize=1000 request to always be the whole folder.
async function listDriveFolderImages(folderId, apiKey) {
  const q = `'${folderId}' in parents and trashed = false`;
  let files = [];
  let pageToken = "";
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("nextPageToken,files(id,name,mimeType)")}&pageSize=1000&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const data = await withRetry(async () => {
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || `Drive API error (status ${res.status})`);
      return body;
    });
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return files
    .filter((f) => (f.mimeType || "").startsWith("image/"))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// `more_photos` accepts either a single Drive folder link (every image file
// inside it becomes an extra photo, in filename order — the tidy option once
// a product has several extra angles) or the older comma/semicolon-separated
// list of individual Drive file links. Returns a list of Drive file IDs
// either way, so the caller doesn't need to know which format was used.
async function resolveMorePhotoFileIds(raw, rowNum, name, warnings) {
  const folderId = extractDriveFolderId(raw);
  if (folderId) {
    if (!DRIVE_API_KEY) {
      warnings.push(`row ${rowNum} ("${name}"): "more_photos" is a Drive folder link, but GOOGLE_DRIVE_API_KEY isn't set — skipped extra photos. See README.md "Connecting the product sheet".`);
      return [];
    }
    try {
      const files = await listDriveFolderImages(folderId, DRIVE_API_KEY);
      if (!files.length) {
        warnings.push(`row ${rowNum} ("${name}"): the more_photos folder has no image files (or isn't shared "Anyone with the link").`);
      }
      return files.map((f) => f.id);
    } catch (err) {
      warnings.push(`row ${rowNum} ("${name}"): couldn't list the more_photos folder — ${err.message}.`);
      return [];
    }
  }

  const links = raw.split(/[,;]/).map((l) => l.trim()).filter(Boolean);
  const ids = [];
  for (const link of links) {
    const fileId = extractDriveFileId(link);
    if (fileId) ids.push(fileId);
    else warnings.push(`row ${rowNum} ("${name}"): additional photo "${link}" doesn't look like a Google Drive link — skipped.`);
  }
  return ids;
}

async function downloadDriveImage(fileId) {
  return withRetry(async () => {
    const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    let res = await fetch(baseUrl, { redirect: "follow" });
    let contentType = res.headers.get("content-type") || "";

    if (contentType.includes("text/html")) {
      // large files show a "can't scan for viruses" interstitial with a confirm token
      const html = await res.text();
      const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
      if (confirmMatch) {
        res = await fetch(`${baseUrl}&confirm=${confirmMatch[1]}`, { redirect: "follow" });
        contentType = res.headers.get("content-type") || "";
      }
    }

    if (!res.ok || !contentType.startsWith("image/")) {
      throw new Error(`unexpected response (status ${res.status}, content-type ${contentType || "unknown"})`);
    }

    return Buffer.from(await res.arrayBuffer());
  });
}

// Re-encodes a downloaded photo at two widths (see IMAGE_MAIN_WIDTH /
// IMAGE_SMALL_WIDTH above). Auto-orients from EXIF first — a phone photo
// that looks upright only because of rotation metadata would otherwise
// come out sideways once that metadata gets stripped by re-encoding.
// Photos with real transparency stay PNG; everything else becomes a
// compressed JPEG, which is far smaller than PNG for a photograph.
async function processImage(buffer, destBasePath) {
  const oriented = sharp(buffer).rotate();
  const hasAlpha = Boolean((await oriented.metadata()).hasAlpha);

  async function renderAt(width, suffix) {
    let pipeline = sharp(buffer).rotate().resize({ width, withoutEnlargement: true });
    const ext = hasAlpha ? "png" : "jpg";
    pipeline = hasAlpha
      ? pipeline.png({ compressionLevel: 9, palette: true })
      : pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

    const outBuffer = await pipeline.toBuffer();
    const destPath = `${destBasePath}${suffix}.${ext}`;
    fs.writeFileSync(destPath, outBuffer);
    return { filename: path.basename(destPath), bytes: outBuffer.length };
  }

  const main = await renderAt(IMAGE_MAIN_WIDTH, "");
  const small = await renderAt(IMAGE_SMALL_WIDTH, "-sm");
  return { main, small };
}

async function main() {
  if (!SHEET_CSV_URL) {
    fail(
      "SHEET_CSV_URL is not set. Publish the product sheet to the web as CSV " +
      "(File > Share > Publish to web > CSV) and pass its URL via the " +
      "SHEET_CSV_URL environment variable. See README.md for the full setup."
    );
  }

  console.log("[sync-products] fetching sheet…");
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) fail(`could not fetch the sheet (status ${res.status}). Is it published to the web?`);
  const csvText = await res.text();

  const rows = parseCSV(csvText);
  if (rows.length < 2) fail("the sheet has no data rows (only a header, or is empty).");
  const records = rowsToObjects(rows);

  // A raw snapshot of every sheet fetch, overwritten each run — recovering
  // "what did the sheet say on date X" is then just `git log`/`git show`
  // against this one file, no need to reconstruct it from the generated
  // js/products-data.js or dig through 30+ automated commits by hand.
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "last-sync.csv"), csvText);

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const usedIds = new Set();
  const products = [];
  const warnings = [];
  let photosDownloaded = 0;

  for (const [i, r] of records.entries()) {
    const rowNum = i + 2; // +1 for header, +1 for 1-indexing
    const name = r.name || "";
    if (!name) { warnings.push(`row ${rowNum}: missing "name", skipped.`); continue; }

    const id = r.id ? slugify(r.id, usedIds) : slugify(name, usedIds);

    const categories = (r.categories || "")
      .split(/[,;]/)
      .map((c) => c.trim())
      .filter(Boolean);
    categories.forEach((c) => {
      if (!CATEGORIES.some((known) => known.toLowerCase() === c.toLowerCase())) {
        warnings.push(`row ${rowNum} ("${name}"): category "${c}" isn't in the known list (${CATEGORIES.join(", ")}) — check for a typo.`);
      }
    });

    const whatsappMessage = r.whatsapp_message ||
      `Hi! I'm interested in the ${name} — can you share more details?`;

    let image = `${id}.jpg`; // default guess; overwritten below if a photo downloads successfully
    let imageSmall = ""; // only set for photos this script has itself resized (see IMAGE_SMALL_WIDTH above)
    const existingFiles = fs.readdirSync(IMAGES_DIR);
    const existing = existingFiles.find((f) => f.startsWith(`${id}.`));
    if (existing) image = existing;
    const existingSmall = existingFiles.find((f) => f.startsWith(`${id}-sm.`));
    if (existingSmall) imageSmall = existingSmall;

    const photoLink = r.photo || r.image || r.drive_photo || "";
    const fileId = extractDriveFileId(photoLink);
    if (fileId) {
      try {
        const buffer = await downloadDriveImage(fileId);
        const { main, small } = await processImage(buffer, path.join(IMAGES_DIR, id));
        image = main.filename;
        imageSmall = small.filename;
        photosDownloaded++;
        console.log(
          `[sync-products] downloaded + optimized photo for "${name}" -> ` +
          `images/${image} (${Math.round(main.bytes / 1024)}KB), images/${imageSmall} (${Math.round(small.bytes / 1024)}KB)`
        );
      } catch (err) {
        warnings.push(`row ${rowNum} ("${name}"): couldn't download photo — ${err.message}. Keeping previous image if any.`);
      }
    } else if (photoLink) {
      warnings.push(`row ${rowNum} ("${name}"): "${photoLink}" doesn't look like a Google Drive link — skipped photo.`);
    }

    // Optional extra photos for the product's own detail-page gallery (a
    // main image + thumbnails, like a marketplace listing) — the product
    // grid card itself only ever shows `image` above. Either a single Drive
    // folder link, or the older comma/semicolon list of individual Drive
    // links — see resolveMorePhotoFileIds above.
    const morePhotosRaw = r.more_photos || r.additional_photos || r.extra_photos || "";
    const morePhotoFileIds = await resolveMorePhotoFileIds(morePhotosRaw, rowNum, name, warnings);
    const extraImages = [];
    for (const [j, altFileId] of morePhotoFileIds.entries()) {
      const altBase = `${id}-alt${j + 1}`;
      let altImage = existingFiles.find((f) => f.startsWith(`${altBase}.`)) || "";
      let altImageSmall = existingFiles.find((f) => f.startsWith(`${altBase}-sm.`)) || "";

      try {
        const buffer = await downloadDriveImage(altFileId);
        const { main, small } = await processImage(buffer, path.join(IMAGES_DIR, altBase));
        altImage = main.filename;
        altImageSmall = small.filename;
        photosDownloaded++;
        console.log(`[sync-products] downloaded + optimized extra photo ${j + 1} for "${name}" -> images/${altImage}`);
      } catch (err) {
        warnings.push(`row ${rowNum} ("${name}"): couldn't download additional photo ${j + 1} — ${err.message}. Keeping previous image if any.`);
      }

      if (altImage) extraImages.push({ image: altImage, imageSmall: altImageSmall });
    }

    products.push({
      id,
      name,
      price: r.price || "",
      description: r.description || "",
      size: r.size || r.dimensions || "",
      image,
      imageSmall,
      extraImages,
      categories,
      whatsappMessage,
    });
  }

  // A partial/accidental Sheet edit (a bad filter, a mass-delete) shouldn't
  // silently collapse the live catalog — the pipeline auto-commits and
  // pushes with no human review step, so this is the only gate. Only fires
  // once there's a real prior catalog to compare against, and can be
  // deliberately bypassed for a genuine intentional shrink.
  const previousCount = getPreviousProductCount();
  if (
    process.env.ALLOW_CATALOG_SHRINK !== "1" &&
    previousCount >= 3 &&
    products.length < previousCount * 0.5
  ) {
    fail(
      `catalog size dropped from ${previousCount} to ${products.length} products (more than half) — ` +
      "this looks like an accidental sheet edit, so nothing was written or pushed. If this drop is " +
      "genuinely intentional, re-run with ALLOW_CATALOG_SHRINK=1 set (the manual 'Run workflow' " +
      "button has a checkbox for this)."
    );
  }

  pruneOrphanedProductImages(usedIds);

  const categoriesFileContents = `// ---------------------------------------------------------------
// AUTO-GENERATED by scripts/sync-products.mjs. Do not hand-edit.
// Split out from products-data.js so pages that only need the category
// list (every product detail page) don't have to load the whole catalog.
// ---------------------------------------------------------------

// Canonical category list — a product can belong to more than one.
const CATEGORIES = ${JSON.stringify(CATEGORIES, null, 2)};
`;
  fs.writeFileSync(CATEGORIES_FILE, categoriesFileContents);

  const fileContents = `// ---------------------------------------------------------------
// AUTO-GENERATED by scripts/sync-products.mjs from the operator's
// Google Sheet + Drive photos. Do not hand-edit — changes here get
// overwritten on the next sync. To update products, edit the sheet.
// Last synced: ${new Date().toISOString()}
// ---------------------------------------------------------------

const PRODUCTS = ${JSON.stringify(products, null, 2)};
`;
  fs.writeFileSync(OUTPUT_FILE, fileContents);

  const pageCount = generateProductPages(products);
  generateSitemap(products);

  // Surfaced by .github/workflows/sync-products.yml into a GitHub Issue —
  // a run that only produced warnings still exits 0 (nothing's actually
  // broken), so without this the only trace was a line in that day's
  // Action log that nobody was watching.
  const warningsFile = path.join(ROOT, "sync-warnings.txt");
  if (warnings.length) fs.writeFileSync(warningsFile, warnings.join("\n"));
  else if (fs.existsSync(warningsFile)) fs.unlinkSync(warningsFile);

  console.log(`\n[sync-products] done: ${products.length} products, ${photosDownloaded} photo(s) downloaded, ${pageCount} product page(s) generated.`);
  if (warnings.length) {
    console.log(`\n[sync-products] ${warnings.length} warning(s):`);
    warnings.forEach((w) => console.log(`  - ${w}`));
  }
}

// Only auto-run when invoked directly (`node scripts/sync-products.mjs`) —
// importing this module for generateProductPages() shouldn't require
// SHEET_CSV_URL to be set.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => fail(err.stack || err.message));
}
