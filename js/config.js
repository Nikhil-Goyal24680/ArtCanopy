// ---------------------------------------------------------------
// SITE SETTINGS — edit these to update contact info across the site
// ---------------------------------------------------------------
const SITE_CONFIG = {
  // WhatsApp number in international format, no "+", no spaces.
  // Example: 91 followed by the 10-digit number.
  whatsappNumber: "917878457307",

  // Message pre-filled when someone taps a general "message us" button.
  whatsappDefaultMessage: "Hi! I saw your resin art page and wanted to ask about your pieces.",

  // Contact email shown in the footer of every page. Placeholder until the
  // real business address is ready.
  contactEmail: "nikhilgoyal24680@gmail.com",

  // Leave blank ("") to hide the Instagram link in the footer.
  instagramHandle: "",

  // Google Analytics 4 Measurement ID (looks like "G-XXXXXXXXXX"). Create a
  // free property at analytics.google.com, then paste the ID here. Leave
  // blank ("") to keep analytics fully off — no script loads, nothing is
  // sent anywhere.
  gaMeasurementId: "G-ET7WH2EWLT",

  // Links shown on the internal quick-links dashboard (admin/index.html) —
  // that page isn't linked from the site nav, just a bookmark-worthy one-page
  // control panel for whoever runs the shop day to day. If the site or sheet
  // ever moves, update the URLs here rather than editing admin/index.html.
  admin: {
    siteUrl: "https://nikhil-goyal24680.github.io/ArtCanopy/",
    sheetUrl: "https://docs.google.com/spreadsheets/d/1V3sK8m3xLPBX8cRl6o7BK54Sp3KKJnoqLD4l1gAgetk/edit",
    // The Drive folder that holds one subfolder per product's photos. Paste
    // its share link here once it exists — leave blank to hide that card.
    driveFolderUrl: "https://drive.google.com/drive/folders/14qgTs6NrmSTNBQ8Qpz2XkNWKLOG5y8BF?usp=sharing",
    syncWorkflowUrl: "https://github.com/Nikhil-Goyal24680/ArtCanopy/actions/workflows/sync-products.yml",
  },
};
