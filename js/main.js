function whatsappLink(message) {
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

// Fixed default for every "Order on WhatsApp" button: the product link first
// (so it's always there, even if the rest gets edited away in the chat), then
// a "Buy" line, price, and description. A sheet row's optional custom
// whatsapp_message (customMessage here) is never a replacement for this —
// it only ever appends as an extra line after it.
function buildProductWhatsappMessage({ link, name, price, description, customMessage }) {
  let message = `${link}\nBuy "${name}"\n${price}\n${description}`;
  if (customMessage) message += `\n${customMessage}`;
  return message;
}

// "₹1,499" -> "1499" — for GA4's numeric value param, which can't take a
// currency symbol or thousands separator.
function priceToNumeric(price) {
  return String(price || "").replace(/[^0-9.]/g, "");
}

// Formats "918824990336" as "+91 88249 90336" for footer display.
function formatPhoneDisplay(number) {
  return `+${number.slice(0, 2)} ${number.slice(2, 7)} ${number.slice(7)}`;
}

// Wires up console-29fab579/index.html — the unlinked, internal quick-links
// dashboard. See SITE_CONFIG.admin in js/config.js for the actual URLs.
function wireAdminPage() {
  document.getElementById("card-site").href = SITE_CONFIG.siteUrl;
  document.getElementById("card-sheet").href = SITE_CONFIG.admin.sheetUrl;
  document.getElementById("card-sync").href = SITE_CONFIG.admin.syncWorkflowUrl;

  const driveCard = document.getElementById("card-drive");
  if (SITE_CONFIG.admin.driveFolderUrl) {
    driveCard.href = SITE_CONFIG.admin.driveFolderUrl;
  } else {
    driveCard.removeAttribute("href");
    driveCard.removeAttribute("target");
    driveCard.classList.add("disabled");
    document.getElementById("card-drive-note").textContent =
      "Not set yet — paste the main Drive folder's link into driveFolderUrl in js/config.js.";
  }
}

function wireFooterContact() {
  document.getElementById("footer-email-link").href = `mailto:${SITE_CONFIG.contactEmail}`;
  document.getElementById("footer-email-link").textContent = SITE_CONFIG.contactEmail;
  document.getElementById("footer-phone-link").href = `tel:+${SITE_CONFIG.whatsappNumber}`;
  document.getElementById("footer-phone-link").textContent = formatPhoneDisplay(SITE_CONFIG.whatsappNumber);

  const policyLines = [SITE_CONFIG.policies.shipping, SITE_CONFIG.policies.payment, SITE_CONFIG.policies.returns].filter(Boolean);
  const policiesEl = document.getElementById("footer-policies");
  if (policiesEl && policyLines.length) {
    policiesEl.textContent = policyLines.join(" · ");
    policiesEl.hidden = false;
  }
}

// ---------------------------------------------------------------
// Analytics — loads Google Analytics 4 only if SITE_CONFIG.gaMeasurementId
// is set (see js/config.js). Page views, referrer, and device type are
// tracked automatically by GA4 itself; on top of that this sends a few
// custom events: which WhatsApp button gets clicked (and on which
// product, if any), what people search for and whether it found anything,
// and hits on the 404 page. If gaMeasurementId is blank, trackEvent() is a
// harmless no-op.
// ---------------------------------------------------------------
function initAnalytics() {
  if (SITE_CONFIG.gaMeasurementId && !window.dataLayer) {
    window.dataLayer = [];
    window.gtag = function () {
      dataLayer.push(arguments);
    };
    gtag("js", new Date());
    gtag("config", SITE_CONFIG.gaMeasurementId);

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${SITE_CONFIG.gaMeasurementId}`;
    document.head.appendChild(script);
  }
  wireWhatsAppTracking();
}

function trackEvent(name, params) {
  if (typeof window.gtag === "function") gtag("event", name, params || {});
}

// Delegated click tracking catches every WhatsApp link on the page — header,
// hero, custom-cta, footer, error page, and every per-product card — without
// needing a listener re-attached each time the product grid re-renders.
//
// It also opens WhatsApp itself (via window.open(), not the link's own
// target="_blank") and sends the current tab on to /thank-you/ right after.
// Letting the browser's native target="_blank" handle the new tab while we
// also change the current tab's location in the same click turned out to be
// unreliable — many browsers treat the immediate navigation as racing the
// pending new-tab action and drop it, so window.open() is called explicitly
// here first, synchronously in the click handler, before we navigate away.
// The actual order happens off-site in a WhatsApp chat, so there's no real
// "purchase" page for ad platforms to detect — the redirect gives Google Ads
// (and anything else watching for a page visit) a page on our own domain to
// count as the conversion.
function wireWhatsAppTracking() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="https://wa.me/"]');
    if (!link) return;
    trackEvent("whatsapp_click", {
      link_location: link.id || "product_card",
      product_name: link.dataset.productName || "",
      category: link.dataset.category || "",
      ...(link.dataset.price ? { value: Number(link.dataset.price), currency: "INR" } : {}),
      page_path: location.pathname,
    });
    e.preventDefault();
    window.open(link.href, "_blank", "noopener");
    window.location.href = "/thank-you/";
  });
}

// Prefetches a local page's HTML the moment a pointer/touch shows intent to
// follow its link — by the time the click actually lands, the next page is
// usually already cached, so navigation feels instant instead of a fresh
// network round trip. Skips anything that isn't a same-site relative page
// link (external sites, mailto:, tel:, wa.me, "#...") since those shouldn't
// be pre-fetched.
function wireLinkPrefetch() {
  const alreadyPrefetched = new Set();
  function isLocalPageLink(href) {
    return Boolean(href) && !href.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//");
  }
  function doPrefetch(href) {
    if (alreadyPrefetched.has(href)) return;
    alreadyPrefetched.add(href);
    const tag = document.createElement("link");
    tag.rel = "prefetch";
    tag.href = href;
    document.head.appendChild(tag);
  }
  document.addEventListener("mouseenter", (e) => {
    const link = e.target.closest && e.target.closest("a[href]");
    const href = link && link.getAttribute("href");
    if (isLocalPageLink(href)) doPrefetch(href);
  }, true);

  // touchstart alone can't tell a tap from the start of a scroll — an
  // ordinary scroll gesture down a product grid often starts with a finger
  // landing right on a card. Track movement and only prefetch if the touch
  // has settled (a scroll shows > 10px of movement within ~120ms), so
  // scrolling past cards doesn't schedule a wasted prefetch on mobile data.
  let pending = null;
  document.addEventListener("touchstart", (e) => {
    const link = e.target.closest && e.target.closest("a[href]");
    const href = link && link.getAttribute("href");
    if (!isLocalPageLink(href)) return;
    const touch = e.touches[0];
    pending = { href, x: touch.clientX, y: touch.clientY, moved: false };
    setTimeout(() => {
      if (pending && pending.href === href && !pending.moved) doPrefetch(href);
    }, 120);
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!pending) return;
    const touch = e.touches[0];
    if (Math.abs(touch.clientX - pending.x) > 10 || Math.abs(touch.clientY - pending.y) > 10) {
      pending.moved = true;
    }
  }, { capture: true, passive: true });
}
document.addEventListener("DOMContentLoaded", wireLinkPrefetch);

// Gift category's product photos are covered by a ribbon-wrap effect that
// used to only peel back on mouse :hover — meaning it never moved at all on
// a touchscreen. Delegated so it keeps working after the grid re-renders
// from a search, same reasoning as wireWhatsAppTracking() above.
function wireGiftUnwrap() {
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".product-image");
    if (!img) return;
    img.classList.toggle("unwrapped");
  });
}

let activeCategory = "All";
let searchQuery = "";
// index.html sits next to images/ and products/; categories/<slug>/index.html
// and products/<id>/index.html sit two levels down. initCategoryPage() flips
// this before the first render on a category page so image/product-link
// paths resolve either way.
let pagePathPrefix = "";

// products/<id>*/index.html — clicking a gallery thumbnail swaps the main
// display image instead of navigating anywhere. Delegated (not wired per
// thumbnail) so it's a harmless no-op on every page without a
// .product-thumb, same reasoning as wireWhatsAppTracking/wireGiftUnwrap.
function wireProductGallery() {
  document.addEventListener("click", (e) => {
    const thumb = e.target.closest(".product-thumb");
    if (!thumb) return;
    const wrap = document.getElementById("product-main-image");
    if (!wrap) return;

    let mainImg = document.getElementById("product-main-img");
    if (!mainImg) {
      // A prior image's onerror handler already removed the <img> — recreate it.
      mainImg = document.createElement("img");
      mainImg.id = "product-main-img";
      wrap.appendChild(mainImg);
    }
    mainImg.onload = () => wrap.classList.remove("placeholder");
    mainImg.onerror = () => wrap.classList.add("placeholder");
    mainImg.src = thumb.dataset.full;
    mainImg.alt = thumb.getAttribute("aria-label") || "";

    document.querySelectorAll(".product-thumb.active").forEach((t) => t.classList.remove("active"));
    thumb.classList.add("active");
  });
}

function renderProducts() {
  const grid = document.getElementById("product-grid");
  const noResults = document.getElementById("no-results");

  const byCategory =
    activeCategory === "All"
      ? PRODUCTS
      : PRODUCTS.filter((p) => (p.categories || []).includes(activeCategory));

  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? byCategory.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      )
    : byCategory;

  if (noResults) noResults.hidden = visible.length > 0;

  grid.innerHTML = visible.map((p) => {
    // A product can carry more than one category tag. Clicking it from the
    // neutral "All pieces" grid opens the neutral/"All pieces"-themed page;
    // clicking it from a specific category's grid opens that category's
    // own themed variant instead — landing in a different visual world than
    // the one you were just browsing felt wrong (see scripts/sync-products.mjs
    // generateProductPages() for how both variants get generated).
    const productPath = activeCategory === "All"
      ? `products/${p.id}/`
      : `products/${p.id}--${categorySlug(activeCategory)}/`;
    const detailHref = `${pagePathPrefix}${productPath}`;
    const productMessage = buildProductWhatsappMessage({
      link: `${SITE_CONFIG.siteUrl}${productPath}`,
      name: p.name,
      price: p.price,
      description: p.description,
      customMessage: p.whatsappMessage,
    });
    return `
    <article class="product-card">
      <a class="product-image placeholder" id="img-wrap-${p.id}" href="${detailHref}" aria-label="View ${p.name}">
        <span>Photo coming soon</span>
        <img
          src="${pagePathPrefix}images/${p.image}"
          ${p.imageSmall ? `srcset="${pagePathPrefix}images/${p.imageSmall} 600w, ${pagePathPrefix}images/${p.image} 1400w" sizes="(max-width: 480px) 90vw, 320px"` : ""}
          alt="${p.name}"
          onload="this.closest('.product-image').classList.remove('placeholder'); this.classList.add('loaded')"
          onerror="this.remove()"
        >
      </a>
      <div class="product-body">
        <h3><a class="product-title-link" href="${detailHref}">${p.name}</a></h3>
        ${
          (p.categories || []).length
            ? `<div class="product-tags">${p.categories.map((c) => `<span class="tag">${c}</span>`).join("")}</div>`
            : ""
        }
        <p class="product-desc">${p.description}</p>
        <div class="product-footer">
          <span class="product-price">${p.originalPrice ? `<span class="price-original">${p.originalPrice}</span> ` : ""}${p.price}</span>
          <a class="btn btn-whatsapp" href="${whatsappLink(productMessage)}" target="_blank" rel="noopener" data-product-name="${p.name}" data-category="${activeCategory}" data-price="${priceToNumeric(p.price)}" aria-label="Order ${p.name} on WhatsApp">Order on WhatsApp</a>
        </div>
      </div>
    </article>
  `;
  }).join("");
}

function wireStaticLinks() {
  const defaultLink = whatsappLink(SITE_CONFIG.whatsappDefaultMessage);
  document.getElementById("header-whatsapp-link").href = defaultLink;
  document.getElementById("hero-whatsapp-link").href = defaultLink;
  document.getElementById("footer-whatsapp-link").href = defaultLink;
  document.getElementById("custom-whatsapp-link").href = whatsappLink(
    "Hi! I'd like to ask about a custom resin art order."
  );

  const instagramEl = document.getElementById("footer-instagram-link");
  if (SITE_CONFIG.instagramHandle) {
    instagramEl.href = `https://instagram.com/${SITE_CONFIG.instagramHandle}`;
  } else {
    instagramEl.style.display = "none";
  }

  const aboutMakerEl = document.getElementById("about-maker-note");
  if (aboutMakerEl && SITE_CONFIG.aboutMaker) {
    aboutMakerEl.textContent = SITE_CONFIG.aboutMaker;
    aboutMakerEl.hidden = false;
  }

  wireFooterContact();
  document.getElementById("footer-year").textContent = new Date().getFullYear();
}

function initErrorPage() {
  initAnalytics();

  const defaultLink = whatsappLink(SITE_CONFIG.whatsappDefaultMessage);
  document.getElementById("header-whatsapp-link").href = defaultLink;
  document.getElementById("footer-whatsapp-link").href = defaultLink;
  document.getElementById("error-whatsapp-link").href = defaultLink;

  const instagramEl = document.getElementById("footer-instagram-link");
  if (SITE_CONFIG.instagramHandle) {
    instagramEl.href = `https://instagram.com/${SITE_CONFIG.instagramHandle}`;
  } else {
    instagramEl.style.display = "none";
  }

  wireFooterContact();
  document.getElementById("footer-year").textContent = new Date().getFullYear();

  trackEvent("404_hit", {
    page_path: location.pathname + location.search,
    referrer: document.referrer || "(direct)",
  });
}

// thank-you/index.html — the page wireWhatsAppTracking() sends people to
// right after they click any WhatsApp button (see comment there). Its own
// WhatsApp link is a fallback for the rare case the new tab didn't open.
function initThankYouPage() {
  initAnalytics();

  const defaultLink = whatsappLink(SITE_CONFIG.whatsappDefaultMessage);
  document.getElementById("header-whatsapp-link").href = defaultLink;
  document.getElementById("footer-whatsapp-link").href = defaultLink;
  document.getElementById("thankyou-whatsapp-link").href = defaultLink;

  const instagramEl = document.getElementById("footer-instagram-link");
  if (SITE_CONFIG.instagramHandle) {
    instagramEl.href = `https://instagram.com/${SITE_CONFIG.instagramHandle}`;
  } else {
    instagramEl.style.display = "none";
  }

  wireFooterContact();
  document.getElementById("footer-year").textContent = new Date().getFullYear();

  trackEvent("thank_you_view", {
    referrer: document.referrer || "(direct)",
  });
}

function wireSearch() {
  const input = document.getElementById("product-search");
  if (!input) return;
  let debounceTimer;
  input.addEventListener("input", () => {
    searchQuery = input.value;
    renderProducts();

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = searchQuery.trim();
      if (!q) return;
      const noResults = document.getElementById("no-results");
      trackEvent("search", {
        search_term: q,
        has_results: Boolean(noResults && noResults.hidden),
        page_path: location.pathname,
      });
    }, 600);
  });
}

// ---------------------------------------------------------------
// Category pages (categories/<slug>/index.html) — each is locked to one
// category and themed differently; no "All"/other-category chips,
// just that category's products, a search box, and a nav to the
// other 7 category pages.
// ---------------------------------------------------------------
function categorySlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// linkPrefix defaults to "../" for categories/<slug>/index.html calling
// this about its sibling category folders; products/<id>/index.html (one
// directory deeper than the categories it links to are relative to) passes
// "../../categories/" instead.
function renderCategoryNav(navId, currentCategory, linkPrefix = "../") {
  const nav = document.getElementById(navId);
  if (!nav || typeof CATEGORIES === "undefined") return;
  const links = CATEGORIES.map((c) => {
    const isCurrent = c === currentCategory;
    return isCurrent
      ? `<span class="category-nav-item current">${c}</span>`
      : `<a class="category-nav-item" href="${linkPrefix}${categorySlug(c)}/">${c}</a>`;
  }).join("");
  nav.innerHTML = `<a class="category-nav-item all" href="../../">All pieces</a>${links}`;
}

function initCategoryPage(categoryName, navId) {
  activeCategory = categoryName;
  pagePathPrefix = "../../";
  renderProducts();
  wireStaticLinks();
  wireSearch();
  if (navId) renderCategoryNav(navId, categoryName);
  if (categoryName === "Gift") wireGiftUnwrap();
}

// products/<id>/index.html — a single product's own page, statically generated
// by scripts/sync-products.mjs and styled by that product's category theme.
// Content (name/price/description/image) is already baked into the page;
// this just wires the same dynamic bits every page wires (WhatsApp links,
// footer contact info, nav).
function initProductPage(navId, categoryName) {
  const defaultLink = whatsappLink(SITE_CONFIG.whatsappDefaultMessage);
  document.getElementById("header-whatsapp-link").href = defaultLink;
  document.getElementById("footer-whatsapp-link").href = defaultLink;

  const productLink = document.getElementById("product-whatsapp-link");
  if (productLink) {
    const message = buildProductWhatsappMessage({
      link: location.href,
      name: productLink.dataset.productName,
      price: productLink.dataset.priceDisplay,
      description: productLink.dataset.description,
      customMessage: productLink.dataset.message,
    });
    productLink.href = whatsappLink(message);
  }

  const instagramEl = document.getElementById("footer-instagram-link");
  if (SITE_CONFIG.instagramHandle) {
    instagramEl.href = `https://instagram.com/${SITE_CONFIG.instagramHandle}`;
  } else {
    instagramEl.style.display = "none";
  }

  wireFooterContact();
  document.getElementById("footer-year").textContent = new Date().getFullYear();
  wireProductGallery();

  if (navId) renderCategoryNav(navId, categoryName, "../../categories/");
}

// index.html specifically: uses the same shared category-nav bar as every
// categories/*.html page, so the nav "part" of the page is identical
// everywhere — "All pieces" marked current since that's where everything
// is already shown, other categories link out to their themed page.
function renderHomeCategoryNav(navId) {
  const nav = document.getElementById(navId);
  if (!nav || typeof CATEGORIES === "undefined") return;

  const present = CATEGORIES.filter((c) =>
    PRODUCTS.some((p) => (p.categories || []).includes(c))
  );

  const links = present
    .map((c) => `<a class="category-nav-item" href="categories/${categorySlug(c)}/">${c}</a>`)
    .join("");
  nav.innerHTML = `<span class="category-nav-item all current">All pieces</span>${links}`;
}

// Pages call one of these after this script loads (index.html and every
// categories/*.html also call initAnalytics(); — see js/config.js):
//   renderHomeCategoryNav("category-nav"); renderProducts(); wireStaticLinks(); wireSearch(); initAnalytics();  (index.html — shared nav bar links out to themed category pages)
//   initCategoryPage("Gift", "category-nav"); initAnalytics();                     (categories/*.html — locked to one category)
//   initErrorPage();                                                              (404.html — also tracks the 404_hit event)
//   initThankYouPage();                                                           (thank-you/index.html — also tracks the thank_you_view event)
