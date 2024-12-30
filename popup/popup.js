document.addEventListener("DOMContentLoaded", async () => {
  const autoReadBtn = document.getElementById("toggleAutoRead");
  const autoLikeBtn = document.getElementById("toggleAutoLike");

  // 初始化按钮状态
  const state = await chrome.storage.local.get(["autoread", "autolike"]);
  updateButtonState(autoReadBtn, state.autoread);
  updateButtonState(autoLikeBtn, state.autolike);

  autoReadBtn.addEventListener("click", async () => {
    const current = await toggleSetting("autoread");
    updateButtonState(autoReadBtn, current);
  });

  autoLikeBtn.addEventListener("click", async () => {
    const current = await toggleSetting("autolike");
    updateButtonState(autoLikeBtn, current);
  });
});

function updateButtonState(button, state) {
  button.textContent = `${button.id.replace("toggle", "")}: ${state ? "ON" : "OFF"}`;
  button.classList.toggle("active", state);
}

async function toggleSetting(key) {
  const state = await chrome.storage.local.get([key]);
  const newState = !state[key];
  await chrome.storage.local.set({ [key]: newState });
  return newState;
}
