const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};

document.addEventListener("DOMContentLoaded", async () => {
  const config = [
    { id: "toggleAutoRead", key: "autoread", label: "Auto-Read" },
    { id: "toggleAutoLike", key: "autolike", label: "Auto-Like" },
    { id: "toggleShowFloat", key: "showfloat", label: "Show Float" },
  ];

  const currentState = await storage.get(config.map((c) => c.key));

  config.forEach((item) => {
    const btn = document.getElementById(item.id);

    // 初始化 UI
    updateUI(btn, item.label, currentState[item.key]);

    // 绑定点击事件
    btn.addEventListener("click", async () => {
      const state = await storage.get(item.key);
      const newState = !state[item.key];
      await storage.set({ [item.key]: newState });
      updateUI(btn, item.label, newState);
    });
  });
});

function updateUI(button, label, isActive) {
  button.textContent = `${label}: ${isActive ? "ON" : "OFF"}`;
  button.classList.toggle("active", isActive);
}
