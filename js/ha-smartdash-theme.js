(function () {
  const STORAGE_KEY = "beast_theme_v1";
  const DEFAULTS = { mode: "auto", palette: "aurora", style: "glass", cardOpacity: 36 };
  const MODES = new Set(["auto", "dark", "light"]);
  const PALETTES = new Set(["aurora", "ocean", "ember", "sage", "sand", "slate", "ruby", "berry", "sunglow", "graphite"]);
  const STYLES = new Set(["glass", "clean", "rich"]);
  const BG_BASE = { dark: "#050608", light: "#edf2f7" };
  // Three deliberately far-apart design styles, layered on top of
  // mode/palette as a third independent axis. borderMul/shadowMul multiply
  // into the existing cardOpacity-derived formula below rather than
  // replacing it -- border/shadow still fade together with card
  // transparency, just scaled by how much chrome each style wants on top
  // of that. cardOpacity here is the *suggested* starting point applied the
  // moment a style is picked (same as picking a palette instantly
  // overwrites the accent colors) -- the "Store kortområder" slider can
  // still fine-tune it afterwards. "glass" now matches --surface-2's own
  // fixed ~32-36% opacity exactly (see .beast-panel's --panel-surface in
  // tokens.css and .beast-robot-card in ha-smartdash-misc.css, both now
  // built from the same --card-opacity), instead of sitting noticeably
  // more opaque than the specialised views the way the original 92%
  // default did.
  const STYLE_TOKENS = {
    glass: { borderMul: 0.11, shadowMul: 0.5, ambient: 0.82, ambient2: 0.5, radiusSm: 10, radiusMd: 14, radiusLg: 20, cardOpacity: 36, bg: false },
    clean: { borderMul: 0.03, shadowMul: 0.08, ambient: 0.05, ambient2: 0.02, radiusSm: 6, radiusMd: 10, radiusLg: 14, cardOpacity: 55, bg: false },
    rich: { borderMul: 0.26, shadowMul: 0.88, ambient: 1, ambient2: 0.8, radiusSm: 18, radiusMd: 26, radiusLg: 38, cardOpacity: 20, bg: true }
  };
  // "Auto" used to mean "follow the browser's prefers-color-scheme" --
  // technically correct, but on a kiosk that's a static OS-level setting
  // nobody is toggling through the day, so in practice "Auto" just looked
  // permanently stuck on whatever the device happened to default to
  // (usually dark), never actually switching to light during the day.
  // Time-of-day is what people actually expect from "Auto" on a wall
  // display -- light in the day, dark at night -- so that's the signal
  // used now instead.
  const AUTO_DAY_START_MINUTES = 7 * 60;
  const AUTO_DAY_END_MINUTES = 20 * 60;
  function isAutoDaytime(date = new Date()) {
    const minutes = date.getHours() * 60 + date.getMinutes();
    return minutes >= AUTO_DAY_START_MINUTES && minutes < AUTO_DAY_END_MINUTES;
  }
  let autoRecheckTimerId = null;

  function read() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        mode: MODES.has(stored.mode) ? stored.mode : DEFAULTS.mode,
        palette: PALETTES.has(stored.palette) ? stored.palette : DEFAULTS.palette,
        style: STYLES.has(stored.style) ? stored.style : DEFAULTS.style,
        cardOpacity: Number.isFinite(Number(stored.cardOpacity))
          ? Math.min(100, Math.max(0, Math.round(Number(stored.cardOpacity))))
          : DEFAULTS.cardOpacity
      };
    } catch (error) {
      return { ...DEFAULTS };
    }
  }

  function apply(settings = read(), notify = true) {
    const resolved = settings.mode === "auto" ? (isAutoDaytime() ? "light" : "dark") : settings.mode;
    const styleTokens = STYLE_TOKENS[settings.style] || STYLE_TOKENS.glass;
    const root = document.documentElement;
    root.dataset.colorMode = resolved;
    root.dataset.themeMode = settings.mode;
    root.dataset.themePalette = settings.palette;
    root.dataset.themeStyle = settings.style;
    root.dataset.floatingCards = settings.cardOpacity === 0 ? "true" : "false";
    root.style.setProperty("--card-opacity", String(settings.cardOpacity / 100));
    root.style.setProperty("--panel-border-opacity", String((settings.cardOpacity / 100 * styleTokens.borderMul).toFixed(3)));
    root.style.setProperty("--panel-shadow-opacity", String((settings.cardOpacity / 100 * styleTokens.shadowMul).toFixed(3)));
    root.style.setProperty("--ambient-strength", String(styleTokens.ambient));
    root.style.setProperty("--ambient-secondary-strength", String(styleTokens.ambient2));
    root.style.setProperty("--radius-sm", `${styleTokens.radiusSm}px`);
    root.style.setProperty("--radius-md", `${styleTokens.radiusMd}px`);
    root.style.setProperty("--radius-lg", `${styleTokens.radiusLg}px`);
    // "rich" replaces the flat page background with a gradient sweep tinted
    // by whichever accent is currently active, instead of the plain
    // per-mode/per-palette solid color -- the most visible single change
    // between styles, so it's deliberately the boldest lever available.
    // Removed (not left stale) when switching back to glass/clean, so their
    // own per-palette --bg (e.g. sage/sand/slate's light-mode tint) shows
    // through again untouched.
    if (styleTokens.bg) {
      root.style.setProperty("--bg", `linear-gradient(160deg, color-mix(in srgb, var(--accent-a) 20%, ${BG_BASE[resolved]}), ${BG_BASE[resolved]} 62%)`);
    } else {
      root.style.removeProperty("--bg");
    }
    root.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#050608" : "#eef3f8");
    if (notify) document.dispatchEvent(new CustomEvent("beast:theme-change", { detail: { ...settings, resolved } }));
    // Auto mode needs to actually re-evaluate as the day goes on -- there's
    // no browser event for "it's now 20:00", unlike prefers-color-scheme's
    // own change event below. Checked every 5 minutes, which is frequent
    // enough that the day/night switch never feels late.
    window.clearInterval(autoRecheckTimerId);
    if (settings.mode === "auto") {
      autoRecheckTimerId = window.setInterval(() => apply(read()), 5 * 60 * 1000);
    }
    return { ...settings, resolved };
  }

  function save(next) {
    const current = read();
    const settings = {
      mode: MODES.has(next.mode) ? next.mode : current.mode,
      palette: PALETTES.has(next.palette) ? next.palette : current.palette,
      style: STYLES.has(next.style) ? next.style : current.style,
      cardOpacity: Number.isFinite(Number(next.cardOpacity))
        ? Math.min(100, Math.max(0, Math.round(Number(next.cardOpacity))))
        : current.cardOpacity
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return apply(settings);
  }

  // Shared markup for the mode/style/palette/opacity picker -- used by both
  // Admin's "Tema og design" tab and the dashboard's own quick-settings
  // popover (js/ha-smartdash-settings.js) so the two never drift apart the
  // way they did before this function existed (they were a hand-duplicated
  // copy of each other). Callers still own their own click-wiring, since
  // one re-renders the whole admin shell and the other re-renders just its
  // popover -- only the markup generation is shared here.
  function renderPanel() {
    const theme = { ...read(), resolved: document.documentElement.dataset.colorMode };
    const modes = [
      ["auto", "settings", "Auto", "Følger skærmen"],
      ["light", "sun", "Lys", "Lyst og tydeligt"],
      ["dark", "moon", "Mørk", "Behageligt om aftenen"]
    ];
    const styles = [
      ["glass", "Glas", "Blødt og transparent"],
      ["clean", "Rent", "Fladt og roligt"],
      ["rich", "Rigt", "Dybt og rundet"]
    ];
    const palettes = [
      ["aurora", "Aurora", "Violet · cyan"], ["ocean", "Ocean", "Blå · turkis"],
      ["ember", "Ember", "Orange · pink"], ["ruby", "Rubin", "Dyb rød · koral"],
      ["berry", "Bær", "Magenta · violet"], ["sunglow", "Solglød", "Rav · koral"],
      ["sage", "Salvie", "Rolig grøn · hav"], ["sand", "Sand", "Varm beige · kobber"],
      ["slate", "Skifer", "Neutral blågrå"], ["graphite", "Grafit", "Næsten toneløs grå"]
    ];
    return `
      <section class="beast-theme-settings" aria-label="Udseende">
        <div class="beast-settings-section-head">
          <div><p class="beast-panel-title">Udseende</p><span>Tilpas skærmen uden genindlæsning</span></div>
          <span class="beast-theme-current">${theme.mode === "auto" ? `Auto · ${theme.resolved === "light" ? "lys" : "mørk"}` : theme.mode === "light" ? "Lys" : "Mørk"}</span>
        </div>
        <div class="beast-theme-mode-grid">
          ${modes.map(([id, icon, title, subtitle]) => `<button type="button" data-theme-mode="${id}" class="${theme.mode === id ? "is-active" : ""}" aria-pressed="${theme.mode === id}">
            ${BeastCore.icon(icon, { size: 22 })}<span><strong>${title}</strong><small>${subtitle}</small></span>
          </button>`).join("")}
        </div>
        <div class="beast-theme-style-grid">
          ${styles.map(([id, title, subtitle]) => `<button type="button" data-theme-style="${id}" class="${theme.style === id ? "is-active" : ""}" aria-pressed="${theme.style === id}">
            <i class="beast-theme-style-swatch is-${id}"></i><span><strong>${title}</strong><small>${subtitle}</small></span>${theme.style === id ? BeastCore.icon("check", { size: 18 }) : ""}
          </button>`).join("")}
        </div>
        <div class="beast-theme-palette-grid">
          ${palettes.map(([id, title, subtitle]) => `<button type="button" data-theme-palette="${id}" class="${theme.palette === id ? "is-active" : ""}" aria-pressed="${theme.palette === id}">
            <i class="beast-theme-swatch is-${id}"></i><span><strong>${title}</strong><small>${subtitle}</small></span>${theme.palette === id ? BeastCore.icon("check", { size: 18 }) : ""}
          </button>`).join("")}
        </div>
        <label class="beast-theme-opacity">
          <span class="beast-theme-opacity-icon">${BeastCore.icon("grid", { size: 21 })}</span>
          <span><strong>Store kortområder</strong><small>0 % fjerner rammerne, mens knapper og styring bevares</small></span>
          <input type="range" id="beastThemeOpacity" min="0" max="100" step="1" value="${theme.cardOpacity ?? 92}">
          <output id="beastThemeOpacityValue">${theme.cardOpacity ?? 92}%</output>
        </label>
        <div class="beast-theme-preview-wrap">
          <p class="beast-panel-title">Sådan ser det ud</p>
          <div class="beast-theme-preview-stage">
            <div class="beast-panel beast-theme-preview-card">
              <span class="beast-theme-preview-icon">${BeastCore.icon("grid", { size: 22 })}</span>
              <div><strong>Eksempelkort</strong><small>Farve, stil, baggrund og gennemsigtighed, vist live</small></div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  window.BeastTheme = {
    getSettings: () => ({ ...read(), resolved: document.documentElement.dataset.colorMode }),
    setMode: (mode) => save({ mode }),
    setPalette: (palette) => save({ palette }),
    setStyle: (style) => save({ style, cardOpacity: (STYLE_TOKENS[style] || STYLE_TOKENS.glass).cardOpacity }),
    setCardOpacity: (cardOpacity) => save({ cardOpacity }),
    apply: () => apply(read()),
    renderPanel
  };

  apply(read(), false);
})();
