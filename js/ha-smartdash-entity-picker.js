// Shared "pick an entity" helper used by the Opsætning (Setup) panel and by
// any panel that needs an inline picker. Not a UI component library — just
// functions that turn a domain/device_class/area filter into a ranked
// candidate list and the <option> markup for a <select>, so every panel's
// setup section looks and behaves the same way.
const BeastEntityPicker = (() => {
  function friendlyName(entityId) {
    const state = BeastHaSocket.getState(entityId);
    const fromState = state?.attributes?.friendly_name;
    if (fromState) return fromState;
    const meta = BeastRegistry.getEntityMeta ? BeastRegistry.getEntityMeta(entityId) : null;
    if (meta?.name || meta?.originalName) return meta.name || meta.originalName;
    return entityId.split(".").slice(1).join(".").replaceAll("_", " ");
  }

  function allEntityIdsForDomain(domain) {
    const states = BeastHaSocket.getAllStates();
    return Array.from(states.keys()).filter((id) => id.startsWith(`${domain}.`));
  }

  // Ranking is deliberately domain/device_class-first and keyword-second:
  // device_class is a structured, language-independent signal every HA
  // instance has, so a "main power sensor" picker works the same in a
  // Danish or English house. Keyword hints (e.g. "main", "total") are only
  // ever a soft tiebreaker on top of that, never a requirement.
  function candidates({ domain, deviceClasses, areaId, keywordHints } = {}) {
    if (!domain) return [];
    let ids = allEntityIdsForDomain(domain);
    if (areaId) {
      const inArea = new Set(BeastRegistry.getAreaEntityIds(areaId, domain));
      ids = ids.filter((id) => inArea.has(id));
    }
    if (deviceClasses && deviceClasses.length) {
      ids = ids.filter((id) => deviceClasses.includes(BeastHaSocket.getState(id)?.attributes?.device_class));
    }
    const lowerHints = (keywordHints || []).map((word) => word.toLowerCase());
    const scored = ids.map((id) => {
      const name = friendlyName(id);
      let score = 0;
      if (deviceClasses && deviceClasses.length && BeastHaSocket.getState(id)?.attributes?.device_class === deviceClasses[0]) score += 2;
      if (lowerHints.length && lowerHints.some((word) => `${id} ${name}`.toLowerCase().includes(word))) score += 1;
      return { id, name, score };
    });
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scored;
  }

  function bestGuess(opts) {
    const list = candidates(opts);
    return list.length ? list[0].id : null;
  }

  function optionsHtml(list, selected) {
    return list.map((item) => `<option value="${item.id}"${item.id === selected ? " selected" : ""}>${item.name} — ${item.id}</option>`).join("");
  }

  function selectHtml({ id, domain, deviceClasses, areaId, keywordHints, selected, emptyLabel = "— Vælg —" } = {}) {
    const list = candidates({ domain, deviceClasses, areaId, keywordHints });
    const empty = `<option value=""${selected ? "" : " selected"}>${emptyLabel}</option>`;
    return `<select id="${id}" class="beast-entity-picker" data-entity-picker>${empty}${optionsHtml(list, selected)}</select>`;
  }

  function multiSelectHtml({ id, domain, deviceClasses, areaId, keywordHints, selectedIds = [] } = {}) {
    const list = candidates({ domain, deviceClasses, areaId, keywordHints });
    const options = list.map((item) => `<option value="${item.id}"${selectedIds.includes(item.id) ? " selected" : ""}>${item.name} — ${item.id}</option>`).join("");
    return `<select id="${id}" class="beast-entity-picker" data-entity-picker multiple size="6">${options}</select>`;
  }

  return { candidates, bestGuess, selectHtml, multiSelectHtml, friendlyName, allEntityIdsForDomain };
})();
