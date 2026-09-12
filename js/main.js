function whatsappLink(message) {
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
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

let activeCategory = "All";
let searchQuery = "";

function renderCategoryFilters() {
  const filters = document.getElementById("category-filters");
  if (!filters || typeof CATEGORIES === "undefined") return;

  const present = CATEGORIES.filter((c) =>
    PRODUCTS.some((p) => (p.categories || []).includes(c))
  );
  const chips = ["All", ...present];

  filters.innerHTML = chips
    .map(
      (c) => `
    <button class="filter-chip${c === activeCategory ? " active" : ""}" data-category="${c}">${c}</button>
  `
    )
    .join("");

  filters.querySelectorAll(".filter-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category;
      renderCategoryFilters();
      renderProducts();
    });
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

  grid.innerHTML = visible.map((p) => `
    <article class="product-card">
      <div class="product-image placeholder" id="img-wrap-${p.id}">
        <span>Photo coming soon</span>
        <img
          src="images/${p.image}"
          ${p.imageSmall ? `srcset="images/${p.imageSmall} 600w, images/${p.image} 1400w" sizes="(max-width: 480px) 90vw, 320px"` : ""}
          alt="${p.name}"
          loading="lazy"
          onload="this.closest('.product-image').classList.remove('placeholder'); this.classList.add('loaded')"
          onerror="this.remove()"
        >
      </div>
      <div class="product-body">
        <h3>${p.name}</h3>
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
  `).join("");
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

function renderCategoryNav(navId, currentCategory) {
  const nav = document.getElementById(navId);
  if (!nav || typeof CATEGORIES === "undefined") return;
  const links = CATEGORIES.map((c) => {
    const isCurrent = c === currentCategory;
    return isCurrent
      ? `<span class="category-nav-item current">${c}</span>`
      : `<a class="category-nav-item" href="${categorySlug(c)}.html">${c}</a>`;
  }).join("");
  nav.innerHTML = `<a class="category-nav-item all" href="../index.html">All pieces</a>${links}`;
}

function initCategoryPage(categoryName, navId) {
  activeCategory = categoryName;
  renderProducts();
  wireStaticLinks();
  wireSearch();
  if (navId) renderCategoryNav(navId, categoryName);
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
//   renderCategoryFilters(); renderProducts(); wireStaticLinks(); wireSearch();    (themes/ previews only — in-page filter, for comparing themes)
//   initCategoryPage("Gift", "category-nav"); initAnalytics();                     (categories/*.html — locked to one category)
//   initErrorPage();                                                              (404.html — also tracks the 404_hit event)
