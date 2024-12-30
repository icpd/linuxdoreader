chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    autoread: false,
    autolike: false,
  });
});
