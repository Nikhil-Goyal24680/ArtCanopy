// A real GPU fluid simulation in raw WebGL — no Three.js, no libraries.
// Same algorithm family as theme-15's CPU version (semi-Lagrangian
// advection + vorticity confinement) plus a real pressure-projection
// solve (Jacobi iteration) for proper incompressible flow, all running
// as fragment shader passes over ping-ponged framebuffers.
//
// NOTE: the numeric constants below (speeds, forces, dissipation) are
// starting estimates carried over from the tuned CPU version where the
// units line up — first-run visuals may need a tuning pass once seen live.
(function () {
  const canvas = document.getElementById("gpu-fluid-bg");
  const fallback = document.getElementById("webgl-fallback");

  function showFallback(reason) {
    console.warn("[theme-16-gpu-fluid]", reason);
    canvas.style.display = "none";
    fallback.hidden = false;
  }

  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false })
    || canvas.getContext("experimental-webgl", { alpha: false, antialias: false, depth: false, stencil: false });

  if (!gl) {
    showFallback("WebGL context could not be created.");
    return;
  }

  function testRenderTarget(type) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    return ok;
  }

  let floatType = null;
  let linearFilterSupported = false;
  const halfFloat = gl.getExtension("OES_texture_half_float");
  if (halfFloat && testRenderTarget(halfFloat.HALF_FLOAT_OES)) {
    floatType = halfFloat.HALF_FLOAT_OES;
    linearFilterSupported = !!gl.getExtension("OES_texture_half_float_linear");
  } else {
    const float = gl.getExtension("OES_texture_float");
    if (float && testRenderTarget(gl.FLOAT)) {
      floatType = gl.FLOAT;
      linearFilterSupported = !!gl.getExtension("OES_texture_float_linear");
    }
  }

  if (!floatType) {
    showFallback("No renderable float/half-float texture format available.");
    return;
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[theme-16-gpu-fluid] shader compile error:", gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function createProgram(vsSource, fsSource) {
    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[theme-16-gpu-fluid] program link error:", gl.getProgramInfoLog(program));
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  }

  const baseVertexShader = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const splatShader = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;
    void main () {
      vec2 p = vUv - point;
      p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + splat, 1.0);
    }
  `;

  const advectionShader = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;
    void main () {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
      gl_FragColor = dissipation * texture2D(uSource, coord);
    }
  `;

  const divergenceShader = `
    precision highp float;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;
      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
  `;

  const curlShader = `
    precision highp float;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }
  `;

  const vorticityShader = `
    precision highp float;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curlStrength;
    uniform float dt;
    void main () {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curlStrength * C;
      force.y *= -1.0;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity += force * dt;
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  const pressureShader = `
    precision highp float;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float div = texture2D(uDivergence, vUv).x;
      float pressure = (L + R + B + T - div) * 0.25;
      gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
  `;

  const gradientSubtractShader = `
    precision highp float;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity -= vec2(R - L, T - B) * 0.5;
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  const clearShader = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    void main () {
      gl_FragColor = value * texture2D(uTexture, vUv);
    }
  `;

  const displayShader = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main () {
      gl_FragColor = vec4(texture2D(uTexture, vUv).rgb, 1.0);
    }
  `;

  const splatProgram = createProgram(baseVertexShader, splatShader);
  const advectionProgram = createProgram(baseVertexShader, advectionShader);
  const divergenceProgram = createProgram(baseVertexShader, divergenceShader);
  const curlProgram = createProgram(baseVertexShader, curlShader);
  const vorticityProgram = createProgram(baseVertexShader, vorticityShader);
  const pressureProgram = createProgram(baseVertexShader, pressureShader);
  const gradientSubtractProgram = createProgram(baseVertexShader, gradientSubtractShader);
  const clearProgram = createProgram(baseVertexShader, clearShader);
  const displayProgram = createProgram(baseVertexShader, displayShader);

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function blit(target) {
    if (target == null) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function createFBO(w, h, filterLinear) {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const filter = filterLinear && linearFilterSupported ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, floatType, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture, fbo, width: w, height: h,
      attach(unit) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return unit;
      },
    };
  }

  function createDoubleFBO(w, h, filterLinear) {
    let fbo1 = createFBO(w, h, filterLinear);
    let fbo2 = createFBO(w, h, filterLinear);
    return {
      get read() { return fbo1; },
      get write() { return fbo2; },
      swap() { const t = fbo1; fbo1 = fbo2; fbo2 = t; },
    };
  }

  const SIM_RESOLUTION = 128;
  const DYE_RESOLUTION = 720;
  const PRESSURE_ITERATIONS = 20;
  const VELOCITY_DISSIPATION = 0.992;
  const DYE_DISSIPATION = 1.0; // no fade — paint persists and only moves/mixes via advection, matching the CPU version
  const PRESSURE_DISSIPATION = 0.85;
  const CURL_STRENGTH = 26;

  const PALETTE = [
    [30 / 255, 136 / 255, 130 / 255],
    [88 / 255, 60 / 255, 168 / 255],
    [214 / 255, 48 / 255, 122 / 255],
    [20 / 255, 110 / 255, 100 / 255],
    [168 / 255, 50 / 255, 120 / 255],
    [40 / 255, 90 / 255, 150 / 255],
  ];
  function paletteColor(t) {
    const n = PALETTE.length;
    const scaled = (((t % 1) + 1) % 1) * n;
    const i0 = Math.floor(scaled) % n;
    const i1 = (i0 + 1) % n;
    const f = scaled - Math.floor(scaled);
    const a = PALETTE[i0], b = PALETTE[i1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function getResolution(resolution) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
    const min = Math.round(resolution);
    const max = Math.round(resolution * aspectRatio);
    if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
    return { width: min, height: max };
  }

  let velocity, dye, divergenceFBO, curlFBO, pressure, texelSizeSim;

  function initFramebuffers() {
    const simRes = getResolution(SIM_RESOLUTION);
    const dyeRes = getResolution(DYE_RESOLUTION);
    texelSizeSim = [1 / simRes.width, 1 / simRes.height];
    velocity = createDoubleFBO(simRes.width, simRes.height, true);
    dye = createDoubleFBO(dyeRes.width, dyeRes.height, true);
    divergenceFBO = createFBO(simRes.width, simRes.height, false);
    curlFBO = createFBO(simRes.width, simRes.height, false);
    pressure = createDoubleFBO(simRes.width, simRes.height, false);
  }

  function resizeCanvasIfNeeded() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      initFramebuffers();
    }
  }

  resizeCanvasIfNeeded();

  function splat(x, y, dx, dy, color) {
    gl.useProgram(splatProgram.program);
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(splatProgram.uniforms.radius, 0.045);
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color[0], color[1], color[2]);
    gl.uniform1f(splatProgram.uniforms.radius, 0.035);
    blit(dye.write);
    dye.swap();
  }

  // seed the canvas with color right away so it never shows blank/base color
  let colorPhase = Math.random();
  (function seedInitialSplats() {
    for (let i = 0; i < 26; i++) {
      const x = Math.random();
      const y = Math.random();
      const angle = Math.random() * Math.PI * 2;
      const force = 4 + Math.random() * 4;
      colorPhase += 0.12 + Math.random() * 0.1;
      splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, paletteColor(colorPhase));
    }
  })();

  function simulationStep(dt) {
    gl.disable(gl.BLEND);

    gl.useProgram(curlProgram.program);
    gl.uniform2f(curlProgram.uniforms.texelSize, texelSizeSim[0], texelSizeSim[1]);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curlFBO);

    gl.useProgram(vorticityProgram.program);
    gl.uniform2f(vorticityProgram.uniforms.texelSize, texelSizeSim[0], texelSizeSim[1]);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curlStrength, CURL_STRENGTH);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    gl.useProgram(divergenceProgram.program);
    gl.uniform2f(divergenceProgram.uniforms.texelSize, texelSizeSim[0], texelSizeSim[1]);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergenceFBO);

    gl.useProgram(clearProgram.program);
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, PRESSURE_DISSIPATION);
    blit(pressure.write);
    pressure.swap();

    gl.useProgram(pressureProgram.program);
    gl.uniform2f(pressureProgram.uniforms.texelSize, texelSizeSim[0], texelSizeSim[1]);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergenceFBO.attach(0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    gl.useProgram(gradientSubtractProgram.program);
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, texelSizeSim[0], texelSizeSim[1]);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    gl.useProgram(advectionProgram.program);
    gl.uniform2f(advectionProgram.uniforms.texelSize, texelSizeSim[0], texelSizeSim[1]);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, velocity.read.attach(0));
    gl.uniform1f(advectionProgram.uniforms.dissipation, VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, DYE_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  // run the sim silently for a bit so it's already swirled by the first
  // visible frame, instead of showing the raw seed splats
  for (let i = 0; i < 90; i++) simulationStep(1 / 60);

  let lastPointer = null;
  let pendingPointer = null;
  window.addEventListener("pointermove", (e) => {
    pendingPointer = { x: e.clientX / window.innerWidth, y: 1 - e.clientY / window.innerHeight };
  });

  function applyPointer() {
    if (!pendingPointer) return;
    const p = pendingPointer;
    if (lastPointer) {
      const dx = p.x - lastPointer.x;
      const dy = p.y - lastPointer.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.0005) {
        colorPhase += dist * 1.2;
        splat(p.x, p.y, dx * 22, dy * 22, paletteColor(colorPhase).map((c) => c * Math.min(1, dist * 18)));
      }
    }
    lastPointer = p;
  }

  let frame = 0;
  function maybeResplash() {
    frame++;
    if (frame % 260 === 0) {
      colorPhase += 0.15 + Math.random() * 0.2;
      const angle = Math.random() * Math.PI * 2;
      splat(Math.random(), Math.random(), Math.cos(angle) * 3, Math.sin(angle) * 3, paletteColor(colorPhase).map((c) => c * 0.6));
    }
  }

  function render() {
    gl.useProgram(displayProgram.program);
    gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
    blit(null);
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion) {
    render();
  } else {
    let lastTime = null;
    function tick(now) {
      if (lastTime == null) lastTime = now;
      const dt = Math.min((now - lastTime) / 1000, 1 / 30);
      lastTime = now;

      resizeCanvasIfNeeded();
      applyPointer();
      maybeResplash();
      simulationStep(dt);
      render();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
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
      const c = PALETTE[i % PALETTE.length].map((v) => Math.round(v * 255));
      ripple.style.background = `radial-gradient(circle, rgba(${c[0]},${c[1]},${c[2]},0.35), rgba(${c[0]},${c[1]},${c[2]},0) 70%)`;
      ripple.style.borderColor = `rgba(${c[0]},${c[1]},${c[2]},0.4)`;
      card.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  });
})();
