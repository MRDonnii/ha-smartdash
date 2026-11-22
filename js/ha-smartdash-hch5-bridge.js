/* Smartdash's compact HCH5 front-page card. The drawing and controls come
   from the shared HA card bundle; this adapter only supplies HA state and
   calls the existing authenticated HA service proxy. */
(() => {
  const editor = window.BeastVentilation?.openEditor;
  function render(host, card) {
    if (!host || !card) return;
    if (!customElements.get('ha-hch5-live-card')) {
      customElements.whenDefined('ha-hch5-live-card').then(() => {
        if (host.isConnected) render(host, card);
      });
      return;
    }
    let element = host.querySelector('ha-hch5-live-card');
    if (!element) {
      element = document.createElement('ha-hch5-live-card');
      element.setAttribute('data-smartdash-card', '');
      host.replaceChildren(element);
    }
    element.toggleAttribute('mobile', !!host.closest('.beast-ov-m-card'));
    // The card draws only what has an entity, so pass it only what the
    // user set up. Smartdash's own "afterheat_setpoint" is no HAC1 signal,
    // but the card treats any afterheat_* entity as an external afterheater
    // and would draw the HAC1 wiring for a plain Dantherm unit. A current
    // fan level (stock "level" sensor) can stand in for the effective level.
    const { afterheat_setpoint: _unused, ...entities } = card.entities || {};
    if (!entities.effective_level && entities.level) entities.effective_level = entities.level;
    const afterheatCoil = card.afterheatCoil === 'water' ? 'water' : 'electric';
    const signature = JSON.stringify([entities, afterheatCoil]);
    if (element._smartdashConfig !== signature) {
      element.setConfig({ variant: 'smartdash', entities, afterheat_coil: afterheatCoil });
      element._smartdashConfig = signature;
    }
    const states = {};
    for (const id of Object.values(entities)) {
      if (typeof id !== 'string' || !id || id.includes(',')) continue;
      const value = BeastHaSocket.getState(id);
      if (value) states[id] = value;
    }
    element.hass = {
      states,
      callService(domain, service, data) {
        return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }
    };
  }
  window.BeastVentilation = { ...window.BeastVentilation, render, openEditor: editor };
})();
