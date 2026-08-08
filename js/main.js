function whatsappLink(message) {
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

let activeCategory = "All";

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
  const visible =
    activeCategory === "All"
      ? PRODUCTS
      : PRODUCTS.filter((p) => (p.categories || []).includes(activeCategory));

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

renderCategoryFilters();
renderProducts();
wireStaticLinks();
