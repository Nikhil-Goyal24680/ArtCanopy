function whatsappLink(message) {
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

function renderProducts() {
  const grid = document.getElementById("product-grid");
  grid.innerHTML = PRODUCTS.map((p) => `
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

renderProducts();
wireStaticLinks();
