// background.js

const DEFAULT_CONFIG = {
  // Task Settings
  taskDuration: 0, // 0 means infinite (minutes)

  // Navigation / Delays
  newOpenDelay: 3000,
  pageRefreshDelay: 60000,

  // Scroll Settings
  scrollStepMin: 10,
  scrollStepMax: 30,
  scrollDelayMin: 50,
  scrollDelayMax: 150,
  scrollPauseProbability: 0.05,
  scrollPauseMin: 1000,
  scrollPauseMax: 3000,

  // Like Settings
  likeMinCount: 5,
  likeProbability: 0.8,
  likeDelayMin: 5000,
  likeDelayMax: 15000,
  likeCooldownHours: 24
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['config', 'autoread', 'autolike', 'showfloat'], (result) => {
    const updates = {};

    // Initialize config if missing or merge with defaults for new keys
    if (!result.config) {
      updates.config = DEFAULT_CONFIG;
    } else {
      // Merge to ensure new keys are present in existing config
      updates.config = { ...DEFAULT_CONFIG, ...result.config };
    }

    // Initialize other states if missing
    if (result.autoread === undefined) updates.autoread = false;
    if (result.autolike === undefined) updates.autolike = false;
    if (result.showfloat === undefined) updates.showfloat = true;
    
    // Initialize task start time
    if (result.taskStartTime === undefined) updates.taskStartTime = 0;

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});
