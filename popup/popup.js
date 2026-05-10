const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};

const DEFAULT_CONFIG = {
  taskDuration: 0,
  newOpenDelay: 5000,
  pageRefreshDelay: 60000,
  scrollStepMin: 320,
  scrollStepMax: 900,
  scrollDelayMin: 800,
  scrollDelayMax: 2600,
  scrollPauseProbability: 0.22,
  scrollPauseMin: 3500,
  scrollPauseMax: 12000,
  likeMinCount: 5,
  likeProbability: 0.8,
  likeDelayMin: 15000,
  likeDelayMax: 45000,
  likeCooldownHours: 24
};

const CONFIG_SCHEMA_VERSION = 2;
const LEGACY_DEFAULT_CONFIG = {
  newOpenDelay: 3000,
  scrollStepMin: 10,
  scrollStepMax: 30,
  scrollDelayMin: 50,
  scrollDelayMax: 150,
  scrollPauseProbability: 0.05,
  scrollPauseMin: 1000,
  scrollPauseMax: 3000,
  likeDelayMin: 5000,
  likeDelayMax: 15000,
};

// Map of config keys to input IDs
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);

function migrateStoredConfig(storedConfig) {
  if (!storedConfig || storedConfig.__schemaVersion >= CONFIG_SCHEMA_VERSION) {
    return { config: storedConfig, changed: false };
  }

  const migrated = {
    ...DEFAULT_CONFIG,
    ...storedConfig,
    __schemaVersion: CONFIG_SCHEMA_VERSION,
  };
  Object.entries(LEGACY_DEFAULT_CONFIG).forEach(([key, legacyValue]) => {
    if (migrated[key] === legacyValue) {
      migrated[key] = DEFAULT_CONFIG[key];
    }
  });

  return { config: migrated, changed: true };
}

function getTaskDurationMs(config = DEFAULT_CONFIG) {
  const durationMinutes = Number(config?.taskDuration ?? DEFAULT_CONFIG.taskDuration);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
  return durationMinutes * 60 * 1000;
}

function getTaskTimingUpdates(config = DEFAULT_CONFIG, startTime = Date.now()) {
  const durationMs = getTaskDurationMs(config);
  return {
    taskStartTime: startTime,
    taskDeadlineTime: durationMs > 0 ? startTime + durationMs : 0,
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize Toggle Buttons
  const toggles = [
    { id: "toggleAutoRead", key: "autoread", label: "Auto-Read" },
    { id: "toggleAutoLike", key: "autolike", label: "Auto-Like" },
    { id: "toggleShowFloat", key: "showfloat", label: "Float" },
  ];

  const state = await storage.get([...toggles.map((c) => c.key), "config"]);
  const migration = migrateStoredConfig(state.config);
  if (migration.changed) {
    await storage.set({ config: migration.config });
  }
  
  toggles.forEach((item) => {
    const btn = document.getElementById(item.id);
    updateToggleUI(btn, item.label, state[item.key]);

    btn.addEventListener("click", async () => {
      const currentState = await storage.get([item.key]);
      const newState = !currentState[item.key];
      
      const updates = { [item.key]: newState };
      
      // If turning ON any automation task, reset the task start time
      if (newState && (item.key === 'autoread' || item.key === 'autolike')) {
        const currentConfig = await storage.get("config");
        Object.assign(
          updates,
          getTaskTimingUpdates(currentConfig.config || DEFAULT_CONFIG),
        );
      }

      await storage.set(updates);
      updateToggleUI(btn, item.label, newState);
    });
  });

  // 2. Initialize Config Inputs
  // Fallback to DEFAULT_CONFIG if state.config is empty or missing
  const currentConfig = migration.config || DEFAULT_CONFIG;
  loadConfigToInputs(currentConfig);

  // 3. Save Settings Handler
  document.getElementById("saveSettings").addEventListener("click", async () => {
    // Read current config first to avoid overwriting hidden keys
    const currentStored = await storage.get("config");
    const baseConfig = currentStored.config || DEFAULT_CONFIG;

    // Clone base config
    const newConfig = { ...baseConfig };

    CONFIG_KEYS.forEach(key => {
      const input = document.getElementById(key);
      if (input) {
        // Convert to number for all inputs as they are numeric
        const val = parseFloat(input.value);
        newConfig[key] = isNaN(val) ? DEFAULT_CONFIG[key] : val;
      }
    });

    // Auto-correct Min > Max
    const pairs = [
      ['scrollStepMin', 'scrollStepMax'],
      ['scrollDelayMin', 'scrollDelayMax'],
      ['scrollPauseMin', 'scrollPauseMax'],
      ['likeDelayMin', 'likeDelayMax']
    ];

    pairs.forEach(([minKey, maxKey]) => {
      if (newConfig[minKey] !== undefined && newConfig[maxKey] !== undefined) {
        if (newConfig[minKey] > newConfig[maxKey]) {
          // Swap values
          [newConfig[minKey], newConfig[maxKey]] = [newConfig[maxKey], newConfig[minKey]];
          // Update UI
          const minInput = document.getElementById(minKey);
          const maxInput = document.getElementById(maxKey);
          if (minInput && maxInput) {
            minInput.value = newConfig[minKey];
            maxInput.value = newConfig[maxKey];
          }
        }
      }
    });

    const taskState = await storage.get(["autoread", "autolike", "taskStartTime"]);
    const configUpdates = { config: newConfig };
    if (taskState.autoread || taskState.autolike) {
      const startTime = taskState.taskStartTime || Date.now();
      Object.assign(configUpdates, getTaskTimingUpdates(newConfig, startTime));
    }

    await storage.set(configUpdates);
    showStatus("Settings saved!");
  });

  // 4. Reset Defaults Handler
  document.getElementById("resetDefaults").addEventListener("click", async () => {
    if (confirm("Reset all settings to default?")) {
      await storage.set({ config: DEFAULT_CONFIG });
      loadConfigToInputs(DEFAULT_CONFIG);
      showStatus("Reset to defaults.");
    }
  });
});

function updateToggleUI(button, label, isActive) {
  // Update text to show ON/OFF explicitly
  button.textContent = `${label}: ${isActive ? "ON" : "OFF"}`;
  button.classList.toggle("active", isActive);
}

function loadConfigToInputs(config) {
  CONFIG_KEYS.forEach(key => {
    const input = document.getElementById(key);
    if (input && config[key] !== undefined) {
      input.value = config[key];
    }
  });
}

function showStatus(msg) {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  setTimeout(() => el.textContent = "", 2000);
}
