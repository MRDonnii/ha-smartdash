(function () {
  const ENERGY_NATIVE_DEFAULTS = [
    { id: "energy-summary", kind: "energy-summary", type: "energy-summary", templateId: "overview-energy", label: "Nøgletal", enabled: true, desktop: { x: 1, y: 2, w: 3, h: 7 }, bindings: {} },
    { id: "energy-recommendation", kind: "energy-recommendation", type: "energy-recommendation", label: "Energiassistent", enabled: true, desktop: { x: 4, y: 2, w: 9, h: 1 }, bindings: {} },
    { id: "energy-price-chart", kind: "energy-price-chart", type: "energy-price-card", templateId: "energy-price-card", label: "Elpris time for time", enabled: true, desktop: { x: 4, y: 3, w: 9, h: 3 }, bindings: {}, options: { days: 7, stats: true } },
    { id: "energy-usage-chart", kind: "energy-usage-chart", type: "energy-usage-card", templateId: "energy-usage-card", label: "Forbrug i dag", enabled: true, desktop: { x: 4, y: 6, w: 9, h: 3 }, bindings: {}, options: { stats: true } },
    { id: "energy-now-summary", kind: "energy-now-summary", type: "energy-now-summary", label: "Forbrug lige nu", enabled: true, desktop: { x: 1, y: 2, w: 12, h: 1 }, bindings: {} },
    { id: "energy-devices", kind: "energy-devices", type: "energy-devices", label: "Forbrug pr. enhed", enabled: true, desktop: { x: 1, y: 3, w: 12, h: 5 }, bindings: {} },
  ];
  function energyCardsPath() { return window.BeastNativePageEditor?.storagePath?.("energy") || "pageLayouts.energy.nativeCards"; }

  function energyNativeCards() {
    const saved = BeastConfig.get(energyCardsPath());
    const cards = Array.isArray(saved) && saved.length ? saved : ENERGY_NATIVE_DEFAULTS;
    return cards.map((card) => {
      const fallback = ENERGY_NATIVE_DEFAULTS.find((item) => item.id === card.id || item.kind === card.kind || item.kind === card.type) || {};
      const merged = { ...fallback, ...card, kind: card.kind || fallback.kind || card.type || card.id, bindings: { ...(fallback.bindings || {}), ...(card.bindings || {}) }, desktop: { ...(fallback.desktop || {}), ...(card.desktop || {}) } };
      if (merged.kind === "energy-usage-chart" && merged.label === "Forbrug seneste 24 timer") merged.label = "Forbrug i dag";
      return merged;
    });
  }

  function nativeCard(id) { return energyNativeCards().find((card) => card.id === id || card.kind === id); }
  function nativeOption(id, key, fallback) { const value = nativeCard(id)?.options?.[key]; return value === undefined ? fallback : value; }
  function nativeBinding(id, key, fallback) { return nativeCard(id)?.bindings?.[key] || fallback; }
  function energyConfig() { return BeastConfig.get("panels.energy") || {}; }
  function POWER_ENTITY_ID() { return nativeBinding("energy-summary", "power", nativeBinding("energy-usage-chart", "power", energyConfig().powerSensor)); }
  function PRICE_ENTITY_ID() { return nativeBinding("energy-summary", "price", nativeBinding("energy-price-chart", "price", energyConfig().priceSensor)); }
  function PRICE_FORECAST_ENTITY_ID() { return nativeBinding("energy-price-chart", "forecast", energyConfig().priceForecastSensor); }
  function TOMORROW_ENTITY_ID() { return nativeBinding("energy-price-chart", "tomorrow", energyConfig().tomorrowAvailableSensor); }
  function TOTAL_ENERGY_ID() { return nativeBinding("energy-summary", "today", nativeBinding("energy-usage-chart", "energy", energyConfig().totalEnergySensor)); }
  function TOTAL_COST_ID() { return nativeBinding("energy-summary", "cost", nativeBinding("energy-usage-chart", "cost", energyConfig().totalCostSensor)); }
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
  // Which utility the page is showing. Electricity is the default because
  // it is the one every install has; the others appear only when set up.
  let utilityView = "electric";
  let utilityHistoryPoints = [];
  let utilityHistoryLoading = false;
  // Heat/water have no draggable cards to rearrange, so they skip the
  // heavier native-card editor entirely (see the render() branch below) --
  // but the chart-type/colour toggle is still edit-mode-only everywhere
  // else in the app, and it needs *some* way to be reached here too. This
  // is that page's own lightweight edit toggle, independent of the
  // electric tab's is-native-editing.
  let utilityEditing = false;
  let todayRefreshTimerId = null;
  let historyRefreshPending = false;
  let nativeEditing = false;
  let nativeDraftCards = null;

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

  function numericState(entityId) {
    const state = BeastHaSocket.getState(entityId);
    const value = Number(state?.state);
    return state && Number.isFinite(value) && !["unknown","unavailable"].includes(state.state) ? { state, value } : null;
  }

  function powerWatts(entityId) {
    const reading = numericState(entityId);
    if (!reading) return null;
    const unit = String(reading.state.attributes?.unit_of_measurement || "W").toLowerCase();
    if (unit === "kw") return Math.max(0, reading.value * 1000);
    if (unit === "mw") return Math.max(0, reading.value * 1000000);
    return Math.max(0, reading.value);
  }

  function directTodayValue(entityId, kind) {
    const reading = numericState(entityId);
    if (!reading || reading.value < 0) return null;
    const unit = String(reading.state.attributes?.unit_of_measurement || "").toLowerCase();
    if (kind === "energy") {
      if (unit === "wh") return reading.value / 1000;
      if (unit === "mwh") return reading.value * 1000;
    }
    return reading.value;
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
        label: localDateKey(new Date()) === key ? "I dag" : date.toLocaleDateString(window.HASmartdashI18n?.locale || "da-DK", { weekday: "short", day: "numeric" }),
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


  function buildPriceLineChart(prices, highlightNow, min, max) {
    const width = 960;
    const height = 190;
    const left = 40;
    const right = 10;
    const top = 12;
    const bottom = 26;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = prices.map((p) => p.price);
    const yMax = max * 1.05 || 1;
    const yMin = Math.min(0, min);
    const range = yMax - yMin || 1;
    const coordinates = prices.map((p, index) => [
      left + (index / Math.max(1, prices.length - 1)) * plotWidth,
      top + plotHeight - ((p.price - yMin) / range) * plotHeight
    ]);
    const line = BeastCore.linearPath(coordinates);
    // The colour bands span the day's actual price range, not the axis: the
    // axis starts at 0, so with prices sitting between (say) 1.50 and 2.70
    // every hour -- including the cheapest -- would land in the top, red
    // part of the scale. Anchoring green to the cheapest hour and red to
    // the dearest also makes the line agree with the hour dots, which are
    // coloured that way already.
    const yForPrice = (price) => top + plotHeight - ((price - yMin) / range) * plotHeight;
    const stroke = BeastCore.chartLineStroke(coordinates, values, {
      width, height, top: yForPrice(max), bottom: yForPrice(min)
    });
    const yGrid = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const y = top + plotHeight * ratio;
      const value = yMin + range * (1 - ratio);
      return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}"></line><text x="${left - 7}" y="${y + 4}" text-anchor="end">${value.toFixed(1)}</text>`;
    }).join("");
    const now = new Date();
    // A dot per hour, not just on the extremes: the data really is hourly,
    // so every hour should be readable as its own point (and hoverable for
    // its exact price). Cheapest/dearest/now stay bigger so they still
    // stand out among them.
    const colorSettings = BeastCore.chartColorSettings();
    const priceRange = (max - min) || 1;
    const marks = prices.map((p, index) => {
      const start = new Date(p.start);
      const isNow = highlightNow && start.getHours() === now.getHours() && start.toDateString() === now.toDateString();
      const isMin = p.price === min;
      const isMax = p.price === max;
      const [x, y] = coordinates[index];
      const cls = isNow ? " is-now" : isMin ? " is-min" : isMax ? " is-max" : "";
      const radius = isNow ? 5.5 : (isMin || isMax) ? 4.5 : 2.6;
      // Plain hours take the value's own colour so the dots read as part of
      // the line rather than as separate markers.
      const fill = cls ? "" : ` style="fill:${colorSettings.mode === "usage" ? BeastCore.chartColorForRatio((p.price - min) / priceRange, colorSettings) : colorSettings.static}"`;
      return `<circle class="beast-energy-price-dot${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}"${fill}><title>${String(start.getHours()).padStart(2, "0")}:00 · ${p.price.toFixed(2)} kr/kWh</title></circle>`;
    }).join("");
    const xLabels = prices.map((p, index) => {
      const hour = new Date(p.start).getHours();
      if (hour % 6 || prices.length < 6) return "";
      const x = coordinates[index][0];
      return `<line class="beast-energy-price-hourline" x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}"></line><text x="${x}" y="${height - 6}" text-anchor="middle">${String(hour).padStart(2, "0")}</text>`;
    }).join("");
    return `<div class="beast-energy-price-line">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Elpris time for time">
        <defs>${stroke.defs}</defs>
        <g class="beast-energy-line-grid">${yGrid}${xLabels}</g>
        <text class="beast-energy-line-unit" x="${left}" y="8">kr/kWh</text>
        <path class="beast-energy-price-path" d="${line}" style="stroke:${stroke.stroke}"></path>
        ${marks}
      </svg>
    </div>`;
  }

  function buildPriceChart(prices, highlightNow) {
    if (!Array.isArray(prices) || !prices.length) return "";
    const now = new Date();
    const values = prices.map((p) => p.price);
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (BeastCore.chartType(PRICE_CHART_KEY) === "line") return buildPriceLineChart(prices, highlightNow, min, max);
    const bars = prices.map((p, index) => {
      const start = new Date(p.start);
      const isActive = highlightNow && start.getHours() === now.getHours() && start.toDateString() === now.toDateString();
      const isMin = p.price === min;
      const isMax = p.price === max;
      return `
        <button type="button" class="beast-energy-hour${isActive ? " is-current" : ""}${isMin ? " is-min" : ""}${isMax ? " is-max" : ""}" style="--bar-height:${Math.max(8, (p.price / max) * 100)}%" aria-label="${start.getHours()}:00, ${p.price.toFixed(2)} kroner pr. kilowatttime">
          <span class="beast-energy-hour-value">${p.price.toFixed(2)}</span>
          <i style="height:${Math.max(8, (p.price / max) * 100)}%;--bar-color:${BeastCore.chartColorSettings().mode === "usage" ? BeastCore.chartColorForRatio((p.price - min) / ((max - min) || 1)) : priceColor(p.price)}"></i>
          <small>${index % 2 === 0 ? String(start.getHours()).padStart(2, "0") : ""}</small>
        </button>
      `;
    }).join("");
    return `<div class="beast-energy-hour-chart">${bars}</div>`;
  }

  // Averaging per bucket keeps the point count sane for today's series without
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

  // Shared by the Energy page and the front page's own usage graph, so the
  // choice follows the household rather than one screen -- picking bars on
  // the wall panel shows bars on a phone too.
  // The Energy page's usage graph is the electricity meter, so it shares
  // the front page's "electric" key rather than having a separate answer --
  // heat and water get their own, set on the front page's energy card.
  const USAGE_CHART_KEY = "overview.utility.electric";
  const PRICE_CHART_KEY = "energy.price";

  function usageChartType() { return BeastCore.chartType(USAGE_CHART_KEY); }

  function usageChartToggleMarkup() {
    return BeastCore.chartTypeToggleMarkup(USAGE_CHART_KEY, "");
  }

  // Same axes, grid, scale and data as the line version -- only the series
  // itself is drawn as discrete columns. Bars are averaged into far fewer
  // buckets than the line's 360 points: at one bar per raw sample they'd be
  // sub-pixel slivers, which reads as noise rather than as a bar chart.
  // Rounds the axis top to something readable for whatever the meter
  // measures: half-units for a few kW, tens or hundreds for litres an hour.
  function niceAxisMax(rawMax) {
    if (rawMax <= 5) return Math.ceil(rawMax * 2) / 2;
    if (rawMax <= 50) return Math.ceil(rawMax / 5) * 5;
    if (rawMax <= 500) return Math.ceil(rawMax / 50) * 50;
    return Math.ceil(rawMax / 500) * 500;
  }

  function buildDetailedUsageBars(points, def) {
    if (!points.length) return "";
    const barCount = 48;
    const scale = def?.scale ?? 0.001;
    const values = bucketAverage(points, Math.min(barCount, points.length)).map((value) => value * scale);
    const width = 960;
    const height = 200;
    const left = 38;
    const right = 8;
    const top = 14;
    const bottom = 26;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const rawMax = Math.max(...values, .5);
    const yMax = niceAxisMax(rawMax);
    const slot = plotWidth / values.length;
    const barWidth = Math.max(1.5, slot * 0.68);
    const bars = values.map((value, index) => {
      const barHeight = Math.max(1, (value / yMax) * plotHeight);
      const x = left + slot * index + (slot - barWidth) / 2;
      const y = top + plotHeight - barHeight;
      return `<rect class="beast-energy-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="${Math.min(2, barWidth / 2).toFixed(2)}" style="fill:${BeastCore.chartColorForRatio(value / (yMax || 1))}"><title>${value.toFixed(2)} kW</title></rect>`;
    }).join("");
    const yGrid = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const y = top + plotHeight * ratio;
      const value = yMax * (1 - ratio);
      return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}"></line><text x="${left - 7}" y="${y + 4}" text-anchor="end">${value >= 100 ? Math.round(value) : value.toFixed(value % 1 ? 1 : 0)}</text>`;
    }).join("");
    const now = new Date();
    const elapsedMinutes = now.getHours() * 60 + now.getMinutes();
    const xLabels = Array.from({ length: 5 }, (_, index) => {
      if (index === 4) return "Nu";
      const minutes = Math.round((elapsedMinutes * index) / 4);
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    });
    const xGrid = xLabels.map((label, index) => {
      const x = left + plotWidth * (index / 4);
      return `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}"></line><text x="${x}" y="${height - 6}" text-anchor="${index === 0 ? "start" : index === 4 ? "end" : "middle"}">${label}</text>`;
    }).join("");
    return `<div class="beast-energy-line-chart-wrap">
      <svg class="beast-energy-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Strømforbrug i dag fra midnat til nu, vist som søjler">
        <g class="beast-energy-line-grid">${yGrid}${xGrid}</g>
        <text class="beast-energy-line-unit" x="${left}" y="8">${escapeHtml(def?.rateUnit || "kW")}</text>
        <g class="beast-energy-bars">${bars}</g>
      </svg>
    </div>`;
  }

  function buildUsageChart(points) {
    return usageChartType() === "bars" ? buildDetailedUsageBars(points) : buildDetailedUsageChart(points);
  }

  function buildDetailedUsageChart(points, def) {
    if (!points.length) return "";
    const maxPoints = 360;
    const scale = def?.scale ?? 0.001;
    const values = bucketAverage(points, maxPoints).map((value) => value * scale);
    const lastRealKw = points[points.length - 1] * scale;
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
    const yMax = niceAxisMax(rawMax);
    const coordinates = values.map((value, index) => [
      left + (index / Math.max(1, values.length - 1)) * plotWidth,
      top + plotHeight - (value / yMax) * plotHeight
    ]);
    // Smoothed the same way as the front page's usage graph so the two read
    // as the same chart at different sizes -- the data is untouched, only
    // the joins between points are rounded (see catmullRomPath).
    const line = BeastCore.catmullRomPath(coordinates);
    const area = `${line} L${left + plotWidth} ${top + plotHeight} L${left} ${top + plotHeight} Z`;
    const [lastX, lastY] = coordinates[coordinates.length - 1];
    const yGrid = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const y = top + plotHeight * ratio;
      const value = yMax * (1 - ratio);
      return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}"></line><text x="${left - 7}" y="${y + 4}" text-anchor="end">${value >= 100 ? Math.round(value) : value.toFixed(value % 1 ? 1 : 0)}</text>`;
    }).join("");
    const now = new Date();
    const elapsedMinutes = now.getHours() * 60 + now.getMinutes();
    const xLabels = Array.from({ length: 5 }, (_, index) => {
      if (index === 4) return "Nu";
      const minutes = Math.round((elapsedMinutes * index) / 4);
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    });
    const xGrid = xLabels.map((label, index) => {
      const x = left + plotWidth * (index / 4);
      return `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}"></line><text x="${x}" y="${height - 6}" text-anchor="${index === 0 ? "start" : index === 4 ? "end" : "middle"}">${label}</text>`;
    }).join("");
    // The end-point dot is a plain HTML circle, not an SVG one: this SVG's
    // viewBox is stretched independently on X and Y (preserveAspectRatio=
    // "none") to fill whatever rectangle the container ends up being,
    // which turns a true SVG <circle> into a visibly squashed ellipse.
    // Positioning it by percentage outside the SVG avoids that entirely.
    const bandBounds = { width, height, top, bottom: top + plotHeight };
    const lineGradient = BeastCore.chartLineStroke(coordinates, values, bandBounds);
    const areaFill = BeastCore.chartAreaFill(coordinates, values, bandBounds);
    const dotLeftPct = (lastX / width) * 100;
    const dotTopPct = (lastY / height) * 100;
    return `<div class="beast-energy-line-chart-wrap">
      <svg class="beast-energy-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Strømforbrug i dag fra midnat til nu">
        <defs>
          ${lineGradient.defs}
          ${areaFill.defs}
        </defs>
        <g class="beast-energy-line-grid">${yGrid}${xGrid}</g>
        <text class="beast-energy-line-unit" x="${left}" y="8">${escapeHtml(def?.rateUnit || "kW")}</text>
        <path class="beast-energy-line-area" fill="${areaFill.fill}" mask="${areaFill.mask}" d="${area}"></path>
        <path class="beast-energy-line-path" d="${line}" style="stroke:${lineGradient.stroke}"></path>
      </svg>
      <span class="beast-energy-line-dot" style="left:${dotLeftPct.toFixed(2)}%;top:${dotTopPct.toFixed(2)}%"></span>
    </div>`;
  }

  function wattValue(entityId) {
    return powerWatts(entityId);
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
    // "Nu" is the per-device wattage breakdown -- it only exists for
    // electricity (NOW_GROUPS() is wired to electrical circuits), so the
    // toggle has nothing to switch to on the heat/water tabs and is left
    // out there rather than shown pointing at a view that doesn't apply.
    const isElectric = utilityView === "electric";
    const title = !isElectric ? (utilityDefs()[utilityView]?.label || "Forbrug")
      : energyView === "overview" ? "Forbrug og priser" : "Forbrug pr. enhed lige nu";
    const tabs = utilityTabsMarkup();
    // With more than one utility set up, El/Varme/Vand IS the "which page
    // am I on" signal -- clearer than the small eyebrow text ever was -- so
    // it takes the top-left slot that text used to occupy. Rendered here in
    // the always-correctly-positioned viewbar row rather than lower in the
    // page, which is where it previously landed in an unpositioned grid
    // cell and got pushed to the bottom of the whole layout. A
    // single-utility install (almost everyone, since heat/water are
    // opt-in) never sees tabs and keeps the original text unchanged.
    const left = tabs || `<div><small>Energi</small><strong>${escapeHtml(title)}</strong></div>`;
    return `<div class="beast-energy-viewbar">
      ${left}
      ${isElectric ? `<div class="beast-energy-view-toggle">
        <button type="button" data-energy-view="overview" class="${energyView === "overview" ? "is-active" : ""}">Overblik</button>
        <button type="button" data-energy-view="now" class="${energyView === "now" ? "is-active" : ""}">Nu</button>
      </div>` : ""}
    </div>`;
  }

  function applyNativeLayout(cardsOverride = null) {
    if (!containerEl) return;
    const selectors = {
      "energy-summary": ".beast-stat-grid",
      "energy-recommendation": ".beast-energy-recommendation",
      "energy-price-chart": ".beast-energy-chart-price",
      "energy-usage-chart": ".beast-energy-chart-usage",
      "energy-now-summary": ".beast-energy-now-summary",
      "energy-devices": ".beast-energy-now-groups",
    };
    containerEl.querySelectorAll(":scope > .beast-energy-native-clone").forEach((element) => element.remove());
    containerEl.classList.add("has-native-layout");
    const cards = cardsOverride || energyNativeCards();
    let runtimeCards = cards;
    if (!cardsOverride) {
      // Overview and Now share one persisted card model, but only one set is
      // rendered at a time. Cards belonging to the inactive view are not
      // "missing" and must not trigger the adaptive full-width stack.
      const activeKinds = energyView === "now"
        ? new Set(["energy-now-summary", "energy-devices"])
        : new Set(["energy-summary", "energy-recommendation", "energy-price-chart", "energy-usage-chart"]);
      const activeCards = cards.filter((card) => activeKinds.has(card.kind || card.type || card.id));
      const visible = activeCards.filter((card) => card.enabled !== false && containerEl.querySelector(selectors[card.kind || card.type || card.id])).map((card) => ({ ...card, desktop:{ ...(card.desktop || {}) } }));
      runtimeCards = visible;
      if (visible.length < activeCards.length && visible.length) {
        const baseHeight = Math.max(1, Math.floor(7 / visible.length));
        let nextY = 2;
        visible.forEach((card,index) => {
          const height = index === visible.length - 1 ? 9 - nextY : baseHeight;
          card.desktop = { ...card.desktop, x:1, y:nextY, w:12, h:Math.max(1,height) };
          nextY += height;
        });
        runtimeCards = visible;
      }
    }
    const usedKinds = new Set();
    cards.forEach((card, index) => {
      const kind = card.kind || card.type || card.id;
      const source = containerEl.querySelector(selectors[kind]);
      let element = source;
      if (source && usedKinds.has(kind)) {
        element = source.cloneNode(true);
        element.classList.add("beast-energy-native-clone");
        element.querySelectorAll(".beast-energy-native-drag,.beast-energy-native-resize").forEach((control) => control.remove());
        containerEl.appendChild(element);
      }
      if (!element) return;
      const runtimeCard = runtimeCards.find((item) => item.id === card.id);
      const desktop = runtimeCard?.desktop || card.desktop;
      usedKinds.add(kind);
      element.classList.add("beast-energy-native-card");
      element.dataset.energyNativeCard = card.id;
      element.dataset.energyNativeKind = kind;
      element.style.setProperty("--energy-native-order", String(index));
      element.style.setProperty("--energy-native-w", String(Math.max(1, Math.min(12, Number(desktop?.w) || 12))));
      element.style.setProperty("--energy-native-h", String(Math.max(1, Math.min(8, Number(desktop?.h) || 1))));
      element.style.setProperty("--energy-native-x", String(Math.max(1, Math.min(12, Number(desktop?.x) || 1))));
      element.style.setProperty("--energy-native-y", String(Math.max(2, Number(desktop?.y) || 2)));
      element.classList.toggle("is-layout-hidden", !runtimeCard);
      const title = element.querySelector(".beast-panel-title"); if (title && card.label) title.textContent = card.label;
    });
  }

  function exitNativeEditor(save) {
    if (!nativeEditing) return;
    if (save && nativeDraftCards) BeastConfig.set(energyCardsPath(), nativeDraftCards);
    nativeEditing = false;
    nativeDraftCards = null;
    window.beastCardEditorActive = false;
    containerEl?.classList.remove("is-native-editing");
    containerEl?.querySelectorAll(".beast-energy-native-drag,.beast-energy-native-resize").forEach((control) => control.remove());
    document.getElementById("beastEnergyNativeEditBar")?.remove();
    // The Nu view normally updates values in place instead of rebuilding its
    // DOM. Reapply the persisted model explicitly so Cancel immediately
    // restores temporary drag/resize changes there as well.
    applyNativeLayout(energyNativeCards());
    render();
  }

  function syncNativeOrderFromDom() {
    if (!nativeDraftCards) return;
    const visible = Array.from(containerEl.querySelectorAll(":scope > .beast-energy-native-card")).map((element) => element.dataset.energyNativeCard);
    const visibleSet = new Set(visible);
    const orderedVisible = visible.map((id) => nativeDraftCards.find((card) => card.id === id)).filter(Boolean);
    nativeDraftCards = [...orderedVisible, ...nativeDraftCards.filter((card) => !visibleSet.has(card.id))];
    applyNativeLayout(nativeDraftCards);
  }

  function wireNativeCardEdit(element) {
    const card = nativeDraftCards.find((item) => item.id === element.dataset.energyNativeCard);
    if (!card) return;
    const drag = document.createElement("span"); drag.className = "beast-energy-native-drag"; drag.innerHTML = BeastCore.icon("grip", { size: 18 });
    const resize = document.createElement("span"); resize.className = "beast-energy-native-resize";
    element.append(drag, resize);
    let dragging = null;
    drag.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); dragging = event.pointerId; drag.setPointerCapture?.(event.pointerId); element.classList.add("is-dragging"); });
    drag.addEventListener("pointermove", (event) => {
      if (dragging !== event.pointerId) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".beast-energy-native-card");
      if (!target || target === element || target.parentElement !== containerEl) return;
      const targetCard = nativeDraftCards.find((item) => item.id === target.dataset.energyNativeCard);
      if (targetCard) {
        const sourcePosition = { x: card.desktop?.x || 1, y: card.desktop?.y || 2 };
        card.desktop = { ...(card.desktop || {}), x: targetCard.desktop?.x || 1, y: targetCard.desktop?.y || 2 };
        targetCard.desktop = { ...(targetCard.desktop || {}), ...sourcePosition };
      }
      const before = target.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING;
      target.parentNode.insertBefore(element, before ? target : target.nextSibling);
      syncNativeOrderFromDom();
    });
    const finishDrag = (event) => { if (dragging !== event.pointerId) return; drag.releasePointerCapture?.(event.pointerId); element.classList.remove("is-dragging"); dragging = null; };
    drag.addEventListener("pointerup", finishDrag); drag.addEventListener("pointercancel", finishDrag);
    let sizing = null;
    resize.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const rect = element.getBoundingClientRect();
      sizing = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, w: Number(card.desktop?.w) || 12, h: Number(card.desktop?.h) || 1, col: rect.width / (Number(card.desktop?.w) || 12), row: rect.height / (Number(card.desktop?.h) || 1) };
      resize.setPointerCapture?.(event.pointerId); element.classList.add("is-resizing");
    });
    resize.addEventListener("pointermove", (event) => {
      if (!sizing || sizing.pointerId !== event.pointerId) return;
      const w = Math.max(1, Math.min(12, Math.round(sizing.w + (event.clientX - sizing.x) / sizing.col)));
      const h = Math.max(1, Math.min(8, Math.round(sizing.h + (event.clientY - sizing.y) / sizing.row)));
      card.desktop = { ...(card.desktop || {}), w, h };
      element.style.setProperty("--energy-native-w", String(w)); element.style.setProperty("--energy-native-h", String(h));
    });
    const finishResize = (event) => { if (!sizing || sizing.pointerId !== event.pointerId) return; resize.releasePointerCapture?.(event.pointerId); element.classList.remove("is-resizing"); sizing = null; };
    resize.addEventListener("pointerup", finishResize); resize.addEventListener("pointercancel", finishResize);
  }

  function enterNativeEditor() {
    if (nativeEditing || !containerEl) return;
    nativeEditing = true; window.beastCardEditorActive = true;
    nativeDraftCards = JSON.parse(JSON.stringify(energyNativeCards()));
    containerEl.classList.add("is-native-editing"); applyNativeLayout(nativeDraftCards);
    containerEl.querySelectorAll(":scope > .beast-energy-native-card").forEach(wireNativeCardEdit);
    const bar = document.createElement("div"); bar.id = "beastEnergyNativeEditBar"; bar.className = "beast-ov-edit-bar";
    bar.innerHTML = `<div class="beast-editor-status"><i>${BeastCore.icon("bolt", { size: 19 })}</i><span><small>Redigering</small><strong>Redigerer energikort</strong></span></div><div class="beast-ov-edit-bar-actions"><button type="button" data-energy-native-settings>Indstillinger</button><button type="button" class="beast-edit-cancel" data-energy-native-cancel>Annullér</button><button type="button" class="beast-btn beast-btn-primary beast-edit-save" data-energy-native-save>Gem</button></div>`;
    document.body.appendChild(bar);
    bar.querySelector("[data-energy-native-cancel]").addEventListener("click", () => exitNativeEditor(false));
    bar.querySelector("[data-energy-native-save]").addEventListener("click", () => exitNativeEditor(true));
    bar.querySelector("[data-energy-native-settings]").addEventListener("click", () => { BeastConfig.set(energyCardsPath(), nativeDraftCards); exitNativeEditor(false); openEnergyLayout(BeastConfig.get("pageLayouts.energy.energyLayout") || {}); });
  }

  function wireUtilityTabs() {
    containerEl.querySelectorAll("[data-utility-view]").forEach((button) => button.addEventListener("click", () => {
      const next = button.dataset.utilityView;
      if (next === utilityView) return;
      utilityView = next;
      utilityHistoryPoints = [];
      utilityHistoryLoading = next !== "electric";
      // Leaving edit mode on tab switch: a chart-type choice belongs to the
      // graph you were just looking at, not the one you're switching to.
      utilityEditing = false;
      render();
      loadUtilityHistoryFor(next);
    }));
    containerEl.querySelector("[data-utility-edit]")?.addEventListener("click", () => {
      utilityEditing = !utilityEditing;
      render();
    });
  }

  async function loadUtilityHistoryFor(key) {
    const def = utilityDefs()[key];
    if (!def) return;
    // Electricity already keeps its own cached series for the price view,
    // so reuse it rather than fetching the same history twice.
    if (key === "electric") { utilityHistoryPoints = cachedHistoryPoints; return; }
    utilityHistoryLoading = true;
    const points = await loadHistoryFor(def.rate || def.total);
    utilityHistoryLoading = false;
    if (utilityView !== key) return;
    utilityHistoryPoints = points;
    render();
  }

  function wireEnergyLayout() {
    const layout = BeastConfig.get("pageLayouts.energy.energyLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const map = { recommendation: ".beast-energy-recommendation", summary: ".beast-stat-grid, .beast-energy-now-summary", price: ".beast-energy-chart-price", usage: ".beast-energy-chart-usage", devices: ".beast-energy-now-groups" };
    Object.entries(map).forEach(([id, selector]) => containerEl.querySelectorAll(selector).forEach((el) => el.classList.toggle("is-layout-hidden", hidden.has(id))));
    applyNativeLayout();
    containerEl.querySelector("[data-energy-layout]")?.addEventListener("click", () => openEnergyLayout(layout));
  }

  function openEnergyLayout(layout) {
    document.getElementById("beastEnergyLayoutEditor")?.remove();
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const legacyIds = { "energy-recommendation": "recommendation", "energy-summary": "summary", "energy-price-chart": "price", "energy-usage-chart": "usage", "energy-now-summary": "summary", "energy-devices": "devices" };
    const cards = energyNativeCards().map((card) => ({ ...card, enabled: card.enabled !== false && !hidden.has(legacyIds[card.id]) }));
    const entities = BeastCardEditor.allEntities();
    const safe = escapeHtml;
    const cardRows = cards.map((card, index) => {
      const template = BeastCardTemplates?.get?.(card.templateId);
      const fields = template?.fields || [];
      return `<article class="beast-energy-native-editor-card" data-energy-native-card="${safe(card.id)}">
        <div class="beast-energy-native-editor-head">
          <span class="beast-energy-native-editor-grip">${BeastCore.icon("grip", { size: 18 })}</span>
          <label><input type="checkbox" data-native-enabled ${card.enabled ? "checked" : ""}><strong>${safe(card.label || card.id)}</strong><small>${safe(template?.description || "Originalt energikort")}</small></label>
          <div><button type="button" data-native-up aria-label="Flyt op" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-native-down aria-label="Flyt ned" ${index === cards.length - 1 ? "disabled" : ""}>↓</button></div>
        </div>
        <div class="beast-energy-native-editor-fields">
          <label>Navn<input type="text" data-native-label value="${safe(card.label || "")}"></label>
          <label>Bredde<select data-native-width>${Array.from({ length: 12 }, (_, value) => `<option value="${value + 1}" ${Number(card.desktop?.w) === value + 1 ? "selected" : ""}>${value + 1} / 12</option>`).join("")}</select></label>
          <label>Højde<select data-native-height>${Array.from({ length: 8 }, (_, value) => `<option value="${value + 1}" ${Number(card.desktop?.h) === value + 1 ? "selected" : ""}>${value + 1}</option>`).join("")}</select></label>
          ${card.kind === "energy-price-chart" ? `<label>Pris-dage<input type="number" min="1" max="10" data-energy-days value="${Number(card.options?.days || 7)}"></label><label><input type="checkbox" data-energy-stats ${card.options?.stats === false ? "" : "checked"}> Vis prisnøgletal</label>` : ""}
          ${card.kind === "energy-usage-chart" ? `<label><input type="checkbox" data-energy-stats ${card.options?.stats === false ? "" : "checked"}> Vis forbrugsnøgletal</label>` : ""}
          ${fields.map((field) => `<label>${safe(field.label)}<input type="search" data-native-binding="${safe(field.key)}" list="beastEnergyEntityList" value="${safe(card.bindings?.[field.key] || "")}" placeholder="Brug standard eller vælg entity"></label>`).join("")}
        </div>
      </article>`;
    }).join("");
    const overlay = document.createElement("div"); overlay.id = "beastEnergyLayoutEditor"; overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-energy-layout-modal"><div class="beast-modal-header"><div><small>Native energikort</small><h3>Rediger energilayout</h3></div><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><p class="beast-page-editor-hint">Vælg navn, størrelse og egne Home Assistant-entities. Tomme entityfelter bruger serverens standardkonfiguration.</p><datalist id="beastEnergyEntityList">${entities.map((entity) => `<option value="${safe(entity.id)}">${safe(entity.name)}</option>`).join("")}</datalist><div class="beast-energy-layout-list">${cardRows}</div><button type="button" class="beast-btn beast-btn-primary" data-save-energy-layout>Gem layout</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      const move = event.target.closest("[data-native-up], [data-native-down]");
      if (move) {
        const row = move.closest("[data-energy-native-card]");
        const sibling = move.hasAttribute("data-native-up") ? row.previousElementSibling : row.nextElementSibling;
        if (sibling) move.hasAttribute("data-native-up") ? row.parentNode.insertBefore(row, sibling) : row.parentNode.insertBefore(sibling, row);
        overlay.querySelectorAll("[data-energy-native-card]").forEach((item, itemIndex, list) => { item.querySelector("[data-native-up]").disabled = itemIndex === 0; item.querySelector("[data-native-down]").disabled = itemIndex === list.length - 1; });
        return;
      }
      if (!event.target.closest("[data-save-energy-layout]")) return;
      const nextCards = Array.from(overlay.querySelectorAll("[data-energy-native-card]")).map((row) => {
        const current = cards.find((card) => card.id === row.dataset.energyNativeCard);
        const bindings = {}; row.querySelectorAll("[data-native-binding]").forEach((input) => { if (input.value.trim()) bindings[input.dataset.nativeBinding] = input.value.trim(); });
        return { ...current, label: row.querySelector("[data-native-label]").value.trim() || current.label, enabled: row.querySelector("[data-native-enabled]").checked, bindings, options:{...(current.options||{}),...(row.querySelector("[data-energy-days]")?{days:Number(row.querySelector("[data-energy-days]").value)||7}:{}),...(row.querySelector("[data-energy-stats]")?{stats:row.querySelector("[data-energy-stats]").checked}:{})}, desktop: { ...(current.desktop || {}), w: Number(row.querySelector("[data-native-width]").value), h: Number(row.querySelector("[data-native-height]").value) } };
      });
      const nextHidden = [...new Set(nextCards.filter((card) => !card.enabled).map((card) => legacyIds[card.id]).filter(Boolean))];
      BeastConfig.set(energyCardsPath(), nextCards);
      BeastConfig.set("pageLayouts.energy.energyLayout", { ...layout, hidden: nextHidden });
      applyNativeLayout(nextCards);
      overlay.remove(); render();
    });
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
    const start = startOfTodayIso();
    try {
      const result = await BeastAuth.haFetch(`/api/history/period/${start}?filter_entity_id=${POWER_ENTITY_ID()}&minimal_response`);
      const series = (result && result[0]) || [];
      return series.map((entry) => Number(entry.state ?? entry.s)).filter((v) => Number.isFinite(v));
    } catch (error) {
      BeastCore.log(`Energi: kunne ikke hente historik (${error.message}).`);
      return [];
    }
  }

  // The page covers whichever utilities the household actually measures.
  // Electricity keeps its full treatment (prices, per-device breakdown);
  // heat and water get the same shape -- a live rate, a running total for
  // today and the same graph -- because that is all the data those meters
  // provide. A utility with nothing configured is not shown at all, so an
  // install that only measures electricity looks exactly as it did before.
  function utilityDefs() {
    const config = energyConfig();
    return {
      electric: {
        label: "El", rate: POWER_ENTITY_ID(), total: TOTAL_ENERGY_ID(),
        rateUnit: "kW", totalUnit: "kWh", chartKey: "overview.utility.electric", scale: 0.001, icon: "bolt",
        rateLabel: "Forbrug lige nu", totalLabel: "I dag"
      },
      heat: {
        label: "Varme", rate: config.heatPowerSensor, total: config.heatEnergySensor,
        rateUnit: "kW", totalUnit: "kWh", chartKey: "overview.utility.heat", scale: 1, icon: "thermometer",
        rateLabel: "Varmeeffekt nu", totalLabel: "Varme i dag"
      },
      water: {
        label: "Vand", rate: config.waterFlowSensor, total: config.waterUsageSensor,
        rateUnit: "L/t", totalUnit: "m³", chartKey: "overview.utility.water", scale: 1, icon: "droplet", totalMeta: "Siden midnat",
        rateLabel: "Vandflow nu", totalLabel: "Vand i dag"
      }
    };
  }

  // A utility counts as available once it has at least one sensor; the
  // view copes with only one of the two being set.
  function availableUtilities() {
    const defs = utilityDefs();
    return Object.entries(defs).filter(([, def]) => def.rate || def.total).map(([key]) => key);
  }

  function utilityNumber(entityId) {
    const reading = numericState(entityId);
    return reading ? reading.value : null;
  }

  function formatUtilityValue(value, unit) {
    if (value === null || !Number.isFinite(value)) return "–";
    if (unit === "m³") return value.toFixed(3);
    if (unit === "L/t") return Math.round(value).toString();
    return value.toFixed(2);
  }

  function formatUtility(value, unit) {
    if (value === null) return "–";
    const decimals = unit === "m³" ? 3 : unit === "L/t" ? 0 : 2;
    return `${value.toFixed(decimals)} ${unit}`;
  }

  async function loadHistoryFor(entityId) {
    if (!entityId) return [];
    try {
      const result = await BeastAuth.haFetch(`/api/history/period/${startOfTodayIso()}?filter_entity_id=${entityId}&minimal_response`);
      const series = (result && result[0]) || [];
      return series.map((entry) => Number(entry.state ?? entry.s)).filter((value) => Number.isFinite(value));
    } catch (error) {
      BeastCore.log(`Forbrug: kunne ikke hente historik (${error.message}).`);
      return [];
    }
  }

  function renderUtilityView(key) {
    const def = utilityDefs()[key];
    if (!def) return "";
    const scale = def.scale ?? 1;
    const rate = utilityNumber(def.rate);
    const total = utilityNumber(def.total);
    const points = utilityHistoryPoints;
    const chartType = BeastCore.chartType(def.chartKey);
    const scaled = points.map((value) => value * scale);
    const stats = scaled.length
      ? {
          avg: scaled.reduce((sum, value) => sum + value, 0) / scaled.length,
          max: Math.max(...scaled),
          min: Math.min(...scaled)
        }
      : null;
    // Same four-tile summary the electricity view opens with, so the page
    // reads the same whichever utility is selected -- the tiles just carry
    // that meter's own numbers and units.
    const rateNow = rate === null ? null : rate * (key === "electric" ? 0.001 : 1);
    return `
      <div class="beast-stat-grid">
        ${BeastCore.statTile({ icon: def.icon, label: def.rateLabel, value: rateNow === null ? "–" : `${formatUtilityValue(rateNow, def.rateUnit)}<small>${def.rateUnit}</small>`, meta: stats ? `Snit i dag ${formatUtilityValue(stats.avg, def.rateUnit)} ${def.rateUnit}` : "" })}
        ${BeastCore.statTile({ icon: "grid", label: def.totalLabel, value: total === null ? "–" : `${formatUtilityValue(total, def.totalUnit)}<small>${def.totalUnit}</small>`, meta: def.totalMeta || "" })}
        ${BeastCore.statTile({ icon: "bolt", label: "Højeste i dag", value: stats ? `${formatUtilityValue(stats.max, def.rateUnit)}<small>${def.rateUnit}</small>` : "–", meta: stats ? "Målt siden midnat" : "" })}
        ${BeastCore.statTile({ icon: "grid", label: "Laveste i dag", value: stats ? `${formatUtilityValue(stats.min, def.rateUnit)}<small>${def.rateUnit}</small>` : "–", meta: stats ? "Målt siden midnat" : "" })}
      </div>
      <div class="beast-energy-chart-wrap beast-energy-chart-usage">
        <div class="beast-energy-chart-head">
          <button type="button" class="beast-energy-utility-edit${utilityEditing ? " is-active" : ""}" data-utility-edit aria-pressed="${utilityEditing}" title="${utilityEditing ? "Luk redigering" : "Rediger graf"}">${BeastCore.icon("settings", { size: 16 })}</button>
          ${BeastCore.chartTypeToggleMarkup(def.chartKey, "")}
          <span class="beast-panel-title">${escapeHtml(def.label)} i dag</span>
          <div class="beast-energy-price-range beast-energy-chart-head-stats">
            ${stats ? `<span>Snit <strong>${formatUtilityValue(stats.avg, def.rateUnit)} ${def.rateUnit}</strong></span>
            <span>Top <strong>${formatUtilityValue(stats.max, def.rateUnit)} ${def.rateUnit}</strong></span>
            <span>Bund <strong>${formatUtilityValue(stats.min, def.rateUnit)} ${def.rateUnit}</strong></span>` : ""}
          </div>
        </div>
        ${points.length
          ? (chartType === "bars" ? buildDetailedUsageBars(points, def) : buildDetailedUsageChart(points, def))
          : `<p class="beast-music-empty">${utilityHistoryLoading ? "Henter historik…" : "Ingen historik for i dag."}</p>`}
      </div>
      ${def.rate && def.total ? "" : `<p class="admin-field-hint">Tilføj de manglende sensorer under Administration → Enheder → Energi for at få alle tal med.</p>`}`;
  }

  function utilityTabsMarkup() {
    const available = availableUtilities();
    if (available.length < 2) return "";
    const defs = utilityDefs();
    return `<div class="beast-content-toggle beast-energy-utility-tabs">
      ${available.map((key) => `<button type="button" class="beast-content-toggle-btn${utilityView === key ? " is-active" : ""}" data-utility-view="${key}">${escapeHtml(defs[key].label)}</button>`).join("")}
    </div>`;
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
        wireEnergyLayout();
        containerEl.querySelectorAll("[data-energy-view]").forEach((button) => button.addEventListener("click", () => {
          energyView = button.dataset.energyView;
          render();
        }));
      } else {
        updateNowView();
      }
      return;
    }
    // Heat and water have no prices or per-device breakdown, so they render
    // their own compact view rather than reusing the electricity layout.
    // Critically, that view must NOT carry the electricity view's
    // .has-native-layout class: that class puts the container into a CSS
    // grid whose children are positioned entirely via --energy-native-x/y/
    // w/h custom properties set by applyNativeLayout() (see there and the
    // matching rules in ha-smartdash-misc.css). This view reuses card
    // classes like .beast-stat-grid for a consistent look, but never runs
    // applyNativeLayout() on them -- with the grid class still attached
    // from the last electric-view render, those elements were left
    // unpositioned and got crushed into the grid's tiny default cell
    // instead of laid out normally.
    if (utilityView !== "electric" && utilityDefs()[utilityView]) {
      containerEl.classList.remove("has-native-layout", "is-now", "is-native-editing");
      containerEl.innerHTML = `${renderViewBar()}<div class="beast-energy-utility-view${utilityEditing ? " is-utility-editing" : ""}">${renderUtilityView(utilityView)}</div>`;
      wireUtilityTabs();
      containerEl.querySelectorAll("[data-energy-view]").forEach((button) => button.addEventListener("click", () => {
        energyView = button.dataset.energyView;
        render();
      }));
      return;
    }
    const powerState = BeastHaSocket.getState(POWER_ENTITY_ID());
    const priceState = BeastHaSocket.getState(PRICE_ENTITY_ID());
    const tomorrowState = BeastHaSocket.getState(TOMORROW_ENTITY_ID());
    const forecastState = BeastHaSocket.getState(PRICE_FORECAST_ENTITY_ID());

    const measuredFallback = powerWatts(energyConfig().nowMeasuredSensor);
    const unmeasuredFallback = powerWatts(energyConfig().nowUnmeasuredSensor);
    const powerNowWatts = powerWatts(POWER_ENTITY_ID()) ?? ((measuredFallback !== null || unmeasuredFallback !== null) ? (measuredFallback || 0) + (unmeasuredFallback || 0) : null);
    const powerKw = powerNowWatts !== null ? (powerNowWatts / 1000).toFixed(2) : "–";
    const price = priceState && Number.isFinite(Number(priceState.state)) ? Number(priceState.state) : null;

    const todayPrices = normalizePrices(priceState?.attributes?.prices || priceState?.attributes?.raw_today || priceState?.attributes?.today);
    const tomorrowPrices = normalizePrices(tomorrowState?.attributes?.prices || priceState?.attributes?.raw_tomorrow || priceState?.attributes?.tomorrow);
    let priceDays = collectPriceDays(priceState, tomorrowState, forecastState);
    const todayKey = localDateKey(new Date());
    if (!priceDays.some((day) => day.key === todayKey) && todayPrices.length) {
      priceDays.unshift({ key: todayKey, date: new Date(), label: "I dag", prices: todayPrices });
    }
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowKey = localDateKey(tomorrowDate);
    if (!priceDays.some((day) => day.key === tomorrowKey) && tomorrowPrices.length) {
      priceDays.push({ key: tomorrowKey, date: tomorrowDate, label: tomorrowDate.toLocaleDateString(window.HASmartdashI18n?.locale || "da-DK", { weekday: "short", day: "numeric" }), prices: tomorrowPrices });
      priceDays.sort((a, b) => a.key.localeCompare(b.key));
    }
    priceDays = priceDays.slice(0, Math.max(1, Number(nativeOption("energy-price-chart", "days", 7))));
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
    const powerNumber = powerNowWatts !== null ? powerNowWatts / 1000 : null;
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
          ${BeastCore.chartTypeToggleMarkup(PRICE_CHART_KEY, "")}
          <span class="beast-panel-title">${escapeHtml(nativeCard("energy-price-chart")?.label || "Elpris time for time")}</span>
          <div class="beast-content-toggle beast-energy-day-toggle beast-energy-chart-head-stats">
            ${priceDays.map((day) => `<button type="button" class="beast-content-toggle-btn${priceView === day.key ? " is-active" : ""}" data-view="${day.key}">${day.label}</button>`).join("")}
          </div>
        </div>
        <div class="beast-energy-price-summary" ${nativeOption("energy-price-chart", "stats", true) ? "" : "hidden"}>
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
          ${usageChartToggleMarkup()}
          <span class="beast-panel-title">${escapeHtml(nativeCard("energy-usage-chart")?.label || "Forbrug i dag")}</span>
          <div class="beast-energy-price-range beast-energy-chart-head-stats" ${nativeOption("energy-usage-chart", "stats", true) ? "" : "hidden"}>
            ${historyAvg !== null ? `<span>Snit <strong>${historyAvg.toFixed(2)} kW</strong></span><span>Top <strong>${historyMax.toFixed(2)} kW</strong></span><span>Bund <strong>${historyMin.toFixed(2)} kW</strong></span>` : ""}
          </div>
        </div>
        ${cachedHistoryPoints.length ? buildUsageChart(cachedHistoryPoints) : '<p class="beast-music-empty">Henter historik…</p>'}
      </div>
    `;
    wireEnergyLayout();
    wireUtilityTabs();

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
    const energyId = TOTAL_ENERGY_ID();
    const costId = TOTAL_COST_ID();
    // These configuration fields explicitly represent today's utility-meter
    // values. Daily sensors already reset themselves; subtracting their first
    // state of the day a second time under-reports both usage and cost.
    todayEnergyKwh = energyId ? directTodayValue(energyId, "energy") : null;
    todayCostKr = costId ? directTodayValue(costId, "cost") : null;
    render();
  }

  async function refreshTodayHistory() {
    if (historyRefreshPending) return;
    historyRefreshPending = true;
    try {
      cachedHistoryPoints = await loadHistory();
      render();
    } finally {
      historyRefreshPending = false;
    }
  }

  function refreshTodayData() {
    refreshTodayTotals();
    refreshTodayHistory();
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
        refreshTodayData();
        window.clearInterval(todayRefreshTimerId);
        todayRefreshTimerId = window.setInterval(refreshTodayData, TODAY_REFRESH_MS);
      }
    });

    [POWER_ENTITY_ID(), PRICE_ENTITY_ID(), PRICE_FORECAST_ENTITY_ID(), TOMORROW_ENTITY_ID(), TOTAL_ENERGY_ID(), TOTAL_COST_ID(), ...NOW_SUMMARY_IDS(), ...NOW_GROUPS().flatMap((group) => group.ids)].filter(Boolean).forEach((id) => {
      BeastHaSocket.subscribeEntity(id, stableRender);
    });
    [TOTAL_ENERGY_ID(), TOTAL_COST_ID()].filter(Boolean).forEach((id) => BeastHaSocket.subscribeEntity(id, refreshTodayTotals));
  }

  document.addEventListener("beast:chart-type-changed", (event) => {
    const key = event.detail?.key;
    if (key === "*" || key === USAGE_CHART_KEY || key === PRICE_CHART_KEY) render();
  });
  document.addEventListener("beast:config-changed", () => render());

  BeastCore.registerPanel("energy", "beastEnergyZone", init);
  window.BeastEnergyEditor = { open: enterNativeEditor };
})();
