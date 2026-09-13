function whatsappLink(message) {
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

// Formats "917878457307" as "+91 78784 57307" for footer display.
function formatPhoneDisplay(number) {
  return `+${number.slice(0, 2)} ${number.slice(2, 7)} ${number.slice(7)}`;
}

function wireFooterContact() {
  document.getElementById("footer-email-link").href = `mailto:${SITE_CONFIG.contactEmail}`;
  document.getElementById("footer-email-link").textContent = SITE_CONFIG.contactEmail;
  document.getElementById("footer-phone-link").href = `tel:+${SITE_CONFIG.whatsappNumber}`;
  document.getElementById("footer-phone-link").textContent = formatPhoneDisplay(SITE_CONFIG.whatsappNumber);
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
function wireWhatsAppTracking() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="https://wa.me/"]');
    if (!link) return;
    trackEvent("whatsapp_click", {
      link_location: link.id || "product_card",
      product_name: link.dataset.productName || "",
      page_path: location.pathname,
    });
  });
}

// Prefetches a local page's HTML the moment a pointer/touch shows intent to
// follow its link — by the time the click actually lands, the next page is
// usually already cached, so navigation feels instant instead of a fresh
// network round trip. Skips anything not a same-page local .html link
// (external sites, mailto:, tel:, wa.me) since those shouldn't be pre-fetched.
function wireLinkPrefetch() {
  const alreadyPrefetched = new Set();
  function schedule(link) {
    const href = link.getAttribute("href");
    if (!href || alreadyPrefetched.has(href)) return;
    if (!href.endsWith(".html") || /^([a-z]+:)?\/\//i.test(href)) return;
    alreadyPrefetched.add(href);
    const tag = document.createElement("link");
    tag.rel = "prefetch";
    tag.href = href;
    document.head.appendChild(tag);
  }
  document.addEventListener("mouseenter", (e) => {
    const link = e.target.closest && e.target.closest("a[href]");
    if (link) schedule(link);
  }, true);
  document.addEventListener("touchstart", (e) => {
    const link = e.target.closest && e.target.closest("a[href]");
    if (link) schedule(link);
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
// index.html sits next to images/ and products/; categories/*.html sit one
// level down. initCategoryPage() flips this before the first render on a
// category page so image/product-link paths resolve either way.
let pagePathPrefix = "";

// products/<id>*.html — clicking a gallery thumbnail swaps the main
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
    const detailHref = activeCategory === "All"
      ? `${pagePathPrefix}products/${p.id}.html`
      : `${pagePathPrefix}products/${p.id}--${categorySlug(activeCategory)}.html`;
    return `
    <article class="product-card">
      <a class="product-image placeholder" id="img-wrap-${p.id}" href="${detailHref}" aria-label="View ${p.name}">
        <span>Photo coming soon</span>
        <img
          src="${pagePathPrefix}images/${p.image}"
          ${p.imageSmall ? `srcset="${pagePathPrefix}images/${p.imageSmall} 600w, ${pagePathPrefix}images/${p.image} 1400w" sizes="(max-width: 480px) 90vw, 320px"` : ""}
          alt="${p.name}"
          loading="lazy"
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
          <span class="product-price">${p.price}</span>
          <a class="btn btn-whatsapp" href="${whatsappLink(p.whatsappMessage)}" target="_blank" rel="noopener" data-product-name="${p.name}">Order on WhatsApp</a>
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
// Category pages (categories/*.html) — each is locked to one
// category and themed differently; no "All"/other-category chips,
// just that category's products, a search box, and a nav to the
// other 7 category pages.
// ---------------------------------------------------------------
function categorySlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// linkPrefix defaults to "" for categories/*.html calling this about its
// sibling category pages; products/*.html (one directory deeper than the
// categories it links to are relative to) passes "../categories/" instead.
function renderCategoryNav(navId, currentCategory, linkPrefix = "") {
  const nav = document.getElementById(navId);
  if (!nav || typeof CATEGORIES === "undefined") return;
  const links = CATEGORIES.map((c) => {
    const isCurrent = c === currentCategory;
    return isCurrent
      ? `<span class="category-nav-item current">${c}</span>`
      : `<a class="category-nav-item" href="${linkPrefix}${categorySlug(c)}.html">${c}</a>`;
  }).join("");
  nav.innerHTML = `<a class="category-nav-item all" href="../index.html">All pieces</a>${links}`;
}

function initCategoryPage(categoryName, navId) {
  activeCategory = categoryName;
  pagePathPrefix = "../";
  renderProducts();
  wireStaticLinks();
  wireSearch();
  if (navId) renderCategoryNav(navId, categoryName);
  if (categoryName === "Gift") wireGiftUnwrap();
}

// products/<id>.html — a single product's own page, statically generated
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
    productLink.href = whatsappLink(productLink.dataset.message || SITE_CONFIG.whatsappDefaultMessage);
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

  if (navId) renderCategoryNav(navId, categoryName, "../categories/");
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
    .map((c) => `<a class="category-nav-item" href="categories/${categorySlug(c)}.html">${c}</a>`)
    .join("");
  nav.innerHTML = `<span class="category-nav-item all current">All pieces</span>${links}`;
}

// Pages call one of these after this script loads (index.html and every
// categories/*.html also call initAnalytics(); — see js/config.js):
//   renderHomeCategoryNav("category-nav"); renderProducts(); wireStaticLinks(); wireSearch(); initAnalytics();  (index.html — shared nav bar links out to themed category pages)
//   initCategoryPage("Gift", "category-nav"); initAnalytics();                     (categories/*.html — locked to one category)
//   initErrorPage();                                                              (404.html — also tracks the 404_hit event)
