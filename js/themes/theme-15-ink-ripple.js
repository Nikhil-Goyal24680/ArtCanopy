// A real (lightweight) fluid simulation: a low-resolution velocity field and
// a color/dye field, advected each frame (semi-Lagrangian, the core idea
// behind "stable fluids" — the same technique behind those Van Gogh-style
// fluid demos). The page loads already fully covered in marbled color,
// moving the pointer stirs a velocity field that swirls the paint through
// itself and leaves fresh color behind it, like a finger dragged through
// wet paint. No WebGL needed — it runs on plain canvas + typed arrays.
(function () {
  const canvas = document.getElementById("liquid-bg");
  const ctx = canvas.getContext("2d");

  const isSmall = window.innerWidth < 700;
  const simW = isSmall ? 110 : 168;
  const simH = isSmall ? 62 : 94;
  const N = simW * simH;

  const PALETTE = [
    [240, 169, 79],  // amber
    [224, 86, 143],  // rose
    [52, 209, 181],  // teal
    [139, 92, 246],  // violet
    [244, 197, 66],  // gold
    [255, 122, 89],  // coral
  ];

  function lerpColor(a, b, f) {
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function paletteColor(t) {
    const n = PALETTE.length;
    const scaled = ((t % 1) + 1) % 1 * n;
    const i0 = Math.floor(scaled) % n;
    const i1 = (i0 + 1) % n;
    return lerpColor(PALETTE[i0], PALETTE[i1], scaled - Math.floor(scaled));
  }

  let vx = new Float32Array(N);
  let vy = new Float32Array(N);
  let nvx = new Float32Array(N);
  let nvy = new Float32Array(N);
  let dye = new Uint8ClampedArray(N * 4);
  let ndye = new Uint8ClampedArray(N * 4);

  // paint the whole grid with a smooth, randomized marbled color field —
  // "spilled all over the page," not a few tidy blobs, with no blank gaps
  (function seedDye() {
    const f1 = 0.05 + Math.random() * 0.04;
    const f2 = 0.05 + Math.random() * 0.04;
    const f3 = 0.04 + Math.random() * 0.03;
    const f4 = 0.04 + Math.random() * 0.03;
    const f5 = 0.03 + Math.random() * 0.03;
    const phase = Math.random() * Math.PI * 2;
    for (let y = 0; y < simH; y++) {
      for (let x = 0; x < simW; x++) {
        const v =
          Math.sin(x * f1 + y * f2 + phase) +
          Math.cos(x * f3 - y * f4) +
          Math.sin((x + y) * f5);
        const t = (v + 3) / 6;
        const [r, g, b] = paletteColor(t);
        const idx = (y * simW + x) * 4;
        dye[idx] = r; dye[idx + 1] = g; dye[idx + 2] = b; dye[idx + 3] = 255;
      }
    }
  })();

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function sampleScalar(field, x, y) {
    x = clamp(x, 0, simW - 1.001);
    y = clamp(y, 0, simH - 1.001);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0 + 1, y1 = y0 + 1;
    const sx = x - x0, sy = y - y0;
    const v00 = field[y0 * simW + x0], v10 = field[y0 * simW + x1];
    const v01 = field[y1 * simW + x0], v11 = field[y1 * simW + x1];
    return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
  }

  function sampleDyeChannel(x, y, c) {
    x = clamp(x, 0, simW - 1.001);
    y = clamp(y, 0, simH - 1.001);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0 + 1, y1 = y0 + 1;
    const sx = x - x0, sy = y - y0;
    const i00 = (y0 * simW + x0) * 4 + c, i10 = (y0 * simW + x1) * 4 + c;
    const i01 = (y1 * simW + x0) * 4 + c, i11 = (y1 * simW + x1) * 4 + c;
    return (dye[i00] * (1 - sx) + dye[i10] * sx) * (1 - sy) + (dye[i01] * (1 - sx) + dye[i11] * sx) * sy;
  }

  function splatVelocity(cx, cy, fx, fy, radius) {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(simW - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(simH - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = Math.exp(-d2 / (r2 * 0.5));
        const idx = y * simW + x;
        vx[idx] += fx * falloff;
        vy[idx] += fy * falloff;
      }
    }
  }

  function splatDye(cx, cy, color, radius, strength) {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(simW - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(simH - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = Math.exp(-d2 / (r2 * 0.5)) * strength;
        const idx = (y * simW + x) * 4;
        dye[idx] = dye[idx] * (1 - falloff) + color[0] * falloff;
        dye[idx + 1] = dye[idx + 1] * (1 - falloff) + color[1] * falloff;
        dye[idx + 2] = dye[idx + 2] * (1 - falloff) + color[2] * falloff;
      }
    }
  }

  const DT = 1.1;
  function step() {
    for (let y = 0; y < simH; y++) {
      for (let x = 0; x < simW; x++) {
        const idx = y * simW + x;
        const px = x - vx[idx] * DT;
        const py = y - vy[idx] * DT;
        nvx[idx] = sampleScalar(vx, px, py) * 0.994;
        nvy[idx] = sampleScalar(vy, px, py) * 0.994;
      }
    }
    let tmp = vx; vx = nvx; nvx = tmp;
    tmp = vy; vy = nvy; nvy = tmp;

    for (let y = 0; y < simH; y++) {
      for (let x = 0; x < simW; x++) {
        const idx = y * simW + x;
        const px = x - vx[idx] * DT;
        const py = y - vy[idx] * DT;
        const o = idx * 4;
        ndye[o] = sampleDyeChannel(px, py, 0);
        ndye[o + 1] = sampleDyeChannel(px, py, 1);
        ndye[o + 2] = sampleDyeChannel(px, py, 2);
        ndye[o + 3] = 255;
      }
    }
    tmp = dye; dye = ndye; ndye = tmp;
  }

  // a couple of slow fixed gyres so the paint keeps drifting even when idle
  const gyres = [
    { x: simW * 0.3, y: simH * 0.35, r: Math.min(simW, simH) * 0.35, dir: 1, speed: 0.6 },
    { x: simW * 0.7, y: simH * 0.65, r: Math.min(simW, simH) * 0.32, dir: -1, speed: 0.5 },
  ];
  function applyGyres(t) {
    gyres.forEach((g) => {
      const angle = t * g.speed * g.dir;
      const fx = Math.cos(angle) * 0.35;
      const fy = Math.sin(angle) * 0.35;
      splatVelocity(g.x, g.y, fx, fy, g.r);
    });
  }

  let colorPhase = Math.random();
  let lastPointer = null;
  let pendingPointer = null;

  function toSim(clientX, clientY) {
    return {
      x: (clientX / window.innerWidth) * simW,
      y: (clientY / window.innerHeight) * simH,
    };
  }

  window.addEventListener("pointermove", (e) => {
    pendingPointer = toSim(e.clientX, e.clientY);
  });

  function applyPointer() {
    if (!pendingPointer) return;
    const p = pendingPointer;
    if (lastPointer) {
      const dx = p.x - lastPointer.x;
      const dy = p.y - lastPointer.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.05) {
        splatVelocity(p.x, p.y, dx * 2.6, dy * 2.6, 9);
        if (dist > 0.3) {
          colorPhase += dist * 0.01;
          splatDye(p.x, p.y, paletteColor(colorPhase), 6, Math.min(0.5, dist * 0.05));
        }
      }
    }
    lastPointer = p;
  }

  let frame = 0;
  function maybeResplash() {
    frame++;
    if (frame % 340 === 0) {
      const cx = Math.random() * simW;
      const cy = Math.random() * simH;
      colorPhase += 0.15 + Math.random() * 0.2;
      splatDye(cx, cy, paletteColor(colorPhase), Math.min(simW, simH) * 0.22, 0.35);
    }
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = simW;
  offscreen.height = simH;
  const offCtx = offscreen.getContext("2d");

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
  }
  window.addEventListener("resize", resize);
  resize();

  function render() {
    const imageData = new ImageData(dye, simW, simH);
    offCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0, simW, simH, 0, 0, canvas.width, canvas.height);
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion) {
    render();
  } else {
    let t = 0;
    (function tick() {
      t += 0.01;
      applyPointer();
      applyGyres(t);
      maybeResplash();
      step();
      render();
      requestAnimationFrame(tick);
    })();
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
      const c = PALETTE[i % PALETTE.length];
      ripple.style.background = `radial-gradient(circle, rgba(${c[0]},${c[1]},${c[2]},0.35), rgba(${c[0]},${c[1]},${c[2]},0) 70%)`;
      ripple.style.borderColor = `rgba(${c[0]},${c[1]},${c[2]},0.4)`;
      card.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  });
})();
