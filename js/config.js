// ---------------------------------------------------------------
// SITE SETTINGS — edit these to update contact info across the site
// ---------------------------------------------------------------
const SITE_CONFIG = {
  // The site's own live URL, trailing slash included. Used to turn a
  // product's page into an absolute link (e.g. so a WhatsApp order message
  // can point back to the exact product being asked about).
  siteUrl: "https://nikhil-goyal24680.github.io/ArtCanopy/",

  // WhatsApp number in international format, no "+", no spaces.
  // Example: 91 followed by the 10-digit number.
  whatsappNumber: "917878457307",

  // Message pre-filled when someone taps a general "message us" button.
  whatsappDefaultMessage: "Hi! I saw your page and wanted to ask about your pieces.",

  // Contact email shown in the footer of every page. Placeholder until the
  // real business address is ready.
  contactEmail: "nikhilgoyal24680@gmail.com",

  // Leave blank ("") to hide the Instagram link in the footer.
  instagramHandle: "",

  // Optional one-line policy notes shown together in the footer, separated
  // by " · ", once you fill them in. Left blank by default — nothing here
  // gets published without you reviewing it first; each line only shows up
  // if non-empty, and the whole strip stays hidden if all three are blank.
  // Keep each one short, e.g. "Ships across India in 5-7 days".
  policies: {
    shipping: "",
    payment: "",
    returns: "",
  },

  // Optional "who's behind this" note shown under the homepage's About
  // section once you fill it in. Left blank by default, same reasoning as
  // policies above — a real customer should only ever see your own words.
  aboutMaker: "",

  // Google Analytics 4 Measurement ID (looks like "G-XXXXXXXXXX"). Create a
  // free property at analytics.google.com, then paste the ID here. Leave
  // blank ("") to keep analytics fully off — no script loads, nothing is
  // sent anywhere.
  gaMeasurementId: "G-ET7WH2EWLT",

  // Links shown on the internal quick-links dashboard
  // (console-29fab579/index.html) — that page isn't linked from the site
  // nav, just a bookmark-worthy one-page control panel for whoever runs the
  // shop day to day. Its folder name is a deliberately unguessable slug
  // rather than "admin" — though since this repo is public, that's a minor
  // speed bump at best, not real access control. The actual protection is
  // the Sheet/Drive share settings themselves (Viewer for "anyone with the
  // link", not Editor) — see README. If the site or sheet ever moves,
  // update the URLs here rather than editing console-29fab579/index.html.
  admin: {
    sheetUrl: "https://docs.google.com/spreadsheets/d/1V3sK8m3xLPBX8cRl6o7BK54Sp3KKJnoqLD4l1gAgetk/edit",
    // The Drive folder that holds one subfolder per product's photos. Paste
    // its share link here once it exists — leave blank to hide that card.
    driveFolderUrl: "https://drive.google.com/drive/folders/14qgTs6NrmSTNBQ8Qpz2XkNWKLOG5y8BF?usp=sharing",
    syncWorkflowUrl: "https://github.com/Nikhil-Goyal24680/ArtCanopy/actions/workflows/sync-products.yml",
  },
};
