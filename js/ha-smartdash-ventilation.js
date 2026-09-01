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
    level: ['Ventilatortrin', 'Fan level'], filter_days: ['Filter, dage tilbage', 'Filter days remaining']
  };
  const t = (da, en) => BeastLocalSettings.get('language', 'en') === 'da' ? da : en;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const config = () => BeastConfig.get('overviewVentilation') || {};
  const enabled = () => config().enabled === true;
  function state(key) {
    const id = config().entities?.[key];
    const entity = id ? BeastHaSocket.getState(id) : null;
    return entity && !['unknown','unavailable',''].includes(entity.state) ? entity : null;
  }
  function number(key, suffix, digits=0) {
    const entity = state(key), value = entity ? Number(entity.state) : NaN;
    return Number.isFinite(value) ? value.toLocaleString(t('da-DK','en-GB'), {maximumFractionDigits:digits}) + suffix : '—';
  }
  // Shared scale for both air streams: the same measured temperature
  // always has the same colour, regardless of route or operating mode.
  function temperatureColor(key) {
    const entity = state(key), value = entity ? Number(entity.state) : NaN;
    if (!Number.isFinite(value)) return '#8c9aa8';
    const stops = [[0,[101,159,237]],[12,[109,195,224]],[18,[165,210,209]],[23,[234,185,145]],[32,[237,133,99]],[45,[226,88,88]]];
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
    const coil = c.showAfterheat === true;
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
      <div class="hrv-airflow">
        <svg data-diagram-id="${id}" viewBox="0 0 440 270" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${t('Ventilationsanlæg i huset. Udeluft og afkast udenfor; udsugning og indblæsning indenfor.','Ventilation unit inside the house. Outdoor air and exhaust outside; extract and supply inside.')}">
          <defs class="hrv-temperature-gradients"></defs>
          <path class="hrv-house" d="M112 58 L273 12 L436 58 V263 H112 Z"/>
          <text class="hrv-svg-zone" x="14" y="39">${t('UDE','OUTSIDE')}</text><text class="hrv-svg-zone" x="273" y="25" text-anchor="middle">${t('INDE','INSIDE')}</text>
          <g class="hrv-room-climate" transform="translate(273 43)" text-anchor="middle" aria-label="${t('Rumtemperatur og luftfugtighed','Room temperature and humidity')}">
            <text class="hrv-room-label" x="-35" y="0">${t('Rum','Room')}</text><text class="hrv-room-value" x="-35" y="19">${temperature('room_temperature')}</text>
            <path d="M0 -4 V22"/><text class="hrv-room-label" x="35" y="0">${t('Fugt','Humidity')}</text><text class="hrv-room-value" x="35" y="19">${number('humidity','%')}</text>
          </g>
          ${duct('cold',coldPath,'supply_fan_rpm')}${duct('warm',warmPath,'extract_fan_rpm')}
          <path class="hrv-core" d="M194 99 L230 138 194 177 158 138Z"/><path class="hrv-fin" d="M177 119 L211 156 M171 128 L203 164 M187 111 L218 145"/>

          <path class="hrv-arrow cold" d="M126 102 L132 106 126 110 M399 166 L405 170 399 174"/><path class="hrv-arrow warm" d="M400 102 L394 106 400 110 M39 166 L33 170 39 174"/>
          ${fan('supply_fan_rpm','supply',106)}${fan('extract_fan_rpm','extract',170)}
          ${coilDetails}
          ${svgTemp('outdoor_temperature',t('Udeluft','Outdoor air'),14,63,'start','#80cfee')}
          ${svgTemp('extract_temperature',t('Udsugning','Extract air'),426,63,'end','#ebbd99')}
          ${svgTemp('exhaust_temperature',t('Afkast','Exhaust air'),14,205,'start','#d4dfeb')}
          ${svgTemp(supplyKey,t('Indblæsning','Supply air'),426,205,'end','#ebbd99')}
        </svg>
      </div>
      <div class="hrv-metrics"><div data-hrv-co2><strong>${number('co2','')}</strong><small>CO₂ · ppm</small></div><div><strong>${recovery}</strong><small>${t('Genvinding','Recovery')}</small></div><div><strong>${esc(level || '—')}</strong><small>${t('Ventilatortrin','Fan level')}</small></div><div class="hrv-metric-secondary"><strong>${number('power',' W')}</strong><small>${t('Effekt','Power')}</small></div><div data-hrv-filter title="${t('Dage til filterskift. Fra valgt sensor eller beregnet af seneste skift og filterinterval','Days until filter change. From the selected sensor or calculated from last change and filter interval')}"><strong>${filterValue}</strong><small>${filterLabel}</small></div></div>
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
    const cold = bypassOpen ? `M${left} ${top} H${cx-88} Q${cx-76} ${top} ${cx-76} ${top-12} V${cy-66} Q${cx-76} ${cy-78} ${cx-64} ${cy-78} H${cx+58} Q${cx+70} ${cy-78} ${cx+70} ${cy-66} V${bottom-12} Q${cx+70} ${bottom} ${cx+82} ${bottom} H${right}` : `M${left} ${top} H${cx-49} Q${cx-30} ${top} ${cx-13} ${cy-8} L${cx+17} ${cy+15} Q${cx+30} ${bottom} ${cx+50} ${bottom} H${right}`;
    const warm = `M${right} ${top} H${cx+50} Q${cx+30} ${top} ${cx+13} ${cy-8} L${cx-17} ${cy+15} Q${cx-30} ${bottom} ${cx-49} ${bottom} H${left}`;
    svg.querySelector('.hrv-house').setAttribute('transform', `scale(${sx} ${sy})`);
    svg.querySelectorAll('.hrv-core,.hrv-fin').forEach(el => el.setAttribute('transform', `translate(${cx-194} ${cy-138})`));
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
    svg.querySelector('.hrv-arrow.cold').style.stroke = `url(#${id}-cold)`;
    svg.querySelector('.hrv-arrow.warm').style.stroke = `url(#${id}-warm)`;
    const zones = svg.querySelectorAll('.hrv-svg-zone');
    zones[1].setAttribute('x', 273*sx);
    zones[1].setAttribute('y', 25*sy);
    svg.querySelector('.hrv-room-climate').setAttribute('transform', `translate(${273*sx} ${43*sy})`);
    svg.querySelector('.hrv-arrow.cold').setAttribute('d', `M${112*sx+14} ${top-4} l6 4 -6 4 M${right-17} ${bottom-4} l6 4 -6 4`);
    svg.querySelector('.hrv-arrow.warm').setAttribute('d', `M${right-16} ${top-4} l-6 4 6 4 M39 ${bottom-4} l-6 4 6 4`);
  }
  function render(host) {
    if (!host) return;
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
        fitDiagram(host);
      });
      host._hrvResize.observe(host);
    }
  }
  function editorMarkup() {
    const c = config();
    return `<fieldset class="hrv-editor"><legend>${t('Kameraområde','Camera area')}</legend>
      <label>${t('Layout','Layout')}<select data-hrv-enabled><option value="false" ${!enabled()?'selected':''}>${t('3 kameraer','3 cameras')}</option><option value="true" ${enabled()?'selected':''}>${t('2 kameraer + ventilation','2 cameras + ventilation')}</option></select></label>
      <p>${t('Det tredje kameravalg bevares, når ventilationskortet vises.','The third camera selection is preserved while the ventilation card is shown.')}</p>
      <details><summary>${t('Rediger ventilationskort','Edit ventilation card')}</summary>
      <label>${t('Kortets navn','Card title')}<input data-hrv-title value="${esc(c.title || t('Ventilation','Ventilation'))}" maxlength="80"></label>
      <label><input type="checkbox" data-hrv-coil ${c.showAfterheat === true?'checked':''}> ${t('Vis varmeflade','Show heating coil')}</label>
      <label><input type="checkbox" data-hrv-animation ${c.animation !== false?'checked':''}> ${t('Animeret luftstrøm','Animated airflow')}</label>
      ${Object.entries(fields).map(([key,label])=>`<label>${t(...label)}<input list="hrv-entities" data-hrv-entity="${key}" value="${esc(c.entities?.[key] || '')}" placeholder="${key==='mode'||key==='level'?'select.':'sensor.'}"></label>`).join('')}
      <datalist id="hrv-entities">${Array.from(BeastHaSocket.getAllStates().keys()).filter(id=>/^(sensor|binary_sensor|select|cover|fan)\./.test(id)).map(id=>`<option value="${esc(id)}">${esc(BeastHaSocket.getState(id)?.attributes?.friendly_name || id)}</option>`).join('')}</datalist>
      </details></fieldset>`;
  }
  function readEditor(root) {
    return {...config(), enabled:root.querySelector('[data-hrv-enabled]').value==='true',title:root.querySelector('[data-hrv-title]').value.trim() || t('Ventilation','Ventilation'),animation:root.querySelector('[data-hrv-animation]').checked,showAfterheat:root.querySelector('[data-hrv-coil]').checked,entities:Object.fromEntries(Array.from(root.querySelectorAll('[data-hrv-entity]'), input=>[input.dataset.hrvEntity,input.value.trim()]))};
  }
  return {enabled, render, editorMarkup, readEditor};
})();
