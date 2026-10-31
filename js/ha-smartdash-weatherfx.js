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
    // The bedroom screensaver is always black, whatever the dashboard theme.
    if (calm) return COLORS.dark;
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
  // Performance (kept identical in look): each cloud is blurred once into its
  // own small sprite instead of blurring every puff on every frame, the
  // condition's tint wash is cached instead of filled anew each frame, calm
  // conditions draw at 30 fps with their motion scaled to time, and the loop
  // stops completely wherever the overlay isn't shown.
  let tintLayer = null;
  let tintKey = "";
  let spritePalette = null;
  let rafId = 0;
  let lastFrameAt = 0;
  let step = 1;
  let currentSection = "overview";
  const suppressedBy = new Set();
  // Bedroom screensaver ("calm" look): its own, dimmer and slower set of
  // layers on the screensaver canvas of a bedroom device, drawn at a capped
  // pixel ratio and frame rate. Every other place keeps the look above.
  let calm = false;
  let builtCalm = false;
  let ambientScale = 1;
  let effectKey = "";

  function enabled() {
    return BeastConfig.get("features.weatherOverlay") === true;
  }

  // Which places show the overlay: dashboard pages by section id, plus
  // "ambient" for the screensaver. Default is the Overview and the
  // screensaver, which is where it was visible before the setting existed.
  const DEFAULT_PAGES = ["overview", "ambient"];
  function shownOn() {
    const pages = BeastConfig.get("features.weatherOverlayPages");
    return Array.isArray(pages) ? pages : DEFAULT_PAGES;
  }

  function bedroomDevice() {
    return typeof BeastLocalSettings !== "undefined" && BeastLocalSettings.isBedroomDevice?.() === true;
  }

  function allowedHere() {
    // An idle kiosk (screen off) shows nothing, so nothing is drawn.
    if (window.BeastPower?.getState?.() === "idle") return false;
    const ambient = document.body.classList.contains("beast-is-ambient");
    // A bedroom device always shows the weather behind its screensaver; its
    // dashboard follows the Admin switch like every other device.
    if (bedroomDevice()) {
      if (ambient) return Boolean(ambientCanvas);
      if (!enabled() && !forcedCondition()) return false;
    }
    // A view covering the dashboard pauses it there; the screensaver is its own.
    if (suppressedBy.size && !ambient) return false;
    return shownOn().includes(ambient ? "ambient" : currentSection);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    if (canvas) { canvas.width = width; canvas.height = height; }
    // The bedroom screensaver draws a little sharper than CSS pixels (stars
    // and raindrops looked soft on a Retina iPad) but never at full 2x/3x.
    ambientScale = bedroomDevice() ? Math.min(1.5, Math.max(1, window.devicePixelRatio || 1)) : 1;
    if (ambientCanvas) { ambientCanvas.width = Math.round(width * ambientScale); ambientCanvas.height = Math.round(height * ambientScale); }
    tintKey = "";
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
    // ---- bedroom screensaver layers (calm) ----
    // Slowly breathing stars, thicker towards the top, a few warmer and a
    // few with a faint halo; a rare, faint shooting star.
    calmStars: () => calmStars(density(6500, 150)),
    calmStarsFew: () => calmStars(density(16000, 60)),
    meteor: () => [{ kind: "meteor", next: performance.now() + 9000 + Math.random() * 20000, t: -1 }],
    // Soft light motes drifting upwards on a clear or partly clear day.
    motes: () => Array.from({ length: density(42000, 22) }, () => ({
      kind: "mote", x: Math.random() * width, y: Math.random() * height, r: 12 + Math.random() * 30,
      vx: (Math.random() - 0.5) * 0.08, vy: -(0.05 + Math.random() * 0.12), phase: Math.random() * Math.PI * 2,
      speed: 0.004 + Math.random() * 0.008, opacity: 0.08 + Math.random() * 0.1
    })),
    // Large, slow cloud banks; each is a soft sprite of gradient puffs (no
    // canvas filter, which iPad Safari does not support).
    calmClouds: () => Array.from({ length: density(110000, 8) }, () => calmCloud(Math.random() * width)),
    calmFog: () => Array.from({ length: 5 }, (_, i) => ({
      kind: "fog", x: Math.random() * width, y: (height / 5) * i + Math.random() * 50,
      w: width * 1.5, h: 90 + Math.random() * 70, speed: (i % 2 ? 1 : -1) * (0.08 + Math.random() * 0.08), opacity: 0.05 + Math.random() * 0.05
    })),
    calmRain: () => rainDrops(density(7200, 150), 5, 4, 14, 14, 0.12, 0.16),
    calmRainHeavy: () => rainDrops(density(4600, 230), 7, 5, 18, 16, 0.14, 0.18),
    calmSnow: () => snowFlakes(density(13000, 95), 1.2, 2.6, 0.35, 0.75).map((flake) => ({ ...flake, opacity: 0.18 + Math.random() * 0.32 })),
    calmSnowLight: () => snowFlakes(density(24000, 50), 1.1, 2.0, 0.3, 0.6).map((flake) => ({ ...flake, opacity: 0.16 + Math.random() * 0.26 })),
    // Droplets clinging to the screen as if it were a window pane, rather
    // than rain falling behind it. Most just sit and quiver; a drop only
    // starts running once it's grown heavy enough, which is what makes the
    // effect read as glass rather than as slow rain -- so radius doubles as
    // "weight" here, and sliding drops leave a shrinking trail behind them.
  };




  function calmStars(count) {
    return Array.from({ length: count }, () => {
      const bright = Math.random() < 0.08;
      return {
        kind: "star", calm: true, x: Math.random() * width, y: Math.pow(Math.random(), 1.35) * height * 0.92,
        r: bright ? 1.1 + Math.random() * 0.6 : 0.45 + Math.random() * 0.75, halo: bright,
        base: bright ? 0.5 : 0.18 + Math.random() * 0.3, amp: 0.08 + Math.random() * 0.14,
        warm: Math.random() < 0.3, phase: Math.random() * Math.PI * 2, speed: 0.004 + Math.random() * 0.012
      };
    });
  }

  // A long, flat bank of overlapping soft puffs (squashed vertically).
  function calmCloud(x) {
    const w = 360 + Math.random() * 360;
    const h = 70 + Math.random() * 60;
    const count = 8 + Math.floor(Math.random() * 4);
    const puffs = Array.from({ length: count }, (_, i) => {
      const edge = Math.abs(i / (count - 1) - 0.5) * 2;
      return { dx: (i / (count - 1) - 0.5) * w * 0.85 + (Math.random() - 0.5) * 24, dy: (Math.random() - 0.5) * h * 0.35, r: h * (1.05 - edge * 0.45 + Math.random() * 0.25) };
    });
    return { kind: "cloud", soft: true, x, y: 10 + Math.random() * height * 0.55, w, h, puffs, speed: 0.04 + Math.random() * 0.07, opacity: 0.03 + Math.random() * 0.028 };
  }

  // A soft round glow, rendered once per colour and stamped with drawImage.
  const glowSprites = {};
  function glowSprite(rgb) {
    if (glowSprites[rgb]) return glowSprites[rgb];
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const c = sprite.getContext("2d");
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.35, `rgba(${rgb},0.45)`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    glowSprites[rgb] = sprite;
    return sprite;
  }

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
    if (p.kind === "star" && p.calm) {
      p.phase += p.speed * step;
      const a = Math.max(0, p.base + Math.sin(p.phase) * p.amp);
      if (p.halo) { ctx.globalAlpha = a * 0.22; const s = p.r * 9; ctx.drawImage(glowSprite("255,236,210"), p.x - s / 2, p.y - s / 2, s, s); }
      ctx.globalAlpha = a;
      ctx.fillStyle = p.warm ? "rgb(255,232,200)" : "rgb(232,238,255)";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (p.kind === "mote") {
      p.phase += p.speed * step;
      ctx.globalAlpha = p.opacity * (0.65 + Math.sin(p.phase) * 0.35);
      const s = p.r * 2;
      ctx.drawImage(glowSprite("255,214,150"), p.x - p.r, p.y - p.r, s, s);
      p.x += (p.vx + Math.sin(p.phase * 0.7) * 0.05) * step; p.y += p.vy * step;
      if (p.y < -p.r) { p.y = height + p.r; p.x = Math.random() * width; }
      if (p.x < -p.r) p.x = width + p.r;
      if (p.x > width + p.r) p.x = -p.r;
      return;
    }
    if (p.kind === "meteor") {
      const now = performance.now();
      if (p.t < 0) {
        if (now < p.next) return;
        p.t = 0; p.x = width * (0.15 + Math.random() * 0.6); p.y = height * (0.05 + Math.random() * 0.25);
        p.len = 90 + Math.random() * 80; p.angle = Math.PI * (0.12 + Math.random() * 0.1);
      }
      p.t += step / 60;
      const life = 1.1; const k = p.t / life;
      if (k >= 1) { p.t = -1; p.next = now + 25000 + Math.random() * 45000; return; }
      const travel = 260 * k;
      const hx = p.x + Math.cos(p.angle) * travel; const hy = p.y + Math.sin(p.angle) * travel;
      const tx = hx - Math.cos(p.angle) * p.len; const ty = hy - Math.sin(p.angle) * p.len;
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, "rgba(255,240,220,0)"); g.addColorStop(1, "rgba(255,240,220,1)");
      ctx.globalAlpha = 0.32 * Math.sin(Math.PI * k);
      ctx.strokeStyle = g; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      return;
    }
    if (p.kind === "star") {
      p.phase += p.speed * step;
      ctx.globalAlpha = 0.35 + Math.sin(p.phase) * 0.25;
      ctx.fillStyle = palette().star;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (p.kind === "cloud") {
      // The same puffs, blurred and composited exactly as before, but once
      // into the cloud's own sprite; every frame then only moves the sprite.
      if (!p.sprite || p.spritePalette !== spritePalette) (p.soft ? softCloudSprite : cloudSprite)(p);
      ctx.globalAlpha = 1;
      ctx.drawImage(p.sprite, p.x - p.ox, p.y - p.oy);
      p.x += p.speed * step;
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
      p.x += p.speed * step;
      if (p.speed > 0 && p.x - p.w / 2 > width) p.x = -p.w / 2;
      if (p.speed < 0 && p.x + p.w / 2 < 0) p.x = width + p.w / 2;
      return;
    }
    if (p.kind === "wind") {
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = palette().wind; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.len, p.y - 2); ctx.stroke();
      p.x += p.speed * step;
      if (p.x > width) { p.x = -p.len; p.y = Math.random() * height; }
      return;
    }
    if (p.kind === "rain") {
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = palette().rain; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.drift * 2, p.y + p.len); ctx.stroke();
      p.y += p.speed * step; p.x -= p.drift * step;
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
      p.y += p.speed * step;
      if (p.y > height) { p.y = -p.r; p.x = Math.random() * width; }
      return;
    }
    if (p.kind === "snow") {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = palette().snow;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      p.sway += 0.02 * step; p.y += p.speed * step; p.x += (p.drift + Math.sin(p.sway) * 0.4) * step;
      if (p.y > height) {
        impacts.push({ kind: "settledSnow", x: p.x, y: height - 1 - Math.random() * 9, r: p.r * (0.7 + Math.random() * 0.6), opacity: p.opacity * 0.8, age: 0, life: 900 + Math.random() * 900 });
        if (impacts.filter((item) => item.kind === "settledSnow").length > 120) impacts.splice(impacts.findIndex((item) => item.kind === "settledSnow"), 1);
        p.y = -p.r; p.x = Math.random() * width;
      }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
    }
  }

  const SQUASH = 0.55;
  function softCloudSprite(p) {
    const minX = Math.min(...p.puffs.map((f) => f.dx - f.r)); const maxX = Math.max(...p.puffs.map((f) => f.dx + f.r));
    const minY = Math.min(...p.puffs.map((f) => f.dy - f.r * SQUASH)); const maxY = Math.max(...p.puffs.map((f) => f.dy + f.r * SQUASH));
    const sprite = p.sprite || document.createElement("canvas");
    sprite.width = Math.ceil(maxX - minX); sprite.height = Math.ceil(maxY - minY);
    const c = sprite.getContext("2d");
    c.clearRect(0, 0, sprite.width, sprite.height);
    const rgb = String(spritePalette.cloud).match(/\d+,\s*\d+,\s*\d+/)?.[0] || "222,227,236";
    const a = p.opacity;
    p.puffs.forEach((puff) => {
      const x = puff.dx - minX; const y = (puff.dy - minY) / SQUASH;
      c.setTransform(1, 0, 0, SQUASH, 0, 0);
      // Close to a Gaussian falloff, so overlapping puffs blend into one bank.
      const g = c.createRadialGradient(x, y, 0, x, y, puff.r);
      g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.3, `rgba(${rgb},${a * 0.8})`); g.addColorStop(0.6, `rgba(${rgb},${a * 0.36})`);
      g.addColorStop(0.82, `rgba(${rgb},${a * 0.1})`); g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g; c.fillRect(x - puff.r, y - puff.r, puff.r * 2, puff.r * 2);
    });
    c.setTransform(1, 0, 0, 1, 0, 0);
    p.sprite = sprite; p.spritePalette = spritePalette; p.ox = -minX; p.oy = -minY;
  }

  function cloudSprite(p) {
    const blur = 14; const pad = blur * 3;
    const minX = Math.min(...p.puffs.map((f) => f.dx - f.r)) - pad; const maxX = Math.max(...p.puffs.map((f) => f.dx + f.r)) + pad;
    const minY = Math.min(...p.puffs.map((f) => f.dy - f.r)) - pad; const maxY = Math.max(...p.puffs.map((f) => f.dy + f.r)) + pad;
    const sprite = p.sprite || document.createElement("canvas");
    sprite.width = Math.ceil(maxX - minX); sprite.height = Math.ceil(maxY - minY);
    const c = sprite.getContext("2d");
    c.clearRect(0, 0, sprite.width, sprite.height);
    c.globalAlpha = p.opacity; c.fillStyle = spritePalette.cloud; c.filter = `blur(${blur}px)`;
    p.puffs.forEach((puff) => { c.beginPath(); c.arc(puff.dx - minX, puff.dy - minY, puff.r, 0, Math.PI * 2); c.fill(); });
    c.filter = "none";
    p.sprite = sprite; p.spritePalette = spritePalette; p.ox = -minX; p.oy = -minY;
  }

  // The tint wash only changes with the condition, the theme and the size,
  // so it is drawn once into its own layer and copied in each frame.
  function drawTint() {
    const make = TINTS[activeConfig.tint]; if (!make) return;
    const key = `${activeConfig.tint}|${document.documentElement.dataset.colorMode}|${width}x${height}`;
    if (key !== tintKey) {
      tintLayer = tintLayer || document.createElement("canvas");
      tintLayer.width = Math.max(1, width); tintLayer.height = Math.max(1, height);
      const main = ctx; ctx = tintLayer.getContext("2d");
      ctx.clearRect(0, 0, width, height);
      const grad = make(width, height); if (grad) { ctx.globalAlpha = 1; ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height); }
      ctx = main; tintKey = key;
    }
    // The bedroom screensaver keeps its black: only half the wash.
    ctx.globalAlpha = calm ? 0.5 : 1; ctx.drawImage(tintLayer, 0, 0);
  }

  // Bedroom screensaver: the weather thins out behind the clock so the
  // digits keep their contrast (a soft hole, not a visible shape).
  let shieldGrad = null;
  let shieldKey = "";
  function drawClockShield() {
    const key = `${width}x${height}`;
    const cx = width / 2; const cy = height * 0.44; const r = Math.min(width, height * 1.25) * 0.5;
    if (key !== shieldKey) {
      shieldGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      shieldGrad.addColorStop(0, "rgba(0,0,0,0.6)"); shieldGrad.addColorStop(0.55, "rgba(0,0,0,0.42)"); shieldGrad.addColorStop(1, "rgba(0,0,0,0)");
      shieldKey = key;
    }
    ctx.save();
    ctx.globalCompositeOperation = "destination-out"; ctx.globalAlpha = 1; ctx.fillStyle = shieldGrad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawGroundEffects() {
    const raining = particles.some((particle) => particle.kind === "rain");
    const snowing = particles.some((particle) => particle.kind === "snow");
    if (raining) {
      const wet = ctx.createLinearGradient(0, height - 28, 0, height);
      const wetRgb = palette().wetGround;
      wet.addColorStop(0, `rgba(${wetRgb},0)`);
      wet.addColorStop(1, `rgba(${wetRgb},${calm ? 0.06 : 0.11})`);
      ctx.globalAlpha = 1; ctx.fillStyle = wet; ctx.fillRect(0, height - 28, width, 28);
    }
    if (snowing) {
      const bank = ctx.createLinearGradient(0, height - 18, 0, height);
      const bankRgb = palette().snowBank;
      bank.addColorStop(0, `rgba(${bankRgb},0)`);
      bank.addColorStop(1, `rgba(${bankRgb},${calm ? 0.09 : 0.18})`);
      ctx.globalAlpha = 1; ctx.fillStyle = bank; ctx.fillRect(0, height - 18, width, 18);
    }
    impacts = impacts.filter((impact) => {
      impact.age += step;
      const remaining = Math.max(0, 1 - impact.age / impact.life);
      if (impact.kind === "rainSplash") {
        ctx.globalAlpha = remaining * (calm ? 0.2 : 0.35);
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
      // In a dark bedroom a full flash would wake someone: only a faint glow.
      ctx.globalAlpha = calm ? flashIntensity * 0.07 : flashIntensity;
      ctx.fillStyle = `rgba(${palette().flash},1)`;
      ctx.fillRect(0, 0, width, height);
      flashIntensity -= 0.06 * step;
    }
  }

  let liveTarget = null;

  // Calm conditions (stars, sun, clouds, fog) move slowly enough to draw at
  // 30 fps; falling rain, hail, snow and wind keep the full frame rate.
  function frameInterval() {
    const fast = particles.some((p) => p.kind === "rain" || p.kind === "hail" || p.kind === "snow" || p.kind === "wind") || flashIntensity > 0;
    // The bedroom screensaver runs all night on an older iPad: 30 fps for
    // falling things, 20 fps for the slow ones.
    if (calm) return fast || particles.some((p) => p.kind === "meteor" && p.t >= 0) ? 1000 / 30 : 1000 / 20;
    return fast ? 0 : 1000 / 30;
  }

  function schedule() {
    if (!rafId && activeConfig && allowedHere() && !document.hidden) rafId = window.requestAnimationFrame(tick);
  }

  // Applies where the overlay may show: starts the loop, or stops it and
  // leaves the canvases empty.
  function refreshActivity() {
    const on = Boolean(activeConfig) && allowedHere();
    const target = activeCanvas();
    canvas?.classList.toggle("is-active", on && target === canvas);
    ambientCanvas?.classList.toggle("is-active", on && target === ambientCanvas);
    if (on) { schedule(); return; }
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    [canvas, ambientCanvas].forEach((c) => {
      const context = c?.getContext("2d"); if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, c.width, c.height);
    });
    lastFrameAt = 0;
  }

  function tick(now) {
    rafId = 0;
    if (!activeConfig || !allowedHere()) { refreshActivity(); return; }
    rafId = window.requestAnimationFrame(tick);
    if (document.hidden) return;
    const interval = frameInterval();
    if (lastFrameAt && now - lastFrameAt < interval - 2) return;
    // Motion is per 60 fps frame; a longer gap moves things on just as far.
    step = lastFrameAt ? Math.min(4, Math.max(0.25, (now - lastFrameAt) / (1000 / 60))) : 1;
    lastFrameAt = now;
    const target = activeCanvas();
    if (target !== liveTarget) {
      liveTarget = target;
      ctx = target ? target.getContext("2d") : null;
      canvas?.classList.toggle("is-active", target === canvas);
      ambientCanvas?.classList.toggle("is-active", target === ambientCanvas);
      calm = Boolean(target) && target === ambientCanvas && bedroomDevice();
      if (calm !== builtCalm) { rebuild(); return; }
    }
    if (!ctx || !target) return;
    const pal = palette(); if (pal !== spritePalette) spritePalette = pal;
    const scale = target === ambientCanvas ? ambientScale : 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!calm) drawTint();
    particles.forEach(drawParticle);
    drawGroundEffects();
    if (calm) {
      // The wash goes in behind the particles after the shield, so only the
      // weather thins out behind the clock, not the colour of the sky.
      drawClockShield();
      ctx.save(); ctx.globalCompositeOperation = "destination-over"; drawTint(); ctx.restore();
    }
    maybeFlash(Date.now());
    ctx.globalAlpha = 1;
    // Nothing moves (a clear sky is only its tint): one frame is enough
    // until the condition, theme, size or page changes.
    if (!particles.length && !impacts.length && !activeConfig.flash && flashIntensity <= 0 && rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
  }


  // The bedroom screensaver's own layer sets: dimmer, slower and softer,
  // and aware of night (HA reports "partlycloudy" or "cloudy" at night too,
  // and a sunny-day glow over a sleeping bedroom would be wrong).
  function calmEffect(condition, night) {
    const c = CONDITION_EFFECTS[condition];
    if (!c) return null;
    switch (condition) {
      case "clear-night": return { tint: "night", layers: ["calmStars", "meteor"] };
      case "sunny": return night ? { tint: "night", layers: ["calmStars", "meteor"] } : { tint: null, layers: ["motes"] };
      case "partlycloudy": return night ? { tint: "night", layers: ["calmStarsFew", "calmClouds"] } : { tint: null, layers: ["motes", "calmClouds"] };
      case "cloudy": return { tint: "overcast", layers: ["calmClouds", "calmClouds"] };
      case "fog": return { tint: "overcast", layers: ["calmFog"] };
      case "windy": case "windy-variant": return { tint: null, layers: ["calmClouds", "wind"] };
      case "rainy": return { tint: "rain", layers: ["calmRain"] };
      case "pouring": return { tint: "storm", layers: ["calmRainHeavy"] };
      case "lightning": return { tint: "storm", layers: ["calmClouds", "calmClouds"], flash: true };
      case "lightning-rainy": return { tint: "storm", layers: ["calmClouds", "calmRain"], flash: true };
      case "snowy": return { tint: "snow", layers: ["calmSnow"] };
      case "snowy-rainy": return { tint: "snow", layers: ["calmRain", "calmSnowLight"] };
      default: return c;
    }
  }

  function isNight() {
    const sun = BeastHaSocket.getState("sun.sun")?.state;
    if (sun === "below_horizon") return true;
    if (sun === "above_horizon") return false;
    const hour = new Date().getHours();
    return hour >= 20 || hour < 7;
  }

  function rebuild() {
    builtCalm = calm;
    const night = calm && isNight();
    effectKey = `${currentCondition}|${calm}|${night}`;
    activeConfig = calm ? calmEffect(currentCondition, night) : (CONDITION_EFFECTS[currentCondition] || null);
    flashIntensity = 0; nextFlashAt = 0;
    impacts = [];
    particles = activeConfig ? activeConfig.layers.flatMap((name) => LAYER_BUILDERS[name]?.() || []) : [];
    tintKey = "";
    lastFrameAt = 0;
    refreshActivity();
  }

  function applyCondition(condition) {
    // The rain style is part of the identity of what's currently rendered:
    // changing it in Administration has to rebuild the particles even though
    // the weather condition itself hasn't changed.
    if (condition === currentCondition && effectKey === `${condition}|${calm}|${calm && isNight()}`) { refreshActivity(); return; }
    currentCondition = condition;
    canvas?.classList.toggle("is-active", Boolean(CONDITION_EFFECTS[condition]));
    rebuild();
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
    if (!(enabled() || bedroomDevice()) || reducedMotion || !weatherEntityId) { applyCondition(null); return; }
    const state = BeastHaSocket.getState(weatherEntityId);
    applyCondition(state?.state || null);
  }

  function bindWeatherEntity() {
    let nextEntityId = BeastConfig.get("panels.weather.entity") || null;
    // A bedroom device shows the weather on its screensaver even before a
    // weather entity is chosen: the first weather entity HA has.
    if (!nextEntityId && bedroomDevice()) {
      BeastHaSocket.getAllStates().forEach((st, id) => { if (!nextEntityId && id.startsWith("weather.") && !["unknown", "unavailable"].includes(st?.state)) nextEntityId = id; });
    }
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
    if ((reducedMotion || !weatherEntityId) && !forcedCondition() && !bedroomDevice()) return;
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", () => { resize(); refreshActivity(); }, { passive: true });
    // A theme switch recolours the particles and the tint.
    new MutationObserver(() => { tintKey = ""; refreshActivity(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-mode"] });
    currentSection = document.querySelector(".beast-section.is-active[data-section]")?.dataset.section || "overview";
    document.addEventListener("beast:sectionchange", (event) => { currentSection = event.detail?.section || "overview"; refreshActivity(); });
    // The screensaver toggles a class on <body>; follow it so the overlay
    // moves to (or leaves) the screensaver's own canvas.
    new MutationObserver(() => refreshActivity()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", () => { lastFrameAt = 0; refreshActivity(); });
    document.addEventListener("beast:powerstatechange", () => { lastFrameAt = 0; refreshActivity(); });
    // Anything that covers the page completely (a full-screen view) can pause
    // the overlay: dispatch beast:weatherfx-suppress with { source, on }.
    document.addEventListener("beast:weatherfx-suppress", (event) => setSuppressed(event.detail?.source || "external", Boolean(event.detail?.on)));
    // The general "a view covers the dashboard" event pauses it too.
    document.addEventListener("beast:dashboard-cover", (event) => setSuppressed(`cover:${event.detail?.source || "external"}`, Boolean(event.detail?.on)));
    evaluate();
    document.addEventListener("beast:config-changed", handleConfigChange);
    document.addEventListener("beast:local-settings-changed", () => { resize(); handleConfigChange(); });
    // Night or day is settled each time the screensaver opens.
    document.addEventListener("beast:ambientchange", (event) => { if (event.detail?.on) evaluate(); });
    BeastHaSocket.onStatusChange((status) => { if (status === "connected") { bindWeatherEntity(); evaluate(); } });
    refreshActivity();
  }

  function setSuppressed(source, on) {
    if (on) suppressedBy.add(source); else suppressedBy.delete(source);
    refreshActivity();
  }

  return { mount, setSuppressed };
})();
