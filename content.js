const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

const SCROLL_DELAY = 100;
const NEW_OPEN_DELAY = 3000;
const PAGE_REFRESH_DELAY = 60 * 1000;
const SLEEP_TIME = 60 * 60 * 1000;

// 替换 GM_getValue 和 GM_setValue
async function getValue(key, defaultValue) {
  const result = await chrome.storage.local.get([key]);
  return result[key] === undefined ? defaultValue : result[key];
}

async function setValue(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// 检查点赞上限
function checkLikeLimit() {
  const likeLimitText = "点赞上限";
  const dialogBody = document.querySelector(".dialog-body");

  if (dialogBody && dialogBody.innerText.includes(likeLimitText)) {
    console.log("Reached like limit, stopping auto-like.");
    setValue("autolike", false);
  }
}

// 滚动页面
function scrollPage() {
  const scrollInterval = setInterval(async () => {
    const isAutoRead = await getValue("autoread", false);
    if (!isAutoRead) {
      clearInterval(scrollInterval);
      return;
    }

    window.scrollBy(0, 15);

    if (window.scrollY + window.innerHeight + 5 >= document.body.scrollHeight) {
      clearInterval(scrollInterval);
      setTimeout(() => {
        location.href = document.referrer;
      }, NEW_OPEN_DELAY);
    }
  }, SCROLL_DELAY);
}

// 自动点赞
async function autoLike() {
  setInterval(async () => {
    const isAutoLike = await getValue("autolike", false);
    if (!isAutoLike) {
      return;
    }

    const repliesContainer = document.querySelector(".timeline-replies");
    if (!repliesContainer) return;

    const currentReplied = repliesContainer.textContent.match(/\d+/g)?.[0];
    if (!currentReplied) return;

    const btn = document
      .querySelector("#post_" + currentReplied)
      ?.querySelector(".discourse-reactions-reaction-button");
    if (btn?.title === "点赞此帖子") {
      btn.click();
      checkLikeLimit();
    }
  }, 1000);
}

// 主函数
async function main() {
  try {
    if (document.readyState !== "complete") {
      await new Promise((resolve) => (window.onload = resolve));
    }

    autoLike();

    const isAutoRead = await getValue("autoread", false);
    if (!isAutoRead) return;

    if (/^https:\/\/linux\.do\/t\/topic\/.+$/.test(location.href)) {
      scrollPage();
      return;
    }

    if (
      location.href === "https://linux.do/new" ||
      location.href === "https://linux.do/unread"
    ) {
      const link = getLastPostLink();
      if (link) {
        await delay(NEW_OPEN_DELAY);
        location.href = link;
      } else {
        await delay(PAGE_REFRESH_DELAY);
        location.href =
          location.href === "https://linux.do/new"
            ? "https://linux.do/unread"
            : "https://linux.do/new";
      }
    } else {
      location.href = "https://linux.do/unread";
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// 获取第一个帖子的链接
function getFirstPostLink() {
  try {
    // 根据你的论坛的HTML结构，找到帖子链接的选择器
    const post = document.querySelector(
      "td.main-link.clearfix.topic-list-data > span > a",
    );
    if (post != null) {
      return post.href;
    }

    return null;
  } catch (error) {
    console.error("Failed to get the first post link:", error);
    return null;
  }
}

function getLastPostLink() {
  try {
    const posts = document.querySelectorAll("a[data-topic-id]");
    if (posts.length > 0) {
      return posts[posts.length - 1].href;
    }
    return null;
  } catch (error) {
    console.error("Failed to get the last post link:", error);
    return null;
  }
}

// 检查是否在工作时间内
function isWorkingHours() {
  return true;

  const hour = new Date().getHours();
  // 晚上8点到第二天早上10点不工作
  if (hour >= 23 || hour < 6) {
    return false;
  } else {
    return true;
  }
}

main();
