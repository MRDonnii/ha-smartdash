/* Shared electricity price graph (bars or line) for the Energy page, the front-page energy card and the "Elpris" card template.
 * Ported from the TH electricity price card in Home Assistant: price-level colours, animated bars, the drawn line with its
 * travelling light, the cheapest-three-hours liquid, "very dear" pulses and the live now marker.
 *
 *   BeastPriceChart.html({ id, slots, t0, t1, type: "bar" | "line", label })  -> placeholder markup (put it into a render)
 *   BeastPriceChart.mountAll(root)                                           -> call after the markup is in the DOM
 *
 * slots: [{ start, end, price, forecast? }] (ISO strings) or [{ t, e, p, f? }] (ms). Every chart keeps one persistent element per
 * id, so a panel that re-renders its markup does not restart the animations; only changed data or a new size redraws it.
 */
(() => {
  "use strict";

  const W = 1000;
  const H = 100;
  const BASE = 100;
  const DEFAULT_LEVELS = Object.freeze({ cheap: 1.5, dear: 3, very_dear: 3.75, extreme: 5 });
  const LEVEL_NAME = ["Billig", "Normal pris", "Dyrt", "Meget dyrt", "Ekstremt dyrt"];
  const TONE = ["var(--price-cheap)", "var(--price-normal)", "var(--price-dear)", "var(--price-very-dear)", "var(--price-extreme)"];
  const CHEAPEST = "var(--price-cheapest)";
  const registry = new Map();
  let nextUid = 1;

  // Fixed price levels in kr/kWh: below `cheap` is cheap, from `dear` dear, from `very_dear` very dear, from `extreme` extreme.
  // Set under Admin -> Energi; anything that is not an ascending set of positive numbers falls back to the defaults.
  function levels() {
    const cfg = (typeof BeastConfig !== "undefined" && BeastConfig.get("panels.energy")) || {};
    const pick = (key, fallback) => { const n = Number(cfg[key]); return Number.isFinite(n) && n > 0 ? n : fallback; };
    const out = {
      cheap: pick("priceLevelCheap", DEFAULT_LEVELS.cheap),
      dear: pick("priceLevelDear", DEFAULT_LEVELS.dear),
      very_dear: pick("priceLevelVeryDear", DEFAULT_LEVELS.very_dear),
      extreme: pick("priceLevelExtreme", DEFAULT_LEVELS.extreme)
    };
    return out.cheap < out.dear && out.dear < out.very_dear && out.very_dear < out.extreme ? out : { ...DEFAULT_LEVELS };
  }

  function level(price, lv = levels()) {
    return price >= lv.extreme ? 4 : price >= lv.very_dear ? 3 : price >= lv.dear ? 2 : price < lv.cheap ? 0 : 1;
  }

  const T = (text) => (window.HASmartdashI18n?.t ? window.HASmartdashI18n.t(text) : text);

  function info(price) {
    if (!Number.isFinite(price)) return { index: -1, name: T("Ukendt"), tone: "var(--ink-faint)" };
    const index = level(price);
    return { index, name: T(LEVEL_NAME[index]), tone: TONE[index] };
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toSlots(list, forecast = false) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((entry) => {
      if (!entry) return;
      const t = Number.isFinite(entry.t) ? entry.t : Date.parse(entry.start);
      const p = Number.isFinite(entry.p) ? entry.p : Number(entry.price);
      if (!Number.isFinite(t) || !Number.isFinite(p)) return;
      let e = Number.isFinite(entry.e) ? entry.e : Date.parse(entry.end || "");
      if (!(e > t)) e = t + 3600000;
      out.push({ t, e, p, f: !!(forecast || entry.f || entry.forecast) });
    });
    return out.sort((a, b) => a.t - b.t);
  }

  function html(spec) {
    const id = String(spec.id || "price");
    const entry = registry.get(id) || { id, uid: `bpc${nextUid++}`, ak: null, pk: null, drawn: false };
    const slots = toSlots(spec.slots, spec.forecast);
    const first = slots.length ? slots[0].t : 0;
    const last = slots.length ? Math.max(...slots.map((s) => s.e)) : 0;
    entry.spec = {
      slots,
      type: spec.type === "line" ? "line" : "bar",
      t0: Number.isFinite(spec.t0) ? spec.t0 : first,
      t1: Number.isFinite(spec.t1) ? spec.t1 : last,
      label: spec.label || "Elpris"
    };
    registry.set(id, entry);
    return `<div class="beast-pchart" data-pchart="${esc(id)}"></div>`;
  }

  function reducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function ensureElement(entry) {
    if (entry.el) return entry.el;
    const el = document.createElement("div");
    el.className = "beast-pchart-in";
    el.innerHTML = `<svg class="beast-pchart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"></svg><div class="beast-pchart-ov"></div><div class="beast-pchart-tip"></div>`;
    entry.el = el;
    entry.svg = el.firstElementChild;
    entry.ov = el.children[1];
    entry.tip = el.children[2];
    entry.visible = true;
    if (typeof ResizeObserver === "function") {
      entry.ro = new ResizeObserver(() => {
        if (entry.raf) return;
        entry.raf = requestAnimationFrame(() => { entry.raf = 0; draw(entry); });
      });
      entry.ro.observe(el);
    }
    if (typeof IntersectionObserver === "function") {
      entry.io = new IntersectionObserver((records) => {
        entry.visible = records[records.length - 1].isIntersecting;
        applySmil(entry);
      });
      entry.io.observe(el);
    }
    const show = (event) => showTip(entry, event);
    el.addEventListener("pointermove", show);
    el.addEventListener("pointerdown", show);
    el.addEventListener("pointerleave", () => { entry.tip.style.opacity = 0; });
    return el;
  }

  // Animations that nobody sees (card scrolled away, tab in the background, another page) are paused, so a kiosk spends no
  // frames on them.
  function applySmil(entry) {
    const svg = entry.svg;
    if (!svg || typeof svg.pauseAnimations !== "function") return;
    if (entry.visible && !document.hidden) svg.unpauseAnimations(); else svg.pauseAnimations();
  }

  function mountAll(root) {
    const scope = root || document;
    scope.querySelectorAll(".beast-pchart[data-pchart]").forEach((host) => {
      const entry = registry.get(host.dataset.pchart);
      if (!entry) return;
      const el = ensureElement(entry);
      if (el.parentNode !== host) {
        // The element is moved, not recreated; moving restarts CSS animations, so a drawn chart is marked still first.
        if (entry.drawn) entry.svg.classList.add("still");
        host.replaceChildren(el);
        applySmil(entry);
        // A moved element keeps its last reported size, so the observer stays quiet unless it is started again.
        if (entry.ro) { entry.ro.unobserve(el); entry.ro.observe(el); }
      }
      draw(entry);
    });
  }

  function slotsDigest(slots) {
    let h = slots.length;
    for (const s of slots) h = (Math.imul(h, 31) + Math.round(s.p * 1000) + Math.floor(s.t / 60000) + (s.f ? 7 : 0)) | 0;
    return h;
  }

  function draw(entry) {
    const { el, spec, svg, ov } = entry;
    if (!el || !spec || !el.isConnected) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return;
    const all = spec.slots;
    if (!all.length) {
      svg.innerHTML = ""; ov.innerHTML = ""; entry.pk = null; entry.view = null;
      return;
    }
    const now = Date.now();
    const lv = levels();
    const first = all[0].t;
    const last = Math.max(...all.map((p) => p.e));
    let t0 = Math.max(spec.t0, first);
    let t1 = Math.min(spec.t1, last);
    if (!(t1 > t0)) { t0 = spec.t0; t1 = spec.t1; }
    if (!(t1 > t0)) return;
    const isBar = spec.type === "bar";
    const pk = [spec.type, t0, t1, slotsDigest(all), Math.floor(now / 9e5), `${cw}x${ch}`, lv.cheap, lv.dear, lv.very_dear, lv.extreme].join("|");
    if (pk === entry.pk) return;
    entry.pk = pk;
    const pts = all.filter((p) => p.e > t0 && p.t < t1);
    if (!pts.length) { svg.innerHTML = ""; ov.innerHTML = ""; entry.view = null; return; }

    const U = entry.uid;
    const gb = parseFloat(getComputedStyle(el).getPropertyValue("--gb")) || 18;
    const calm = reducedMotion();
    const vmax = Math.max(...pts.map((p) => p.p));
    const vmin = Math.min(...pts.map((p) => p.p));
    const max = vmax * 1.06;
    const min = Math.min(vmin * 0.9, vmin - 0.05);
    const X = (t) => (t - t0) / (t1 - t0) * W;
    const Y = (v) => 8 + (1 - (v - min) / (max - min)) * (H - 14);
    const sx = Math.max(0.1, cw / W);
    const sy = Math.max(0.1, (ch - gb) / H);
    const slotMs = Math.min(...pts.map((p) => p.e - p.t));
    const gap = Math.min(3, Math.max(0.4, slotMs / (t1 - t0) * W * 0.07));
    const [cG, cN, cW, cB, cX] = TONE;
    const tone = (v) => TONE[level(v, lv)];
    const vd = lv.very_dear;
    const veryDear = (p) => p.p >= vd && p.e > now;
    const line = (arr) => arr.map((p, i) => `${i ? "L" : "M"}${X((p.t + p.e) / 2).toFixed(1)} ${Y(p.p).toFixed(1)}`).join("");

    // The line's height at any moment, so liquid and pulses can follow the line instead of stepping like bars.
    const mids = pts.map((p) => [(p.t + p.e) / 2, Y(p.p)]);
    const yAt = (t) => {
      if (t <= mids[0][0]) return mids[0][1];
      for (let i = 1; i < mids.length; i += 1) {
        if (t <= mids[i][0]) { const [ta, ya] = mids[i - 1]; const [tb, yb] = mids[i]; return ya + (yb - ya) * (t - ta) / ((tb - ta) || 1); }
      }
      return mids[mids.length - 1][1];
    };
    const lineBar = (p) => {
      const x = Math.max(0, X(p.t));
      return { x, w: Math.max(0.5, Math.min(W, X(p.e)) - x), y: Math.min(yAt(Math.max(t0, p.t)), Y(p.p), yAt(Math.min(t1, p.e))), p };
    };
    // Consecutive slots as one area: one shape per slot left vertical seams in Safari.
    const runsOf = (ps) => {
      const out = [];
      for (const p of [...ps].sort((a, b) => a.t - b.t)) {
        const r = out[out.length - 1];
        if (r && p.t - r[r.length - 1].e < 1000) r.push(p); else out.push([p]);
      }
      return out;
    };
    const areaRun = (ps) => {
      const a = Math.max(t0, ps[0].t);
      const b = Math.min(t1, ps[ps.length - 1].e);
      const top = [[a, yAt(a)], ...ps.map((p) => (p.t + p.e) / 2).filter((m) => m > a && m < b).map((m) => [m, yAt(m)]), [b, yAt(b)]];
      return `M${X(a).toFixed(2)} ${BASE}${top.map(([t, y]) => `L${X(t).toFixed(2)} ${y.toFixed(1)}`).join("")}L${X(b).toFixed(2)} ${BASE}Z`;
    };

    const A1 = pts.filter((p) => !p.f);
    const F1 = pts.filter((p) => p.f);
    if (A1.length && F1.length) F1.unshift(A1[A1.length - 1]);
    const stop = (offset, color, extra = "") => `<stop offset="${offset}" style="stop-color:${color}"${extra}/>`;
    let g = `<defs><linearGradient id="${U}pl" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">${[[lv.extreme, cX], [lv.very_dear, cB], [lv.dear, cW], [lv.cheap, cN], [-1e9, cG]].map(([v, c], i, a) => {
      const o = (y) => Math.max(0, Math.min(1, y / H)).toFixed(3);
      return `${stop(i ? o(Y(a[i - 1][0])) : "0", c)}${stop(o(Y(v)), c)}`;
    }).join("")}</linearGradient>
      <linearGradient id="${U}pa" x1="0" y1="0" x2="0" y2="1">${stop(0, cW, ' stop-opacity=".28"')}${stop(1, cW, ' stop-opacity="0"')}</linearGradient></defs>`;

    if (isBar) {
      pts.forEach((p, i) => {
        const x = Math.max(0, X(p.t));
        const w = Math.max(0.5, Math.min(W, X(p.e)) - x - gap);
        const y = Y(p.p);
        const past = p.e <= now;
        g += `<rect x="${x.toFixed(2)}" y="${y.toFixed(1)}" width="${w.toFixed(2)}" height="${(BASE - y).toFixed(1)}" rx="1.5" style="fill:${tone(p.p)};transform-origin:${x.toFixed(2)}px ${BASE}px;animation:bpcBarIn .7s cubic-bezier(.16,1,.3,1) ${Math.min(i * 6, 900)}ms both" opacity="${past ? 0.25 : p.f ? 0.45 : 0.9}"/>`;
      });
    } else {
      if (A1.length) {
        const d = line(A1);
        g += `<path d="${d}L${X((A1[A1.length - 1].t + A1[A1.length - 1].e) / 2).toFixed(1)} ${BASE}L${X((A1[0].t + A1[0].e) / 2).toFixed(1)} ${BASE}Z" fill="url(#${U}pa)" class="fadein"/><path d="${d}" fill="none" stroke="url(#${U}pl)" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" class="draw"/>`;
      }
      if (F1.length > 1) g += `<path d="${line(F1)}" fill="none" stroke="url(#${U}pl)" stroke-width="1.6" stroke-dasharray="4 5" vector-effect="non-scaling-stroke" opacity=".7" class="fadein"/>`;
      // The coming part of the line is alive: a light with a soft tail runs along it, a faint glow glides over the area, and
      // the cheapest and dearest coming prices pulse. Layered strokes instead of a blur filter, so a kiosk does not recompute it.
      const fut = pts.filter((p) => p.e > now);
      if (fut.length > 2 && !calm) {
        const fd = line(fut);
        const xs = X((fut[0].t + fut[0].e) / 2);
        const xe = X((fut[fut.length - 1].t + fut[fut.length - 1].e) / 2);
        const tail = Math.max(60, (xe - xs) * 0.16);
        const dur = Math.max(6, Math.min(14, fut.length / 10)).toFixed(1);
        const sweep = (a, b) => `<animate attributeName="x1" values="${(xs - tail + a).toFixed(1)};${(xe + b).toFixed(1)};${(xe + b).toFixed(1)}" keyTimes="0;.8;1" dur="${dur}s" repeatCount="indefinite"/><animate attributeName="x2" values="${(xs + a).toFixed(1)};${(xe + tail + b).toFixed(1)};${(xe + tail + b).toFixed(1)}" keyTimes="0;.8;1" dur="${dur}s" repeatCount="indefinite"/>`;
        g += `<defs><linearGradient id="${U}cm" gradientUnits="userSpaceOnUse" x1="${xs - tail}" y1="0" x2="${xs}" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".82" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>${sweep(0, 0)}</linearGradient>
          <linearGradient id="${U}sh" gradientUnits="userSpaceOnUse" x1="${xs - tail}" y1="0" x2="${xs}" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".6" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>${sweep(-tail * 0.3, -tail * 0.3)}</linearGradient>
          <linearGradient id="${U}shg" gradientUnits="userSpaceOnUse" x1="0" y1="${Math.min(...fut.map((p) => Y(p.p))).toFixed(1)}" x2="0" y2="${BASE}">${stop(0, cW, ' stop-opacity=".42"')}${stop(1, cW, ' stop-opacity="0"')}</linearGradient>
          <mask id="${U}shm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${BASE}"><rect x="0" y="0" width="${W}" height="${BASE}" fill="url(#${U}sh)"/></mask>
          <clipPath id="${U}arc"><path d="${fd}L${xe.toFixed(1)} ${BASE}L${xs.toFixed(1)} ${BASE}Z"/></clipPath></defs>
          <g clip-path="url(#${U}arc)" style="pointer-events:none"><rect x="0" y="0" width="${W}" height="${BASE}" fill="url(#${U}shg)" mask="url(#${U}shm)"/></g>
          ${[[9, 0.12], [5.5, 0.28], [2.6, 1]].map(([w, o]) => `<path d="${fd}" fill="none" stroke="url(#${U}cm)" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="${o}" style="pointer-events:none"/>`).join("")}`;
        const lo = fut.reduce((m, p) => (p.p < m.p ? p : m));
        const hi = fut.reduce((m, p) => (p.p > m.p ? p : m));
        if (hi.p - lo.p >= 0.05) {
          for (const [p, col, k] of [[lo, cG, 0], [hi, cB, 1]]) {
            const cx = X((p.t + p.e) / 2);
            const cy = Y(p.p);
            const r0 = 3;
            const r1 = 13;
            const d2 = 2.6;
            const b2 = k * 1.3;
            g += `<g style="pointer-events:none">${[0, d2 / 2].map((off) => `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(r0 / sx).toFixed(2)}" ry="${(r0 / sy).toFixed(2)}" fill="none" style="stroke:${col}" stroke-width="1.6" vector-effect="non-scaling-stroke" opacity="0"><animate attributeName="rx" values="${(r0 / sx).toFixed(2)};${(r1 / sx).toFixed(2)}" dur="${d2}s" begin="${(b2 + off).toFixed(2)}s" repeatCount="indefinite"/><animate attributeName="ry" values="${(r0 / sy).toFixed(2)};${(r1 / sy).toFixed(2)}" dur="${d2}s" begin="${(b2 + off).toFixed(2)}s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="${d2}s" begin="${(b2 + off).toFixed(2)}s" repeatCount="indefinite"/></ellipse>`).join("")}
              <ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(3.2 / sx).toFixed(2)}" ry="${(3.2 / sy).toFixed(2)}" style="fill:${col};stroke:#fff" stroke-width="1.2" vector-effect="non-scaling-stroke"/></g>`;
          }
        }
      }
    }

    // The animation plays on the first drawing and when the day or view changes; a redraw for new data, a new size or the passing
    // minutes just draws again, so the graph does not look like it loads twice.
    const ak = `${spec.type}|${t0}`;
    const anim = entry.ak !== ak;
    entry.ak = ak;

    // The cheapest three hours (the liquid with bubbles) among the coming real prices of this view.
    let liq = [];
    let bsTop = null;
    let best = null;
    {
      const cand = pts.filter((p) => !p.f && p.t >= now - 9e5);
      const win = Math.max(1, Math.round(3 * 36e5 / ((cand[0]?.e - cand[0]?.t) || 9e5)));
      for (let i = 0; i + win <= cand.length; i += 1) {
        const a = cand.slice(i, i + win).reduce((s, p) => s + p.p, 0) / win;
        if (!best || a < best.a) best = { a, t: cand[i].t, e: cand[i + win - 1].e };
      }
      if (best) {
        liq = pts.filter((p) => p.t < best.e && p.e > best.t).map((p) => {
          if (!isBar) return lineBar(p);
          const x = Math.max(0, X(p.t));
          return { x, w: Math.max(0.5, Math.min(W, X(p.e)) - x - gap), y: Y(p.p) };
        });
      }
    }
    if (liq.length) {
      const id = "bs";
      let seed = liq.length * 7 + Math.floor(liq[0].x);
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      const rise = H * 0.32;
      const topY = Math.min(...liq.map((b) => b.y));
      const tint = `color-mix(in srgb,${CHEAPEST} 45%,#fff)`;
      bsTop = topY - rise * 0.75;
      g += `<defs><clipPath id="${U}${id}c">${runsOf(liq.filter((b) => b.p).map((b) => b.p)).map((r) => `<path d="${areaRun(r)}"/>`).join("")}${liq.filter((b) => !b.p).map((b) => `<rect x="${b.x.toFixed(2)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(2)}" height="${(BASE - b.y).toFixed(1)}" rx="1.5"/>`).join("")}</clipPath>
        <linearGradient id="${U}${id}l" gradientUnits="userSpaceOnUse" x1="0" y1="${topY.toFixed(1)}" x2="0" y2="${BASE}">${stop(0, CHEAPEST, ' stop-opacity="1"')}${stop(1, CHEAPEST, ` stop-opacity="${isBar ? 0.92 : 0.35}"`)}</linearGradient></defs><g clip-path="url(#${U}${id}c)"><rect x="0" y="0" width="${W}" height="${BASE}" fill="url(#${U}${id}l)"/>
        <rect x="0" y="0" width="${W}" height="${BASE}" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;.14;0" dur="3.2s" repeatCount="indefinite"/></rect></g>`;
      if (!calm) {
        liq.forEach((b) => {
          const n = Math.max(2, Math.round((BASE - b.y) / 16));
          for (let k = 0; k < n; k += 1) {
            const r = 1.8 + rnd() * 2.4;
            const cx = b.x + b.w * (0.2 + rnd() * 0.6);
            const dur = (2.8 + rnd() * 3).toFixed(2);
            const delay = (rnd() * 4.5).toFixed(2);
            const top = Math.max(3, b.y - rise * (0.35 + rnd() * 0.65));
            g += `<ellipse cx="${cx.toFixed(2)}" cy="${BASE}" rx="${(r / sx).toFixed(2)}" ry="${(r / sy).toFixed(2)}" style="fill:${k % 3 ? tint : CHEAPEST}" opacity="0"><animate attributeName="cy" from="${BASE}" to="${top.toFixed(1)}" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;.6;.5;0" keyTimes="0;.15;.75;1" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/></ellipse>`;
          }
        });
      }
    }

    // Very dear prices ahead: the bars pulse as a wave, sparks rise from the tops, and the line glows.
    const hotP = pts.filter(veryDear);
    if (hotP.length && !calm) {
      let hs = hotP.length * 13 + Math.floor(X(hotP[0].t));
      const hr = () => ((hs = (hs * 9301 + 49297) % 233280) / 233280);
      g += `<defs><linearGradient id="${U}hotg" x1="0" y1="0" x2="0" y2="1">${stop(0, cB, ' stop-opacity=".75"')}${stop(1, cB, ' stop-opacity=".05"')}</linearGradient></defs>`;
      if (!isBar) for (const r of runsOf(hotP)) g += `<path d="${areaRun(r)}" fill="url(#${U}hotg)" opacity="0" style="pointer-events:none"><animate attributeName="opacity" values="0;.85;0" dur="1.8s" repeatCount="indefinite"/></path>`;
      const everyNth = t1 - t0 <= 36 * 36e5 && pts.length <= 30 ? 1 : pts.length <= 120 ? 2 : 3;
      hotP.forEach((p, i) => {
        const x = Math.max(0, X(p.t));
        const w = Math.max(0.5, Math.min(W, X(p.e)) - x - (isBar ? gap : 0));
        const top = isBar ? Y(p.p) : lineBar(p).y;
        if (isBar) g += `<rect x="${x.toFixed(2)}" y="${top.toFixed(1)}" width="${w.toFixed(2)}" height="${(BASE - top).toFixed(1)}" rx="1.5" fill="url(#${U}hotg)" opacity="0" style="pointer-events:none"><animate attributeName="opacity" values="0;.85;0" dur="1.8s" begin="${((i % 6) * 0.22).toFixed(2)}s" repeatCount="indefinite"/></rect>`;
        if (i % everyNth) return;
        const r = 1.4 + hr() * 1.4;
        const cx = x + w * (0.25 + hr() * 0.5);
        const dur = (1.6 + hr() * 1.4).toFixed(2);
        const delay = (hr() * 2).toFixed(2);
        const up = Math.max(2, top - H * (0.12 + hr() * 0.14));
        g += `<ellipse cx="${cx.toFixed(2)}" cy="${top.toFixed(1)}" rx="${(r / sx).toFixed(2)}" ry="${(r / sy).toFixed(2)}" style="fill:${i % 2 ? "#ffb347" : cB}" opacity="0" style="pointer-events:none"><animate attributeName="cy" from="${top.toFixed(1)}" to="${up.toFixed(1)}" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;.95;0" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/></ellipse>`;
      });
      if (!isBar) {
        const runs = [];
        for (const p of pts) {
          const lastRun = runs[runs.length - 1];
          if (veryDear(p)) { if (lastRun && lastRun.open) lastRun.ps.push(p); else runs.push({ ps: [p], open: true }); } else if (lastRun) lastRun.open = false;
        }
        for (const r of runs) {
          const i0 = pts.indexOf(r.ps[0]);
          const i1 = pts.indexOf(r.ps[r.ps.length - 1]);
          const seg = pts.slice(Math.max(0, i0 - 1), Math.min(pts.length, i1 + 2));
          g += `<path d="${line(seg)}" fill="none" stroke-width="4.5" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity=".5" style="stroke:${cB};filter:drop-shadow(0 0 5px ${cB});pointer-events:none"><animate attributeName="opacity" values=".25;1;.25" dur="1.4s" repeatCount="indefinite"/></path>`;
        }
      }
    }

    svg.classList.toggle("still", !anim);
    svg.setAttribute("aria-label", spec.label);
    svg.innerHTML = g;
    applySmil(entry);

    // Overlay: hour labels, the very-dear and cheapest labels, and the live now marker.
    let html = "";
    const spanH = (t1 - t0) / 36e5;
    const pxPerHour = cw / Math.max(0.1, spanH);
    const step = [1, 2, 3, 6, 12].find((s) => pxPerHour * s >= 38) || 12;
    const hourAt = new Date(t0);
    hourAt.setMinutes(0, 0, 0);
    if (hourAt.getTime() < t0) hourAt.setTime(hourAt.getTime() + 36e5);
    for (let t = hourAt.getTime(); t < t1; t += 36e5) {
      const hour = new Date(t).getHours();
      if (hour % step) continue;
      const x = X(t) / W * 100;
      if (x < 2.5 || x > 97.5) continue;
      html += `<div class="hl" style="left:${x.toFixed(2)}%">${String(hour).padStart(2, "0")}</div>`;
    }
    if (best && best.t >= t0 && best.e <= t1) {
      const l = Math.max(0, X(best.t) / W * 100);
      const r = Math.min(100, X(best.e) / W * 100);
      html += `<div class="band" style="left:${l}%;width:${r - l}%"><span style="${bsTop != null ? `top:${Math.max(4, bsTop / H * (ch - gb) - 22).toFixed(0)}px` : ""}">${esc(T("BILLIGST"))}</span></div>`;
    }
    // MEGET DYRT only when the whole dear stretch is in the graph: a stretch that runs past the edge is hard to read.
    {
      const hot = (p) => p.p >= vd;
      const runs = [];
      for (const p of pts) {
        const lastRun = runs[runs.length - 1];
        if (hot(p)) { if (lastRun && lastRun.e >= p.t - 1) lastRun.e = p.e; else runs.push({ s: p.t, t: Math.max(p.t, now), e: p.e }); }
      }
      const hill = (p) => p.p >= lv.dear;
      const stretch = (r) => {
        let i = all.findIndex((p) => p.t >= r.s - 1);
        let j = all.findIndex((p) => p.t >= r.e - 1);
        if (i < 1 || j < 0) return null;
        while (i > 0 && hill(all[i - 1])) i -= 1;
        while (j < all.length && hill(all[j])) j += 1;
        return i > 0 && j < all.length ? { s: all[i].t, e: all[j].t } : null;
      };
      const whole = runs.filter((r) => { if (r.e <= now) return false; const st = stretch(r); return !!st && st.s > t0 && st.e <= t1; });
      const big = whole.reduce((m, r) => (!m || r.e - r.t > m.e - m.t ? r : m), null);
      if (big && big.t < t1) {
        const l = Math.max(0, X(big.t) / W * 100);
        const r = Math.min(100, X(big.e) / W * 100);
        const top = Math.max(...all.filter((p) => p.t < big.e && p.e > big.s).map((p) => p.p));
        const xt = top >= lv.extreme;
        html += `<div class="band hot${xt ? " xt" : ""}" style="left:${l}%;width:${Math.max(0.6, r - l)}%"><span>${esc(T(xt ? "EKSTREMT DYRT" : "MEGET DYRT"))}</span></div>`;
      }
    }
    const cp = all.find((p) => p.t <= now && p.e > now);
    if (cp && now >= t0 && now < t1) {
      const nx = X(now) / W * 100;
      html += `<div class="now" style="left:${nx}%"></div><div class="nd" style="left:${nx}%;top:${(Y(cp.p) / H * (ch - gb)).toFixed(1)}px"></div>`;
    }
    ov.innerHTML = html;
    // Labels stand in the middle of their period but never outside the graph.
    const box = el.getBoundingClientRect();
    if (box.width) {
      ov.querySelectorAll(".band span").forEach((sp) => {
        const b = sp.getBoundingClientRect();
        const over = b.right - (box.right - 4);
        const under = box.left + 4 - b.left;
        if (over > 0) sp.style.marginLeft = `${-over}px`; else if (under > 0) sp.style.marginLeft = `${under}px`;
      });
    }
    entry.view = { t0, t1, pts, X, Y, ch, gb, W, H, now, all };
    entry.drawn = true;
  }

  function showTip(entry, event) {
    const view = entry.view;
    const tip = entry.tip;
    if (!view) { tip.style.opacity = 0; return; }
    const { t0, t1, pts, Y, H: vh, gb } = view;
    const box = entry.el.getBoundingClientRect();
    if (!box.width) return;
    const t = t0 + (event.clientX - box.left) / box.width * (t1 - t0);
    const p = pts.find((q) => q.t <= t && q.e > t);
    if (!p) { tip.style.opacity = 0; return; }
    const locale = window.HASmartdashI18n?.locale || "da-DK";
    const when = new Date(p.t).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const lvl = info(p.p);
    tip.innerHTML = `${esc(when)}${p.f ? ` · ${esc(T("prognose"))}` : ""}<br><b>${p.p.toFixed(2)} kr</b> · ${lvl.name.toLowerCase()}`;
    const bounds = (entry.el.closest(".beast-ov-card, .beast-energy-chart-wrap, [data-standard-card]") || entry.el).getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const py = Y(p.p) / vh * (box.height - gb);
    tip.style.left = `${Math.max(bounds.left - box.left + tw / 2 + 4, Math.min(bounds.right - box.left - tw / 2 - 4, event.clientX - box.left))}px`;
    tip.style.top = `${py}px`;
    tip.style.transform = box.top + py - th * 1.1 < bounds.top + 4 ? "translate(-50%,12px)" : "";
    tip.style.opacity = 1;
  }

  // The clock keeps the marker moving between redraws; a new quarter of an hour redraws the whole graph (new current price).
  function tick() {
    const now = Date.now();
    registry.forEach((entry) => {
      if (!entry.el || !entry.el.isConnected || !entry.view) return;
      const view = entry.view;
      if (Math.floor(now / 9e5) !== Math.floor(view.now / 9e5)) { draw(entry); return; }
      const nowLine = entry.ov.querySelector(".now");
      if (nowLine && now >= view.t0 && now < view.t1) {
        const left = `${view.X(now) / view.W * 100}%`;
        nowLine.style.left = left;
        const dot = entry.ov.querySelector(".nd");
        if (dot) dot.style.left = left;
      }
    });
  }
  window.setInterval(tick, 30000);

  function redrawAll() {
    registry.forEach((entry) => { entry.pk = null; draw(entry); });
  }
  document.addEventListener("beast:config-changed", redrawAll);
  document.addEventListener("visibilitychange", () => registry.forEach((entry) => applySmil(entry)));

  window.BeastPriceChart = { html, mountAll, levels, level, info, slots: toSlots, LEVEL_NAME, TONE, DEFAULT_LEVELS };
})();
