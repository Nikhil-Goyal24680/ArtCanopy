// ---------------------------------------------------------------
// SITE SETTINGS — edit these to update contact info across the site
// ---------------------------------------------------------------
const SITE_CONFIG = {
  // WhatsApp number in international format, no "+", no spaces.
  // Example: 91 followed by the 10-digit number.
  whatsappNumber: "917878457307",

  // Message pre-filled when someone taps a general "message us" button.
  whatsappDefaultMessage: "Hi! I saw your resin art page and wanted to ask about your pieces.",

  // Leave blank ("") to hide the Instagram link in the footer.
  instagramHandle: "",
};

// ---------------------------------------------------------------
// PRODUCTS — add, remove, or edit pieces here.
// Each product needs: id, name, price, description, image, whatsappMessage.
// "image" is a filename that should exist inside the /images folder.
// Until real photos are added, products show a placeholder instead.
// ---------------------------------------------------------------
const PRODUCTS = [
  {
    id: "photo-frame",
    name: "Resin Photo Frame",
    price: "₹499",
    description: "A cherished photo, sealed in clear resin with a decorative border.",
    image: "photo-frame.jpg",
    whatsappMessage: "Hi! I'm interested in the Resin Photo Frame — can you share more details?",
  },
  {
    id: "coaster-set",
    name: "Resin Coaster Set (4 pcs)",
    price: "₹699",
    description: "Ocean-swirl coasters, hand-poured and finished with a glossy seal.",
    image: "coaster-set.jpg",
    whatsappMessage: "Hi! I'm interested in the Resin Coaster Set — can you share more details?",
  },
  {
    id: "keychain",
    name: "Resin Keychain",
    price: "₹199",
    description: "A small keepsake — pressed flowers or glitter, cast in a durable resin charm.",
    image: "keychain.jpg",
    whatsappMessage: "Hi! I'm interested in the Resin Keychain — can you share more details?",
  },
  {
    id: "nameplate",
    name: "Resin Nameplate",
    price: "₹899",
    description: "A custom-lettered nameplate for your door, desk, or nursery.",
    image: "nameplate.jpg",
    whatsappMessage: "Hi! I'm interested in the Resin Nameplate — can you share more details?",
  },
  {
    id: "wall-clock",
    name: "Resin Wall Clock",
    price: "₹1,299",
    description: "A statement clock with layered color and texture, made to order.",
    image: "wall-clock.jpg",
    whatsappMessage: "Hi! I'm interested in the Resin Wall Clock — can you share more details?",
  },
  {
    id: "jewelry-box",
    name: "Resin Jewelry Box",
    price: "₹1,099",
    description: "A small keepsake box with a marbled resin lid, lined inside.",
    image: "jewelry-box.jpg",
    whatsappMessage: "Hi! I'm interested in the Resin Jewelry Box — can you share more details?",
  },
];
