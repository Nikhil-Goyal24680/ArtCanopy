// A soft glowing "ink" blob that trails the cursor with a lazy delay, plus a
// droplet-ripple that spreads out from wherever a product card is clicked.
(function () {
  const glow = document.getElementById("cursor-glow");
  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let x = targetX;
  let y = targetY;

  window.addEventListener("mousemove", (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
    glow.style.opacity = "1";
  });

  function raf() {
    x += (targetX - x) * 0.08;
    y += (targetY - y) * 0.08;
    glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    requestAnimationFrame(raf);
  }
  raf();

  document.querySelectorAll(".product-card").forEach((card) => {
    card.style.position = "relative";
    card.style.overflow = "hidden";

    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // let the WhatsApp link behave normally
      const rect = card.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ink-ripple";
      ripple.style.left = `${e.clientX - rect.left}px`;
      ripple.style.top = `${e.clientY - rect.top}px`;
      card.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  });
})();
