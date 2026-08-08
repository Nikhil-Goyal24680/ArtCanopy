# ArtCanopy

A simple one-page website for sharing and selling handmade resin art. No backend, no
database — just a page you can send as a link, with an "Order on WhatsApp" button on
every product.

## Preview it on your own computer

You don't need to install anything special. From this folder, run:

```
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. Stop it later with Ctrl+C.

(Double-clicking `index.html` also works in a pinch, but some browsers block loading
the product list that way — the command above avoids that.)

## Editing the site (no coding experience needed)

Two files matter:

- **`js/config.js`** — WhatsApp number, default message, Instagram handle. Edit this
  directly whenever these change.
- **`js/products-data.js`** — the actual product list (name, price, description,
  photo, categories). If you're using the Google Sheet (see below), **don't hand-edit
  this file** — it gets overwritten every time the sheet syncs. If you're *not* using
  the sheet yet, it's safe to edit directly the same way the old `products.js` worked:

  ```js
  {
    "id": "keychain",
    "name": "Resin Keychain",
    "price": "₹199",
    "description": "A small keepsake, cast in a durable resin charm.",
    "image": "keychain.jpg",
    "categories": ["Gift"],
    "whatsappMessage": "Hi! I'm interested in the Resin Keychain — can you share more details?"
  },
  ```

  To remove a product, delete its whole `{ ... },` block.

## Connecting the product sheet (lets the operator update products without touching code)

Products can be managed from a Google Sheet instead of editing files. A script
(`scripts/sync-products.mjs`) reads the sheet, downloads each product's photo from
Google Drive, and regenerates `js/products-data.js`. It runs automatically once a day
via GitHub Actions, and can also be triggered manually any time.

**1. Create the sheet.** Make a Google Sheet with these column headers in row 1 (order
doesn't matter, but the names must match exactly, lowercase):

| id | name | price | description | categories | photo | whatsapp_message |
|----|------|-------|-------------|------------|-------|-------------------|
| *(optional)* | Lippan Mirror Wall Art | ₹1,499 | Traditional Lippan mud-mirror work... | Lippan art, Home deco | *(Drive link)* | *(optional)* |

- **id**: leave blank — it's generated automatically from the name. Only fill it in if
  you want a specific web-friendly ID.
- **categories**: comma-separated, using this list (a product can have more than one):
  `Painting sketch, Resin art, Lippan art, Mosaic art, Mirror, Home deco, Festival special, Gift`
- **photo**: a Google Drive share link (see step 2).
- **whatsapp_message**: leave blank to auto-generate a reasonable default from the name.

Each row = one product. Row order = display order on the site.

**2. Set up the Drive photos.**
1. Create a Google Drive folder for product photos.
2. Upload each photo there.
3. For each photo: right-click → **Share** → change access to **"Anyone with the
   link"** → **Copy link**. Paste that link into the `photo` column for that row.

**3. Get the sheet's CSV link.**
1. Make sure the sheet's sharing is set to **"Anyone with the link"** (Share button,
   top right) — same as the Drive photos above.
2. Copy the sheet's ID from its normal URL — the long string between `/d/` and
   `/edit`, e.g. `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.
3. The CSV link is: `https://docs.google.com/spreadsheets/d/THE_ID/export?format=csv&gid=0`

   (If that doesn't work — e.g. sharing is more locked down than "anyone with the
   link" — use **File → Share → Publish to web**, choose the sheet tab, format
   **CSV**, and use that URL instead.)

**4. Wire it up in GitHub.**
1. In the GitHub repo: **Settings → Secrets and variables → Actions → Variables tab →
   New repository variable**.
2. Name: `SHEET_CSV_URL`. Value: the URL from step 3.
3. That's it — the daily sync (`.github/workflows/sync-products.yml`) will pick it up.

**Running a sync manually** (don't want to wait for the next scheduled run): go to the
repo's **Actions** tab → **Sync products from Google Sheet** → **Run workflow**.

**Running it locally** (to test before relying on the daily schedule):

```
SHEET_CSV_URL="<your published CSV URL>" node scripts/sync-products.mjs
```

The script only ever adds or overwrites images/data — it never deletes a photo you've
placed manually, so it's safe to try.

## Adding real photos manually (without the sheet)

Every product without a photo shows a "Photo coming soon" placeholder automatically.
To add one by hand: drop the image file into the `images/` folder, named to match the
product's `image` field (e.g. `images/keychain.jpg`) — no code changes needed, it's
picked up automatically. Keep photos reasonably small (under ~500KB each, square or
4:3) so the page loads fast on mobile.

## Trying different looks

The `themes/` folder has several alternate designs for the same product data — open
`themes/index.html` to browse them. `index.html` at the project root is the live site.

## Getting a real shareable link (free hosting)

This site is fully static, so it can be hosted for free with **GitHub Pages**:

1. Create a new repo on GitHub and push this folder to it.
2. In the repo settings, go to **Pages** and set the source to the `main` branch, root
   folder.
3. GitHub gives you a link like `https://<username>.github.io/ArtCanopy/` — that's
   the link to share.

(Netlify and Vercel are also free and work the same way if you'd rather use those.)

## Notes

- The WhatsApp number currently in `js/config.js` is a **test number** — replace it
  with the real one before sharing the link publicly.
- `instagramHandle` in `SITE_CONFIG` is blank, so the Instagram footer link is hidden.
  Fill it in once there's a page to link to.
- The daily sheet sync only works once this repo is pushed to GitHub (Actions doesn't
  run on a purely local repo).
