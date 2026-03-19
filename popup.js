const SETTINGS_KEY = "assistiveBotSettings";
const SCRAPED_DATA_KEY = "assistiveBotScrapedData";

function byId(id) {
  return document.getElementById(id);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function getConfigFromForm() {
  return {
    intervalMs: Number(byId("intervalMs").value || 4000),
    scrollStep: Number(byId("scrollStep").value || 600),
    maxIterations: Number(byId("maxIterations").value || 30),
    targetClickSelector: byId("targetClickSelector").value.trim(),
    nextPageSelector: byId("nextPageSelector").value.trim(),
    captureLinkSelector: byId("captureLinkSelector").value.trim(),
    fieldsMapping: byId("fieldsMapping").value,
    smoothScroll: byId("smoothScroll").checked,
    enableSpeech: byId("enableSpeech").checked,
    compareKeyword: byId("compareKeyword").value.trim(),
    comparePages: Number(byId("comparePages").value || 3)
  };
}

function setForm(config = {}) {
  byId("intervalMs").value = config.intervalMs ?? 4000;
  byId("scrollStep").value = config.scrollStep ?? 600;
  byId("maxIterations").value = config.maxIterations ?? 30;
  byId("targetClickSelector").value = config.targetClickSelector ?? "";
  byId("nextPageSelector").value = config.nextPageSelector ?? "";
  byId("captureLinkSelector").value = config.captureLinkSelector ?? "";
  byId("fieldsMapping").value = config.fieldsMapping ?? "";
  byId("smoothScroll").checked = config.smoothScroll ?? true;
  byId("enableSpeech").checked = config.enableSpeech ?? false;
  byId("compareKeyword").value = config.compareKeyword ?? "";
  byId("comparePages").value = config.comparePages ?? 3;
}

function setStatus(text) {
  byId("statusText").textContent = `状态：${text}`;
}

async function saveSettings(config) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: config });
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(SETTINGS_KEY);
  return saved[SETTINGS_KEY] || null;
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function setBackgroundRunning(tabId, running, config = null) {
  await chrome.runtime.sendMessage({
    type: "BOT_TAB_SET_RUNNING",
    payload: { tabId, running, config }
  });
}

async function refreshStatus(tabId) {
  try {
    const response = await sendToTab(tabId, { type: "BOT_STATUS" });
    if (response?.running) {
      setStatus(`运行中（${response.iterations} 次）`);
    } else {
      setStatus("未启动");
    }
  } catch (_) {
    setStatus("页面不支持或未加载完成");
  }
}

async function openDashboard() {
  await chrome.runtime.openOptionsPage();
}

async function start() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("无法获取当前标签页");
    return;
  }

  const config = getConfigFromForm();
  await saveSettings(config);

  try {
    await sendToTab(tab.id, {
      type: "BOT_START",
      payload: { config }
    });
    await setBackgroundRunning(tab.id, true, config);
    setStatus("普通模式已启动");
  } catch (_) {
    setStatus("启动失败，请刷新页面后重试");
  }
}

async function startCompare() {
  const config = getConfigFromForm();
  if (!config.compareKeyword) {
    setStatus("请先输入比价关键词");
    return;
  }

  await saveSettings(config);
  const response = await chrome.runtime.sendMessage({
    type: "BOT_START_COMPARE",
    payload: {
      keyword: config.compareKeyword,
      maxPages: Math.max(1, Number(config.comparePages) || 3),
      intervalMs: Math.max(1000, Number(config.intervalMs) || 4000),
      enableSpeech: config.enableSpeech
    }
  });

  if (response?.ok) {
    setStatus(`比价已启动：${config.compareKeyword}`);
  } else {
    setStatus(`比价启动失败：${response?.error || "未知错误"}`);
  }
}

async function stop() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("无法获取当前标签页");
    return;
  }

  try {
    await sendToTab(tab.id, { type: "BOT_STOP" });
  } catch (_) {}

  await setBackgroundRunning(tab.id, false, null);
  setStatus("当前页已停止");
}

async function stopAllCompare() {
  const response = await chrome.runtime.sendMessage({ type: "BOT_STOP_ALL_COMPARE" });
  if (response?.ok) {
    setStatus("已停止所有比价任务");
  } else {
    setStatus("停止失败");
  }
}

async function exportJson() {
  const data = await chrome.storage.local.get(SCRAPED_DATA_KEY);
  const rows = data[SCRAPED_DATA_KEY] || [];
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `assistive-data-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  setStatus(`已导出 ${rows.length} 条`);
}

async function clearData() {
  await chrome.storage.local.set({ [SCRAPED_DATA_KEY]: [] });
  setStatus("采集数据已清空");
}

async function init() {
  const settings = await loadSettings();
  if (settings) {
    setForm(settings);
  }

  const tab = await getActiveTab();
  if (tab?.id) {
    await refreshStatus(tab.id);
  }

  byId("openDashboardBtn").addEventListener("click", openDashboard);
  byId("startBtn").addEventListener("click", start);
  byId("startCompareBtn").addEventListener("click", startCompare);
  byId("stopBtn").addEventListener("click", stop);
  byId("stopAllBtn").addEventListener("click", stopAllCompare);
  byId("exportBtn").addEventListener("click", exportJson);
  byId("clearDataBtn").addEventListener("click", clearData);
}

init().catch(() => {
  setStatus("初始化失败");
});
