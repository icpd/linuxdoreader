// --- 1. 配置与选择器 ---
const CONFIG = {
  DELAYS: {
    SCROLL: 100,
    NEW_OPEN: 3000,
    PAGE_REFRESH: 60 * 1000,
  },
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
};

// --- 3. 业务逻辑模块 ---

/**
 * 自动点赞逻辑
 */
async function runAutoLike() {
  setInterval(async () => {
    if (!(await storage.get("autolike", false))) return;

    const repliesContainer = document.querySelector(SELECTORS.REPLIES_CONTAINER);
    if (!repliesContainer) return;

    // 获取当前正在浏览的回复 ID
    const currentPostId = repliesContainer.textContent.match(/\d+/g)?.[0];
    if (!currentPostId) return;

    const likeBtn = document
      .querySelector(`${SELECTORS.POST_ID_PREFIX}${currentPostId}`)
      ?.querySelector(SELECTORS.LIKE_BUTTON);

    if (likeBtn?.title === CONFIG.STRINGS.LIKE_TITLE_TRIGGER) {
      likeBtn.click();
      checkAndHandleLikeLimit();
    }
  }, 1000);
}

function checkAndHandleLikeLimit() {
  const dialog = document.querySelector(SELECTORS.LIKE_LIMIT_DIALOG);
  if (dialog && dialog.innerText.includes(CONFIG.STRINGS.LIKE_LIMIT_TEXT)) {
    console.warn("[LinuxDoReader] 达到点赞上限，已自动关闭");
    storage.set("autolike", false);
  }
}

/**
 * 自动滚动浏览逻辑
 */
function startAutoScroll() {
  const scrollInterval = setInterval(async () => {
    if (!(await storage.get("autoread", false))) {
      clearInterval(scrollInterval);
      return;
    }

    window.scrollBy(0, 15);

    // 触底判断
    if (window.scrollY + window.innerHeight + 5 >= document.body.scrollHeight) {
      clearInterval(scrollInterval);
      setTimeout(() => {
        location.href = document.referrer || CONFIG.URLS.LATEST;
      }, CONFIG.DELAYS.NEW_OPEN);
    }
  }, CONFIG.DELAYS.SCROLL);
}

/**
 * 获取目标帖子链接
 */
function getTargetTopicLink() {
  const posts = document.querySelectorAll(SELECTORS.TOPIC_LINKS);
  return posts.length > 0 ? posts[posts.length - 1].href : null;
}

/**
 * 导航逻辑
 */
async function handleNavigation() {
  const isAutoRead = await storage.get("autoread", false);
  if (!isAutoRead) return;

  const currentUrl = location.href;

  // 1. 如果在话题详情页
  if (CONFIG.URLS.TOPIC_PATTERN.test(currentUrl)) {
    startAutoScroll();
    return;
  }

  // 2. 如果在列表页
  if (currentUrl === CONFIG.URLS.LATEST || currentUrl === CONFIG.URLS.UNSEEN) {
    const link = getTargetTopicLink();
    if (link) {
      setTimeout(() => (location.href = link), CONFIG.DELAYS.NEW_OPEN);
    } else {
      // 找不到帖子，在两个列表间切换刷新
      setTimeout(() => {
        location.href =
          currentUrl === CONFIG.URLS.LATEST
            ? CONFIG.URLS.UNSEEN
            : CONFIG.URLS.LATEST;
      }, CONFIG.DELAYS.PAGE_REFRESH);
    }
  } else {
    // 3. 其他页面默认跳到未读
    location.href = CONFIG.URLS.UNSEEN;
  }
}

// --- 4. 主入口 ---
async function init() {
  if (document.readyState !== "complete") {
    await new Promise((r) => window.addEventListener("load", r));
  }

  runAutoLike();
  handleNavigation();
}

init().catch(console.error);
