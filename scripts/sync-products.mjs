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

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";

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

async function downloadDriveImage(fileId) {
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

    products.push({
      id,
      name,
      price: r.price || "",
      description: r.description || "",
      image,
      imageSmall,
      categories,
      whatsappMessage,
    });
  }

  const fileContents = `// ---------------------------------------------------------------
// AUTO-GENERATED by scripts/sync-products.mjs from the operator's
// Google Sheet + Drive photos. Do not hand-edit — changes here get
// overwritten on the next sync. To update products, edit the sheet.
// Last synced: ${new Date().toISOString()}
// ---------------------------------------------------------------

// Canonical category list — a product can belong to more than one.
const CATEGORIES = ${JSON.stringify(CATEGORIES, null, 2)};

const PRODUCTS = ${JSON.stringify(products, null, 2)};
`;
  fs.writeFileSync(OUTPUT_FILE, fileContents);

  console.log(`\n[sync-products] done: ${products.length} products, ${photosDownloaded} photo(s) downloaded.`);
  if (warnings.length) {
    console.log(`\n[sync-products] ${warnings.length} warning(s):`);
    warnings.forEach((w) => console.log(`  - ${w}`));
  }
}

main().catch((err) => fail(err.stack || err.message));
