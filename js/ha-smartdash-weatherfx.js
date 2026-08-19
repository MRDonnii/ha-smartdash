// Full-screen ambient overlay reflecting the current weather condition,
// sitting behind the dashboard's own (already translucent) cards -- see
// ha-smartdash-app.js's shell markup, where the canvas is a sibling placed
// before .beast-app and stacked underneath it with z-index. Off by
// default; toggled under Admin -> Tema og design.
//
// Every native HA weather condition gets its own distinct look rather than
// a shared "rain or snow" bucket: stars at night, a sun glow when clear,
// drifting clouds, fog bands, wind gusts, rain (light/heavy), hail, snow,
// sleet (rain+snow together), and lightning flashes layered on top of
// storm conditions.
const BeastWeatherFx = (() => {
  // Each condition maps to a tint (a very low-opacity full-canvas wash --
  // this sits behind translucent cards, so it must stay subtle) plus a set
  // of particle-layer builders and whether lightning flashes are active.
  const CONDITION_EFFECTS = {
    "clear-night": { tint: "night", layers: ["stars"] },
    sunny: { tint: "sun", layers: ["sunGlow"] },
    partlycloudy: { tint: "day", layers: ["sunGlow", "clouds"] },
    cloudy: { tint: "overcast", layers: ["clouds", "clouds"] },
    fog: { tint: "overcast", layers: ["fog"] },
    windy: { tint: "day", layers: ["clouds", "wind"] },
    "windy-variant": { tint: "day", layers: ["clouds", "wind"] },
    rainy: { tint: "rain", layers: ["rain"] },
    pouring: { tint: "storm", layers: ["rainHeavy"] },
    lightning: { tint: "storm", layers: ["clouds"], flash: true },
    "lightning-rainy": { tint: "storm", layers: ["rain"], flash: true },
    hail: { tint: "storm", layers: ["hail"] },
    snowy: { tint: "snow", layers: ["snow"] },
    "snowy-rainy": { tint: "snow", layers: ["rainLight", "snowLight"] }
  };

  const TINTS = {
    day: null,
    night: (w, h) => { const g = mkGrad(0, 0, 0, h); g.addColorStop(0, "rgba(10,18,45,0.16)"); g.addColorStop(1, "rgba(10,18,45,0)"); return g; },
    sun: (w, h) => { const g = ctx.createRadialGradient(w * 0.82, h * 0.12, 0, w * 0.82, h * 0.12, Math.max(w, h) * 0.5); g.addColorStop(0, "rgba(255,214,140,0.14)"); g.addColorStop(1, "rgba(255,214,140,0)"); return g; },
    overcast: (w, h) => { const g = mkGrad(0, 0, 0, h); g.addColorStop(0, "rgba(140,150,165,0.10)"); g.addColorStop(1, "rgba(140,150,165,0.03)"); return g; },
    rain: (w, h) => { const g = mkGrad(0, 0, 0, h); g.addColorStop(0, "rgba(70,90,120,0.10)"); g.addColorStop(1, "rgba(70,90,120,0.04)"); return g; },
    storm: (w, h) => { const g = mkGrad(0, 0, 0, h); g.addColorStop(0, "rgba(40,50,70,0.20)"); g.addColorStop(1, "rgba(40,50,70,0.06)"); return g; },
    // The only wash that's near-white; on a pale background it washed out
    // completely, so it takes the same cool-but-darker treatment as the
    // snow particles themselves (see COLORS below). The rest are already
    // dark or saturated enough to read against either background.
    snow: (w, h) => { const g = mkGrad(0, 0, 0, h); const rgb = palette().snowTint; g.addColorStop(0, `rgba(${rgb},0.10)`); g.addColorStop(1, `rgba(${rgb},0.02)`); return g; }
  };

  function mkGrad(x0, y0, x1, y1) { return ctx.createLinearGradient(x0, y0, x1, y1); }

  // Every particle was drawn in white or near-white, which only reads
  // against a dark surface -- in the light theme the whole effect was
  // invisible rather than absent. Each colour therefore has a light-theme
  // counterpart: the same material, dark enough to show on a pale
  // background (rain stays blue, cloud/fog stay neutral grey, snow keeps a
  // cool cast) at the same opacities, so the effect reads identically in
  // both themes without a second set of tuning values.
  const COLORS = {
    dark: {
      star: "rgba(255,255,255,1)", cloud: "rgba(222,227,236,1)", fog: "210,215,220",
      wind: "rgba(255,255,255,1)", rain: "rgba(200,220,255,1)", hail: "rgba(225,235,245,1)",
      snow: "rgba(255,255,255,1)", wetGround: "110,150,205", snowBank: "245,250,255",
      splash: "rgba(205,225,255,1)", settledSnow: "rgba(250,253,255,1)", flash: "255,255,255",
      snowTint: "210,225,245"
    },
    light: {
      star: "rgba(86,104,145,1)", cloud: "rgba(126,141,166,1)", fog: "118,130,148",
      wind: "rgba(92,108,136,1)", rain: "rgba(56,96,158,1)", hail: "rgba(96,116,148,1)",
      snow: "rgba(132,156,192,1)", wetGround: "62,98,150", snowBank: "150,174,206",
      splash: "rgba(66,104,164,1)", settledSnow: "rgba(158,180,210,1)", flash: "70,96,150",
      snowTint: "96,128,178"
    }
  };

  // Resolved by ha-smartdash-theme.js onto <html data-color-mode>, which is
  // also what "auto" resolves to -- so this follows a time-of-day switch
  // without needing to know about the mode itself.
  function palette() {
    return document.documentElement.dataset.colorMode === "light" ? COLORS.light : COLORS.dark;
  }

  let canvas = null;
  let ambientCanvas = null;
  let ctx = null;
  let particles = [];
  let impacts = [];
  let currentCondition = null;
  let activeConfig = null;
  let width = 0;
  let height = 0;
  let reducedMotion = false;
  let weatherEntityId = null;
  let flashIntensity = 0;
  let nextFlashAt = 0;
  let unsubscribeWeather = null;

  function enabled() {
    return BeastConfig.get("features.weatherOverlay") === true;
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    if (canvas) { canvas.width = width; canvas.height = height; }
    if (ambientCanvas) { ambientCanvas.width = width; ambientCanvas.height = height; }
  }

  // Dashboard and screensaver are never visible at once, so rather than
  // running the whole particle simulation twice (each drawParticle() call
  // both paints AND steps that particle's position -- running it against
  // two canvases every frame would advance every particle's physics
  // twice as fast), tick() just points the single shared ctx at whichever
  // canvas is actually on screen right now.
  function activeCanvas() {
    return (document.body.classList.contains("beast-is-ambient") && ambientCanvas) ? ambientCanvas : canvas;
  }

  function density(perPixels, cap) {
    return Math.min(cap, Math.max(6, Math.round((width * height) / perPixels)));
  }

  const LAYER_BUILDERS = {
    stars: () => Array.from({ length: density(9000, 70) }, () => ({
      kind: "star", x: Math.random() * width, y: Math.random() * height * 0.75,
      r: 0.6 + Math.random() * 1.3, phase: Math.random() * Math.PI * 2, speed: 0.01 + Math.random() * 0.02
    })),
    sunGlow: () => [],
    clouds: () => Array.from({ length: density(70000, 10) }, () => {
      const w = 90 + Math.random() * 140;
      const h = 24 + Math.random() * 20;
      // A handful of overlapping puffs (offset within the cloud's own
      // bounds) reads as a soft, irregular cloud shape once blurred --
      // a single gradient ellipse showed a hard, scalloped edge instead.
      const puffs = Array.from({ length: 3 + Math.floor(Math.random() * 2) }, () => ({
        dx: (Math.random() - 0.5) * w * 0.7, dy: (Math.random() - 0.5) * h * 0.6, r: h * (0.55 + Math.random() * 0.35)
      }));
      return { kind: "cloud", x: Math.random() * width, y: 20 + Math.random() * height * 0.35, w, h, puffs, speed: 0.12 + Math.random() * 0.25, opacity: 0.06 + Math.random() * 0.08 };
    }),
    fog: () => Array.from({ length: 4 }, (_, i) => ({
      kind: "fog", x: Math.random() * width, y: (height / 4) * i + Math.random() * 40,
      w: width * 1.4, h: 60 + Math.random() * 40, speed: (i % 2 ? 1 : -1) * (0.15 + Math.random() * 0.15), opacity: 0.05 + Math.random() * 0.05
    })),
    wind: () => Array.from({ length: density(12000, 60) }, () => ({
      kind: "wind", x: Math.random() * width, y: Math.random() * height,
      len: 20 + Math.random() * 30, speed: 6 + Math.random() * 5, opacity: 0.08 + Math.random() * 0.1
    })),
    rain: () => rainDrops(density(5200, 240), 8, 6, 12, 16, 0.14, 0.2),
    rainLight: () => rainDrops(density(10000, 120), 7, 5, 9, 12, 0.12, 0.16),
    rainHeavy: () => rainDrops(density(3600, 320), 12, 7, 16, 20, 0.18, 0.26),
    hail: () => Array.from({ length: density(12000, 60) }, () => ({
      kind: "hail", x: Math.random() * width, y: Math.random() * height,
      r: 1.8 + Math.random() * 1.6, speed: 9 + Math.random() * 5, opacity: 0.3 + Math.random() * 0.25
    })),
    snow: () => snowFlakes(density(14000, 90), 1.5, 2.5, 0.6, 1.2),
    snowLight: () => snowFlakes(density(22000, 50), 1.3, 2.2, 0.5, 1.0),
    // Droplets clinging to the screen as if it were a window pane, rather
    // than rain falling behind it. Most just sit and quiver; a drop only
    // starts running once it's grown heavy enough, which is what makes the
    // effect read as glass rather than as slow rain -- so radius doubles as
    // "weight" here, and sliding drops leave a shrinking trail behind them.
  };




  function rainDrops(count, speedBase, speedRange, lenBase, lenRange, opBase, opRange) {
    return Array.from({ length: count }, () => ({
      kind: "rain", x: Math.random() * width, y: Math.random() * height,
      len: lenBase + Math.random() * lenRange, speed: speedBase + Math.random() * speedRange,
      drift: 1.2, opacity: opBase + Math.random() * opRange
    }));
  }

  function snowFlakes(count, rMin, rRange, speedMin, speedRange) {
    return Array.from({ length: count }, () => ({
      kind: "snow", x: Math.random() * width, y: Math.random() * height,
      r: rMin + Math.random() * rRange, speed: speedMin + Math.random() * speedRange,
      drift: Math.random() * 0.6 - 0.3, sway: Math.random() * Math.PI * 2, opacity: 0.25 + Math.random() * 0.35
    }));
  }

  function drawParticle(p) {
    if (p.kind === "star") {
      p.phase += p.speed;
      ctx.globalAlpha = 0.35 + Math.sin(p.phase) * 0.25;
      ctx.fillStyle = palette().star;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (p.kind === "cloud") {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = palette().cloud;
      ctx.filter = "blur(14px)";
      p.puffs.forEach((puff) => {
        ctx.beginPath();
        ctx.arc(p.x + puff.dx, p.y + puff.dy, puff.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.filter = "none";
      p.x += p.speed;
      if (p.x - p.w > width) p.x = -p.w;
      return;
    }
    if (p.kind === "fog") {
      ctx.globalAlpha = p.opacity;
      const grad = ctx.createLinearGradient(p.x - p.w / 2, 0, p.x + p.w / 2, 0);
      const fog = palette().fog;
      grad.addColorStop(0, `rgba(${fog},0)`); grad.addColorStop(0.5, `rgba(${fog},1)`); grad.addColorStop(1, `rgba(${fog},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(p.x - p.w / 2, p.y, p.w, p.h);
      p.x += p.speed;
      if (p.speed > 0 && p.x - p.w / 2 > width) p.x = -p.w / 2;
      if (p.speed < 0 && p.x + p.w / 2 < 0) p.x = width + p.w / 2;
      return;
    }
    if (p.kind === "wind") {
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = palette().wind; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.len, p.y - 2); ctx.stroke();
      p.x += p.speed;
      if (p.x > width) { p.x = -p.len; p.y = Math.random() * height; }
      return;
    }
    if (p.kind === "rain") {
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = palette().rain; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.drift * 2, p.y + p.len); ctx.stroke();
      p.y += p.speed; p.x -= p.drift;
      if (p.y > height) {
        impacts.push({ kind: "rainSplash", x: p.x, y: height - 2, age: 0, life: 18 + Math.random() * 12 });
        if (impacts.length > 90) impacts.shift();
        p.y = -p.len; p.x = Math.random() * width;
      }
      if (p.x < -10) p.x = width + 10;
      return;
    }
    if (p.kind === "hail") {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = palette().hail;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      p.y += p.speed;
      if (p.y > height) { p.y = -p.r; p.x = Math.random() * width; }
      return;
    }
    if (p.kind === "snow") {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = palette().snow;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      p.sway += 0.02; p.y += p.speed; p.x += p.drift + Math.sin(p.sway) * 0.4;
      if (p.y > height) {
        impacts.push({ kind: "settledSnow", x: p.x, y: height - 1 - Math.random() * 9, r: p.r * (0.7 + Math.random() * 0.6), opacity: p.opacity * 0.8, age: 0, life: 900 + Math.random() * 900 });
        if (impacts.filter((item) => item.kind === "settledSnow").length > 120) impacts.splice(impacts.findIndex((item) => item.kind === "settledSnow"), 1);
        p.y = -p.r; p.x = Math.random() * width;
      }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
    }
  }

  function drawGroundEffects() {
    const raining = particles.some((particle) => particle.kind === "rain");
    const snowing = particles.some((particle) => particle.kind === "snow");
    if (raining) {
      const wet = ctx.createLinearGradient(0, height - 28, 0, height);
      const wetRgb = palette().wetGround;
      wet.addColorStop(0, `rgba(${wetRgb},0)`);
      wet.addColorStop(1, `rgba(${wetRgb},0.11)`);
      ctx.globalAlpha = 1; ctx.fillStyle = wet; ctx.fillRect(0, height - 28, width, 28);
    }
    if (snowing) {
      const bank = ctx.createLinearGradient(0, height - 18, 0, height);
      const bankRgb = palette().snowBank;
      bank.addColorStop(0, `rgba(${bankRgb},0)`);
      bank.addColorStop(1, `rgba(${bankRgb},0.18)`);
      ctx.globalAlpha = 1; ctx.fillStyle = bank; ctx.fillRect(0, height - 18, width, 18);
    }
    impacts = impacts.filter((impact) => {
      impact.age += 1;
      const remaining = Math.max(0, 1 - impact.age / impact.life);
      if (impact.kind === "rainSplash") {
        ctx.globalAlpha = remaining * 0.35;
        ctx.strokeStyle = palette().splash; ctx.lineWidth = 1;
        const spread = 2 + impact.age * 0.55;
        ctx.beginPath(); ctx.ellipse(impact.x, impact.y, spread, Math.max(0.7, spread * 0.18), 0, Math.PI, Math.PI * 2); ctx.stroke();
      } else {
        ctx.globalAlpha = Math.min(impact.opacity, remaining * impact.opacity * 2);
        ctx.fillStyle = palette().settledSnow;
        ctx.beginPath(); ctx.ellipse(impact.x, impact.y, impact.r * 1.35, impact.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      }
      return impact.age < impact.life;
    });
  }

  function maybeFlash(now) {
    if (!activeConfig?.flash) { flashIntensity = 0; nextFlashAt = 0; return; }
    if (!nextFlashAt) nextFlashAt = now + 3000 + Math.random() * 6000;
    if (now >= nextFlashAt) {
      flashIntensity = 0.5 + Math.random() * 0.3;
      nextFlashAt = now + 4000 + Math.random() * 8000;
    }
    if (flashIntensity > 0) {
      ctx.globalAlpha = flashIntensity;
      ctx.fillStyle = `rgba(${palette().flash},1)`;
      ctx.fillRect(0, 0, width, height);
      flashIntensity -= 0.06;
    }
  }

  let liveTarget = null;

  function tick() {
    window.requestAnimationFrame(tick);
    const target = activeCanvas();
    if (target !== liveTarget) {
      liveTarget = target;
      ctx = target ? target.getContext("2d") : null;
    }
    canvas?.classList.toggle("is-active", Boolean(activeConfig) && target === canvas);
    ambientCanvas?.classList.toggle("is-active", Boolean(activeConfig) && target === ambientCanvas);
    if (document.hidden || !ctx || !activeConfig || !target) return;
    ctx.clearRect(0, 0, width, height);
    const tint = TINTS[activeConfig.tint];
    if (tint) { const grad = tint(width, height); if (grad) { ctx.globalAlpha = 1; ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height); } }
    particles.forEach(drawParticle);
    drawGroundEffects();
    maybeFlash(Date.now());
    ctx.globalAlpha = 1;
  }


  function applyCondition(condition) {
    // The rain style is part of the identity of what's currently rendered:
    // changing it in Administration has to rebuild the particles even though
    // the weather condition itself hasn't changed.
    if (condition === currentCondition) return;
    currentCondition = condition;
    activeConfig = CONDITION_EFFECTS[condition] || null;
    canvas?.classList.toggle("is-active", Boolean(activeConfig));
    flashIntensity = 0; nextFlashAt = 0;
    impacts = [];
    particles = activeConfig ? activeConfig.layers.flatMap((name) => LAYER_BUILDERS[name]?.() || []) : [];
  }

  // Debug-only preview hook: ?weatherfx=<condition> in the URL forces that
  // condition's look regardless of the real weather state or the Admin
  // toggle, so a specific effect can be checked on the actual kiosk/device
  // without waiting for that weather to happen. No query param -> normal
  // behavior, untouched.
  function forcedCondition() {
    try {
      const configured = String(BeastConfig.get("features.weatherOverlayConditionOverride") || "").trim();
      return new URLSearchParams(window.location.search).get("weatherfx")
        || (!["", "auto", "off"].includes(configured) ? configured : null);
    } catch (_) { return null; }
  }

  function evaluate() {
    const forced = forcedCondition();
    if (forced) { applyCondition(forced); return; }
    if (!enabled() || reducedMotion || !weatherEntityId) { applyCondition(null); return; }
    const state = BeastHaSocket.getState(weatherEntityId);
    applyCondition(state?.state || null);
  }

  function bindWeatherEntity() {
    const nextEntityId = BeastConfig.get("panels.weather.entity") || null;
    if (nextEntityId === weatherEntityId && unsubscribeWeather) return;
    unsubscribeWeather?.();
    unsubscribeWeather = null;
    weatherEntityId = nextEntityId;
    if (weatherEntityId) unsubscribeWeather = BeastHaSocket.subscribeEntity(weatherEntityId, evaluate);
  }

  function handleConfigChange() {
    bindWeatherEntity();
    evaluate();
  }

  // Called once from ha-smartdash-app.js's own init, after BeastConfig is
  // already loaded (same timing every other post-boot subscription in that
  // file relies on) -- not on DOMContentLoaded, which could race config's
  // own async load.
  function mount() {
    canvas = document.getElementById("beastWeatherFx");
    ambientCanvas = document.getElementById("beastAmbientWeatherFx");
    if (!canvas) return;
    reducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    bindWeatherEntity();
    // The debug preview hook (?weatherfx=<condition>) must work even when
    // reduced-motion is on or no weather entity is configured -- those are
    // real reasons to disable the effect normally, but they shouldn't be
    // able to silently swallow someone deliberately asking to preview it.
    if ((reducedMotion || !weatherEntityId) && !forcedCondition()) return;
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize, { passive: true });
    evaluate();
    document.addEventListener("beast:config-changed", handleConfigChange);
    BeastHaSocket.onStatusChange((status) => { if (status === "connected") evaluate(); });
    tick();
  }

  return { mount };
})();
