// A full-page canvas of slow-drifting, glowing resin-colored blobs that blend
// into each other where they overlap. Moving the cursor stirs them into a
// gentle vortex instead of just having them chase the pointer directly.
// Clicking a product card still sends out an ink-drop ripple.
(function () {
  const canvas = document.getElementById("liquid-bg");
  const ctx = canvas.getContext("2d");

  const COLORS = [
    "#f0a94f", // amber
    "#e0568f", // rose
    "#34d1b5", // teal
    "#8b5cf6", // violet
    "#f4c542", // gold
    "#ff7a59", // coral
  ];

  let width, height, dpr;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  const blobCount = window.innerWidth < 700 ? 4 : 6;
  const blobs = Array.from({ length: blobCount }, (_, i) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.min(width, height) * (0.22 + Math.random() * 0.14),
    color: COLORS[i % COLORS.length],
    phase: Math.random() * Math.PI * 2,
  }));

  const mouse = { x: width / 2, y: height / 2, active: false };
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });
  window.addEventListener("mouseleave", () => { mouse.active = false; });

  let t = 0;
  function tick() {
    t += 0.006;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "screen";

    blobs.forEach((b) => {
      // gentle ambient drift so the scene is alive even without input
      b.vx += Math.cos(t + b.phase) * 0.01;
      b.vy += Math.sin(t + b.phase) * 0.01;

      if (mouse.active) {
        const dx = mouse.x - b.x;
        const dy = mouse.y - b.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        // swirl: pull toward the cursor, plus a perpendicular component so
        // blobs orbit and mix rather than collapsing straight into the point
        const pull = Math.min(120 / dist, 0.9);
        b.vx += (dx / dist) * pull * 0.06 - (dy / dist) * pull * 0.05;
        b.vy += (dy / dist) * pull * 0.06 + (dx / dist) * pull * 0.05;
      }

      // damping keeps speeds from running away
      b.vx *= 0.965;
      b.vy *= 0.965;
      const speed = Math.hypot(b.vx, b.vy);
      const maxSpeed = 2.2;
      if (speed > maxSpeed) {
        b.vx = (b.vx / speed) * maxSpeed;
        b.vy = (b.vy / speed) * maxSpeed;
      }

      b.x += b.vx;
      b.y += b.vy;

      const pad = b.r * 0.3;
      if (b.x < -pad) b.x = width + pad;
      if (b.x > width + pad) b.x = -pad;
      if (b.y < -pad) b.y = height + pad;
      if (b.y > height + pad) b.y = -pad;

      const gradient = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      gradient.addColorStop(0, b.color + "cc");
      gradient.addColorStop(0.6, b.color + "55");
      gradient.addColorStop(1, b.color + "00");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(tick);
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!prefersReducedMotion) {
    tick();
  } else {
    // draw one static frame so the background still has color, then stop
    blobs.forEach((b) => {
      const gradient = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      gradient.addColorStop(0, b.color + "cc");
      gradient.addColorStop(1, b.color + "00");
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  document.querySelectorAll(".product-card").forEach((card, i) => {
    card.style.position = "relative";
    card.style.overflow = "hidden";

    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // let the WhatsApp link behave normally
      const rect = card.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ink-ripple";
      ripple.style.left = `${e.clientX - rect.left}px`;
      ripple.style.top = `${e.clientY - rect.top}px`;
      ripple.style.background = `radial-gradient(circle, ${COLORS[i % COLORS.length]}55, ${COLORS[i % COLORS.length]}00 70%)`;
      ripple.style.borderColor = `${COLORS[i % COLORS.length]}66`;
      card.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  });
})();
