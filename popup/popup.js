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

const READ_PROFILE_MODEL = [
  { key: "skim", label: "Skim", weight: 0.28 },
  { key: "normal", label: "Normal", weight: 0.52 },
  { key: "deep", label: "Deep", weight: 0.2 },
];

const READ_PROFILE_LABELS = {
  skim: "Skim",
  normal: "Normal",
  deep: "Deep",
};

const TOGGLE_CONFIGS = [
  { id: "toggleAutoRead", key: "autoread", label: "Auto-Read" },
  { id: "toggleAutoLike", key: "autolike", label: "Auto-Like" },
  { id: "toggleShowFloat", key: "showfloat", label: "Panel" },
];

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
  const state = await storage.get([
    ...TOGGLE_CONFIGS.map((c) => c.key),
    "config",
  ]);
  const migration = migrateStoredConfig(state.config);
  if (migration.changed) {
    await storage.set({ config: migration.config });
  }
  
  TOGGLE_CONFIGS.forEach((item) => {
    const btn = document.getElementById(item.id);
    const initialState =
      state[item.key] === undefined ? item.key === "showfloat" : state[item.key];
    updateToggleUI(btn, item.label, initialState);

    btn.addEventListener("click", async () => {
      const currentState = await storage.get([item.key]);
      const oldState =
        currentState[item.key] === undefined
          ? item.key === "showfloat"
          : currentState[item.key];
      const newState = !oldState;
      
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
      await renderRuntimeStatus();
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
    await renderRuntimeStatus();
    showStatus("Settings saved");
  });

  // 4. Reset Defaults Handler
  document.getElementById("resetDefaults").addEventListener("click", async () => {
    if (confirm("Reset all settings to default?")) {
      await storage.set({ config: DEFAULT_CONFIG });
      loadConfigToInputs(DEFAULT_CONFIG);
      await renderRuntimeStatus();
      showStatus("Reset to defaults");
    }
  });

  await renderRuntimeStatus();
  setInterval(renderRuntimeStatus, 1000);
  chrome.storage.onChanged.addListener(() => {
    renderRuntimeStatus();
  });
});

function updateToggleUI(button, label, isActive) {
  const labelEl = button.querySelector(".toggle-label");
  const stateEl = button.querySelector(".toggle-state");

  if (labelEl && stateEl) {
    labelEl.textContent = label.replace("Auto-", "");
    stateEl.textContent = isActive ? "On" : "Off";
  } else {
    button.textContent = `${label}: ${isActive ? "ON" : "OFF"}`;
  }
  button.classList.toggle("active", isActive);
  button.setAttribute("aria-pressed", String(Boolean(isActive)));
}

function syncToggleButtons(state) {
  TOGGLE_CONFIGS.forEach((item) => {
    const btn = document.getElementById(item.id);
    if (!btn) return;

    const isActive =
      state[item.key] === undefined ? item.key === "showfloat" : state[item.key];
    updateToggleUI(btn, item.label, isActive);
  });
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

async function renderRuntimeStatus() {
  const state = await storage.get([
    "autoread",
    "autolike",
    "showfloat",
    "taskDeadlineTime",
    "readSession",
    "config",
  ]);

  const taskStatus = document.getElementById("taskStatus");
  const taskRemaining = document.getElementById("taskRemaining");
  const taskMode = document.getElementById("taskMode");
  if (!taskStatus || !taskRemaining || !taskMode) return;

  syncToggleButtons(state);

  const isRunning = Boolean(state.autoread || state.autolike);
  taskStatus.textContent = isRunning ? "Active" : "Idle";
  taskStatus.classList.toggle("active", isRunning);

  const activeModes = [];
  if (state.autoread) activeModes.push("Read");
  if (state.autolike) activeModes.push("Like");
  taskMode.textContent = activeModes.length ? activeModes.join(" + ") : "Manual";

  const duration = Number(state.config?.taskDuration || 0);
  const deadline = Number(state.taskDeadlineTime || 0);
  if (!isRunning) {
    taskRemaining.textContent = "Stopped";
  } else if (duration <= 0 || deadline <= 0) {
    taskRemaining.textContent = "No limit";
  } else {
    const remainingMs = Math.max(0, deadline - Date.now());
    taskRemaining.textContent = formatRemaining(remainingMs);
  }

  renderReadProfile(state.readSession, state.autoread);
}

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderReadProfile(session, isAutoRead) {
  const stateEl = document.getElementById("readProfileState");
  const modeEl = document.getElementById("readProfileMode");
  const metaEl = document.getElementById("readProfileMeta");
  const progressTextEl = document.getElementById("readProfileProgressText");
  const progressEl = document.getElementById("readProfileProgress");
  const progressBarEl = progressEl?.parentElement;
  const targetEl = document.getElementById("readProfileTarget");
  const stayEl = document.getElementById("readProfileStay");
  const exitEl = document.getElementById("readProfileExit");
  if (
    !stateEl ||
    !modeEl ||
    !metaEl ||
    !progressTextEl ||
    !progressEl ||
    !progressBarEl ||
    !targetEl ||
    !stayEl ||
    !exitEl
  ) {
    return;
  }

  const isFresh =
    session?.updatedAt && Date.now() - Number(session.updatedAt) < 5 * 60 * 1000;
  if (!isAutoRead || !session || !isFresh) {
    const mix = READ_PROFILE_MODEL
      .map((item) => `${item.label} ${Math.round(item.weight * 100)}%`)
      .join(" / ");
    stateEl.textContent = "Model";
    modeEl.textContent = "Weighted mix";
    metaEl.textContent = mix;
    progressTextEl.textContent = "0%";
    progressEl.style.width = "0%";
    progressBarEl.setAttribute("aria-valuenow", "0");
    targetEl.textContent = "12-100%";
    stayEl.textContent = "12s-7m";
    exitEl.textContent = "Random";
    return;
  }

  const progress = clamp(Number(session.progress) || 0, 0, 1);
  const progressPercent = Math.round(progress * 100);
  const targetPercent = Math.round(
    clamp(Number(session.targetProgress) || 0, 0, 1) * 100,
  );
  const elapsed = Math.max(
    0,
    Date.now() - Number(session.startedAt || Date.now()),
  );

  stateEl.textContent = session.isLeaving ? "Leaving" : "Live";
  modeEl.textContent = READ_PROFILE_LABELS[session.mode] || "Custom";
  metaEl.textContent = `Elapsed ${formatDurationCompact(elapsed)}`;
  progressTextEl.textContent = `${progressPercent}%`;
  progressEl.style.width = `${progressPercent}%`;
  progressBarEl.setAttribute("aria-valuenow", String(progressPercent));
  targetEl.textContent = `${targetPercent}%`;
  stayEl.textContent = `${formatDurationCompact(session.minReadMs)}-${formatDurationCompact(
    session.maxReadMs,
  )}`;
  exitEl.textContent = session.reviewBeforeExit ? "Review" : "Direct";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDurationCompact(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m${String(seconds).padStart(2, "0")}`;
}
