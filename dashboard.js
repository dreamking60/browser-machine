const SCRAPED_DATA_KEY = "assistiveBotScrapedData";
const SETTINGS_KEY = "assistiveBotSettings";

function byId(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  byId("status").textContent = `状态：${text}`;
}

function parsePrice(v) {
  const n = Number(String(v || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function renderSummary(rows) {
  const taobao = rows.filter((r) => r.platform === "taobao").length;
  const jd = rows.filter((r) => r.platform === "jd").length;
  const prices = rows.map((r) => parsePrice(r.price)).filter((n) => n !== null);
  const minPrice = prices.length ? Math.min(...prices) : null;

  byId("totalCount").textContent = String(rows.length);
  byId("taobaoCount").textContent = String(taobao);
  byId("jdCount").textContent = String(jd);
  byId("minPrice").textContent = minPrice === null ? "-" : `¥${minPrice}`;
}

function truncate(v, len = 60) {
  if (!v) return "";
  return v.length > len ? `${v.slice(0, len)}...` : v;
}

function renderTable(rows) {
  const body = byId("resultBody");
  body.innerHTML = "";

  const sorted = [...rows].sort((a, b) => {
    const pa = parsePrice(a.price) ?? Number.POSITIVE_INFINITY;
    const pb = parsePrice(b.price) ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });

  for (const row of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.platform || "-"}</td>
      <td title="${(row.title || "").replace(/"/g, "&quot;")}">${truncate(row.title || "-")}</td>
      <td>${row.price ? `¥${row.price}` : "-"}</td>
      <td>${truncate(row.shop || "-")}</td>
      <td>${row.link ? `<a href="${row.link}" target="_blank" rel="noreferrer">打开</a>` : "-"}</td>
      <td>${row.capturedAt ? new Date(row.capturedAt).toLocaleString() : "-"}</td>
    `;
    body.appendChild(tr);
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

async function saveSettings(partial) {
  const prev = await loadSettings();
  const next = { ...prev, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
}

async function refreshData() {
  const data = await chrome.storage.local.get(SCRAPED_DATA_KEY);
  const rows = data[SCRAPED_DATA_KEY] || [];
  renderSummary(rows);
  renderTable(rows);
  setStatus(`已加载 ${rows.length} 条数据`);
}

async function startCompare() {
  const keyword = byId("keyword").value.trim();
  const maxPages = Math.max(1, Number(byId("pages").value || 3));
  const intervalMs = Math.max(1000, Number(byId("intervalMs").value || 4000));
  const enableSpeech = byId("speech").checked;

  if (!keyword) {
    setStatus("请先输入关键词");
    return;
  }

  await saveSettings({ compareKeyword: keyword, comparePages: maxPages, intervalMs, enableSpeech });

  const res = await chrome.runtime.sendMessage({
    type: "BOT_START_COMPARE",
    payload: { keyword, maxPages, intervalMs, enableSpeech }
  });

  if (!res?.ok) {
    setStatus(`启动失败：${res?.error || "未知错误"}`);
    return;
  }

  setStatus(`任务已启动：${keyword}`);
}

async function stopAll() {
  const res = await chrome.runtime.sendMessage({ type: "BOT_STOP_ALL_COMPARE" });
  setStatus(res?.ok ? "已停止全部任务" : "停止失败");
}

async function clearData() {
  await chrome.storage.local.set({ [SCRAPED_DATA_KEY]: [] });
  await refreshData();
  setStatus("数据已清空");
}

async function exportJson() {
  const data = await chrome.storage.local.get(SCRAPED_DATA_KEY);
  const rows = data[SCRAPED_DATA_KEY] || [];
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `compare-results-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`已导出 ${rows.length} 条`);
}

async function init() {
  const settings = await loadSettings();
  byId("keyword").value = settings.compareKeyword || "";
  byId("pages").value = settings.comparePages || 3;
  byId("intervalMs").value = settings.intervalMs || 4000;
  byId("speech").checked = Boolean(settings.enableSpeech);

  byId("startBtn").addEventListener("click", startCompare);
  byId("stopBtn").addEventListener("click", stopAll);
  byId("refreshBtn").addEventListener("click", refreshData);
  byId("clearBtn").addEventListener("click", clearData);
  byId("exportBtn").addEventListener("click", exportJson);

  await refreshData();
}

init().catch((err) => {
  setStatus(`初始化失败：${String(err)}`);
});
