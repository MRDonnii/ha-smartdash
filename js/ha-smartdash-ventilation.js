/* Optional vendor-neutral heat-recovery ventilation summary for the overview. */
window.BeastVentilation = (() => {
  const AIRFLOW_DURATION = 6.3;
  const AIRFLOW_STREAKS = 9;
  const fields = {
    room_temperature: ['Rumtemperatur', 'Room temperature'],
    supply_fan_percent: ['Indblæsning, hastighed %', 'Supply fan speed %'], extract_fan_percent: ['Udsugning, hastighed %', 'Extract fan speed %'],
    supply_fan_rpm: ['Indblæsningsblæser, RPM', 'Supply fan RPM'], extract_fan_rpm: ['Udsugningsblæser, RPM', 'Extract fan RPM'],
    filter_changed: ['Seneste filterskift', 'Last filter change'], filter_interval: ['Filterinterval, dage', 'Filter interval, days'],
    afterheat_active: ['Varmeflade aktiv', 'Heating coil active'], afterheat_after: ['Luft efter varmeflade', 'Air after coil'],
    afterheat_setpoint: ['Eftervarme setpunkt', 'Afterheat setpoint'], water_flow: ['Varmeflade fremløb', 'Coil water flow'], water_return: ['Varmeflade retur', 'Coil water return'],
    outdoor_temperature: ['Udeluft', 'Outdoor air'], supply_temperature: ['Indblæsning', 'Supply air'],
    extract_temperature: ['Udsugning', 'Extract air'], exhaust_temperature: ['Afkast', 'Exhaust air'],
    co2: ['CO₂', 'CO₂'], power: ['Effekt', 'Power'], heat_recovery: ['Varmegenvinding', 'Heat recovery'], humidity: ['Luftfugtighed', 'Humidity'],
    bypass: ['Bypass', 'Bypass'], mode: ['Driftstilstand', 'Operation mode'],
    level: ['Ventilatortrin', 'Fan level'], filter_days: ['Filter, dage tilbage', 'Filter days remaining'],
    air_quality: ['Luftkvalitet', 'Air quality'], heat_transfer: ['Varmeoverførsel', 'Heat transfer'], alarm: ['Alarm', 'Alarm']
  };
  // Entity-id suffixes the Home Assistant Dantherm integration itself
  // assigns (e.g. "..._outdoor_air_temperature", "..._bypass_active"),
  // shared by every install using that integration -- not this user's own
  // data, just the integration's fixed naming convention. Used to detect a
  // Dantherm device from its entities and auto-fill the fields it covers,
  // instead of hand-typing 13 sensor IDs one at a time.
  const DANTHERM_SUFFIXES = {
    outdoor_temperature: 'outdoor_air_temperature', supply_temperature: 'supply_air_temperature',
    extract_temperature: 'extract_air_temperature', exhaust_temperature: 'exhaust_air_temperature',
    heat_recovery: 'temperature_efficiency', co2: 'co2', mode: 'operating_mode',
    level: 'current_ventilation_level', bypass: 'bypass_active',
    supply_fan_rpm: 'supply_fan_speed', extract_fan_rpm: 'extract_fan_speed',
    supply_fan_percent: 'supply_fan_control', extract_fan_percent: 'extract_fan_control',
    filter_changed: 'last_filter_change', afterheat_setpoint: 'after_heater_setpoint'
  };
  // Groups every entity whose id ends in a known Dantherm suffix by its
  // shared prefix (the device), keeping only groups that matched enough of
  // the known fields to be a real Dantherm device rather than one
  // coincidentally-named unrelated sensor.
  function detectDanthermDevices() {
    const groups = new Map();
    for (const id of BeastHaSocket.getAllStates().keys()) {
      const dot = id.indexOf('.');
      const rest = id.slice(dot + 1);
      for (const [fieldKey, suffix] of Object.entries(DANTHERM_SUFFIXES)) {
        if (rest !== suffix && !rest.endsWith(`_${suffix}`)) continue;
        const prefix = rest.slice(0, rest.length - suffix.length).replace(/_$/, '');
        if (!groups.has(prefix)) groups.set(prefix, {});
        groups.get(prefix)[fieldKey] = id;
      }
    }
    const threshold = Math.ceil(Object.keys(DANTHERM_SUFFIXES).length / 2);
    return Array.from(groups.entries())
      .filter(([, matches]) => Object.keys(matches).length >= threshold)
      .map(([prefix, matches]) => {
        const sampleId = matches.bypass || matches.co2 || Object.values(matches)[0];
        const friendly = BeastHaSocket.getState(sampleId)?.attributes?.friendly_name || prefix;
        const label = friendly.replace(/\s+(Bypass active|CO2|Co2|Operating mode)\s*$/i, '').trim() || prefix;
        return { prefix, label, matches, count: Object.keys(matches).length };
      })
      .sort((a, b) => b.count - a.count);
  }
  // The Dantherm integration -- and community setups built on top of it --
  // never expose one single combined "alarm" entity covering everything;
  // fault signals are scattered: four electrical/thermal fault booleans
  // (over-current/-heating/-powering/-voltage) under one device, and a
  // separate single "filter alarm" under the filter-tracking device, each
  // potentially under its own prefix. No Home Assistant helper is required
  // to combine them: the card does it itself. entities.alarm can hold a
  // comma-separated list of source entities; alarmSummary() below treats
  // "any is on" as active.
  const DANTHERM_ALARM_GROUP_SUFFIXES = ['overcurrent', 'overheating', 'overpowering', 'overvoltage'];
  const DANTHERM_ALARM_SINGLE_SUFFIXES = ['filter_alarm'];
  function detectDanthermAlarmSources() {
    const groups = new Map();
    for (const id of BeastHaSocket.getAllStates().keys()) {
      const dot = id.indexOf('.');
      const rest = id.slice(dot + 1);
      for (const suffix of DANTHERM_ALARM_GROUP_SUFFIXES) {
        if (rest !== suffix && !rest.endsWith(`_${suffix}`)) continue;
        const prefix = rest.slice(0, rest.length - suffix.length).replace(/_$/, '');
        if (!groups.has(prefix)) groups.set(prefix, new Set());
        groups.get(prefix).add(id);
      }
    }
    const ids = new Set();
    Array.from(groups.values()).filter(set => set.size >= 2).forEach(set => set.forEach(id => ids.add(id)));
    // Single-entity alarm suffixes (e.g. a filter-due alarm) only count as
    // a real match when there's exactly one candidate -- an install with
    // several similarly-named sensors is ambiguous, and a wrong guess here
    // is worse than leaving the field for manual entry.
    for (const suffix of DANTHERM_ALARM_SINGLE_SUFFIXES) {
      const match = findUniqueSuffixMatch(suffix);
      if (match) ids.add(match);
    }
    return ids.size ? [{ ids: Array.from(ids).sort() }] : [];
  }
  // Fields that live on their own separate Home Assistant device (not the
  // main unit) -- an indoor-climate add-on sensor, an afterheat coil, etc.
  // -- so they never share the main device's entity-id prefix and can't be
  // grouped with it. Matched independently, each on its own suffix, and
  // only auto-filled when there's exactly one candidate: some of these
  // (air quality especially) are common enough sensor types that a large
  // install can have several unrelated ones, and picking the wrong one
  // silently would be worse than leaving it for manual entry.
  const DANTHERM_STANDALONE_SUFFIXES = {
    room_temperature: 'house_temperature', humidity: 'measured_relative_humidity',
    air_quality: 'air_quality', heat_transfer: 'heat_transfer',
    afterheat_active: 'afterheat_active', afterheat_after: 'air_after_heating_coil',
    water_flow: 'flow_temperature', water_return: 'return_temperature'
  };
  function findUniqueSuffixMatch(suffix) {
    const matches = [];
    for (const id of BeastHaSocket.getAllStates().keys()) {
      const rest = id.slice(id.indexOf('.') + 1);
      if (rest === suffix || rest.endsWith(`_${suffix}`)) matches.push(id);
    }
    return matches.length === 1 ? matches[0] : null;
  }
  function detectDanthermStandaloneFields() {
    const matches = {};
    for (const [fieldKey, suffix] of Object.entries(DANTHERM_STANDALONE_SUFFIXES)) {
      const match = findUniqueSuffixMatch(suffix);
      if (match) matches[fieldKey] = match;
    }
    return matches;
  }
  // entities.alarm holds one entity id or a comma-separated list (the
  // multi-source case built by the auto-detect above). Active if any
  // listed entity is "on"; "known" (vs. "no alarm configured") if at
  // least one listed entity currently has a real state.
  function alarmSummary() {
    const ids = String(config().entities?.alarm || '').split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length) return { known: false, active: false };
    const states = ids.map(id => BeastHaSocket.getState(id)).filter(entity => entity && !['unknown','unavailable',''].includes(entity.state));
    if (!states.length) return { known: false, active: false };
    return { known: true, active: states.some(entity => entity.state === 'on') };
  }
  const t = (da, en) => BeastLocalSettings.get('language', 'en') === 'da' ? da : en;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // The card currently being rendered/fitted -- set by render()/fitDiagram()
  // before calling into markup()/state()/etc., which all read it instead of
  // taking a card argument through every helper. Safe because rendering is
  // synchronous and single-threaded; mirrors the existing diagramSequence
  // module-level state below.
  let activeCard = null;
  const config = () => activeCard || {};
  function state(key) {
    const id = config().entities?.[key];
    const entity = id ? BeastHaSocket.getState(id) : null;
    return entity && !['unknown','unavailable',''].includes(entity.state) ? entity : null;
  }
  function number(key, suffix, digits=0) {
    const entity = state(key), value = entity ? Number(entity.state) : NaN;
    return Number.isFinite(value) ? value.toLocaleString(t('da-DK','en-GB'), {maximumFractionDigits:digits}) + suffix : '—';
  }
  function entityValue(key, fallbackSuffix='') {
    const entity = state(key);
    if (!entity) return '—';
    const value = Number(entity.state);
    if (!Number.isFinite(value)) return esc(entity.state);
    const suffix = entity.attributes?.unit_of_measurement || fallbackSuffix;
    return value.toLocaleString(t('da-DK','en-GB')) + (suffix ? ' ' + suffix : '');
  }
  function airQualityValue() {
    const raw = state('air_quality')?.state?.toLowerCase();
    const labels = {good: t('God','Good'), moderate: t('Moderat','Moderate'), poor: t('Dårlig','Poor')};
    return labels[raw] || (raw ? esc(state('air_quality').state) : '—');
  }
  // Shared scale for both air streams: the same measured temperature
  // always has the same colour, regardless of route or operating mode.
  function temperatureColor(key) {
    const entity = state(key), value = entity ? Number(entity.state) : NaN;
    if (!Number.isFinite(value)) return '#8c9aa8';
    const stops = [[0,[83,156,255]],[12,[83,208,250]],[18,[155,220,219]],[23,[254,183,125]],[32,[255,124,81]],[45,[255,59,59]]];
    if (value <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`;
    for (let i=1;i<stops.length;i++) {
      if (value <= stops[i][0]) {
        const [a,ca]=stops[i-1], [b,cb]=stops[i], k=(value-a)/(b-a);
        return `rgb(${ca.map((v,j)=>Math.round(v+(cb[j]-v)*k)).join(',')})`;
      }
    }
    return `rgb(${stops.at(-1)[1].join(',')})`;
  }
  let diagramSequence = 0;
  function markup(id) {
    const c = config(), bypass = state('bypass')?.state;
    const open = ['open','opening','on'].includes(bypass);
    const temperature = key => number(key, '°', 1);
    const datum = (key, cls) => `<div class="hrv-temp ${cls}"><small>${t(...fields[key])}</small><strong>${temperature(key)}</strong></div>`;
    const rawMode = state('mode')?.state;
    const modes = {auto_or_scheduled:t('Auto / tidsplan','Auto / scheduled'),standby:t('Standby','Standby'),auto_or_boost:t('Auto / boost','Auto / boost'),fireplace:t('Pejs','Fireplace')};
    const mode = modes[rawMode] || rawMode;
    const rawLevel = state('level')?.state;
    const level = /^level_[1-9]$/.test(rawLevel || '') ? rawLevel.slice(6) : rawLevel;
    const hasData = Object.keys(fields).some(key => state(key));
    const recovery = open ? '—' : number('heat_recovery', '%');
    const coil = c.showAfterheat === true && !open;
    const coilState = state('afterheat_active')?.state;
    const coilActive = coilState === 'on';
    const coilStatus = coilActive ? t('Varmer','Heating') : coilState === 'off' ? t('Inaktiv','Inactive') : t('Ukendt','Unknown');
    const flow = state('water_flow'), waterReturn = state('water_return');
    const delta = flow && waterReturn ? Number(flow.state) - Number(waterReturn.state) : NaN;
    const deltaText = Number.isFinite(delta) ? delta.toLocaleString(t('da-DK','en-GB'), {maximumFractionDigits:1}) + '°' : '—';
    const svgTemp = (key, label, x, y, anchor, color) => `<g class="hrv-svg-temp" transform="translate(${x} ${y})" text-anchor="${anchor}"><text class="label">${label}</text><text class="value" y="24" fill="${temperatureColor(key)}">${temperature(key)}</text></g>`;
    const supplyKey = coil && c.entities?.afterheat_after ? 'afterheat_after' : 'supply_temperature';
    const coldPath = 'M24 106 H145 Q164 106 181 130 L211 153 Q224 170 244 170 H416';
    const warmPath = 'M416 106 H244 Q224 106 207 130 L177 153 Q164 170 145 170 H24';
    const duct = (route, path, rpmKey) => {
      const value = state(rpmKey), running = value && Number(value.state) > 0;
      return `<g class="hrv-duct ${route} ${running ? 'running' : ''}">
        <path class="hrv-duct-rim hrv-route-${route}" d="${path}"/>
        <path class="hrv-duct-inner hrv-route-${route}" d="${path}"/>
        <path class="hrv-path ${route} hrv-route-${route}" d="${path}"/>
        <path class="hrv-duct-seams"/>
        ${Array.from({length:AIRFLOW_STREAKS}, (_,i)=>`<g class="hrv-duct-air"><path d="M-11 -2 Q-5 -4 1 -2 M-7 2 H3"/><animateMotion data-route="${route}" dur="${AIRFLOW_DURATION}s" begin="__AIRFLOW_BEGIN_${i}__" calcMode="linear" repeatCount="indefinite" rotate="auto" path="${path}"/></g>`).join('')}
      </g>`;
    };
    const fan = (key, direction, y) => {
      const value = state(key), rpm = value ? Number(value.state) : NaN;
      const running = Number.isFinite(rpm) && rpm > 0;
      return `<g class="hrv-fan ${direction} ${running ? 'running' : ''}" transform="translate(86 ${y})" aria-label="${t(...fields[key])}: ${number(key,' RPM')}">
        <text class="hrv-fan-percent" x="0" y="-28" text-anchor="middle">${number(direction === 'supply' ? 'supply_fan_percent' : 'extract_fan_percent','%')}</text>
        <rect class="hrv-air-outlet" x="-9" y="-21" width="18" height="42" rx="8"/>
        <ellipse class="hrv-air-outlet-opening" cx="${direction === 'supply' ? 4 : -4}" cy="0" rx="3" ry="15"/>
        <g class="hrv-fan-wind" style="stroke:${temperatureColor(direction === 'supply' ? 'outdoor_temperature' : 'exhaust_temperature')};animation-delay:__FAN_DELAY__"><path d="M11 -6 C22 -6 22 -13 32 -13 C40 -13 42 -7 35 -5"/><path d="M11 0 H42"/><path d="M11 6 C23 6 26 13 36 13"/></g>
      </g>`;
    };
    const changed = Date.parse(state('filter_changed')?.state || '');
    const intervalState = state('filter_interval'), remainingState = state('filter_days');
    const interval = intervalState ? Number(intervalState.state) : NaN;
    const now = Date.now();
    const remaining = c.entities?.filter_days
      ? (remainingState ? Number(remainingState.state) : NaN)
      : Number.isFinite(changed) && changed <= now && Number.isFinite(interval) && interval > 0
        ? (changed + interval * 86400000 - now) / 86400000 : NaN;
    const filterValue = Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining)).toLocaleString(t('da-DK','en-GB')) + ' d' : '—';
    const filterLabel = t('Filter tilbage','Filter left');
    const alarm = alarmSummary();
    const alarmActive = alarm.active;
    const alarmText = alarm.known ? (alarmActive ? t('Alarm','Alarm') : 'OK') : '—';
    const coilDetails = coil ? `<g class="hrv-coil ${coilActive?'active':''}" aria-label="${t('Varmeflade','Heating coil')}: ${coilStatus}">
      <text class="hrv-svg-delta" x="310" y="132" text-anchor="middle"><title>${t('Fremløb minus retur','Flow minus return')}</title>ΔT ${deltaText}</text>
      <rect class="hrv-coil-glow" x="256" y="145" width="108" height="50" rx="10" aria-hidden="true"/>
      <rect class="hrv-coil-face" x="258" y="147" width="104" height="46" rx="8"/>
      <path class="hrv-coil-divider" d="M310 154 V186"/>
      <text class="hrv-svg-small" x="284" y="162" text-anchor="middle">${t('Fremløb','Flow')}</text><text class="hrv-svg-coil-value" x="284" y="182" text-anchor="middle">${number('water_flow','°',1)}</text>
      <text class="hrv-svg-small" x="336" y="162" text-anchor="middle">${t('Retur','Return')}</text><text class="hrv-svg-coil-value" x="336" y="182" text-anchor="middle">${number('water_return','°',1)}</text>
    </g>` : '';
    return `<article class="smartdash-hrv ${open ? 'hrv-bypass' : ''} ${c.animation === false ? 'hrv-still' : ''}">
      <header><div><small>${t('VENTILATION','VENTILATION')}</small><h3>${esc(c.title || t('Ventilation','Ventilation'))}</h3></div><span class="hrv-mode ${hasData?'':'hrv-offline'}">${esc(mode || t('Ingen driftsdata','No operation data'))}</span></header>
      <div class="hrv-body">
      <div class="hrv-metrics hrv-metrics-left">
        <div class="${open ? 'hrv-metric-info' : ''}"><strong>${open ? t('Åben','Open') : t('Lukket','Closed')}</strong><small>${t(...fields.bypass)}</small></div>
        <div><strong>${airQualityValue()}</strong><small>${t(...fields.air_quality)}</small></div>
        <div><strong>${entityValue('heat_transfer','W')}</strong><small>${t(...fields.heat_transfer)}</small></div>
        <div class="${alarmActive ? 'hrv-metric-danger' : alarm.known ? 'hrv-metric-ok' : ''}"><strong>${alarmText}</strong><small>${t(...fields.alarm)}</small></div>
      </div>
      <div class="hrv-airflow">
        <svg data-diagram-id="${id}" viewBox="0 0 440 270" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${t('Ventilationsanlæg i huset. Udeluft og afkast udenfor; udsugning og indblæsning indenfor.','Ventilation unit inside the house. Outdoor air and exhaust outside; extract and supply inside.')}">
          <defs class="hrv-temperature-gradients"></defs>
          <path class="hrv-house" d="M112 54 L273 4 L436 54 V263 H112 Z"/>
          <text class="hrv-svg-zone" x="14" y="39">${t('UDE','OUTSIDE')}</text><text class="hrv-svg-zone" x="273" y="25" text-anchor="middle">${t('INDE','INSIDE')}</text>
          <g class="hrv-room-climate" transform="translate(273 43)" text-anchor="middle" aria-label="${t('Rumtemperatur og luftfugtighed','Room temperature and humidity')}">
            <text class="hrv-room-label" x="-35" y="0">${t('Rum','Room')}</text><text class="hrv-room-value" x="-35" y="19">${temperature('room_temperature')}</text>
            <path d="M0 -4 V22"/><text class="hrv-room-label" x="35" y="0">${t('Fugt','Humidity')}</text><text class="hrv-room-value" x="35" y="19">${number('humidity','%')}</text>
          </g>
          ${duct('cold',coldPath,'supply_fan_rpm')}${duct('warm',warmPath,'extract_fan_rpm')}
          <path class="hrv-core" d="M194 99 L230 138 194 177 158 138Z"/><path class="hrv-fin" d="M177 119 L211 156 M171 128 L203 164 M187 111 L218 145"/>
          <g class="hrv-core-label" text-anchor="middle" aria-label="${t(...fields.heat_recovery)}: ${recovery}"><text class="hrv-core-value" x="194" y="134">${recovery}</text><text class="hrv-core-caption" x="194" y="148">${t('Genvinding','Recovery')}</text></g>

          ${fan('supply_fan_rpm','supply',106)}${fan('extract_fan_rpm','extract',170)}
          ${coilDetails}
          ${svgTemp('outdoor_temperature',t('Udeluft','Outdoor air'),14,63,'start','#80cfee')}
          ${svgTemp(open ? supplyKey : 'extract_temperature',open ? t('Indblæsning','Supply air') : t('Udsugning','Extract air'),426,63,'end','#ebbd99')}
          ${svgTemp('exhaust_temperature',t('Afkast','Exhaust air'),14,205,'start','#d4dfeb')}
          ${svgTemp(open ? 'extract_temperature' : supplyKey,open ? t('Udsugning','Extract air') : t('Indblæsning','Supply air'),426,205,'end','#ebbd99')}
        </svg>
      </div>
      <div class="hrv-metrics"><div data-hrv-co2><strong>${number('co2','')}</strong><small>CO₂ · ppm</small></div><div><strong>${esc(level || '—')}</strong><small>${t('Ventilatortrin','Fan level')}</small></div><div class="hrv-metric-secondary"><strong>${number('power',' W')}</strong><small>${t('Effekt','Power')}</small></div><div data-hrv-filter title="${t('Dage til filterskift. Fra valgt sensor eller beregnet af seneste skift og filterinterval','Days until filter change. From the selected sensor or calculated from last change and filter interval')}"><strong>${filterValue}</strong><small>${filterLabel}</small></div></div>
      </div>

    </article>`;
  }
  // Spread the layout across the actual available area, keeping text and
  // equipment undistorted. Only the room envelope and pipe lengths expand.
  function fitDiagram(host) {
    const svg = host.querySelector('.hrv-airflow svg');
    if (!svg) return;
    const {width, height} = svg.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    const ratio = width / height;
    const w = Math.max(440, 270 * ratio), h = Math.max(270, 440 / ratio);
    const signature = `${w.toFixed(1)}:${h.toFixed(1)}`;
    if (svg.dataset.fit === signature) return;
    svg.dataset.fit = signature;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const sx = w / 440, sy = h / 270;
    const cx = 194 * sx, cy = 138 * sy + 18;
    const top = cy - 32, bottom = cy + 32;
    const left = 24, right = w - 24;
    const bypassOpen = host.querySelector('.smartdash-hrv').classList.contains('hrv-bypass');
    const cold = bypassOpen ? `M${left} ${top} H${right}` : `M${left} ${top} H${cx-49} Q${cx-30} ${top} ${cx-13} ${cy-8} L${cx+17} ${cy+15} Q${cx+30} ${bottom} ${cx+50} ${bottom} H${right}`;
    const warm = bypassOpen ? `M${right} ${bottom} H${left}` : `M${right} ${top} H${cx+50} Q${cx+30} ${top} ${cx+13} ${cy-8} L${cx-17} ${cy+15} Q${cx-30} ${bottom} ${cx-49} ${bottom} H${left}`;
    svg.querySelector('.hrv-house').setAttribute('transform', `scale(${sx} ${sy})`);
    svg.querySelectorAll('.hrv-core,.hrv-fin,.hrv-core-label').forEach(el => el.setAttribute('transform', `translate(${cx-194} ${cy-138})`));
    const coilXForColor = (cx + 50 + right) / 2;
    const hasCoil = config().showAfterheat === true;
    const finalKey = hasCoil && config().entities?.afterheat_after ? 'afterheat_after' : 'supply_temperature';
    const outdoorColor=temperatureColor('outdoor_temperature'), supplyColor=temperatureColor('supply_temperature');
    let finalColor=temperatureColor(finalKey);
    // Add a heating-status accent only downstream of an active coil.
    // Keep the measured temperature as the base and unknown values neutral.
    if (hasCoil && state('afterheat_active')?.state === 'on' && finalColor.startsWith('rgb(')) {
      const channels=finalColor.match(/\d+/g).map(Number), heated=[240,105,92];
      finalColor=`rgb(${channels.map((v,i)=>Math.round(v*.4+heated[i]*.6)).join(',')})`;
    }
    const extractColor=temperatureColor('extract_temperature'), exhaustColor=temperatureColor('exhaust_temperature');
    const supplyTransition = bypassOpen ? cx+76 : cx+36;
    const coldStops = [[left,outdoorColor],[cx-36,outdoorColor],[supplyTransition,supplyColor],[hasCoil?Math.max(supplyTransition,coilXForColor-50):right,supplyColor],...(hasCoil?[[coilXForColor+50,finalColor],[right,finalColor]]:[])];
    const warmStops = [[left,exhaustColor],[cx-36,exhaustColor],[cx+36,extractColor],[right,extractColor]];
    const id=svg.dataset.diagramId;
    svg.querySelector('defs').innerHTML = [['cold',coldStops],['warm',warmStops]].map(([route,stops])=>`<linearGradient id="${id}-${route}" gradientUnits="userSpaceOnUse" x1="${left}" x2="${right}" y1="0" y2="0">${stops.map(([x,color])=>`<stop offset="${Math.max(0,Math.min(1,(x-left)/(right-left)))}" stop-color="${color}"/>`).join('')}</linearGradient>`).join('');
    for (const [route, path] of [['cold',cold],['warm',warm]]) {
      svg.querySelectorAll(`.hrv-route-${route}`).forEach(el=>el.setAttribute('d',path));
      svg.querySelectorAll(`animateMotion[data-route="${route}"]`).forEach(el=>el.setAttribute('path',path));
      const centreline = svg.querySelector(`.hrv-path.${route}`);
      const length = centreline.getTotalLength();
      centreline.style.stroke = `url(#${id}-${route})`;
      // Match moving streak colour changes to their physical position along
      // the route, including the longer bypass and the separate heating coil.
      const points = route === 'cold' ? coldStops : [...warmStops].reverse();
      const samples = Array.from({length:241},(_,i)=>({fraction:i/240,point:centreline.getPointAtLength(length*i/240)}));
      let previous=0;
      const phases=points.map(([x,color],index)=>{
        let fraction=index===0?0:index===points.length-1?1:samples.filter(s=>s.fraction>=previous).reduce((best,s)=>Math.abs(s.point.x-x)<Math.abs(best.point.x-x)?s:best,samples[Math.round(previous*240)]).fraction;
        fraction=Math.max(previous,fraction);previous=fraction;return [fraction,color];
      });
      const unique=phases.filter((p,i)=>i===0||p[0]>phases[i-1][0]);
      svg.querySelectorAll(`.hrv-duct.${route} .hrv-duct-air`).forEach((streak,i)=>{
        const motion=streak.querySelector('animateMotion');
        let animation=streak.querySelector('animate');
        if(!animation){animation=document.createElementNS('http://www.w3.org/2000/svg','animate');streak.append(animation);}
        animation.setAttribute('attributeName','stroke');animation.setAttribute('values',unique.map(p=>p[1]).join(';'));animation.setAttribute('keyTimes',unique.map(p=>p[0]).join(';'));animation.setAttribute('dur',`${AIRFLOW_DURATION}s`);animation.setAttribute('begin',motion.getAttribute('begin'));animation.setAttribute('calcMode','linear');animation.setAttribute('repeatCount','indefinite');
        streak.style.stroke=points[0][1];
      });
      let seams = '';
      for (let distance = 28; distance < length-12; distance += 48) {
        const point = centreline.getPointAtLength(distance);
        const before = centreline.getPointAtLength(Math.max(0,distance-1));
        const after = centreline.getPointAtLength(Math.min(length,distance+1));
        const dx=after.x-before.x, dy=after.y-before.y, norm=Math.hypot(dx,dy)||1;
        const nx=-dy/norm*5.5, ny=dx/norm*5.5;
        seams += `M${point.x-nx} ${point.y-ny} L${point.x+nx} ${point.y+ny} `;
      }
      svg.querySelector(`.hrv-duct.${route} .hrv-duct-seams`).setAttribute('d',seams);
    }
    // Centre the heating coil on the straight supply pipe, not on the bend.
    const coilX = (cx + 50 + right) / 2;
    svg.querySelector('.hrv-coil')?.setAttribute('transform', `translate(${coilX-310} ${bottom-170})`);
    svg.querySelector('.hrv-fan.supply')?.setAttribute('transform', `translate(${86*sx} ${top})`);
    svg.querySelector('.hrv-fan.extract')?.setAttribute('transform', `translate(${86*sx} ${bottom})`);
    const temps = svg.querySelectorAll('.hrv-svg-temp');
    [[14,top-51],[w-14,top-51],[14,bottom+39],[w-14,bottom+39]].forEach(([x,y],i) => temps[i].setAttribute('transform', `translate(${x} ${y})`));
    const zones = svg.querySelectorAll('.hrv-svg-zone');
    zones[1].setAttribute('x', 273*sx);
    zones[1].setAttribute('y', 25*sy);
    svg.querySelector('.hrv-room-climate').setAttribute('transform', `translate(${273*sx} ${43*sy})`);
  }
  function render(host, card) {
    if (!host) return;
    activeCard = card || {};
    host._hrvDiagramId ||= `hrv-diagram-${++diagramSequence}`;
    const template = markup(host._hrvDiagramId);
    if (host._hrvMarkup !== template) {
      const airflowPhase = (Date.now() / 1000) % AIRFLOW_DURATION;
      const fanPhase = (Date.now() / 1000) % 2.8;
      const html = template
        .replace(/__AIRFLOW_BEGIN_(\d+)__/g, (_, index) => `${-(airflowPhase + Number(index) * AIRFLOW_DURATION / AIRFLOW_STREAKS)}s`)
        .replaceAll('__FAN_DELAY__', `${-fanPhase}s`);
      host.innerHTML = html;
      host._hrvMarkup = template;
    }
    fitDiagram(host);
    if (!host._hrvResize && typeof ResizeObserver !== 'undefined') {
      host._hrvResize = new ResizeObserver(() => {
        if (!host.isConnected) { host._hrvResize.disconnect(); host._hrvResize = null; return; }
        // The card this host was fitted for may no longer be the active one
        // (another ventilation-typed card could theoretically render in
        // between) -- fitDiagram() only reads geometry and the entities
        // dataset already baked into the DOM, so this is safe either way.
        fitDiagram(host);
      });
      host._hrvResize.observe(host);
    }
  }
  // Standalone "Indstil kort" editor, opened the same way as every other
  // freeform overview card (gear icon -> modal), instead of the old
  // fieldset buried inside the camera picker. commit(null) on cancel,
  // commit(updatedCard) to save -- same contract as configureBasicCard().
  function openEditor(card, commit) {
    const safe = esc;
    const overlay = document.createElement('div');
    overlay.className = 'beast-modal-overlay';
    const entityIds = Array.from(BeastHaSocket.getAllStates().keys()).filter(id => /^(sensor|binary_sensor|select|cover|fan)\./.test(id));
    const datalist = entityIds.map(id => `<option value="${safe(id)}">${safe(BeastHaSocket.getState(id)?.attributes?.friendly_name || id)}</option>`).join('');
    const entityFields = Object.entries(fields).map(([key, label]) => `<label class="beast-page-editor-field">${safe(t(...label))}${key === 'alarm' ? `<small>${safe(t('Kan være flere entities adskilt af komma','Can be several entities separated by commas'))}</small>` : ''}<input type="search" list="hrv-entities-datalist" data-hrv-entity="${key}" value="${safe(card.entities?.[key] || '')}" placeholder="${key === 'mode' || key === 'level' ? 'select.' : 'sensor.'}"></label>`).join('');
    const detected = detectDanthermDevices();
    const alarmSources = detectDanthermAlarmSources();
    const standaloneFields = detectDanthermStandaloneFields();
    const standaloneCount = Object.keys(standaloneFields).length;
    const bonusCount = (alarmSources.length ? 1 : 0) + standaloneCount;
    const detectFieldCount = Object.keys(DANTHERM_SUFFIXES).length + bonusCount;
    const bonusNotes = [
      alarmSources.length ? t(`${alarmSources[0].ids.length} separate fejlsensorer, kombineret til alarmfeltet`, `${alarmSources[0].ids.length} separate fault sensors, combined into the alarm field`) : null,
      standaloneCount ? t(`${standaloneCount} felt(er) fra andre Dantherm-enheder (${Object.keys(standaloneFields).map(key => t(...fields[key])).join(', ')})`, `${standaloneCount} field(s) from other Dantherm devices (${Object.keys(standaloneFields).map(key => t(...fields[key])).join(', ')})`) : null
    ].filter(Boolean);
    const detectMarkup = detected.length ? `<div class="beast-page-editor-field">
        <strong>${safe(t('Autodetekteret Dantherm-enhed','Auto-detected Dantherm device'))}</strong>
        ${detected.length > 1
          ? `<select data-hrv-autodetect-device>${detected.map((item, index) => `<option value="${index}">${safe(item.label)} (${item.count}/${detectFieldCount})</option>`).join('')}</select>`
          : `<span>${safe(detected[0].label)} (${detected[0].count + bonusCount}/${detectFieldCount} ${safe(t('felter fundet','fields found'))})</span>`}
        <button type="button" class="beast-btn" data-hrv-autofill>${safe(t('Udfyld automatisk','Fill automatically'))}</button>
        <small>${safe(t('Udfylder kun de felter der hører til selve ventilationsenheden. Overskriver eventuelle værdier i de felter.','Only fills the fields belonging to the ventilation unit itself. Overwrites any values already in those fields.'))}${bonusNotes.length ? ' ' + safe(t('Fandt også: ','Also found: ') + bonusNotes.join('; ') + '.') : ''}</small>
      </div>` : '';
    overlay.innerHTML = `<div class="beast-modal beast-page-entity-modal" role="dialog" aria-modal="true">
      <div class="beast-modal-header"><div><small>${safe(t('Varme','Heating'))}</small><h3>${safe(t('Rediger ventilationskort','Edit ventilation card'))}</h3></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon('close', {size: 22})}</button></div>
      <div class="beast-modal-body">
        <label class="beast-page-editor-field">${safe(t('Kortets navn','Card title'))}<input data-hrv-title value="${safe(card.title || t('Ventilation','Ventilation'))}" maxlength="80"></label>
        <label class="beast-page-editor-check"><input type="checkbox" data-hrv-coil ${card.showAfterheat === true ? 'checked' : ''}> ${safe(t('Vis varmeflade','Show heating coil'))}</label>
        <label class="beast-page-editor-check"><input type="checkbox" data-hrv-animation ${card.animation !== false ? 'checked' : ''}> ${safe(t('Animeret luftstrøm','Animated airflow'))}</label>
        ${detectMarkup}
        ${entityFields}
        <datalist id="hrv-entities-datalist">${datalist}</datalist>
        <button type="button" class="beast-btn beast-btn-primary" data-hrv-save>${safe(t('Gem ændringer','Save changes'))}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-hrv-autofill]')?.addEventListener('click', () => {
      const deviceSelect = overlay.querySelector('[data-hrv-autodetect-device]');
      const chosen = detected[deviceSelect ? Number(deviceSelect.value) : 0];
      if (!chosen) return;
      Object.entries(chosen.matches).forEach(([key, entityId]) => {
        const input = overlay.querySelector(`[data-hrv-entity="${key}"]`);
        if (input) input.value = entityId;
      });
      // The alarm field accepts a comma-separated list of source entities
      // (see alarmSummary()) -- fill it from whichever fault-sensor group
      // was found, independent of the main device's prefix, since the
      // Dantherm integration exposes these under a separate device on this
      // install.
      if (alarmSources.length) {
        const alarmInput = overlay.querySelector('[data-hrv-entity="alarm"]');
        if (alarmInput) alarmInput.value = alarmSources[0].ids.join(',');
      }
      // Fields that live on their own separate device (indoor-climate
      // add-on sensor, afterheat coil, ...) and so never shared the main
      // device's prefix -- only filled when detection found exactly one
      // unambiguous candidate.
      Object.entries(standaloneFields).forEach(([key, entityId]) => {
        const input = overlay.querySelector(`[data-hrv-entity="${key}"]`);
        if (input) input.value = entityId;
      });
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-close]')) { overlay.remove(); commit(null); return; }
      if (!event.target.closest('[data-hrv-save]')) return;
      const entities = Object.fromEntries(Array.from(overlay.querySelectorAll('[data-hrv-entity]'), input => [input.dataset.hrvEntity, input.value.trim()]).filter(([, value]) => value));
      commit({
        ...card,
        label: overlay.querySelector('[data-hrv-title]').value.trim() || t('Ventilation','Ventilation'),
        title: overlay.querySelector('[data-hrv-title]').value.trim() || t('Ventilation','Ventilation'),
        animation: overlay.querySelector('[data-hrv-animation]').checked,
        showAfterheat: overlay.querySelector('[data-hrv-coil]').checked,
        entities
      });
      overlay.remove();
    });
  }
  return {render, openEditor, fields};
})();
