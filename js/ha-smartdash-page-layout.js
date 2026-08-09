// Shared contract for migrating existing specialised view widgets into the
// live card editor. A widget keeps its page-specific renderer/wiring while
// the layout layer owns id, visibility, label, position and size.
window.BeastPageLayout = (() => {
  const VERSION = 1;
  function normalize(widget, fallback = {}) {
    const source = widget && typeof widget === "object" ? widget : {};
    return {
      id: typeof source.id === "string" && source.id ? source.id : fallback.id || `widget_${Date.now()}`,
      type: source.type || fallback.type || "special",
      label: typeof source.label === "string" ? source.label : (fallback.label || ""),
      enabled: source.enabled !== false,
      desktop: { w: Math.max(1, Math.min(12, Number(source.desktop?.w) || Number(fallback.desktop?.w) || 4)), h: Math.max(1, Math.min(2, Number(source.desktop?.h) || Number(fallback.desktop?.h) || 1)) },
      tablet: { w: Math.max(1, Math.min(2, Number(source.tablet?.w) || Number(fallback.tablet?.w) || 1)), h: Math.max(1, Math.min(2, Number(source.tablet?.h) || Number(fallback.tablet?.h) || 1)) },
      portrait: { h: Math.max(1, Math.min(2, Number(source.portrait?.h) || Number(fallback.portrait?.h) || 1)) },
      settings: source.settings && typeof source.settings === "object" ? source.settings : (fallback.settings || {})
    };
  }
  function migrate(list, defaults = []) {
    const current = Array.isArray(list) ? list : [];
    const fallback = new Map((Array.isArray(defaults) ? defaults : []).map((item) => [item.id, item]));
    return current.map((item) => normalize(item, fallback.get(item?.id))).concat((Array.isArray(defaults) ? defaults : []).filter((item) => !current.some((existing) => existing?.id === item.id)).map((item) => normalize(item)));
  }
  return { VERSION, normalize, migrate };
})();
