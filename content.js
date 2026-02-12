// --- 1. 配置与选择器 ---

// 默认配置（兜底用，实际会从 storage 加载）
let CONFIG = {
  taskDuration: 0,
  newOpenDelay: 3000,
  pageRefreshDelay: 60 * 1000,
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
  likeCooldownHours: 24,
};

// URL 和 字符串常量保持不变
const CONSTANTS = {
  URLS: {
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
  TOPIC_LINKS: "a[data-topic-id]",
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

// --- 3. 业务逻辑模块 ---

/**
 * 检查任务是否超时
 * @returns {Promise<boolean>} true if task expired
 */
async function checkTaskDuration() {
  const data = await storage.getAll();
  const startTime = data.taskStartTime || 0;
  const durationMinutes = CONFIG.taskDuration || 0;
  
  // 0 表示不限制
  if (durationMinutes <= 0) return false;
  if (startTime === 0) return false; // 未记录开始时间

  const elapsed = Date.now() - startTime;
  const durationMs = durationMinutes * 60 * 1000;

  if (elapsed >= durationMs) {
    console.log(`[LinuxDoReader] 任务已运行 ${elapsed/1000}s，超过设定时长 ${durationMinutes}min，自动停止。`);
    
    // 停止任务
    await chrome.storage.local.set({
      autoread: false,
      autolike: false
    });
    
    return true;
  }
  return false;
}

/**
 * 随机整数生成器
 */
const getRandomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

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
          updates.taskStartTime = Date.now();
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
async function runAutoLike() {
  setInterval(async () => {
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

    const repliesContainer = document.querySelector(SELECTORS.REPLIES_CONTAINER);
    if (!repliesContainer) return;

    // 获取当前正在浏览的回复 ID
    const currentPostId = repliesContainer.textContent.match(/\d+/g)?.[0];
    if (!currentPostId) return;

    const postElement = document.querySelector(
      `${SELECTORS.POST_ID_PREFIX}${currentPostId}`,
    );
    if (!postElement) return;

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

      setTimeout(() => {
        // 再次检查按钮状态（防止延迟期间滑走或已点）
        if (likeBtn.title === CONSTANTS.STRINGS.LIKE_TITLE_TRIGGER) {
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
 * 自动滚动浏览逻辑 (拟人化优化)
 */
let isScrolling = false;
function startAutoScroll() {
  if (isScrolling) return; // 防止重复启动

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
      if (isAutoRead) handleNavigation();
      return;
    }
    isScrolling = true;

    // 2. 随机滚动距离和延迟
    const step = getRandomInt(CONFIG.scrollStepMin, CONFIG.scrollStepMax);
    const delay = getRandomInt(
      CONFIG.scrollDelayMin,
      CONFIG.scrollDelayMax,
    );

    window.scrollBy(0, step);

    // 2. 触底判断
    if (window.scrollY + window.innerHeight + 5 >= document.body.scrollHeight) {
      // 智能等待：给予页面懒加载的时间
      await new Promise((r) => setTimeout(r, 2000));

      // 再次检查是否真的到底（如果在等待期间加载了新内容，高度会增加）
      if (
        window.scrollY + window.innerHeight + 5 >=
        document.body.scrollHeight
      ) {
        setTimeout(() => {
          // 读完后优先去未读列表，确保清理未读
          location.href = CONSTANTS.URLS.UNSEEN;
        }, CONFIG.newOpenDelay);
        return; // 结束滚动循环
      }
    }

    // 3. 随机暂停模拟阅读
    if (Math.random() < CONFIG.scrollPauseProbability) {
      const pauseTime = getRandomInt(
        CONFIG.scrollPauseMin,
        CONFIG.scrollPauseMax,
      );
      setTimeout(runScroll, pauseTime);
    } else {
      setTimeout(runScroll, delay);
    }
  };

  runScroll();
}

// 监听 autoread 变化，以便在开启时立即启动滚动或导航
chrome.storage.onChanged.addListener((changes) => {
  if (changes.autoread && changes.autoread.newValue === true) {
    handleNavigation();
  }
});

/**
 * 获取目标帖子链接 (全列表随机)
 */
function getTargetTopicLink() {
  const posts = document.querySelectorAll(SELECTORS.TOPIC_LINKS);
  if (posts.length === 0) return null;
  // 随机选择一个帖子
  const randomIndex = getRandomInt(0, posts.length - 1);
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

  // 2. 如果在列表页
  if (currentUrl === CONSTANTS.URLS.LATEST || currentUrl === CONSTANTS.URLS.UNSEEN) {
    const link = getTargetTopicLink();
    if (link) {
      setTimeout(() => (location.href = link), CONFIG.newOpenDelay);
    } else {
      // 找不到帖子，在两个列表间切换刷新
      setTimeout(() => {
        location.href =
          currentUrl === CONSTANTS.URLS.LATEST
            ? CONSTANTS.URLS.UNSEEN
            : CONSTANTS.URLS.LATEST;
      }, CONFIG.pageRefreshDelay);
    }
  } else {
    // 3. 其他页面默认跳到未读
    location.href = CONSTANTS.URLS.UNSEEN;
  }
}

// --- 4. 主入口 ---
async function init() {
  // 1. 加载配置
  const stored = await storage.get("config");
  if (stored) {
    CONFIG = { ...CONFIG, ...stored };
  }

  if (document.readyState !== "complete") {
    await new Promise((r) => window.addEventListener("load", r));
  }

  runAutoLike();
  handleNavigation();
  createFloatingPanel();
}

init().catch(console.error);
