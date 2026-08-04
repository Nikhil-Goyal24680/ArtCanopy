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

Almost everything you'll want to change lives in **one file**: `js/products.js`.

- **WhatsApp number / default message**: edit the `SITE_CONFIG` block at the top.
- **Add, remove, or edit a product**: edit the `PRODUCTS` list below it. Each product
  is a block like this — copy one, change the text, keep the commas:

  ```js
  {
    id: "keychain",
    name: "Resin Keychain",
    price: "₹199",
    description: "A small keepsake, cast in a durable resin charm.",
    image: "keychain.jpg",
    whatsappMessage: "Hi! I'm interested in the Resin Keychain — can you share more details?",
  },
  ```

- To remove a product, delete its whole `{ ... },` block.

## Adding real photos

Right now every product shows a "Photo coming soon" placeholder. To add a real photo:

1. Drop the image file into the `images/` folder (e.g. `images/keychain.jpg`).
2. Open `js/main.js` and swap the placeholder `<div>` for an `<img>` tag pointing at
   `images/${p.image}` — or just ask Claude to wire it in once photos are ready.

Keep photos reasonably small (under ~500KB each, square or 4:3) so the page loads fast
on mobile — most people will open this link from Instagram or WhatsApp on a phone.

## Getting a real shareable link (free hosting)

This site is fully static, so it can be hosted for free with **GitHub Pages**:

1. Create a new repo on GitHub and push this folder to it.
2. In the repo settings, go to **Pages** and set the source to the `main` branch, root
   folder.
3. GitHub gives you a link like `https://<username>.github.io/ArtCanopy/` — that's
   the link to share.

(Netlify and Vercel are also free and work the same way if you'd rather use those.)

## Notes

- The WhatsApp number currently in `js/products.js` is a **test number** — replace it
  with the real one before sharing the link publicly.
- `instagramHandle` in `SITE_CONFIG` is blank, so the Instagram footer link is hidden.
  Fill it in once there's a page to link to.
