// background.js

const DEFAULT_CONFIG = {
  // Task Settings
  taskDuration: 0, // 0 means infinite (minutes)

  // Navigation / Delays
  newOpenDelay: 5000,
  pageRefreshDelay: 60000,

  // Scroll Settings
  scrollStepMin: 320,
  scrollStepMax: 900,
  scrollDelayMin: 800,
  scrollDelayMax: 2600,
  scrollPauseProbability: 0.22,
  scrollPauseMin: 3500,
  scrollPauseMax: 12000,

  // Like Settings
  likeMinCount: 5,
  likeProbability: 0.8,
  likeDelayMin: 15000,
  likeDelayMax: 45000,
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
    if (result.taskDeadlineTime === undefined) updates.taskDeadlineTime = 0;

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});
