const BeastRegistry = (() => {
  const CACHE_KEY = "beast_panel_registry_cache_v2";
  let areasById = new Map();
  let areaEntities = new Map();
  let entityAreaById = new Map();
  let entityMetaById = new Map();
  let devicesById = new Map();
  let deviceEntities = new Map();
  let loadPromise = null;
  let loaded = false;

  function buildFromRegistries(entities, devices, areas) {
    const deviceAreaById = new Map();
    const nextDevicesById = new Map();
    devices.forEach((device) => {
      if (device.area_id) deviceAreaById.set(device.id, device.area_id);
      nextDevicesById.set(device.id, {
        id: device.id,
        name: device.name_by_user || device.name || device.id,
        manufacturer: device.manufacturer || "",
        model: device.model || "",
        areaId: device.area_id || null,
        configEntries: Array.isArray(device.config_entries) ? device.config_entries : []
      });
    });

    const nextAreasById = new Map();
    areas.forEach((area) => nextAreasById.set(area.area_id, area));

    const nextEntityAreaById = new Map();
    const nextEntityMetaById = new Map();
    const nextAreaEntities = new Map();
    const nextDeviceEntities = new Map();

    entities.forEach((entity) => {
      if (entity.hidden_by || entity.disabled_by) return;
      const areaId = entity.area_id || (entity.device_id ? deviceAreaById.get(entity.device_id) : null);
      nextEntityMetaById.set(entity.entity_id, {
        entityCategory: entity.entity_category,
        originalName: entity.original_name,
        name: entity.name,
        platform: entity.platform,
        deviceId: entity.device_id || null,
        configEntryId: entity.config_entry_id || null,
        areaId: areaId || null
      });
      if (entity.device_id) {
        if (!nextDeviceEntities.has(entity.device_id)) nextDeviceEntities.set(entity.device_id, []);
        nextDeviceEntities.get(entity.device_id).push(entity.entity_id);
      }
      if (!areaId) return;
      nextEntityAreaById.set(entity.entity_id, areaId);
      if (!nextAreaEntities.has(areaId)) nextAreaEntities.set(areaId, []);
      nextAreaEntities.get(areaId).push(entity.entity_id);
    });

    areasById = nextAreasById;
    entityAreaById = nextEntityAreaById;
    entityMetaById = nextEntityMetaById;
    areaEntities = nextAreaEntities;
    devicesById = nextDevicesById;
    deviceEntities = nextDeviceEntities;
    loaded = true;
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        areas: Array.from(areasById.values()),
        areaEntities: Array.from(areaEntities.entries()),
        entityMeta: Array.from(entityMetaById.entries()),
        devices: Array.from(devicesById.entries()),
        deviceEntities: Array.from(deviceEntities.entries())
      }));
    } catch (error) {
      BeastCore.log(`Registry: kunne ikke gemme cache (${error.message}).`);
    }
  }

  function loadFromCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      areasById = new Map(parsed.areas.map((area) => [area.area_id, area]));
      areaEntities = new Map(parsed.areaEntities);
      entityMetaById = new Map(parsed.entityMeta);
      devicesById = new Map(parsed.devices || []);
      deviceEntities = new Map(parsed.deviceEntities || []);
      entityAreaById = new Map();
      entityMetaById.forEach((meta, entityId) => {
        if (meta.areaId) entityAreaById.set(entityId, meta.areaId);
      });
      loaded = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  async function fetchFromHa() {
    const [entities, devices, areas] = await Promise.all([
      BeastHaSocket.sendCommand("config/entity_registry/list"),
      BeastHaSocket.sendCommand("config/device_registry/list"),
      BeastHaSocket.sendCommand("config/area_registry/list")
    ]);
    buildFromRegistries(entities || [], devices || [], areas || []);
    saveCache();
    BeastCore.log(`Registry: hentede ${entityAreaById.size} entities fordelt på ${areasById.size} områder.`);
  }

  function ensureLoaded() {
    if (loadPromise) return loadPromise;
    const cacheFresh = loadFromCache();
    if (cacheFresh) {
      loadPromise = Promise.resolve();
      return loadPromise;
    }
    loadPromise = fetchFromHa().catch((error) => {
      BeastCore.log(`Registry: kunne ikke hente fra HA (${error.message}).`);
      loadPromise = null;
      throw error;
    });
    return loadPromise;
  }

  async function refresh() {
    if (loadPromise) await loadPromise.catch(() => null);
    loadPromise = fetchFromHa().catch((error) => {
      BeastCore.log(`Registry: manuel opdatering fejlede (${error.message}).`);
      loadPromise = null;
      throw error;
    });
    await loadPromise;
  }

  function getArea(areaId) {
    return areasById.get(areaId) || null;
  }

  function getAreaEntityIds(areaId, domain) {
    const ids = areaEntities.get(areaId) || [];
    if (!domain) return ids.slice();
    return ids.filter((entityId) => entityId.startsWith(`${domain}.`));
  }

  function getEntityArea(entityId) {
    return entityAreaById.get(entityId) || null;
  }

  function getEntityMeta(entityId) {
    return entityMetaById.get(entityId) || null;
  }

  function getAllAreas() {
    return Array.from(areasById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  function getDevice(deviceId) {
    return devicesById.get(deviceId) || null;
  }

  function getDeviceEntityIds(deviceId, domain) {
    const ids = deviceEntities.get(deviceId) || [];
    if (!domain) return ids.slice();
    return ids.filter((entityId) => entityId.startsWith(`${domain}.`));
  }

  function getAllDevices() {
    return Array.from(devicesById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || "", "da"));
  }

  return {
    ensureLoaded,
    refresh,
    isLoaded: () => loaded,
    getArea,
    getAllAreas,
    getAreaEntityIds,
    getEntityArea,
    getEntityMeta,
    getDevice,
    getAllDevices,
    getDeviceEntityIds
  };
})();
