(function () {
  function energyConfig() { return BeastConfig.get("panels.energy") || {}; }
  function POWER_ENTITY_ID() { return energyConfig().powerSensor; }
  function PRICE_ENTITY_ID() { return energyConfig().priceSensor; }
  function PRICE_FORECAST_ENTITY_ID() { return energyConfig().priceForecastSensor; }
  function TOMORROW_ENTITY_ID() { return energyConfig().tomorrowAvailableSensor; }
  function TOTAL_ENERGY_ID() { return energyConfig().totalEnergySensor; }
  function TOTAL_COST_ID() { return energyConfig().totalCostSensor; }
  function NOW_GROUPS() { return energyConfig().nowGroups || []; }
  function NOW_SUMMARY_IDS() { return [energyConfig().powerSensor, energyConfig().nowMeasuredSensor, energyConfig().nowUnmeasuredSensor]; }

  const TODAY_REFRESH_MS = 5 * 60 * 1000;

  let containerEl = null;
  let historyLoaded = false;
  let cachedHistoryPoints = [];
  let todayEnergyKwh = null;
  let todayCostKr = null;
  let priceView = "today";
  let energyView = "overview";
  let todayRefreshTimerId = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function startOfTodayIso() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  async function loadTodayDelta(entityId) {
    try {
      const result = await BeastAuth.haFetch(`/api/history/period/${startOfTodayIso()}?filter_entity_id=${entityId}&minimal_response`);
      const series = (result && result[0]) || [];
      const values = series.map((entry) => Number(entry.state ?? entry.s)).filter((v) => Number.isFinite(v));
      if (values.length < 2) return null;
      const delta = values[values.length - 1] - values[0];
      return delta >= 0 ? delta : null;
    } catch (error) {
      BeastCore.log(`Energi: kunne ikke beregne dagsforbrug (${error.message}).`);
      return null;
    }
  }

  function priceColor(price) {
    if (price < 1.5) return "var(--success)";
    if (price < 3) return "var(--warning)";
    return "var(--danger)";
  }

  function normalizePrices(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry, index) => {
      const value = Number(typeof entry === "number" ? entry : (entry?.price ?? entry?.value));
      const start = new Date(entry?.start || entry?.time || entry?.datetime || Date.now() + index * 3600000);
      return Number.isFinite(value) && !Number.isNaN(start.getTime()) ? { ...entry, price: value, start: start.toISOString() } : null;
    }).filter(Boolean);
  }

  function hourLabel(entry) {
    return `${String(new Date(entry.start).getHours()).padStart(2, "0")}:00`;
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function collectPriceDays(priceState, tomorrowState, forecastState) {
    const buckets = new Map();
    const add = (entries, impliedOffset = null) => {
      normalizePrices(entries).forEach((entry) => {
        const date = new Date(entry.start);
        if (impliedOffset !== null && (!entry.start || Number.isNaN(date.getTime()))) return;
        const key = localDateKey(date);
        const bucket = buckets.get(key) || [];
        bucket.push(entry);
        buckets.set(key, bucket);
      });
    };
    const inspect = (attributes) => {
      if (!attributes) return;
      Object.values(attributes).forEach((value) => {
        const entries = Array.isArray(value?.value) ? value.value : (Array.isArray(value) ? value : null);
        if (entries) add(entries);
      });
    };
    inspect(forecastState?.attributes);
    inspect(priceState?.attributes);
    add(tomorrowState?.attributes?.prices);

    return Array.from(buckets.entries()).map(([key, entries]) => {
      const unique = new Map();
      entries.forEach((entry) => unique.set(new Date(entry.start).getHours(), entry));
      const date = new Date(`${key}T12:00:00`);
      return {
        key,
        date,
        label: localDateKey(new Date()) === key ? "I dag" : date.toLocaleDateString("da-DK", { weekday: "short", day: "numeric" }),
        prices: Array.from(unique.values()).sort((a, b) => new Date(a.start) - new Date(b.start))
      };
    }).filter((day) => day.prices.length).sort((a, b) => a.key.localeCompare(b.key));
  }

  function priceLevel(price, average) {
    if (!Number.isFinite(price)) return { label: "Ukendt", cls: "" };
    if (Number.isFinite(average)) {
      if (price <= average * .78) return { label: "Meget billig", cls: "is-cheap" };
      if (price <= average * .95) return { label: "Billig", cls: "is-cheap" };
      if (price >= average * 1.25) return { label: "Dyr", cls: "is-expensive" };
    }
    return { label: "Normal", cls: "is-normal" };
  }

  function cheapestWindow(prices, length = 3) {
    if (prices.length < length) return null;
    let best = null;
    for (let i = 0; i <= prices.length - length; i += 1) {
      const slice = prices.slice(i, i + length);
      const average = slice.reduce((sum, item) => sum + item.price, 0) / length;
      if (!best || average < best.average) best = { start: slice[0], end: slice[length - 1], average };
    }
    return best;
  }

  function buildPriceChart(prices, highlightNow) {
    if (!Array.isArray(prices) || !prices.length) return "";
    const now = new Date();
    const values = prices.map((p) => p.price);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const bars = prices.map((p, index) => {
      const start = new Date(p.start);
      const isActive = highlightNow && start.getHours() === now.getHours() && start.toDateString() === now.toDateString();
      const isMin = p.price === min;
      const isMax = p.price === max;
      return `
        <button type="button" class="beast-energy-hour${isActive ? " is-current" : ""}${isMin ? " is-min" : ""}${isMax ? " is-max" : ""}" style="--bar-height:${Math.max(8, (p.price / max) * 100)}%" aria-label="${start.getHours()}:00, ${p.price.toFixed(2)} kroner pr. kilowatttime">
          <span class="beast-energy-hour-value">${p.price.toFixed(2)}</span>
          <i style="height:${Math.max(8, (p.price / max) * 100)}%;--bar-color:${priceColor(p.price)}"></i>
          <small>${index % 2 === 0 ? String(start.getHours()).padStart(2, "0") : ""}</small>
        </button>
      `;
    }).join("");
    return `<div class="beast-energy-hour-chart">${bars}</div>`;
  }

  // Averaging per bucket keeps the point count sane for a 24h series without
  // needing to smooth the shape afterwards — real HA history graphs (see
  // the "Strømkilder" reference card) draw actual recorded values with
  // straight segments between them, spikes and all, not a rounded curve.
  function bucketAverage(points, bucketCount) {
    if (points.length <= bucketCount) return points;
    const bucketSize = points.length / bucketCount;
    const out = [];
    for (let i = 0; i < bucketCount; i += 1) {
      const start = Math.floor(i * bucketSize);
      const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
      const bucket = points.slice(start, end);
      out.push(bucket.reduce((sum, v) => sum + v, 0) / bucket.length);
    }
    return out;
  }

  function buildDetailedUsageChart(points) {
    if (!points.length) return "";
    const maxPoints = 360;
    const values = bucketAverage(points, maxPoints).map((value) => value / 1000);
    const lastRealKw = points[points.length - 1] / 1000;
    if (points.length > 1 && values[values.length - 1] !== lastRealKw) values.push(lastRealKw);
    const width = 960;
    const height = 200;
    const left = 38;
    const right = 8;
    const top = 14;
    const bottom = 26;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const rawMax = Math.max(...values, .5);
    const yMax = Math.ceil(rawMax * 2) / 2;
    const coordinates = values.map((value, index) => [
      left + (index / Math.max(1, values.length - 1)) * plotWidth,
      top + plotHeight - (value / yMax) * plotHeight
    ]);
    const line = BeastCore.linearPath(coordinates);
    const area = `${line} L${left + plotWidth} ${top + plotHeight} L${left} ${top + plotHeight} Z`;
    const [lastX, lastY] = coordinates[coordinates.length - 1];
    const yGrid = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const y = top + plotHeight * ratio;
      const value = yMax * (1 - ratio);
      return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}"></line><text x="${left - 7}" y="${y + 4}" text-anchor="end">${value.toFixed(value % 1 ? 1 : 0)}</text>`;
    }).join("");
    const xLabels = ["24 t siden", "−18 t", "−12 t", "−6 t", "Nu"];
    const xGrid = xLabels.map((label, index) => {
      const x = left + plotWidth * (index / 4);
      return `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}"></line><text x="${x}" y="${height - 6}" text-anchor="${index === 0 ? "start" : index === 4 ? "end" : "middle"}">${label}</text>`;
    }).join("");
    // The end-point dot is a plain HTML circle, not an SVG one: this SVG's
    // viewBox is stretched independently on X and Y (preserveAspectRatio=
    // "none") to fill whatever rectangle the container ends up being,
    // which turns a true SVG <circle> into a visibly squashed ellipse.
    // Positioning it by percentage outside the SVG avoids that entirely.
    const dotLeftPct = (lastX / width) * 100;
    const dotTopPct = (lastY / height) * 100;
    return `<div class="beast-energy-line-chart-wrap">
      <svg class="beast-energy-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Strømforbrug de seneste 24 timer">
        <defs>
          <linearGradient id="beastEnergyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4fb8ff" stop-opacity=".5"></stop>
            <stop offset="100%" stop-color="#4fb8ff" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <g class="beast-energy-line-grid">${yGrid}${xGrid}</g>
        <text class="beast-energy-line-unit" x="${left}" y="8">kW</text>
        <path class="beast-energy-line-area" fill="url(#beastEnergyFill)" d="${area}"></path>
        <path class="beast-energy-line-shadow" d="${line}"></path>
        <path class="beast-energy-line-path" d="${line}"></path>
      </svg>
      <span class="beast-energy-line-dot" style="left:${dotLeftPct.toFixed(2)}%;top:${dotTopPct.toFixed(2)}%"></span>
    </div>`;
  }

  function wattValue(entityId) {
    const value = Number(BeastHaSocket.getState(entityId)?.state);
    return Number.isFinite(value) ? Math.max(0, value) : null;
  }

  function wattLabel(value) {
    if (!Number.isFinite(value)) return "–";
    return value >= 1000 ? `${(value / 1000).toFixed(2)} kW` : `${Math.round(value)} W`;
  }

  function nowEntityName(entityId) {
    const state = BeastHaSocket.getState(entityId);
    return state?.attributes?.friendly_name || entityId.split(".")[1].replaceAll("_", " ");
  }

  function renderViewBar() {
    return `<div class="beast-energy-viewbar">
      <div><small>Energi</small><strong>${energyView === "overview" ? "Forbrug og priser" : "Forbrug pr. enhed lige nu"}</strong></div>
      <div class="beast-energy-view-toggle">
        <button type="button" data-energy-view="overview" class="${energyView === "overview" ? "is-active" : ""}">Overblik</button>
        <button type="button" data-energy-view="now" class="${energyView === "now" ? "is-active" : ""}">Nu</button>
      </div>
    </div>`;
  }

  function renderNowView() {
    const main = wattValue(NOW_SUMMARY_IDS()[0]);
    const measured = wattValue(NOW_SUMMARY_IDS()[1]);
    const unmeasured = wattValue(NOW_SUMMARY_IDS()[2]);
    const activeCount = NOW_GROUPS().flatMap((group) => group.ids).filter((id) => (wattValue(id) || 0) > 2).length;
    return `
      ${renderViewBar()}
      <div class="beast-energy-now-summary">
        <div class="is-main" data-now-summary="main"><small>Hovedmåler</small><strong>${wattLabel(main)}</strong><span>Samlet effekt lige nu</span></div>
        <div data-now-summary="measured"><small>Målt total</small><strong>${wattLabel(measured)}</strong><span>Fordelt på kendte enheder</span></div>
        <div data-now-summary="unmeasured" class="${(unmeasured || 0) > 150 ? "is-warning" : ""}"><small>Umålt</small><strong>${wattLabel(unmeasured)}</strong><span>${main ? `${Math.max(0, ((unmeasured || 0) / main) * 100).toFixed(0)}% af hovedmåleren` : "Kontrol af strømregnskab"}</span></div>
        <div data-now-summary="active"><small>Aktive enheder</small><strong>${activeCount}</strong><span>Over 2 watt lige nu</span></div>
      </div>
      <div class="beast-energy-now-groups">
        ${NOW_GROUPS().map((group, groupIndex) => {
          const values = group.ids.map((id) => wattValue(id));
          const total = values.reduce((sum, value) => sum + (value || 0), 0);
          const active = values.filter((value) => (value || 0) > 2).length;
          return `<section class="beast-energy-device-group" data-now-group="${groupIndex}">
            <header><div><small>${active}/${group.ids.length} aktive</small><strong>${group.name}</strong></div><b>${wattLabel(total)}</b></header>
            <div>${group.ids.map((id, index) => {
              const value = values[index];
              const name = escapeHtml(nowEntityName(id));
              return `<article data-now-entity="${id}" class="${(value || 0) > 2 ? "is-active" : ""}${value === null ? " is-missing" : ""}">
                <i></i><span title="${name}">${name}</span><strong>${wattLabel(value)}</strong>
              </article>`;
            }).join("")}</div>
          </section>`;
        }).join("")}
      </div>
    `;
  }

  function updateNowView() {
    if (!containerEl) return;
    const main = wattValue(NOW_SUMMARY_IDS()[0]);
    const measured = wattValue(NOW_SUMMARY_IDS()[1]);
    const unmeasured = wattValue(NOW_SUMMARY_IDS()[2]);
    const activeCount = NOW_GROUPS().flatMap((group) => group.ids).filter((id) => (wattValue(id) || 0) > 2).length;
    const setSummary = (key, value, detail) => {
      const card = containerEl.querySelector(`[data-now-summary="${key}"]`);
      if (!card) return;
      card.querySelector("strong").textContent = value;
      if (detail) card.querySelector("span").textContent = detail;
    };
    setSummary("main", wattLabel(main));
    setSummary("measured", wattLabel(measured));
    setSummary("unmeasured", wattLabel(unmeasured), main ? `${Math.max(0, ((unmeasured || 0) / main) * 100).toFixed(0)}% af hovedmåleren` : "Kontrol af strømregnskab");
    setSummary("active", String(activeCount));
    containerEl.querySelector('[data-now-summary="unmeasured"]')?.classList.toggle("is-warning", (unmeasured || 0) > 150);

    NOW_GROUPS().forEach((group, groupIndex) => {
      const section = containerEl.querySelector(`[data-now-group="${groupIndex}"]`);
      if (!section) return;
      const values = group.ids.map((id) => wattValue(id));
      const total = values.reduce((sum, value) => sum + (value || 0), 0);
      const active = values.filter((value) => (value || 0) > 2).length;
      section.querySelector("header small").textContent = `${active}/${group.ids.length} aktive`;
      section.querySelector("header b").textContent = wattLabel(total);
      group.ids.forEach((id, index) => {
        const row = section.querySelector(`[data-now-entity="${id}"]`);
        if (!row) return;
        const value = values[index];
        row.classList.toggle("is-active", (value || 0) > 2);
        row.classList.toggle("is-missing", value === null);
        row.querySelector("strong").textContent = wattLabel(value);
      });
    });
  }

  async function loadHistory() {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await BeastAuth.haFetch(`/api/history/period/${start}?filter_entity_id=${POWER_ENTITY_ID()}&minimal_response`);
      const series = (result && result[0]) || [];
      return series.map((entry) => Number(entry.state ?? entry.s)).filter((v) => Number.isFinite(v));
    } catch (error) {
      BeastCore.log(`Energi: kunne ikke hente historik (${error.message}).`);
      return [];
    }
  }

  function render() {
    if (!containerEl) return;
    if (!POWER_ENTITY_ID() && !PRICE_ENTITY_ID()) {
      containerEl.innerHTML = BeastCore.notConfiguredMarkup("Energi", "Vælg hovedmåler og/eller elpris-sensor i Administration for at aktivere dette panel.");
      BeastCore.wireNotConfiguredLinks(containerEl);
      return;
    }
    containerEl.classList.toggle("is-now", energyView === "now");
    if (energyView === "now") {
      if (!containerEl.querySelector(".beast-energy-now-groups")) {
        containerEl.innerHTML = renderNowView();
        containerEl.querySelectorAll("[data-energy-view]").forEach((button) => button.addEventListener("click", () => {
          energyView = button.dataset.energyView;
          render();
        }));
      } else {
        updateNowView();
      }
      return;
    }
    const powerState = BeastHaSocket.getState(POWER_ENTITY_ID());
    const priceState = BeastHaSocket.getState(PRICE_ENTITY_ID());
    const tomorrowState = BeastHaSocket.getState(TOMORROW_ENTITY_ID());
    const forecastState = BeastHaSocket.getState(PRICE_FORECAST_ENTITY_ID());

    const powerKw = powerState && Number.isFinite(Number(powerState.state)) ? (Number(powerState.state) / 1000).toFixed(2) : "–";
    const price = priceState && Number.isFinite(Number(priceState.state)) ? Number(priceState.state) : null;

    const todayPrices = normalizePrices(priceState?.attributes?.prices || priceState?.attributes?.raw_today || priceState?.attributes?.today);
    const tomorrowPrices = normalizePrices(tomorrowState?.attributes?.prices || priceState?.attributes?.raw_tomorrow || priceState?.attributes?.tomorrow);
    const priceDays = collectPriceDays(priceState, tomorrowState, forecastState);
    const todayKey = localDateKey(new Date());
    if (!priceDays.some((day) => day.key === todayKey) && todayPrices.length) {
      priceDays.unshift({ key: todayKey, date: new Date(), label: "I dag", prices: todayPrices });
    }
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowKey = localDateKey(tomorrowDate);
    if (!priceDays.some((day) => day.key === tomorrowKey) && tomorrowPrices.length) {
      priceDays.push({ key: tomorrowKey, date: tomorrowDate, label: tomorrowDate.toLocaleDateString("da-DK", { weekday: "short", day: "numeric" }), prices: tomorrowPrices });
      priceDays.sort((a, b) => a.key.localeCompare(b.key));
    }
    if (priceView === "today") priceView = todayKey;
    if (priceView === "tomorrow") priceView = tomorrowKey;
    if (!priceDays.some((day) => day.key === priceView)) priceView = priceDays[0]?.key || todayKey;
    const activeDay = priceDays.find((day) => day.key === priceView);
    const activePrices = activeDay?.prices || [];
    const activeValues = activePrices.map((p) => p.price);
    const rangeMax = activeValues.length ? Math.max(...activeValues) : null;
    const rangeMin = activeValues.length ? Math.min(...activeValues) : null;
    const rangeAverage = activeValues.length ? activeValues.reduce((sum, value) => sum + value, 0) / activeValues.length : null;
    const cheapest = activePrices.length ? activePrices.reduce((best, item) => item.price < best.price ? item : best) : null;
    const dearest = activePrices.length ? activePrices.reduce((best, item) => item.price > best.price ? item : best) : null;
    const bestWindow = cheapestWindow(activePrices);
    const currentLevel = priceLevel(price, todayPrices.length ? todayPrices.reduce((sum, item) => sum + item.price, 0) / todayPrices.length : null);
    const priceDifference = price !== null && rangeAverage !== null ? ((price / rangeAverage) - 1) * 100 : null;
    const historyMin = cachedHistoryPoints.length ? Math.min(...cachedHistoryPoints) / 1000 : null;
    const historyMax = cachedHistoryPoints.length ? Math.max(...cachedHistoryPoints) / 1000 : null;
    const historyAvg = cachedHistoryPoints.length ? cachedHistoryPoints.reduce((sum, point) => sum + point, 0) / cachedHistoryPoints.length / 1000 : null;
    const powerNumber = powerState && Number.isFinite(Number(powerState.state)) ? Number(powerState.state) / 1000 : null;
    const loadLabel = powerNumber === null ? "" : powerNumber < 1 ? "Lav belastning" : powerNumber < 3 ? "Normal belastning" : "Høj belastning";
    const elapsedHours = Math.max(1, new Date().getHours() + new Date().getMinutes() / 60);
    const todayAveragePower = todayEnergyKwh !== null ? todayEnergyKwh / elapsedHours : null;
    const todayAveragePrice = todayCostKr !== null && todayEnergyKwh > 0 ? todayCostKr / todayEnergyKwh : null;
    const recommendation = price === null ? { cls: "", icon: "bolt", title: "Afventer aktuelle priser", detail: "Anbefalingen kommer automatisk" }
      : powerNumber !== null && powerNumber >= 5 ? { cls: "is-warning", icon: "bolt", title: "Højt forbrug lige nu", detail: bestWindow ? `${powerNumber.toFixed(1)} kW · flyt om muligt større forbrug til ${hourLabel(bestWindow.start)}–${String((new Date(bestWindow.end.start).getHours() + 1) % 24).padStart(2, "0")}:00` : `${powerNumber.toFixed(1)} kW lige nu` }
      : price >= 3 ? { cls: "is-warning", icon: "bolt", title: "Vent med større strømforbrug", detail: bestWindow ? `Bedste tretimers vindue er ${hourLabel(bestWindow.start)}–${String((new Date(bestWindow.end.start).getHours() + 1) % 24).padStart(2, "0")}:00` : "Prisen er høj lige nu" }
      : currentLevel.label === "Billig" ? { cls: "is-good", icon: "check", title: "Godt tidspunkt at bruge strøm", detail: `${price.toFixed(2)} kr/kWh lige nu` }
      : { cls: "", icon: "bolt", title: bestWindow ? `Planlæg større forbrug fra ${hourLabel(bestWindow.start)}` : "Normalt prisniveau", detail: bestWindow ? `Tre timer til ca. ${bestWindow.average.toFixed(2)} kr/kWh` : `${price.toFixed(2)} kr/kWh lige nu` };

    containerEl.innerHTML = `
      ${renderViewBar()}
      <div class="beast-energy-recommendation ${recommendation.cls}">${BeastCore.icon(recommendation.icon, { size: 22 })}<div><strong>${escapeHtml(recommendation.title)}</strong><span>${escapeHtml(recommendation.detail)}</span></div></div>
      <div class="beast-stat-grid">
        ${BeastCore.statTile({ icon: "bolt", label: "Forbrug nu", value: `${powerKw}<small>kW</small>`, meta: loadLabel })}
        ${BeastCore.statTile({ icon: "bolt", label: "Elpris nu", value: price !== null ? `${price.toFixed(2)}<small>kr/kWh</small>` : "–", meta: price !== null ? `${currentLevel.label}${priceDifference !== null ? ` · ${Math.abs(priceDifference).toFixed(0)}% ${priceDifference <= 0 ? "under" : "over"} snit` : ""}` : "" })}
        ${BeastCore.statTile({ icon: "grid", label: "Forbrug i dag", value: todayEnergyKwh !== null ? `${todayEnergyKwh.toFixed(1)}<small>kWh</small>` : "–", meta: todayAveragePower !== null ? `Gennemsnit ${todayAveragePower.toFixed(2)} kW` : "" })}
        ${BeastCore.statTile({ icon: "grid", label: "Pris i dag", value: todayCostKr !== null ? `${todayCostKr.toFixed(0)}<small>kr</small>` : "–", meta: todayAveragePrice !== null ? `Effektiv pris ${todayAveragePrice.toFixed(2)} kr/kWh` : "" })}
      </div>
      <div class="beast-energy-chart-wrap beast-energy-chart-price">
        <div class="beast-energy-chart-head">
          <span class="beast-panel-title">Elpris time for time</span>
          <div class="beast-content-toggle beast-energy-day-toggle">
            ${priceDays.map((day) => `<button type="button" class="beast-content-toggle-btn${priceView === day.key ? " is-active" : ""}" data-view="${day.key}">${day.label}</button>`).join("")}
          </div>
        </div>
        <div class="beast-energy-price-summary">
          ${rangeAverage !== null ? `
            <div><small>Gennemsnit</small><strong>${rangeAverage.toFixed(2)} <em>kr/kWh</em></strong></div>
            <div class="is-cheap"><small>Billigst kl. ${hourLabel(cheapest)}</small><strong>${cheapest.price.toFixed(2)} <em>kr/kWh</em></strong></div>
            <div class="is-expensive"><small>Dyrest kl. ${hourLabel(dearest)}</small><strong>${dearest.price.toFixed(2)} <em>kr/kWh</em></strong></div>
            ${bestWindow ? `<div class="is-best-time"><small>Bedste 3 timer</small><strong>${hourLabel(bestWindow.start)}–${String((new Date(bestWindow.end.start).getHours() + 1) % 24).padStart(2, "0")}:00 <em>· ${bestWindow.average.toFixed(2)} kr</em></strong></div>` : ""}
          ` : ""}
        </div>
        ${activeValues.length ? buildPriceChart(activePrices, priceView === todayKey) : `<p class="beast-music-empty">Ingen prisdata for den valgte dag.</p>`}
      </div>
      <div class="beast-energy-chart-wrap beast-energy-chart-usage">
        <div class="beast-energy-chart-head">
          <span class="beast-panel-title">Forbrug seneste 24 timer</span>
          <div class="beast-energy-price-range">
            ${historyAvg !== null ? `<span>Snit <strong>${historyAvg.toFixed(2)} kW</strong></span><span>Top <strong>${historyMax.toFixed(2)} kW</strong></span><span>Bund <strong>${historyMin.toFixed(2)} kW</strong></span>` : ""}
          </div>
        </div>
        ${cachedHistoryPoints.length ? buildDetailedUsageChart(cachedHistoryPoints) : '<p class="beast-music-empty">Henter historik…</p>'}
      </div>
    `;

    containerEl.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        priceView = btn.dataset.view;
        render();
      });
    });
    containerEl.querySelectorAll("[data-energy-view]").forEach((button) => button.addEventListener("click", () => {
      energyView = button.dataset.energyView;
      render();
    }));
  }

  function refreshTodayTotals() {
    loadTodayDelta(TOTAL_ENERGY_ID()).then((v) => { todayEnergyKwh = v; render(); });
    loadTodayDelta(TOTAL_COST_ID()).then((v) => { todayCostKr = v; render(); });
  }

  function init(root) {
    containerEl = root;
    containerEl.classList.add("beast-energy-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;
    const stableRender = BeastCore.stableUpdater(containerEl, render, 1200);

    BeastHaSocket.onStatusChange((status) => {
      if (status !== "connected") return;
      render();
      if (!historyLoaded) {
        historyLoaded = true;
        loadHistory().then((points) => { cachedHistoryPoints = points; render(); });
        refreshTodayTotals();
        window.clearInterval(todayRefreshTimerId);
        todayRefreshTimerId = window.setInterval(refreshTodayTotals, TODAY_REFRESH_MS);
      }
    });

    [POWER_ENTITY_ID(), PRICE_ENTITY_ID(), PRICE_FORECAST_ENTITY_ID(), TOMORROW_ENTITY_ID(), ...NOW_SUMMARY_IDS(), ...NOW_GROUPS().flatMap((group) => group.ids)].filter(Boolean).forEach((id) => {
      BeastHaSocket.subscribeEntity(id, stableRender);
    });
  }

  BeastCore.registerPanel("energy", "beastEnergyZone", init);
})();
