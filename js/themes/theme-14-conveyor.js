// Duplicates the rendered product cards once so the CSS marquee (-50% translateX)
// loops seamlessly, then pauses the belt whenever the cursor is over any card.
(function () {
  const grid = document.getElementById("product-grid");
  const originalCards = Array.from(grid.children);

  originalCards.forEach((card) => {
    const clone = card.cloneNode(true);
    clone.setAttribute("aria-hidden", "true");
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    grid.appendChild(clone);
  });

  const track = document.querySelector(".conveyor-track");
  grid.addEventListener("mouseenter", () => track.classList.add("paused"), true);
  grid.addEventListener("mouseleave", () => track.classList.remove("paused"), true);
})();
