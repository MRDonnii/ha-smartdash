// Sleep / CPAP module of the bedroom page (ResMed myAir sensors): score ring,
// verdict, the four nightly metrics (which double as the chart's tabs) and a
// 14-night trend, plus the full-screen "Søvn & CPAP" sheet. myAir reports
// once per morning, so nothing here is live: every value belongs to the night
// named by the data-date sensor.
window.BeastBedroom.sleep = (() => {
  const B = window.BeastBedroom;
  const { t, esc, icon, fmt, hm, capitalize, dateKey, parseDateKey, addDays, startOfDay, cfg, single, state, unavailable, numberState, locale } = B.util;

  const NIGHTS = 14;
  const HISTORY_DAYS = 16;
  const HISTORY_TTL_MS = 60 * 60 * 1000;
  // A new night's metrics can be written a few ms before its data date.
  const SKEW_MS = 5000;
  const BAR_NOTE_MS = 4000;

  const METRICS = {
    score: { key: "cpapScore", label: "Score", bad: (v) => v < 60, top: () => 100 },
    usage: { key: "cpapUsageMinutes", label: "Brugstid", short: "Brug", unit: "t", ref: 240, refLabel: "4 t", bad: (v) => v < 240, top: (max) => Math.max(540, max * 1.12) },
    ahi: { key: "cpapAhi", label: "AHI", unit: "/t", ref: 5, refLabel: "5", bad: (v) => v >= 5, top: (max) => Math.max(6.25, max * 1.2) },
    leak: { key: "cpapLeak", label: "Lækage", unit: "L/min", ref: 24, refLabel: "24", bad: (v) => v >= 24, top: (max) => Math.max(36, max * 1.2) },
    mask: { key: "cpapMaskEvents", label: "Maske af/på", bad: () => false, top: (max) => Math.max(5, max * 1.2) }
  };
  const TAB_ORDER = ["usage", "ahi", "leak", "mask"];

  let selected = null;
  let barNote = null;
  let barNoteTimerId = null;
  let history = { nights: new Map(), approximate: new Set(), at: 0, signature: "", loading: null };
  let historyVersion = 0;
  let reloadTimerId = null;
  let panelSignature = "";
  let chartSignature = "";
  let resizeObserver = null;
  let observedChart = null;
  let detailSignature = "";

  // ---------------------------------------------------------------------------
  // Values
  // ---------------------------------------------------------------------------
  function ids() {
    const c = cfg();
    return {
      score: single(c.cpapScore), usage: single(c.cpapUsageMinutes), usageTime: single(c.cpapUsageTime),
      ahi: single(c.cpapAhi), leak: single(c.cpapLeak), mask: single(c.cpapMaskEvents),
      date: single(c.cpapDataDate), collected: single(c.cpapLastCollected)
    };
  }

  function configured() {
    const i = ids();
    return Boolean(i.score || i.usage || i.usageTime || i.ahi || i.leak || i.mask);
  }

  function entityIds() { return Object.values(ids()).filter(Boolean); }

  function hasMetric(metric) {
    const i = ids();
    return metric === "usage" ? Boolean(i.usage || i.usageTime) : Boolean(i[metric]);
  }

  // "5:19" (the usage-time sensor) or plain minutes.
  function parseMinutes(text) {
    const match = /^(\d+):(\d{2})/.exec(String(text || "").trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function currentValue(metric) {
    const i = ids();
    if (metric === "usage") {
      const minutes = numberState(i.usage);
      return minutes != null ? minutes : parseMinutes(state(i.usageTime)?.state);
    }
    return numberState(i[metric]);
  }

  function dataDate() {
    const raw = String(state(ids().date)?.state || "").slice(0, 10);
    return parseDateKey(raw) ? raw : null;
  }

  function collectedAt() {
    const i = ids();
    const at = Date.parse(state(i.collected)?.state || "");
    if (Number.isFinite(at)) return at;
    const fallback = state(i.date) || state(i.score) || state(i.usage);
    const changed = Date.parse(fallback?.last_changed || "");
    return Number.isFinite(changed) ? changed : 0;
  }

  // The newest night myAir can have reported by now: last night once the
  // morning sync has normally happened, the night before until then.
  function expectedLatestKey(now = new Date()) {
    return dateKey(addDays(startOfDay(now), now.getHours() < 11 ? -2 : -1));
  }

  function hours(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  function fmt1(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "–";
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(number);
  }

  function formatMetric(metric, value) {
    if (value == null || !Number.isFinite(Number(value))) return "–";
    if (metric === "usage") return hours(value);
    if (metric === "ahi" || metric === "leak") return fmt1(value);
    return fmt(value, 0);
  }

  function verdictFor(metric, value) {
    if (value == null) return null;
    if (metric === "usage") return value >= 240 ? { text: "Mål nået", tone: "ok" } : { text: "Under mål", tone: "warn" };
    if (metric === "ahi") return value < 5 ? { text: "Normal", tone: "ok" } : value <= 15 ? { text: "Let forhøjet", tone: "warn" } : { text: "Høj", tone: "warn" };
    if (metric === "leak") return value < 24 ? { text: "God", tone: "ok" } : { text: "Høj", tone: "warn" };
    return null;
  }

  // Fill fraction and tick positions of a metric's threshold track.
  function trackFor(metric, value) {
    const scale = { usage: 480, ahi: 10, leak: 36, mask: 10 }[metric];
    const ticks = { usage: [[240, 1], [420, 0.5]], ahi: [[5, 1]], leak: [[24, 1]], mask: [] }[metric];
    const pct = (v) => Math.max(0, Math.min(100, (v / scale) * 100));
    return { fill: value == null ? 0 : pct(value), ticks: ticks.map(([at, opacity]) => ({ left: pct(at), opacity })) };
  }

  // ---------------------------------------------------------------------------
  // History: one value per myAir data date
  // ---------------------------------------------------------------------------
  function historySignature() { return JSON.stringify(ids()); }

  function rowsById(payload) {
    const out = new Map();
    (Array.isArray(payload) ? payload : []).forEach((rows) => {
      const id = Array.isArray(rows) ? rows[0]?.entity_id : null;
      if (!id) return;
      out.set(id, rows.map((row) => ({ state: row.state ?? row.s, at: Date.parse(row.last_changed || row.last_updated || row.lc || "") }))
        .filter((row) => Number.isFinite(row.at)).sort((a, b) => a.at - b.at));
    });
    return out;
  }

  function numeric(raw) {
    if (raw === "" || raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  // The value that was current when a night's reign ended. Rows of the next
  // night's poll can land just before its date row, hence the skew margin.
  function valueAsOf(rows, end, parse = numeric) {
    let value = null;
    for (const row of rows || []) {
      if (row.at > end - SKEW_MS) break;
      const parsed = parse(row.state);
      if (parsed != null) value = parsed;
    }
    return value;
  }

  function metricParsers(i) {
    return [["score", i.score, numeric], ["usage", i.usage || i.usageTime, i.usage ? numeric : parseMinutes], ["ahi", i.ahi, numeric], ["leak", i.leak, numeric], ["mask", i.mask, numeric]]
      .filter(([, id]) => id);
  }

  function nightsFromRows(rows, i) {
    const nights = new Map();
    const parsers = metricParsers(i);
    if (i.date) {
      const reigns = [];
      (rows.get(i.date) || []).forEach((row) => {
        const key = String(row.state || "").slice(0, 10);
        if (!parseDateKey(key)) return;
        if (reigns.length && reigns[reigns.length - 1].key === key) return;
        reigns.push({ key, start: row.at });
      });
      reigns.forEach((reign, index) => {
        const end = reigns[index + 1]?.start ?? Infinity;
        const night = {};
        parsers.forEach(([metric, id, parse]) => { night[metric] = valueAsOf(rows.get(id), end, parse); });
        nights.set(reign.key, night);
      });
      return { nights, firstStart: reigns[0]?.start ?? Infinity };
    }
    // Without a data-date sensor: the values standing at noon belong to the
    // night before (myAir has synced by then).
    const today = startOfDay();
    for (let back = HISTORY_DAYS - 1; back >= 0; back -= 1) {
      const noon = addDays(today, -back);
      noon.setHours(12, 0, 0, 0);
      if (noon.getTime() > Date.now()) continue;
      const night = {};
      parsers.forEach(([metric, id, parse]) => { night[metric] = valueAsOf(rows.get(id), noon.getTime() + SKEW_MS, parse); });
      if (Object.values(night).some((value) => value != null)) nights.set(dateKey(addDays(noon, -1)), night);
    }
    return { nights, firstStart: Infinity };
  }

  // Long-term statistics outlive the raw history: for night D the hour
  // starting at 12:00 the next day (up to 15:00) holds that night's value
  // as long as nothing changed within the hour (min === max).
  async function fillFromStatistics(nights, approximate, keys, firstStart, i) {
    const missing = keys.filter((key) => {
      const noon = parseDateKey(key);
      return noon && (!nights.has(key)) && addDays(noon, 1).getTime() < Math.min(firstStart, Date.now());
    });
    const metrics = metricParsers(i).filter(([metric, id]) => metric !== "usage" || id === i.usage);
    if (!missing.length || !metrics.length) return true;
    const start = addDays(parseDateKey(missing[0]), 1);
    start.setHours(11, 0, 0, 0);
    const end = new Date(Math.min(Date.now(), firstStart === Infinity ? Date.now() : firstStart + 3600000));
    if (end <= start) return true;
    let stats = null;
    try {
      stats = await BeastHaSocket.sendCommand("recorder/statistics_during_period", {
        start_time: start.toISOString(), end_time: end.toISOString(), period: "hour",
        statistic_ids: metrics.map(([, id]) => id), types: ["mean", "min", "max"]
      });
    } catch (error) {
      // Only a socket that wasn't up yet is worth another try soon.
      return !/^SOCKET_/.test(String(error?.message || ""));
    }
    const startOf = (row) => (typeof row.start === "number" ? row.start : Date.parse(row.start || ""));
    missing.forEach((key) => {
      const day = addDays(parseDateKey(key), 1);
      const from = new Date(day); from.setHours(12, 0, 0, 0);
      const to = new Date(day); to.setHours(15, 0, 0, 0);
      const night = {};
      metrics.forEach(([metric, id]) => {
        const row = (stats?.[id] || []).find((item) => {
          const at = startOf(item);
          return at >= from.getTime() && at <= to.getTime() && item.min != null && item.min === item.max;
        });
        if (row) night[metric] = Number(row.mean ?? row.min);
      });
      if (Object.keys(night).length) { nights.set(key, night); approximate.add(key); }
    });
    return true;
  }

  function latestKey() {
    return dataDate() || dateKey(addDays(startOfDay(), -1));
  }

  function nightKeys() {
    const last = parseDateKey(latestKey());
    return Array.from({ length: NIGHTS }, (_, index) => dateKey(addDays(last, index - NIGHTS + 1)));
  }

  async function loadHistory(force = false) {
    if (!configured()) return;
    if (history.loading) {
      await history.loading;
      if (!force) return;
    }
    const signature = historySignature();
    if (!force && history.signature === signature && Date.now() - history.at < HISTORY_TTL_MS) return;
    const i = ids();
    const entityList = [i.date, ...metricParsers(i).map(([, id]) => id)].filter(Boolean);
    const start = new Date(Date.now() - HISTORY_DAYS * 86400000);
    const path = `/api/history/period/${encodeURIComponent(start.toISOString())}?filter_entity_id=${encodeURIComponent([...new Set(entityList)].join(","))}&end_time=${encodeURIComponent(new Date().toISOString())}&minimal_response&no_attributes`;
    const run = (async () => {
      const approximate = new Set();
      let nights = new Map();
      let firstStart = Infinity;
      let complete = false;
      try {
        ({ nights, firstStart } = nightsFromRows(rowsById(await BeastAuth.haFetch(path)), i));
        complete = await fillFromStatistics(nights, approximate, nightKeys(), firstStart, i);
      } catch (error) {
        BeastCore.log(`Soveværelse: søvnhistorik kunne ikke hentes (${error.message}).`);
      }
      history = { nights, approximate, at: complete ? Date.now() : 0, signature, loading: null };
      historyVersion += 1;
      B.renderSleep?.();
    })();
    history.loading = run;
    try { await run; } finally { if (history.loading === run) history.loading = null; }
  }

  // The night on screen right now always reflects the live sensors, so a
  // late correction (myAir rewrites a score hours later) shows at once.
  function series(metric) {
    const live = latestKey();
    return nightKeys().map((key) => {
      const value = key === live ? currentValue(metric) : history.nights.get(key)?.[metric];
      return { key, value: value == null || !Number.isFinite(Number(value)) ? null : Number(value), approximate: history.approximate.has(key) };
    });
  }

  function average(points) {
    const values = points.map((point) => point.value).filter((value) => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  // ---------------------------------------------------------------------------
  // Model and copy
  // ---------------------------------------------------------------------------
  function tHtml(template, vars) {
    return esc(t(template)).replace(/\{(\w+)\}/g, (match, key) => (key in vars ? `<em>${esc(vars[key])}</em>` : match));
  }

  function model(now = new Date()) {
    const i = ids();
    const values = { score: currentValue("score"), usage: currentValue("usage"), ahi: currentValue("ahi"), leak: currentValue("leak"), mask: currentValue("mask") };
    const metricIds = [i.score, i.usage || i.usageTime, i.ahi, i.leak, i.mask].filter(Boolean);
    const allDown = metricIds.length > 0 && metricIds.every((id) => unavailable(state(id)));
    const key = dataDate();
    const yesterday = dateKey(addDays(startOfDay(now), -1));
    const stale = Boolean(key && i.date && key < expectedLatestKey(now));
    const hour = now.getHours();
    const mode = hour >= 21 || hour < 5 ? "night" : hour < 11 && key === yesterday ? "morning" : "day";
    const wake = key ? addDays(parseDateKey(key), 1) : null;
    const meta = !key ? "" : stale
      ? t("Seneste data: {date}", { date: shortDate(wake) })
      : t("Natten til {date}", { date: shortWeekdayDate(wake) });

    let title;
    let chip = null;
    let sentence = "";
    if (allDown) title = t("myAir er ikke tilgængelig");
    else if (stale) title = t("Ingen nye data fra myAir");
    else {
      const { score, usage, ahi, leak } = values;
      if (usage != null && usage < 240) title = t("En kort nat");
      else if (ahi != null && ahi >= 15) title = t("Mange hændelser");
      else if (score != null) title = t(score >= 85 ? "Flot nat" : score >= 70 ? "Godt arbejde" : score >= 50 ? "En okay nat" : "En urolig nat");
      else title = t(ahi != null && ahi < 5 ? "En rolig nat" : "Nattens søvn");
      if (usage != null && usage < 240) chip = { text: t("Under 4 timer"), tone: "warn" };
      else if (ahi != null && ahi >= 5) chip = { text: t("Mange hændelser"), tone: "warn" };
      else if (leak != null && leak >= 24) chip = { text: t("Høj lækage"), tone: "warn" };
      else if (ahi != null && usage != null) chip = { text: t("Terapien virker"), tone: "ok" };
      sentence = sentenceFor(values);
    }
    const collected = collectedAt();
    let fresh = "";
    if (collected) {
      const day = dateKey(new Date(collected));
      const when = day === dateKey(now) ? t("i dag") : day === yesterday ? t("i går") : shortDate(new Date(collected));
      fresh = t("Hentet {when} {time}", { when, time: hm(new Date(collected)) });
    }
    return { values, allDown, stale, mode, meta, title, chip, sentence, fresh, key };
  }

  function sentenceFor(values) {
    const { score, usage, ahi, leak } = values;
    const parts = [];
    if (usage != null) {
      const dur = B.util.duration(usage);
      if (usage < 240) parts.push(tHtml("Kun {dur} med masken — prøv at holde den på.", { dur }));
      else if (ahi == null) parts.push(tHtml("{dur} med masken.", { dur }));
      else if (ahi < 1) parts.push(tHtml("{dur} med masken og meget få hændelser.", { dur }));
      else if (ahi < 5) parts.push(tHtml("{dur} med masken og {ahi} hændelser i timen.", { dur, ahi: fmt1(ahi) }));
      else parts.push(tHtml("{dur} med masken, men {ahi} hændelser i timen.", { dur, ahi: fmt1(ahi) }));
    } else if (ahi != null) {
      parts.push(tHtml("{ahi} hændelser i timen.", { ahi: fmt1(ahi) }));
    }
    if (leak != null && leak >= 24) {
      parts.push(esc(t("Masken lækkede — tjek pasformen.")));
    } else if (score != null) {
      const earlier = series("score").slice(0, -1).filter((point) => point.value != null);
      if (earlier.length >= 3) {
        const avg = Math.round(average(earlier));
        const diff = score - avg;
        const template = Math.abs(diff) <= 2 ? "Som dit snit på {avg}." : diff > 8 ? "Et godt stykke over dit snit på {avg}." : diff > 0 ? "Lidt over dit snit på {avg}." : diff >= -8 ? "Lidt under dit snit på {avg}." : "Under dit snit på {avg}.";
        parts.push(tHtml(template, { avg: fmt(avg, 0) }));
      }
    }
    return parts.join(" ");
  }

  function shortDate(date) { return date.toLocaleDateString(locale(), { day: "numeric", month: "short" }).replace(/\.$/, ""); }
  function shortWeekdayDate(date) { return date.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, ""); }

  // ---------------------------------------------------------------------------
  // Markup
  // ---------------------------------------------------------------------------
  const RING_CIRCUMFERENCE = 2 * Math.PI * 48;
  // Gradient ids must be unique per inline SVG: several rings and charts can
  // be in the document at once.
  let gradientSeq = 0;

  // A 270° gauge (open at the bottom): track and value arc share the start.
  const RING_SWEEP = RING_CIRCUMFERENCE * 0.75;

  function ringMarkup(m) {
    const score = m.values.score;
    const usage = m.values.usage;
    const useScore = ids().score != null;
    const value = m.allDown || m.stale ? null : useScore ? score : usage;
    const fraction = value == null ? 0 : useScore ? Math.max(0, Math.min(1, value / 100)) : Math.max(0, Math.min(1, value / 480));
    const label = useScore ? "myAir" : t("Timer");
    const text = value == null ? "–" : useScore ? fmt(value, 0) : hours(value);
    const gradient = `bdRingAmber${++gradientSeq}`;
    const dash = (length) => `${length.toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`;
    const arc = fraction > 0 ? `<circle class="bd-ring-arc" style="stroke:url(#${gradient})" cx="60" cy="60" r="48" stroke-dasharray="${dash(Math.max(0.5, fraction * RING_SWEEP))}" transform="rotate(135 60 60)"/>` : "";
    return `<span class="bd-ring${m.stale ? " is-stale" : ""}"><svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><defs><linearGradient id="${gradient}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#305380"/><stop offset=".55" stop-color="#8FB3E6"/><stop offset="1" stop-color="#B4CDF0"/></linearGradient></defs><circle class="bd-ring-track" cx="60" cy="60" r="48" stroke-dasharray="${dash(RING_SWEEP)}" transform="rotate(135 60 60)"/>${arc}</svg><span class="bd-ring-val"><b>${esc(text)}</b><small>${esc(label)}</small></span></span>`;
  }

  // On the page the freshness chip sits in the panel's eyebrow (which gives
  // the sentence a third line); the sheet shows it under the verdict.
  function freshMarkup(m) {
    if (m.stale) return `<span class="bd-fresh is-stale"><i></i>${esc(m.meta)}</span>`;
    return m.fresh ? `<span class="bd-fresh"><i></i>${esc(m.fresh)}</span>` : "";
  }

  function verdictMarkup(m, full = false) {
    let chip = m.chip ? `<span class="bd-chip-st is-${m.chip.tone}"><i></i>${esc(m.chip.text)}</span>` : "";
    if (m.stale && !full) chip = `<span class="bd-chip-st is-mute"><i></i>${esc(t("Ingen data i nat"))}</span>`;
    const sentence = m.sentence ? `<span class="bd-v2${full ? " is-full" : ""}">${m.sentence}</span>` : "";
    const extra = full ? `${freshMarkup(m)}${m.meta && !m.stale ? `<span class="bd-v3">${esc(m.meta)}</span>` : ""}` : "";
    return `<span class="bd-verdict">${chip}<span class="bd-v1">${esc(m.title)}</span>${sentence}${extra}</span>`;
  }

  // Label and verdict on top, the value, then a short scale with the
  // threshold tick. On the page the tiles also pick the chart's metric.
  function metricCellMarkup(metric, m, { tabs = true, active = null } = {}) {
    const value = m.allDown ? null : m.values[metric];
    const verdict = m.stale || m.allDown ? null : verdictFor(metric, value);
    const track = trackFor(metric, m.allDown ? null : value);
    const unit = metric === "mask" ? (value === 1 ? t("gang") : t("gange")) : METRICS[metric].unit ? t(METRICS[metric].unit) : "";
    const tone = verdict?.tone || "";
    const down = value == null ? " is-empty" : "";
    const inner = `<span class="bd-m-k">${esc(t(METRICS[metric].short || METRICS[metric].label))}</span>${verdict ? `<i class="bd-m-q is-${tone}">${esc(t(verdict.text))}</i>` : "<i></i>"}<span class="bd-m-v"><span class="bd-m-num">${esc(formatMetric(metric, value))}</span>${value != null && unit ? `<small>${esc(unit)}</small>` : ""}</span><span class="bd-m-track${tone === "warn" ? " is-warn" : ""}"><span class="bd-m-fill" style="width:${track.fill.toFixed(1)}%"></span>${track.ticks.map((tick) => `<span class="bd-m-tick" style="left:${tick.left.toFixed(1)}%;opacity:${tick.opacity}"></span>`).join("")}</span>`;
    if (!tabs) return `<div class="bd-m${down}">${inner}</div>`;
    return `<button type="button" class="bd-m${down}" data-bd-action="sleep-metric" data-metric="${metric}" aria-pressed="${active === metric}">${inner}</button>`;
  }

  function panelMarkup() {
    return `<div class="bd-eyebrow"><b>${esc(t("Søvnterapi"))}</b><span class="bd-sleep-eyeright"><span class="bd-sleep-meta" data-sleep-meta></span><button type="button" class="bd-sleep-open" data-bd-action="sleep-detail" aria-label="${esc(t("Åbn søvn og CPAP"))}">${icon("corners", 14)}</button></span></div><div class="bd-sleep-body" data-sleep-body></div>`;
  }

  function activeMetric() {
    if (selected && (selected === "score" ? ids().score : hasMetric(selected))) return selected;
    if (ids().score) return "score";
    return TAB_ORDER.find(hasMetric) || "score";
  }

  // Chart tabs: Score and the three metrics with a threshold. "Maske af/på"
  // has no tab; its tile still selects it.
  const CHART_TABS = [["score", "Score"], ["usage", "Brug"], ["ahi", "AHI"], ["leak", "Læk"]];

  function trendHeadMarkup(metric) {
    const tabs = CHART_TABS.filter(([key]) => (key === "score" ? ids().score : hasMetric(key)));
    const note = barNote && barNote.metric === metric ? `<span class="bd-trend-note">${esc(barNote.text)}</span>` : "";
    return `<span class="bd-trend-k">${esc(t("{n} nætter", { n: NIGHTS }))}</span>${note || `<span class="bd-tabs" role="tablist">${tabs.map(([key, label]) => `<button type="button" class="bd-tab" role="tab" data-bd-action="sleep-metric" data-metric="${key}" aria-selected="${key === metric}">${esc(t(label))}</button>`).join("")}</span>`}`;
  }

  // One line for the compact card: "5:19 t · AHI 0,5 · tæt maske".
  function shortLine(m) {
    if (m.allDown || m.stale) return m.allDown ? "" : t("Ingen data i nat");
    const { usage, ahi, leak } = m.values;
    const parts = [];
    if (usage != null) parts.push(`${hours(usage)} ${t("t")}`);
    if (ahi != null) parts.push(`AHI ${fmt1(ahi)}`);
    if (leak != null) parts.push(leak < 24 ? t("tæt maske") : t("høj lækage"));
    return parts.join(" · ");
  }

  // Dag and Aften: ring, verdict, one line and (when there is room) the
  // score bars; the whole card opens the sheet.
  function renderCompact(panel, body) {
    const m = model();
    const metric = ids().score ? "score" : activeMetric();
    const signature = JSON.stringify(["compact", m, metric, historyVersion]);
    panel.classList.toggle("is-night", false);
    panel.classList.toggle("is-morning", false);
    panel.classList.toggle("is-down", m.allDown);
    if (signature !== panelSignature || !body.firstElementChild) {
      panelSignature = signature;
      const meta = panel.querySelector("[data-sleep-meta]");
      if (meta) meta.innerHTML = m.allDown || !m.meta ? "" : `<span class="bd-sleep-when${m.stale ? " is-stale" : ""}">${esc(m.meta)}</span>`;
      body.innerHTML = `<div class="bd-sc-top"><button type="button" class="bd-sc-hero" data-bd-action="sleep-detail" aria-label="${esc(t("Åbn søvn og CPAP"))}">${ringMarkup(m)}<span class="bd-sc-tx"><b>${esc(m.title)}</b><small>${esc(shortLine(m))}</small></span></button><button type="button" class="bd-sc-open" data-bd-action="sleep-detail" aria-label="${esc(t("Åbn søvn og CPAP"))}">${icon("chev", 18)}</button></div>
        <div class="bd-chart" data-sleep-chart="${metric}"></div>`;
      chartSignature = "";
    }
    drawChart(body.querySelector("[data-sleep-chart]"), metric, series(metric));
  }

  function render(panel) {
    if (!panel || !configured()) return;
    const body = panel.querySelector("[data-sleep-body]");
    if (!body) return;
    if (panel.closest(".bd-page")?.classList.contains("is-sleep-compact")) { renderCompact(panel, body); return; }
    const m = model();
    const metric = activeMetric();
    const tabs = TAB_ORDER.filter(hasMetric);
    const points = series(metric);
    const signature = JSON.stringify([m, metric, tabs, historyVersion, barNote?.text || "", barNote?.metric || ""]);
    panel.classList.toggle("is-night", m.mode === "night");
    panel.classList.toggle("is-morning", m.mode === "morning");
    panel.classList.toggle("is-down", m.allDown);
    if (signature !== panelSignature || !body.firstElementChild) {
      panelSignature = signature;
      const meta = panel.querySelector("[data-sleep-meta]");
      if (meta) meta.innerHTML = m.allDown || !m.meta ? "" : `<span class="bd-sleep-when${m.stale ? " is-stale" : ""}">${esc(m.meta)}</span>`;
      body.innerHTML = `<button type="button" class="bd-hero" data-bd-action="sleep-metric" data-metric="score" aria-pressed="${metric === "score"}">${ringMarkup(m)}${verdictMarkup(m)}</button>
        ${tabs.length ? `<div class="bd-metrics" data-n="${tabs.length}">${tabs.map((key) => metricCellMarkup(key, m, { active: metric })).join("")}</div>` : ""}
        <div class="bd-trend"><div class="bd-trend-head">${trendHeadMarkup(metric)}</div><div class="bd-chart" data-sleep-chart="${metric}"></div></div>`;
      chartSignature = "";
    }
    drawChart(body.querySelector("[data-sleep-chart]"), metric, points);
  }

  // ---------------------------------------------------------------------------
  // Chart: inline SVG in real pixels so lines stay crisp and text keeps its size
  // ---------------------------------------------------------------------------
  function drawChart(host, metric, points, { force = false, compact = false } = {}) {
    if (!host) return;
    observeChart(host);
    const width = Math.round(host.clientWidth);
    const height = Math.round(host.clientHeight);
    if (width < 40 || height < 30) return;
    const signature = JSON.stringify([metric, points, width, height, compact]);
    if (!force && host === observedChart && signature === chartSignature && host.firstElementChild) return;
    if (host === observedChart) chartSignature = signature;
    host.innerHTML = chartSvg(metric, points, width, height);
  }

  function barPath(x, y, w, base) {
    const h = base - y;
    if (h <= 0) return "";
    const r = Math.min(3, w / 2, h);
    return `M${x.toFixed(1)},${base} V${(y + r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} H${(x + w - r).toFixed(1)} Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)} V${base} Z`;
  }

  // Amber bars: warm brown nights, last night lit amber, bad nights ember
  // red; a dashed average line labelled at the top right and, for metrics
  // with a limit (4 t, AHI 5, leak 24), a solid threshold line.
  function chartSvg(metric, points, width, height) {
    const def = METRICS[metric];
    const top = 14;
    const axis = 16;
    const plotW = width;
    const base = height - axis;
    const plotH = Math.max(10, base - top);
    const values = points.map((point) => point.value).filter((value) => value != null);
    const max = values.length ? Math.max(...values) : 0;
    const yTop = def.top(max);
    const y = (value) => base - Math.max(0, Math.min(1, value / yTop)) * plotH;
    // Bars nearly touch on the page (4 px apart) but stay slim in a wide chart.
    const slot = (plotW + 4) / points.length;
    const barW = Math.max(3, Math.min(30, slot - 4, slot * 0.78 + (slot < 24 ? 4 : 0)));
    const offset = (slot - 4 - barW) / 2;
    const lastIndex = points.length - 1;
    const todayKey = dateKey(startOfDay());
    const avg = average(points);
    const parts = [];
    const seq = ++gradientSeq;
    parts.push(`<defs><linearGradient id="bdBarN${seq}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34383D"/><stop offset="1" stop-color="#1B1D20"/></linearGradient><linearGradient id="bdBarL${seq}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B4CDF0"/><stop offset="1" stop-color="#4A7BBB"/></linearGradient><linearGradient id="bdBarB${seq}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7E3A30"/><stop offset="1" stop-color="#391A15"/></linearGradient></defs>`);
    points.forEach((point, index) => {
      const x = index * slot + Math.max(0, offset);
      const center = x + barW / 2;
      const latest = index === lastIndex;
      const wake = addDays(parseDateKey(point.key), 1);
      const initial = wake.toLocaleDateString(locale(), { weekday: "narrow" }).toLocaleUpperCase(locale());
      const isToday = dateKey(wake) === todayKey;
      parts.push(`<text class="bd-c-day${isToday || latest ? " is-today" : ""}" x="${center.toFixed(1)}" y="${(height - 2).toFixed(1)}" text-anchor="middle">${esc(initial)}</text>`);
      if (point.value == null) {
        parts.push(`<rect class="bd-c-stub" x="${x.toFixed(1)}" y="${base - 2}" width="${barW.toFixed(1)}" height="2" rx="1"/>`);
      } else {
        const bad = def.bad(point.value);
        const yy = Math.min(base - 2, y(point.value));
        const cls = latest ? "is-last" : bad ? "is-bad" : "";
        const fill = ` style="fill:url(#bdBar${latest ? "L" : bad ? "B" : "N"}${seq})"`;
        const path = barPath(x, yy, barW, base);
        parts.push(path ? `<path class="bd-c-bar ${cls}"${fill} d="${path}"/>` : `<rect class="bd-c-bar ${cls}"${fill} x="${x.toFixed(1)}" y="${base - 2}" width="${barW.toFixed(1)}" height="2"/>`);
      }
      parts.push(`<rect class="bd-c-hit" x="${(index * slot - 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}" data-bd-action="sleep-bar" data-metric="${metric}" data-index="${index}"/>`);
    });
    if (def.ref != null) {
      const yy = Math.round(y(def.ref)) + 0.5;
      parts.push(`<line class="bd-c-ref" x1="0" y1="${yy}" x2="${plotW.toFixed(1)}" y2="${yy}"/>`);
    }
    if (avg != null && values.length >= 3) {
      const yy = Math.round(y(avg)) + 0.5;
      parts.push(`<line class="bd-c-avg" x1="0" y1="${yy}" x2="${plotW.toFixed(1)}" y2="${yy}"/>`);
      const text = `${t("snit")} ${formatMetric(metric, metric === "score" || metric === "mask" ? Math.round(avg) : avg)}`;
      parts.push(`<text class="bd-c-avg-t" x="${plotW.toFixed(1)}" y="${Math.max(10, yy - 4).toFixed(1)}" text-anchor="end">${esc(text)}</text>`);
    }
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(t("{metric} de seneste {n} nætter", { metric: t(def.label), n: NIGHTS }))}">${parts.join("")}</svg>`;
  }

  function observeChart(host) {
    if (typeof ResizeObserver === "undefined" || host === observedChart) return;
    resizeObserver?.disconnect();
    observedChart = host;
    chartSignature = "";
    let lastSize = "";
    resizeObserver = new ResizeObserver(() => {
      const size = `${host.clientWidth}x${host.clientHeight}`;
      if (size === lastSize || !host.isConnected) return;
      lastSize = size;
      window.requestAnimationFrame(() => {
        if (!host.isConnected) return;
        const metric = host.dataset.sleepChart;
        drawChart(host, metric, series(metric), { force: true });
      });
    });
    resizeObserver.observe(host);
  }

  // ---------------------------------------------------------------------------
  // Detail sheet: every metric with its own chart
  // ---------------------------------------------------------------------------
  function detailBody() {
    const m = model();
    const charts = ["score", ...TAB_ORDER].filter((metric) => (metric === "score" ? ids().score : hasMetric(metric)));
    return `<div class="bd-sd${m.allDown ? " is-down" : ""}">
      <div class="bd-sd-top"><div class="bd-sd-hero">${ringMarkup(m)}${verdictMarkup(m, true)}</div>
        <div class="bd-sd-metrics">${TAB_ORDER.filter(hasMetric).map((metric) => metricCellMarkup(metric, m, { tabs: false })).join("")}</div></div>
      <div class="bd-sd-charts" data-n="${charts.length}">${charts.map((metric) => {
        const points = series(metric);
        const avg = points.filter((point) => point.value != null).length >= 3 ? average(points) : null;
        const latest = points[points.length - 1]?.value;
        return `<section class="bd-sd-card${metric === "score" ? " is-score" : ""}"><header><b>${esc(t(METRICS[metric].label))}</b><span>${[avg == null ? "" : `${esc(t("snit"))} ${esc(formatMetric(metric, metric === "score" || metric === "mask" ? Math.round(avg) : avg))}`, latest == null ? "" : `${esc(t("i nat"))} <b>${esc(formatMetric(metric, latest))}</b>`].filter(Boolean).join(" · ")}</span></header><div class="bd-chart" data-sd-chart="${metric}"></div></section>`;
      }).join("")}</div>
      ${history.approximate.size ? `<p class="bd-quiet">${esc(t("Ældre nætter er hentet fra langtidsstatistik og kan være omtrentlige."))}</p>` : ""}
    </div>`;
  }

  function drawDetailCharts(host) {
    host.querySelectorAll("[data-sd-chart]").forEach((chart) => {
      const metric = chart.dataset.sdChart;
      const width = Math.round(chart.clientWidth);
      const height = Math.round(chart.clientHeight);
      if (width >= 40 && height >= 30) chart.innerHTML = chartSvg(metric, series(metric), width, height);
    });
  }

  let detailResize = null;
  function openDetail() {
    if (!configured()) return;
    const host = B.openLayer("sleep", B.sheetMarkup("sleep", t("Søvn & CPAP"), ""), () => {
      detailResize?.disconnect();
      detailResize = null;
      detailSignature = "";
    });
    if (!host) return;
    renderDetail(true);
    loadHistory();
  }

  function renderDetail(force = false) {
    if (B.layerKind?.() !== "sleep") return;
    const body = B.root?.querySelector('[data-sheet="sleep"] [data-sheet-body]');
    if (!body) return;
    const signature = JSON.stringify([model(), historyVersion]);
    if (!force && signature === detailSignature) return;
    detailSignature = signature;
    body.innerHTML = detailBody();
    window.requestAnimationFrame(() => drawDetailCharts(body));
    if (!detailResize && typeof ResizeObserver !== "undefined") {
      let lastSize = "";
      detailResize = new ResizeObserver(() => {
        const size = `${body.clientWidth}x${body.clientHeight}`;
        if (size === lastSize) return;
        lastSize = size;
        window.requestAnimationFrame(() => drawDetailCharts(body));
      });
      detailResize.observe(body);
    }
  }

  // ---------------------------------------------------------------------------
  // Hooks used by the page and the menu
  // ---------------------------------------------------------------------------
  function onAction(target) {
    const action = target.dataset.bdAction;
    if (action === "sleep-metric") {
      const metric = target.dataset.metric;
      selected = metric === activeMetric() && metric !== "score" ? "score" : metric;
      barNote = null;
      B.renderSleep?.();
      return true;
    }
    if (action === "sleep-bar") {
      const metric = target.dataset.metric;
      const point = series(metric)[Number(target.dataset.index)];
      if (!point) return true;
      const wake = addDays(parseDateKey(point.key), 1);
      const date = capitalize(shortWeekdayDate(wake));
      barNote = { metric, text: point.value == null ? t("{date} · ingen data", { date }) : `${date} · ${point.approximate ? "≈ " : ""}${formatMetric(metric, point.value)}` };
      window.clearTimeout(barNoteTimerId);
      barNoteTimerId = window.setTimeout(() => { barNote = null; B.renderSleep?.(); }, BAR_NOTE_MS);
      B.renderSleep?.();
      return true;
    }
    if (action === "sleep-detail") { openDetail(); return true; }
    return false;
  }

  function onEntityChange(entityId, newState, oldState) {
    const i = ids();
    if (entityId === i.date && newState?.state !== oldState?.state && parseDateKey(String(newState?.state || "").slice(0, 10))) {
      window.clearTimeout(reloadTimerId);
      reloadTimerId = window.setTimeout(() => loadHistory(true), 8000);
    }
  }

  function onActivate() { loadHistory(); }

  function onReconnected() {
    if (!history.at || Date.now() - history.at > 30 * 60 * 1000) loadHistory(true);
  }

  // For the menu row "Søvn & CPAP".
  function summary() {
    if (!configured()) return null;
    const m = model();
    if (m.allDown) return { text: t("Utilgængelig"), off: true };
    if (m.stale) return { text: m.meta };
    const parts = [];
    if (m.values.score != null) parts.push(t("Score {score}", { score: fmt(m.values.score, 0) }));
    if (m.values.usage != null) parts.push(t("{time} t i nat", { time: hours(m.values.usage) }));
    return { text: parts.join(" · ") || m.title };
  }

  return {
    configured, entityIds, model, panelMarkup, render, renderDetail, openDetail, onAction, onEntityChange, onActivate, onReconnected, summary,
    reload: () => loadHistory(true)
  };
})();
