const SETTINGS_VERSION = 1;

function getFactoryDefaults() {
  return {
    thirdPerson: {
      featureEnabled: false,
      cameraActive: true,
      cameraDistance: 50,
      bindKey: null,
    },
    minimap: {
      enabled: true,
      mapSizePercent: 50,
      mapBindKey: null,
    },
  };
}

function mergeSettingsWithDefaults(partial) {
  const defaults = getFactoryDefaults();
  if (!partial || typeof partial !== 'object') {
    return defaults;
  }

  return {
    thirdPerson: {
      ...defaults.thirdPerson,
      ...(partial.thirdPerson && typeof partial.thirdPerson === 'object' ? partial.thirdPerson : {}),
    },
    minimap: {
      ...defaults.minimap,
      ...(partial.minimap && typeof partial.minimap === 'object' ? partial.minimap : {}),
    },
  };
}

function deepMergeSettings(base, patch) {
  if (!patch || typeof patch !== 'object') {
    return mergeSettingsWithDefaults(base);
  }

  const merged = mergeSettingsWithDefaults(base);
  if (patch.thirdPerson && typeof patch.thirdPerson === 'object') {
    merged.thirdPerson = { ...merged.thirdPerson, ...patch.thirdPerson };
  }
  if (patch.minimap && typeof patch.minimap === 'object') {
    merged.minimap = { ...merged.minimap, ...patch.minimap };
  }
  return merged;
}

function deepMergePartialObjects(base, patch) {
  if (!patch || typeof patch !== 'object') {
    return base && typeof base === 'object' ? { ...base } : {};
  }

  const result = { ...(base && typeof base === 'object' ? base : {}) };

  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMergePartialObjects(result[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

module.exports = {
  SETTINGS_VERSION,
  getFactoryDefaults,
  mergeSettingsWithDefaults,
  deepMergeSettings,
  deepMergePartialObjects,
};
