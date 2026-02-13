const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};

const DEFAULT_CONFIG = {
  taskDuration: 0,
  newOpenDelay: 3000,
  pageRefreshDelay: 60000,
  scrollStepMin: 10,
  scrollStepMax: 30,
  scrollDelayMin: 50,
  scrollDelayMax: 150,
  scrollPauseProbability: 0.05,
  scrollPauseMin: 1000,
  scrollPauseMax: 3000,
  likeMinCount: 5,
  likeProbability: 0.8,
  likeDelayMin: 5000,
  likeDelayMax: 15000,
  likeCooldownHours: 24
};

// Map of config keys to input IDs
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize Toggle Buttons
  const toggles = [
    { id: "toggleAutoRead", key: "autoread", label: "Auto-Read" },
    { id: "toggleAutoLike", key: "autolike", label: "Auto-Like" },
    { id: "toggleShowFloat", key: "showfloat", label: "Float" },
  ];

  const state = await storage.get([...toggles.map((c) => c.key), "config"]);
  
  toggles.forEach((item) => {
    const btn = document.getElementById(item.id);
    updateToggleUI(btn, item.label, state[item.key]);

    btn.addEventListener("click", async () => {
      const currentState = await storage.get([item.key]);
      const newState = !currentState[item.key];
      
      const updates = { [item.key]: newState };
      
      // If turning ON any automation task, reset the task start time
      if (newState && (item.key === 'autoread' || item.key === 'autolike')) {
        updates.taskStartTime = Date.now();
      }

      await storage.set(updates);
      updateToggleUI(btn, item.label, newState);
    });
  });

  // 2. Initialize Config Inputs
  // Fallback to DEFAULT_CONFIG if state.config is empty or missing
  const currentConfig = state.config || DEFAULT_CONFIG;
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

    await storage.set({ config: newConfig });
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
