// Pauseskærmens tidsplan pr. skærmtype -- Change by Claude AI (v0.8.100).
// Two independent timers per device type, each with its own switch:
//   "Tænd pauseskærm kl." (startAuto + start) and "Sluk pauseskærm kl." (endAuto + end).
// The bedside iPad (deviceType "bedroom") keeps them in panels.bedroom
// (saverStartAuto/saverStart/saverEndAuto/saverEnd, default on, 21:00/07:00);
// the wall kiosk and every other screen in the shared `screensaver` block
// (startAuto/startTime/endAuto/endTime). Missing switches count as on, so
// nothing changes until someone turns one off.
// Start off: the saver never starts by itself (a manual start still works).
// End off: a running saver stays until someone touches the screen; the end
// time still closes the window in which an idle screen may start it.
window.BeastSaverTimers = (() => {
  const STEP = 15;
  const TIME = /^(\d{1,2}):(\d{2})$/;

  function toMinutes(value, fallback) {
    const match = TIME.exec(String(value || "").trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
  }
  function fromMinutes(value) {
    const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  function inWindow(start, end, date = new Date()) {
    const minutes = date.getHours() * 60 + date.getMinutes();
    const from = toMinutes(start, 0);
    const to = toMinutes(end, 0);
    if (from === to) return true;
    return from > to ? minutes >= from || minutes < to : minutes >= from && minutes < to;
  }

  // target: "bedroom" (iPad) or "kiosk" (the shared schedule).
  function get(target) {
    if (target === "bedroom") {
      const panel = BeastConfig.get("panels.bedroom") || {};
      return {
        startAuto: panel.saverStartAuto !== false,
        start: fromMinutes(toMinutes(panel.saverStart, 21 * 60)),
        endAuto: panel.saverEndAuto !== false,
        end: fromMinutes(toMinutes(panel.saverEnd, 7 * 60))
      };
    }
    const saver = BeastConfig.get("screensaver") || {};
    return {
      startAuto: saver.startAuto !== false,
      start: fromMinutes(toMinutes(saver.startTime, 23 * 60)),
      endAuto: saver.endAuto !== false,
      end: fromMinutes(toMinutes(saver.endTime, 5 * 60 + 30))
    };
  }

  // Schedule keys a device may hold locally; they would beat the timers
  // saved here, so this device drops them when it saves its own timers.
  const LOCAL_SCHEDULE_KEYS = ["schedule", "startTime", "endTime", "startAuto", "endAuto"];
  function clearLocalOverride() {
    if (typeof BeastLocalSettings === "undefined") return;
    const local = BeastLocalSettings.get("screensaver", null);
    if (local && typeof local === "object" && LOCAL_SCHEDULE_KEYS.some((key) => key in local)) {
      const rest = { ...local };
      LOCAL_SCHEDULE_KEYS.forEach((key) => delete rest[key]);
      if (Object.keys(rest).length) BeastLocalSettings.set("screensaver", rest);
      else BeastLocalSettings.remove("screensaver");
    }
  }

  function thisTarget() {
    return typeof BeastLocalSettings !== "undefined" && BeastLocalSettings.isBedroomDevice() ? "bedroom" : "kiosk";
  }

  // Saves the whole pair at once through the normal config save (same path
  // and permissions as Tilstande and Administration).
  function save(target, timers) {
    if (target === thisTarget()) clearLocalOverride();
    if (target === "bedroom") {
      return BeastConfig.setPanel("bedroom", { saverStartAuto: timers.startAuto, saverStart: timers.start, saverEndAuto: timers.endAuto, saverEnd: timers.end });
    }
    const current = BeastConfig.get("screensaver") || {};
    // "Altid" would ignore the times; the timers mean a custom window.
    return BeastConfig.set("screensaver", { enabled: true, ...current, schedule: "custom", startAuto: timers.startAuto, startTime: timers.start, endAuto: timers.endAuto, endTime: timers.end });
  }

  function step(time, delta) {
    const minutes = toMinutes(time, 0);
    return fromMinutes(Math.round((minutes + delta) / STEP) * STEP);
  }

  // One short status line: what happens now.
  function status(target, date = new Date()) {
    const timers = get(target);
    if (!timers.startAuto && !timers.endAuto) return { active: false, text: "Ingen tidsplan · kun manuelt" };
    const active = timers.startAuto && inWindow(timers.start, timers.end, date);
    if (active) return { active, text: timers.endAuto ? `Aktiv nu · til kl. ${timers.end}` : "Aktiv nu · til du trykker" };
    if (timers.startAuto) return { active, text: `Starter kl. ${timers.start}` };
    return { active, text: `Slukker kl. ${timers.end} hvis den kører` };
  }

  return { STEP, get, save, step, status, inWindow, thisTarget, clearLocalOverride, toMinutes, fromMinutes };
})();
