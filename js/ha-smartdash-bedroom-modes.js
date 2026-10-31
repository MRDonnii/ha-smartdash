// Time-of-day modes of the bedroom page (Morgen / Dag / Aften / Nat): the
// settings (panels.bedroom.modes, shared by Administration and the bedside
// device), their defaults and the pure schedule maths. No DOM here, so the
// admin page can load it too.
window.BeastBedroomModes = (() => {
  const MODES = ["morgen", "dag", "aften", "nat"];
  const LABELS = { morgen: "Morgen", dag: "Dag", aften: "Aften", nat: "Nat" };
  // The cards a mode can show or hide, in the order the settings list them.
  const CARDS = ["cams", "sec", "sleep", "cal", "lights", "scenes", "comfort", "media"];
  const CARD_LABELS = { cams: "Kameraer", sec: "Sikring", sleep: "Søvn", cal: "Kalender", lights: "Lys", scenes: "Stemninger", comfort: "Komfort", media: "Medier" };
  const DAY_TYPES = ["weekday", "weekend"];

  // Owner-approved defaults (design/amber-modes/rules.md): cameras are not
  // mounted in Morgen and Nat, the CPAP card is hidden at night.
  const all = (value) => Object.fromEntries(CARDS.map((card) => [card, value]));
  const DEFAULTS = Object.freeze({
    times: {
      weekday: { morgen: "06:00", dag: "10:00", aften: "18:00", nat: "22:30" },
      weekend: { morgen: "07:30", dag: "10:00", aften: "18:00", nat: "22:30" }
    },
    cards: {
      morgen: { ...all(true), cams: false },
      dag: all(true),
      aften: all(true),
      nat: { ...all(true), cams: false, sleep: false }
    },
    showAllMinutes: 10,
    nightOnGoodnight: true,
    fanWarmAt: 23.5
  });

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function defaults() { return clone(DEFAULTS); }

  function validTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours < 24 && minutes < 60 ? `${String(hours).padStart(2, "0")}:${match[2]}` : null;
  }

  function minutesOf(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  // Anything missing or invalid falls back to the default, key by key.
  function normalize(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const out = defaults();
    DAY_TYPES.forEach((type) => MODES.forEach((mode) => {
      const time = validTime(source.times?.[type]?.[mode]);
      if (time) out.times[type][mode] = time;
    }));
    MODES.forEach((mode) => CARDS.forEach((card) => {
      const value = source.cards?.[mode]?.[card];
      if (typeof value === "boolean") out.cards[mode][card] = value;
    }));
    const minutes = Number(source.showAllMinutes);
    if (Number.isFinite(minutes) && minutes >= 1) out.showAllMinutes = Math.min(120, Math.round(minutes));
    if (typeof source.nightOnGoodnight === "boolean") out.nightOnGoodnight = source.nightOnGoodnight;
    const warm = Number(source.fanWarmAt);
    if (source.fanWarmAt !== null && source.fanWarmAt !== "" && Number.isFinite(warm)) out.fanWarmAt = warm;
    return out;
  }

  function isWeekend(date) { const day = date.getDay(); return day === 0 || day === 6; }
  function dayType(date) { return isWeekend(date) ? "weekend" : "weekday"; }

  // A day's four mode starts as timestamps. A start earlier in the clock
  // than the previous mode's (e.g. Nat at 00:30 after Aften at 18:00) belongs
  // to the following night.
  function dayEvents(date, settings) {
    const times = settings.times[dayType(date)];
    const events = [];
    let previous = -1;
    let offset = 0;
    MODES.forEach((mode) => {
      const minutes = minutesOf(times[mode]);
      if (previous >= 0 && minutes + offset < previous) offset += 24 * 60;
      const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minutes + offset, 0, 0).getTime();
      previous = minutes + offset;
      events.push({ at, mode });
    });
    return events;
  }

  function eventsAround(now, settings) {
    const base = new Date(now);
    const events = [];
    for (let offset = -2; offset <= 2; offset += 1) {
      const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, 12);
      events.push(...dayEvents(day, settings));
    }
    return events.sort((a, b) => a.at - b.at);
  }

  // The scheduled mode at `now`, when it started and the next change.
  function scheduled(now, settings) {
    const events = eventsAround(now, settings);
    let current = null;
    let next = null;
    for (const event of events) {
      if (event.at <= now) current = event;
      else { next = event; break; }
    }
    return { mode: current?.mode || "nat", since: current?.at || 0, next: next || null, events };
  }

  function lastStart(events, mode, now) {
    let at = 0;
    events.forEach((event) => { if (event.mode === mode && event.at <= now) at = event.at; });
    return at;
  }

  // Overrides (all optional):
  //   goodnightAt  ms; Godnat run during Aften switches to Nat until Morgen
  //   manual       { mode, at } "Skift tilstand nu", until the next scheduled change
  function compute(now, settings, overrides = {}) {
    const plan = scheduled(now, settings);
    const result = { mode: plan.mode, scheduledMode: plan.mode, source: "schedule", since: plan.since, nextAt: plan.next?.at || 0, nextMode: plan.next?.mode || null };
    const goodnightAt = Number(overrides.goodnightAt) || 0;
    if (settings.nightOnGoodnight && plan.mode === "aften" && goodnightAt && goodnightAt >= lastStart(plan.events, "aften", now) && goodnightAt <= now + 60000) {
      result.mode = "nat";
      result.source = "goodnight";
      result.since = goodnightAt;
      // Nat lasts until the next Morgen, past a scheduled Nat start.
      const morning = plan.events.find((event) => event.mode === "morgen" && event.at > now);
      result.nextAt = morning?.at || result.nextAt;
      result.nextMode = "morgen";
    }
    const manual = overrides.manual;
    if (manual && MODES.includes(manual.mode) && Number(manual.at)) {
      const after = plan.events.find((event) => event.at > Number(manual.at));
      if (manual.at <= now && (!after || after.at > now)) {
        result.mode = manual.mode;
        result.source = "manual";
        result.since = Number(manual.at);
        result.nextAt = after?.at || result.nextAt;
        result.nextMode = after?.mode || result.nextMode;
      }
    }
    return result;
  }

  return { MODES, LABELS, CARDS, CARD_LABELS, DAY_TYPES, defaults, normalize, validTime, scheduled, compute, isWeekend, dayType };
})();
