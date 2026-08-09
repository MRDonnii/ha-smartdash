(function () {
  const STORAGE_KEY = "beast_theme_v1";
  const DEFAULTS = { mode: "auto", palette: "aurora", cardOpacity: 92 };
  const MODES = new Set(["auto", "dark", "light"]);
  const PALETTES = new Set(["aurora", "ocean", "ember", "sage", "sand", "slate"]);
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
    const root = document.documentElement;
    root.dataset.colorMode = resolved;
    root.dataset.themeMode = settings.mode;
    root.dataset.themePalette = settings.palette;
    root.dataset.floatingCards = settings.cardOpacity === 0 ? "true" : "false";
    root.style.setProperty("--card-opacity", String(settings.cardOpacity / 100));
    root.style.setProperty("--panel-border-opacity", String((settings.cardOpacity / 100 * 0.11).toFixed(3)));
    root.style.setProperty("--panel-shadow-opacity", String((settings.cardOpacity / 100 * 0.5).toFixed(3)));
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
      cardOpacity: Number.isFinite(Number(next.cardOpacity))
        ? Math.min(100, Math.max(0, Math.round(Number(next.cardOpacity))))
        : current.cardOpacity
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return apply(settings);
  }


  window.BeastTheme = {
    getSettings: () => ({ ...read(), resolved: document.documentElement.dataset.colorMode }),
    setMode: (mode) => save({ mode }),
    setPalette: (palette) => save({ palette }),
    setCardOpacity: (cardOpacity) => save({ cardOpacity }),
    apply: () => apply(read())
  };

  apply(read(), false);
})();
