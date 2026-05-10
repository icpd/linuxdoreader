// --- 1. 配置与选择器 ---

// 默认配置（兜底用，实际会从 storage 加载）
let CONFIG = {
  taskDuration: 0,
  newOpenDelay: 5000,
  pageRefreshDelay: 60 * 1000,
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
  likeCooldownHours: 24,
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

// URL 和 字符串常量保持不变
const CONSTANTS = {
  URLS: {
    HOME: "https://linux.do/",
    LATEST: "https://linux.do/latest",
    UNSEEN: "https://linux.do/unseen",
    TOPIC_PATTERN: /^https:\/\/linux\.do\/t\/topic\/.+$/,
  },
  STRINGS: {
    LIKE_LIMIT_TEXT: "点赞上限",
    LIKE_TITLE_TRIGGER: "点赞此帖子",
  },
};

const SELECTORS = {
  LIKE_LIMIT_DIALOG: ".dialog-body",
  REPLIES_CONTAINER: ".timeline-replies",
  POST_ID_PREFIX: "#post_",
  LIKE_BUTTON: ".discourse-reactions-reaction-button",
  LIKE_COUNTER: ".reactions-counter",
  TOPIC_LINKS: "a[data-topic-id].title",
};

// --- 2. 存储工具函数 ---
const storage = {
  get: async (key, defaultValue) => {
    const result = await chrome.storage.local.get([key]);
    return result[key] === undefined ? defaultValue : result[key];
  },
  set: async (key, value) => {
    await chrome.storage.local.set({ [key]: value });
  },
  getAll: async () => {
    return await chrome.storage.local.get(null);
  }
};

function migrateStoredConfig(storedConfig) {
  if (!storedConfig || storedConfig.__schemaVersion >= CONFIG_SCHEMA_VERSION) {
    return { config: storedConfig, changed: false };
  }

  const migrated = {
    ...CONFIG,
    ...storedConfig,
    __schemaVersion: CONFIG_SCHEMA_VERSION,
  };
  Object.entries(LEGACY_DEFAULT_CONFIG).forEach(([key, legacyValue]) => {
    if (migrated[key] === legacyValue) {
      migrated[key] = CONFIG[key];
    }
  });

  return { config: migrated, changed: true };
}

function getTaskDurationMs(config = CONFIG) {
  const durationMinutes = Number(config?.taskDuration ?? CONFIG.taskDuration);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
  return durationMinutes * 60 * 1000;
}

function getTaskTimingUpdates(config = CONFIG, startTime = Date.now()) {
  const durationMs = getTaskDurationMs(config);
  return {
    taskStartTime: startTime,
    taskDeadlineTime: durationMs > 0 ? startTime + durationMs : 0,
  };
}

// --- 3. 业务逻辑模块 ---

/**
 * 检查任务是否超时
 * @returns {Promise<boolean>} true if task expired
 */
async function checkTaskDuration() {
  const data = await storage.getAll();
  const storedConfig = data.config || CONFIG;
  const startTime = data.taskStartTime || 0;
  const durationMs = getTaskDurationMs(storedConfig);
  const deadlineTime =
    data.taskDeadlineTime ||
    (startTime && durationMs ? startTime + durationMs : 0);
  const hasRunningTask = data.autoread || data.autolike;
  
  // 0 表示不限制
  if (durationMs <= 0) return false;
  if (startTime === 0) return false; // 未记录开始时间
  if (!hasRunningTask) {
    stopAutomationTimers();
    return false;
  }

  if (Date.now() >= deadlineTime) {
    const elapsed = Date.now() - startTime;
    console.log(`[LinuxDoReader] 任务已运行 ${elapsed/1000}s，超过设定时长 ${durationMs / 60000}min，自动停止。`);
    
    // 停止任务
    await chrome.storage.local.set({
      autoread: false,
      autolike: false,
      taskStartTime: 0,
      taskDeadlineTime: 0,
    });
    stopAutomationTimers();
    
    return true;
  }
  return false;
}

/**
 * 随机整数生成器
 */
const getRandomInt = (min, max) => {
  const minInt = Math.ceil(Number(min));
  const maxInt = Math.floor(Number(max));
  const safeMin = Math.min(minInt, maxInt);
  const safeMax = Math.max(minInt, maxInt);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
};

const getRandomFloat = (min, max) => Math.random() * (max - min) + min;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isElementInViewport(element, minVisibleRatio = 0.25) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const visibleTop = Math.max(rect.top, 0);
  const visibleBottom = Math.min(rect.bottom, window.innerHeight);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const requiredVisibleHeight = Math.min(
    rect.height * minVisibleRatio,
    window.innerHeight * 0.5,
  );
  return visibleHeight >= requiredVisibleHeight;
}

function isTopicListPage(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://linux.do") return false;
    return ["/", "/latest", "/unseen"].includes(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * 创建悬浮控制面板
 */
async function createFloatingPanel() {
  const isShow = await storage.get("showfloat", true);
  
  const initPanel = async () => {
    let panel = document.getElementById("linux-do-reader-float-panel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "linux-do-reader-float-panel";
    document.body.appendChild(panel);

    const configs = [
      { key: "autoread", label: "Auto-Read" },
      { key: "autolike", label: "Auto-Like" },
    ];

    for (const config of configs) {
      const btn = document.createElement("div");
      btn.className = "linux-do-reader-float-btn";
      btn.dataset.key = config.key;
      btn.textContent = `${config.label}: OFF`;
      panel.appendChild(btn);

      // 初始化状态
      const isActive = await storage.get(config.key, false);
      updateButtonVisual(btn, config.label, isActive);

      // 点击事件
      btn.addEventListener("click", async () => {
        const currentState = await storage.get(config.key, false);
        const newState = !currentState;
        
        // 如果是开启任务，记录开始时间
        const updates = { [config.key]: newState };
        if (newState) {
          Object.assign(updates, getTaskTimingUpdates(CONFIG));
        }
        await chrome.storage.local.set(updates);
        
        updateButtonVisual(btn, config.label, newState);
      });
    }
    return panel;
  };

  if (isShow) await initPanel();

  // 监听来自 popup 的变更
  chrome.storage.onChanged.addListener(async (changes) => {
    // 1. 同步 Config
    if (changes.config) {
      CONFIG = { ...CONFIG, ...changes.config.newValue };
      console.log('[LinuxDoReader] Config updated:', CONFIG);
    }

    // 2. 处理面板显示/隐藏
    if (changes.showfloat) {
      if (changes.showfloat.newValue) {
        await initPanel();
      } else {
        document.getElementById("linux-do-reader-float-panel")?.remove();
      }
    }

    // 3. 处理按钮状态同步
    const panel = document.getElementById("linux-do-reader-float-panel");
    if (!panel) return;

    const btnConfigs = [
      { key: "autoread", label: "Auto-Read" },
      { key: "autolike", label: "Auto-Like" },
    ];

    btnConfigs.forEach((config) => {
      if (changes[config.key]) {
        const btn = panel.querySelector(`[data-key="${config.key}"]`);
        if (btn) {
          updateButtonVisual(btn, config.label, changes[config.key].newValue);
        }
      }
    });
  });
}

function updateButtonVisual(btn, label, isActive) {
  btn.textContent = `${label}: ${isActive ? "ON" : "OFF"}`;
  if (isActive) {
    btn.classList.add("active");
  } else {
    btn.classList.remove("active");
  }
}

/**
 * 自动点赞逻辑
 */
let isLiking = false; // 防止重复点赞同一帖子
let pendingLikeTimer = null;
const viewedPosts = new Map();
const MIN_LIKE_DWELL_MS = 4000;

function getCurrentPostContext() {
  const repliesContainer = document.querySelector(SELECTORS.REPLIES_CONTAINER);
  if (!repliesContainer) return null;

  const postId = repliesContainer.textContent.match(/\d+/g)?.[0];
  if (!postId) return null;

  const postElement = document.querySelector(
    `${SELECTORS.POST_ID_PREFIX}${postId}`,
  );
  if (!postElement) return null;

  return { postId, postElement };
}

function markVisiblePostsAsRead() {
  document.querySelectorAll('[id^="post_"]').forEach((postElement) => {
    if (!isElementInViewport(postElement, 0.35)) return;
    const postId = postElement.id.replace("post_", "");
    if (!viewedPosts.has(postId)) {
      viewedPosts.set(postId, Date.now());
    }
  });
}

function hasEnoughDwellTime(postId) {
  const viewedAt = viewedPosts.get(postId);
  return viewedAt && Date.now() - viewedAt >= MIN_LIKE_DWELL_MS;
}

async function runAutoLike() {
  setInterval(async () => {
    markVisiblePostsAsRead();

    // 0. 任务时长检查
    const isExpired = await checkTaskDuration();
    if (isExpired) return;

    // 1. 基础开关检查
    const isAutoLike = await storage.get("autolike", false);
    if (!isAutoLike) return;

    // 2. 冷却时间检查
    const resumeTime = await storage.get("like_resume_time", 0);
    if (Date.now() < resumeTime) return;

    // 3. 正在处理中则跳过
    if (isLiking) return;

    const context = getCurrentPostContext();
    if (!context) return;

    const { postId, postElement } = context;
    if (!isElementInViewport(postElement, 0.35) || !hasEnoughDwellTime(postId)) {
      return;
    }

    const likeBtn = postElement.querySelector(SELECTORS.LIKE_BUTTON);

    // 4. 检查是否可以点赞
    if (likeBtn?.title === CONSTANTS.STRINGS.LIKE_TITLE_TRIGGER) {
      isLiking = true;

      // 5. 跟风点赞检查 (Social Proof)
      const counterEl = postElement.querySelector(SELECTORS.LIKE_COUNTER);
      let likeCount = 0;
      if (counterEl) {
        likeCount = parseInt(counterEl.innerText.trim(), 10) || 0;
      }

      if (likeCount < CONFIG.likeMinCount) {
        isLiking = false;
        return; // 赞数太少，不点
      }

      // 6. 概率检查
      if (Math.random() > CONFIG.likeProbability) {
        isLiking = false;
        return; // 运气不好，不点
      }

      // 7. 随机延迟执行
      const delay = getRandomInt(
        CONFIG.likeDelayMin,
        CONFIG.likeDelayMax,
      );

      clearTimeout(pendingLikeTimer);
      pendingLikeTimer = setTimeout(async () => {
        pendingLikeTimer = null;
        const isExpired = await checkTaskDuration();
        const isAutoLike = await storage.get("autolike", false);
        if (isExpired || !isAutoLike) {
          isLiking = false;
          return;
        }

        markVisiblePostsAsRead();
        const latestContext = getCurrentPostContext();
        const stillReadingSamePost =
          latestContext?.postId === postId &&
          isElementInViewport(latestContext.postElement, 0.35);

        // 再次检查按钮状态（防止延迟期间滑走或已点）
        if (
          stillReadingSamePost &&
          likeBtn.title === CONSTANTS.STRINGS.LIKE_TITLE_TRIGGER
        ) {
          likeBtn.click();
          checkAndHandleLikeLimit();
        }
        isLiking = false; // 重置状态
      }, delay);
    }
  }, 1000);
}

function checkAndHandleLikeLimit() {
  const dialog = document.querySelector(SELECTORS.LIKE_LIMIT_DIALOG);
  if (dialog && dialog.innerText.includes(CONSTANTS.STRINGS.LIKE_LIMIT_TEXT)) {
    console.warn(
      `[LinuxDoReader] 达到点赞上限，暂停 ${CONFIG.likeCooldownHours} 小时`,
    );
    // 设置恢复时间为当前时间 + 冷却小时数
    const resumeTime =
      Date.now() + CONFIG.likeCooldownHours * 60 * 60 * 1000;
    storage.set("like_resume_time", resumeTime);
  }
}

/**
 * 自动滚动浏览逻辑
 */
let isScrolling = false;
let pendingNavigationTimer = null;
let pendingScrollTimer = null;
let readSession = null;

const READ_SESSION_MODES = [
  {
    name: "skim",
    weight: 0.28,
    targetProgressMin: 0.12,
    targetProgressMax: 0.42,
    minReadMsMin: 12000,
    minReadMsMax: 35000,
    maxReadMsMin: 30000,
    maxReadMsMax: 90000,
  },
  {
    name: "normal",
    weight: 0.52,
    targetProgressMin: 0.35,
    targetProgressMax: 0.78,
    minReadMsMin: 25000,
    minReadMsMax: 90000,
    maxReadMsMin: 75000,
    maxReadMsMax: 210000,
  },
  {
    name: "deep",
    weight: 0.2,
    targetProgressMin: 0.68,
    targetProgressMax: 1,
    minReadMsMin: 60000,
    minReadMsMax: 180000,
    maxReadMsMin: 150000,
    maxReadMsMax: 420000,
  },
];

function formatReadSessionSnapshot() {
  if (!readSession) return null;

  return {
    mode: readSession.mode,
    startedAt: readSession.startedAt,
    targetProgress: readSession.targetProgress,
    minReadMs: readSession.minReadMs,
    maxReadMs: readSession.maxReadMs,
    exitPauseMs: readSession.exitPauseMs,
    reviewBeforeExit: readSession.reviewBeforeExit,
    isLeaving: readSession.isLeaving,
    progress: getReadProgress(),
    updatedAt: Date.now(),
  };
}

function publishReadSession() {
  storage.set("readSession", formatReadSessionSnapshot()).catch((error) => {
    console.warn("[LinuxDoReader] Failed to publish read session:", error);
  });
}

function pickWeightedMode(modes) {
  const totalWeight = modes.reduce((sum, mode) => sum + mode.weight, 0);
  let cursor = Math.random() * totalWeight;
  for (const mode of modes) {
    cursor -= mode.weight;
    if (cursor <= 0) return mode;
  }
  return modes[modes.length - 1];
}

function createReadSession() {
  const mode = pickWeightedMode(READ_SESSION_MODES);
  const minReadMs = getRandomInt(mode.minReadMsMin, mode.minReadMsMax);
  const maxReadMs = Math.max(
    minReadMs + getRandomInt(10000, 45000),
    getRandomInt(mode.maxReadMsMin, mode.maxReadMsMax),
  );

  return {
    mode: mode.name,
    startedAt: Date.now(),
    targetProgress: getRandomFloat(
      mode.targetProgressMin,
      mode.targetProgressMax,
    ),
    minReadMs,
    maxReadMs,
    exitPauseMs: getRandomInt(CONFIG.scrollPauseMin, CONFIG.scrollPauseMax),
    reviewBeforeExit: Math.random() < 0.3,
    isLeaving: false,
  };
}

function getScrollProgress() {
  const maxScrollY = Math.max(
    1,
    document.body.scrollHeight - window.innerHeight,
  );
  return Math.min(1, Math.max(0, window.scrollY / maxScrollY));
}

function getReplyProgress() {
  const repliesContainer = document.querySelector(SELECTORS.REPLIES_CONTAINER);
  const numbers = repliesContainer?.textContent.match(/\d+/g)?.map(Number);
  if (!numbers || numbers.length < 2) return 0;

  const current = numbers[0];
  const total = numbers[numbers.length - 1];
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, current / total));
}

function getReadProgress() {
  return Math.max(getScrollProgress(), getReplyProgress());
}

function shouldLeaveTopicByBudget() {
  if (!readSession || readSession.isLeaving) return false;

  const elapsed = Date.now() - readSession.startedAt;
  if (elapsed < readSession.minReadMs) return false;

  return (
    elapsed >= readSession.maxReadMs ||
    getReadProgress() >= readSession.targetProgress
  );
}

function scheduleTopicExit() {
  if (!readSession || readSession.isLeaving) return;
  readSession.isLeaving = true;
  publishReadSession();
  isScrolling = false;
  clearPendingScroll();

  if (readSession.reviewBeforeExit && window.scrollY > window.innerHeight) {
    const reviewStep = getRandomInt(80, 240);
    window.scrollBy({ top: -reviewStep, behavior: "smooth" });
  }

  scheduleAutoReadNavigation(() => {
    location.href = CONSTANTS.URLS.HOME;
  }, readSession.exitPauseMs);
}

function clearPendingNavigation() {
  if (!pendingNavigationTimer) return;
  clearTimeout(pendingNavigationTimer);
  pendingNavigationTimer = null;
}

function clearPendingScroll() {
  if (!pendingScrollTimer) return;
  clearTimeout(pendingScrollTimer);
  pendingScrollTimer = null;
}

function clearAutoReadState() {
  clearPendingNavigation();
  clearPendingScroll();
  readSession = null;
  publishReadSession();
  isScrolling = false;
}

function clearPendingLike() {
  if (!pendingLikeTimer) return;
  clearTimeout(pendingLikeTimer);
  pendingLikeTimer = null;
  isLiking = false;
}

function stopAutomationTimers() {
  clearAutoReadState();
  clearPendingLike();
}

function scheduleAutoReadNavigation(callback, delay) {
  clearPendingNavigation();
  pendingNavigationTimer = setTimeout(async () => {
    pendingNavigationTimer = null;
    const isExpired = await checkTaskDuration();
    const isAutoRead = await storage.get("autoread", false);
    if (isExpired || !isAutoRead) return;
    callback();
  }, delay);
}

function scheduleAutoReadScroll(callback, delay) {
  clearPendingScroll();
  pendingScrollTimer = setTimeout(async () => {
    pendingScrollTimer = null;
    const isExpired = await checkTaskDuration();
    const isAutoRead = await storage.get("autoread", false);
    if (isExpired || !isAutoRead) {
      isScrolling = false;
      return;
    }
    callback();
  }, delay);
}

function startAutoScroll() {
  if (isScrolling) return; // 防止重复启动

  isScrolling = true;
  if (!readSession) {
    readSession = createReadSession();
    publishReadSession();
  }

  const runScroll = async () => {
    // 0. 任务时长检查
    const isExpired = await checkTaskDuration();
    if (isExpired) {
      isScrolling = false;
      return;
    }

    // 1. 基础检查：开关是否开启，以及是否还在话题页
    const isAutoRead = await storage.get("autoread", false);
    const isTopicPage = CONSTANTS.URLS.TOPIC_PATTERN.test(location.href);

    if (!isAutoRead || !isTopicPage) {
      isScrolling = false;
      readSession = null;
      publishReadSession();
      if (isAutoRead) handleNavigation();
      return;
    }

    markVisiblePostsAsRead();
    publishReadSession();
    if (shouldLeaveTopicByBudget()) {
      scheduleTopicExit();
      return;
    }

    // 2. 触底判断
    if (window.scrollY + window.innerHeight + 5 >= document.body.scrollHeight) {
      // 智能等待：给予页面懒加载的时间
      await sleep(Math.max(3000, CONFIG.scrollDelayMax));
      if (await checkTaskDuration()) return;

      // 再次检查是否真的到底（如果在等待期间加载了新内容，高度会增加）
      if (
        window.scrollY + window.innerHeight + 5 >=
        document.body.scrollHeight
      ) {
        isScrolling = false;
        if (readSession) {
          readSession.isLeaving = true;
          publishReadSession();
        }
        scheduleAutoReadNavigation(() => {
          location.href = CONSTANTS.URLS.HOME;
        }, CONFIG.newOpenDelay);
        return; // 结束滚动循环
      }
    }

    // 3. 分段滚动和阅读停顿
    const shouldReview =
      window.scrollY > window.innerHeight && Math.random() < 0.08;
    const reviewMaxStep = Math.max(80, Math.min(240, CONFIG.scrollStepMax));
    const step = shouldReview
      ? -getRandomInt(80, reviewMaxStep)
      : getRandomInt(CONFIG.scrollStepMin, CONFIG.scrollStepMax);

    window.scrollBy({ top: step, behavior: "smooth" });
    markVisiblePostsAsRead();

    const delay = Math.random() < CONFIG.scrollPauseProbability
      ? getRandomInt(CONFIG.scrollPauseMin, CONFIG.scrollPauseMax)
      : getRandomInt(CONFIG.scrollDelayMin, CONFIG.scrollDelayMax);

    if (document.visibilityState === "hidden") {
      scheduleAutoReadScroll(runScroll, Math.max(delay, CONFIG.scrollPauseMin));
    } else {
      scheduleAutoReadScroll(runScroll, delay);
    }
  };

  const initialDelayMin = Math.min(
    CONFIG.scrollDelayMin,
    CONFIG.scrollPauseMin,
  );
  const initialDelayMax = Math.max(
    CONFIG.scrollDelayMin,
    CONFIG.scrollPauseMin,
  );
  scheduleAutoReadScroll(
    runScroll,
    getRandomInt(initialDelayMin, initialDelayMax),
  );
}

// 监听 autoread 变化，以便在开启时立即启动滚动或导航
chrome.storage.onChanged.addListener((changes) => {
  if (changes.autoread && changes.autoread.newValue === true) {
    handleNavigation();
  } else if (changes.autoread && changes.autoread.newValue === false) {
    clearAutoReadState();
  }
  if (changes.autolike && changes.autolike.newValue === false) {
    clearPendingLike();
  }
});

/**
 * 获取目标帖子链接
 */
function getTargetTopicLink() {
  const posts = Array.from(document.querySelectorAll(SELECTORS.TOPIC_LINKS))
    .filter((post) => CONSTANTS.URLS.TOPIC_PATTERN.test(post.href));
  if (posts.length === 0) return null;
  // 优先从靠前的主题里选择，避免跳到页面很深处的旧内容。
  const poolSize = Math.min(posts.length, 12);
  const randomIndex = getRandomInt(0, poolSize - 1);
  return posts[randomIndex].href;
}

/**
 * 导航逻辑
 */
async function handleNavigation() {
  // 0. 任务时长检查
  const isExpired = await checkTaskDuration();
  if (isExpired) return;

  const isAutoRead = await storage.get("autoread", false);
  if (!isAutoRead) return;

  const currentUrl = location.href;

  // 1. 如果在话题详情页
  if (CONSTANTS.URLS.TOPIC_PATTERN.test(currentUrl)) {
    startAutoScroll();
    return;
  }
  readSession = null;
  publishReadSession();

  // 2. 如果在首页或列表页
  if (isTopicListPage(currentUrl)) {
    const link = getTargetTopicLink();
    if (link) {
      scheduleAutoReadNavigation(() => {
        location.href = link;
      }, CONFIG.newOpenDelay);
    } else {
      // 找不到帖子，回到首页后等待刷新
      scheduleAutoReadNavigation(() => {
        if (currentUrl === CONSTANTS.URLS.HOME) {
          location.reload();
        } else {
          location.href = CONSTANTS.URLS.HOME;
        }
      }, CONFIG.pageRefreshDelay);
    }
  } else {
    // 3. 其他页面默认跳到论坛首页
    location.href = CONSTANTS.URLS.HOME;
  }
}

// --- 4. 主入口 ---
async function init() {
  // 1. 加载配置
  const stored = await storage.get("config");
  if (stored) {
    const migration = migrateStoredConfig(stored);
    CONFIG = { ...CONFIG, ...migration.config };
    if (migration.changed) {
      await storage.set("config", migration.config);
    }
  }

  if (document.readyState !== "complete") {
    await new Promise((r) => window.addEventListener("load", r));
  }

  runAutoLike();
  handleNavigation();
  createFloatingPanel();
}

init().catch(console.error);
