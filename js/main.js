function whatsappLink(message) {
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
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
          <a class="btn btn-whatsapp" href="${whatsappLink(p.whatsappMessage)}" target="_blank" rel="noopener">Order on WhatsApp</a>
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

function wireSearch() {
  const input = document.getElementById("product-search");
  if (!input) return;
  input.addEventListener("input", () => {
    searchQuery = input.value;
    renderProducts();
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

// index.html specifically: chips are links out to each category's own
// themed page (categories/*.html), not an in-page filter — "All" stays
// on the homepage since that's where everything is already shown.
function renderHomeCategoryLinks() {
  const filters = document.getElementById("category-filters");
  if (!filters || typeof CATEGORIES === "undefined") return;

  const present = CATEGORIES.filter((c) =>
    PRODUCTS.some((p) => (p.categories || []).includes(c))
  );

  const allChip = `<span class="filter-chip active">All</span>`;
  const links = present
    .map((c) => `<a class="filter-chip" href="categories/${categorySlug(c)}.html">${c}</a>`)
    .join("");
  filters.innerHTML = allChip + links;
}

// Pages call one of these after this script loads:
//   renderHomeCategoryLinks(); renderProducts(); wireStaticLinks(); wireSearch();  (index.html — chips link out to themed category pages)
//   renderCategoryFilters(); renderProducts(); wireStaticLinks(); wireSearch();    (themes/ previews only — in-page filter, for comparing themes)
//   initCategoryPage("Gift", "category-nav");                                      (categories/*.html — locked to one category)
