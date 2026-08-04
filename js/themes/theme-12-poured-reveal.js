// Staggers a "poured resin" fill-reveal on each product card as it scrolls into view.
// Runs after main.js has already rendered #product-grid.
(function () {
  const cards = document.querySelectorAll(".product-card");

  cards.forEach((card, i) => {
    card.style.setProperty("--delay", `${(i % 6) * 90}ms`);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("poured");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.25 }
  );

  cards.forEach((card) => observer.observe(card));
})();
