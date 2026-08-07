(function () {
  const STORAGE_KEY = "beast_theme_v1";
  const DEFAULTS = { mode: "auto", palette: "aurora", cardOpacity: 92 };
  const MODES = new Set(["auto", "dark", "light"]);
  const PALETTES = new Set(["aurora", "ocean", "ember", "sage", "sand", "slate"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");

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
    const resolved = settings.mode === "auto" ? (media.matches ? "dark" : "light") : settings.mode;
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

  media.addEventListener?.("change", () => {
    const settings = read();
    if (settings.mode === "auto") apply(settings);
  });

  window.BeastTheme = {
    getSettings: () => ({ ...read(), resolved: document.documentElement.dataset.colorMode }),
    setMode: (mode) => save({ mode }),
    setPalette: (palette) => save({ palette }),
    setCardOpacity: (cardOpacity) => save({ cardOpacity }),
    apply: () => apply(read())
  };

  apply(read(), false);
})();
