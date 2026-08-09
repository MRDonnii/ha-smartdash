// Central page library. Standard pages are immutable templates; the user's
// active navigation is a small saved manifest, so removing a standard page
// never destroys its implementation and it can always be restored.
window.BeastPageManager = (() => {
  const STANDARD = [
    ["weather", "Vejr", "cloud"], ["rooms", "Rum", "grid"], ["cameras", "Kameraer", "camera"],
    ["security", "Sikkerhed", "shield"], ["music", "Musik", "music"], ["energy", "Energi", "bolt"],
    ["heating", "Varme", "thermometer"], ["car", "Bil", "car"], ["pool", "Pool", "droplet"],
    ["waste", "Kalender", "calendar"], ["robots", "Robotter", "robot"], ["printer", "3D Printer", "printer"]
  ].map(([id, label, icon]) => ({ id, label, icon, standard: true }));
  const ICONS = ["grid", "home", "cloud", "camera", "shield", "music", "bolt", "thermometer", "car", "droplet", "calendar", "robot", "printer", "sparkles"];
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const manifest = () => BeastConfig.get("pages") || { order: [], removed: [], custom: [], overrides: {} };
  const rememberManifest = () => { try { const history = JSON.parse(localStorage.getItem("beast-page-manifest-history") || "[]"); history.unshift({ at:new Date().toISOString(), data:manifest() }); localStorage.setItem("beast-page-manifest-history", JSON.stringify(history.slice(0,8))); } catch (_) {} };

  function allDefinitions() {
    const data = manifest(); const overrides = data.overrides || {};
    return [...STANDARD.map((page) => ({ ...page, ...(overrides[page.id] || {}) })), ...(Array.isArray(data.custom) ? data.custom.map((page) => ({ ...page, standard: false })) : [])];
  }
  function buildRailItems(baseItems) {
    const data = manifest(); const removed = new Set(data.removed || []);
    const overview = baseItems.find((item) => item.id === "overview"); const settings = baseItems.find((item) => item.id === "settings");
    const active = allDefinitions().filter((page) => !removed.has(page.id)); const order = Array.isArray(data.order) ? data.order : [];
    active.sort((a, b) => { const ai = order.indexOf(a.id), bi = order.indexOf(b.id); return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi); });
    return [overview, ...active, settings].filter(Boolean);
  }
  function open() {
    document.getElementById("beastPageManager")?.remove();
    const data = manifest(); const removed = new Set(data.removed || []); const pages = allDefinitions().filter((page) => !removed.has(page.id)); const deletedStandard = STANDARD.filter((page) => removed.has(page.id));
    const overlay = document.createElement("div"); overlay.id = "beastPageManager"; overlay.className = "beast-modal-overlay";
    const iconOptions = (selected) => ICONS.map((icon) => `<option value="${icon}" ${icon === selected ? "selected" : ""}>${icon}</option>`).join("");
    overlay.innerHTML = `<div class="beast-modal beast-page-manager-modal" role="dialog" aria-modal="true"><div class="beast-modal-header"><div><small>Navigation og views</small><h3>Administrer sider</h3></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div><div class="beast-modal-body"><p class="beast-page-editor-hint">Træk i håndtaget for at ændre rækkefølgen. Standardsider kan altid gendannes fra biblioteket.</p><div class="beast-page-manager-list">${pages.map((page, index) => `<article data-page-row="${escape(page.id)}" data-standard="${page.standard}"><button type="button" class="beast-page-manager-drag" data-page-drag aria-label="Flyt ${escape(page.label)}">${BeastCore.icon("grip", { size: 20 })}</button><span class="beast-page-manager-icon">${BeastCore.icon(page.icon || "grid", { size: 22 })}</span><label><small>Navn</small><input data-page-label value="${escape(page.label)}"></label><label><small>Ikon</small><select data-page-icon>${iconOptions(page.icon)}</select></label><div class="beast-page-manager-move"><button type="button" data-page-up ${index ? "" : "disabled"}>↑</button><button type="button" data-page-down ${index < pages.length - 1 ? "" : "disabled"}>↓</button></div><button type="button" class="beast-page-manager-remove" data-page-remove>Fjern</button></article>`).join("")}</div><section class="beast-page-library"><h4>Opret side</h4><div class="beast-page-create"><input data-new-page-name placeholder="Navn på ny side"><select data-new-page-icon>${iconOptions("grid")}</select><button type="button" class="beast-btn" data-create-page>${BeastCore.icon("plus", { size: 18 })} Tom side</button></div>${deletedStandard.length ? `<h4>Fjernede standardsider</h4><div class="beast-page-restore-grid">${deletedStandard.map((page) => `<button type="button" data-restore-page="${page.id}"><span>${BeastCore.icon(page.icon, { size: 22 })}</span><strong>${page.label}</strong><small>Opret igen</small></button>`).join("")}</div>` : ""}</section><button type="button" class="beast-btn beast-btn-primary" data-save-pages>Gem sider</button></div></div>`;
    document.body.appendChild(overlay);
    const list = overlay.querySelector(".beast-page-manager-list");
    const refreshMoveButtons = () => { const rows = [...list.querySelectorAll("[data-page-row]:not([hidden])")]; rows.forEach((row, index) => { row.querySelector("[data-page-up]").disabled = index === 0; row.querySelector("[data-page-down]").disabled = index === rows.length - 1; }); };
    list.querySelectorAll("[data-page-drag]").forEach((handle) => {
      let drag = null;
      handle.addEventListener("pointerdown", (event) => { event.preventDefault(); const row = handle.closest("[data-page-row]"); drag = { pointerId: event.pointerId, row }; handle.setPointerCapture?.(event.pointerId); row.classList.add("is-page-dragging"); });
      handle.addEventListener("pointermove", (event) => { if (!drag || event.pointerId !== drag.pointerId) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-page-row]"); if (!target || target === drag.row || target.hidden || !list.contains(target)) return; const rect = target.getBoundingClientRect(); list.insertBefore(drag.row, event.clientY < rect.top + rect.height / 2 ? target : target.nextElementSibling); refreshMoveButtons(); });
      const finish = (event) => { if (!drag || event.pointerId !== drag.pointerId) return; handle.releasePointerCapture?.(event.pointerId); drag.row.classList.remove("is-page-dragging"); drag = null; refreshMoveButtons(); };
      handle.addEventListener("pointerup", finish); handle.addEventListener("pointercancel", finish);
    });
    overlay.addEventListener("click", async (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      const row = event.target.closest("[data-page-row]");
      if (row && event.target.closest("[data-page-up]") && row.previousElementSibling) { list.insertBefore(row, row.previousElementSibling); refreshMoveButtons(); return; }
      if (row && event.target.closest("[data-page-down]") && row.nextElementSibling) { list.insertBefore(row.nextElementSibling, row); refreshMoveButtons(); return; }
      if (row && event.target.closest("[data-page-remove]")) { if (!window.confirm("Fjern siden fra navigationen? Standardsider kan altid gendannes.")) return; row.dataset.removed = "true"; row.hidden = true; refreshMoveButtons(); return; }
      const restore = event.target.closest("[data-restore-page]");
      if (restore) { removed.delete(restore.dataset.restorePage); await BeastConfig.set("pages", { ...data, removed: [...removed] }); overlay.remove(); open(); return; }
      if (event.target.closest("[data-create-page]")) {
        const name = overlay.querySelector("[data-new-page-name]").value.trim(); if (!name) return;
        const id = `custom_${Date.now()}`; const custom = [...(data.custom || []), { id, label: name, icon: overlay.querySelector("[data-new-page-icon]").value || "grid" }];
        rememberManifest(); await BeastConfig.set("pages", { ...data, custom, order: [...(data.order || pages.map((page) => page.id)), id] }); window.location.reload(); return;
      }
      if (event.target.closest("[data-save-pages]")) {
        const customById = new Map((data.custom || []).map((page) => [page.id, page])); const overrides = { ...(data.overrides || {}) }; const order = [];
        list.querySelectorAll("[data-page-row]").forEach((item) => { const id = item.dataset.pageRow; const isStandard = item.dataset.standard === "true"; if (item.dataset.removed === "true") removed.add(id); else { removed.delete(id); order.push(id); } const update = { label: item.querySelector("[data-page-label]").value.trim() || id, icon: item.querySelector("[data-page-icon]").value || "grid" }; if (isStandard) overrides[id] = update; else customById.set(id, { ...(customById.get(id) || { id }), ...update }); });
        rememberManifest(); await BeastConfig.set("pages", { order, removed: [...removed], custom: [...customById.values()].filter((page) => !removed.has(page.id)), overrides }); window.location.reload();
      }
    });
  }
  return { open, buildRailItems, standardPages: () => STANDARD.map((page) => ({ ...page })) };
})();
