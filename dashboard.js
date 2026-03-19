const SCRAPED_DATA_KEY = "assistiveBotScrapedData";
const SETTINGS_KEY = "assistiveBotSettings";

const state = {
  rows: [],
  activeRunId: "all",
  schedule: {
    enabled: false,
    keyword: "",
    maxPages: 2,
    intervalMinutes: 60,
    intervalMs: 4000,
    enableSpeech: false
  },
  scheduleLastRun: null
};

function byId(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  byId("status").textContent = `状态：${text}`;
}

function parsePrice(v) {
  const n = Number(String(v || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseSales(v) {
  const s = String(v || "").replace(/,/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)(万|千)?\+?/);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  if (m[2] === "万") return Math.round(base * 10000);
  if (m[2] === "千") return Math.round(base * 1000);
  return Math.round(base);
}

function formatNum(n) {
  if (!Number.isFinite(n)) return "-";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(Math.round(n));
}

function cleanShopName(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .replace(/^\d+\s*年老店/g, "")
    .trim();
}

function getRuns(rows) {
  const map = new Map();
  for (const row of rows) {
    const runId = row.runId || "legacy";
    if (!map.has(runId)) {
      map.set(runId, { runId, keyword: row.keyword || "未命名任务", count: 0, lastAt: row.capturedAt || "" });
    }
    const r = map.get(runId);
    r.count += 1;
    if ((row.capturedAt || "") > (r.lastAt || "")) r.lastAt = row.capturedAt || "";
  }
  return Array.from(map.values()).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
}

function renderRunList() {
  const root = byId("runList");
  root.innerHTML = "";

  const all = document.createElement("div");
  all.className = `run-item ${state.activeRunId === "all" ? "active" : ""}`;
  all.innerHTML = `<div class="name">全部任务</div><div class="meta">${state.rows.length} 条</div>`;
  all.onclick = () => {
    state.activeRunId = "all";
    renderTable();
  };
  root.appendChild(all);

  for (const run of getRuns(state.rows)) {
    const item = document.createElement("div");
    item.className = `run-item ${state.activeRunId === run.runId ? "active" : ""}`;
    item.innerHTML = `<div class="name">${run.keyword}</div><div class="meta">${run.count} 条 · ${run.lastAt ? new Date(run.lastAt).toLocaleString() : "-"}</div>`;
    item.onclick = () => {
      state.activeRunId = run.runId;
      renderTable();
    };
    root.appendChild(item);
  }
}

function rowsForCurrentRun() {
  if (state.activeRunId === "all") return state.rows;
  return state.rows.filter((r) => (r.runId || "legacy") === state.activeRunId);
}

function renderTable() {
  const rows = [...rowsForCurrentRun()].sort((a, b) => {
    const pa = parsePrice(a.price);
    const pb = parsePrice(b.price);
    if (Number.isFinite(pa) && Number.isFinite(pb)) return pa - pb;
    if (Number.isFinite(pa)) return -1;
    if (Number.isFinite(pb)) return 1;
    return (b.capturedAt || "").localeCompare(a.capturedAt || "");
  });

  const body = byId("resultBody");
  body.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7">暂无数据</td>`;
    body.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement("tr");
      const price = parsePrice(row.price);
      const sales = parseSales(row.sales);
      tr.innerHTML = `
        <td>${row.platform || "-"}</td>
        <td>${row.title || "-"}</td>
        <td>${Number.isFinite(price) ? `¥${price}` : (row.price || "-")}</td>
        <td>${Number.isFinite(sales) ? formatNum(sales) : (row.sales || "-")}</td>
        <td>${cleanShopName(row.shop || "-") || "-"}</td>
        <td>${row.link ? `<a href="${row.link}" target="_blank" rel="noreferrer">打开</a>` : "-"}</td>
        <td>${row.capturedAt ? new Date(row.capturedAt).toLocaleString() : "-"}</td>
      `;
      body.appendChild(tr);
    }
  }

  const runText = state.activeRunId === "all" ? "全部任务" : (rows[0]?.keyword || state.activeRunId);
  byId("tableHint").textContent = `${runText} · ${rows.length} 条`;
}

function toCsv(rows) {
  const headers = ["runId", "keyword", "platform", "title", "price", "sales", "shop", "link", "capturedAt"];
  const esc = (v) => {
    const s = String(v ?? "").replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(","));
  return lines.join("\n");
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function encodeTextByEncoding(str, encoding) {
  if (encoding === "gbk" && typeof TextEncoder !== "undefined") {
    try {
      return new TextEncoder("gbk").encode(str);
    } catch (_) {
      return null;
    }
  }
  return new TextEncoder().encode(str);
}

function exportCsv() {
  const rows = rowsForCurrentRun();
  const csv = toCsv(rows);
  const encoding = byId("csvEncoding").value;
  const runTag = state.activeRunId === "all" ? "all" : state.activeRunId;

  if (encoding === "utf-8") {
    downloadBlob(`compare-${runTag}.utf8.csv`, new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    setStatus(`已导出 UTF-8 CSV（${rows.length} 条）`);
    return;
  }

  const encoded = encodeTextByEncoding(csv, "gbk");
  if (encoded) {
    downloadBlob(`compare-${runTag}.gbk.csv`, new Blob([encoded], { type: "text/csv;charset=gbk" }));
    setStatus(`已导出 GBK CSV（${rows.length} 条）`);
  } else {
    downloadBlob(`compare-${runTag}.gbk-fallback.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
    setStatus("当前浏览器不支持原生GBK编码，已导出UTF-8回退文件");
  }
}

function exportExcel() {
  const rows = rowsForCurrentRun();
  const headers = ["runId", "keyword", "platform", "title", "price", "sales", "shop", "link", "capturedAt"];
  const trs = rows.map((row) => `<tr>${headers.map((h) => `<td>${String(row[h] ?? "").replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset=\"UTF-8\"></head><body><table border=\"1\"><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>${trs}</table></body></html>`;
  const runTag = state.activeRunId === "all" ? "all" : state.activeRunId;
  downloadBlob(`compare-${runTag}.xls`, new Blob(["\uFEFF", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  setStatus(`已导出 Excel（${rows.length} 条）`);
}

function exportJson() {
  const rows = rowsForCurrentRun();
  const runTag = state.activeRunId === "all" ? "all" : state.activeRunId;
  downloadBlob(`compare-${runTag}.json`, new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
  setStatus(`已导出 JSON（${rows.length} 条）`);
}

function applyScheduleToUI() {
  byId("scheduleEnabled").checked = Boolean(state.schedule.enabled);
  byId("scheduleKeyword").value = state.schedule.keyword || "";
  byId("schedulePages").value = state.schedule.maxPages || 2;
  byId("scheduleIntervalMinutes").value = state.schedule.intervalMinutes || 60;
  byId("scheduleIntervalMs").value = state.schedule.intervalMs || 4000;
  byId("scheduleSpeech").checked = Boolean(state.schedule.enableSpeech);
}

function collectScheduleFromUI() {
  state.schedule = {
    enabled: byId("scheduleEnabled").checked,
    keyword: byId("scheduleKeyword").value.trim(),
    maxPages: Math.max(1, Number(byId("schedulePages").value || 2)),
    intervalMinutes: Math.max(1, Number(byId("scheduleIntervalMinutes").value || 60)),
    intervalMs: Math.max(1000, Number(byId("scheduleIntervalMs").value || 4000)),
    enableSpeech: byId("scheduleSpeech").checked
  };
}

function renderScheduleStatus() {
  const parts = [state.schedule.enabled ? "已开启" : "未开启"];
  if (state.schedule.enabled) parts.push(`每${state.schedule.intervalMinutes}分钟`);
  if (state.schedule.keyword) parts.push(`关键词:${state.schedule.keyword}`);
  if (state.scheduleLastRun?.at) {
    parts.push(`上次:${state.scheduleLastRun.status || "-"}@${new Date(state.scheduleLastRun.at).toLocaleString()}`);
  }
  byId("scheduleStatus").textContent = `定时状态：${parts.join(" · ")}`;
}

async function refreshScheduleFromBackground() {
  const res = await chrome.runtime.sendMessage({ type: "BOT_GET_SCHEDULE" });
  if (!res?.ok) return;
  state.schedule = {
    ...state.schedule,
    ...(res.scheduleConfig || {})
  };
  state.scheduleLastRun = res.scheduleLastRun || null;
  applyScheduleToUI();
  renderScheduleStatus();
}

async function saveSchedule() {
  collectScheduleFromUI();
  if (state.schedule.enabled && !state.schedule.keyword) {
    setStatus("请填写定时关键词后再开启");
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: "BOT_SET_SCHEDULE", payload: state.schedule });
  if (!res?.ok) {
    setStatus(`定时配置保存失败：${res?.error || "未知错误"}`);
    return;
  }
  const settings = await chrome.storage.local.get(SETTINGS_KEY);
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...(settings[SETTINGS_KEY] || {}), scheduleConfig: state.schedule } });
  setStatus(state.schedule.enabled ? "定时任务已开启并生效" : "定时任务已关闭");
  await refreshScheduleFromBackground();
}

async function runScheduleNow() {
  const res = await chrome.runtime.sendMessage({ type: "BOT_RUN_SCHEDULE_NOW" });
  if (!res?.ok) {
    setStatus(`立即执行失败：${res?.error || "未知错误"}`);
    return;
  }
  setStatus("已触发一次定时任务");
  await refreshScheduleFromBackground();
}

async function refreshData() {
  const data = await chrome.storage.local.get(SCRAPED_DATA_KEY);
  state.rows = data[SCRAPED_DATA_KEY] || [];
  renderRunList();
  renderTable();
  setStatus(`已加载 ${state.rows.length} 条数据`);
}

async function startCompare() {
  const keyword = byId("keyword").value.trim();
  const maxPages = Math.max(1, Number(byId("pages").value || 2));
  const intervalMs = Math.max(1000, Number(byId("intervalMs").value || 4000));
  const enableSpeech = byId("speech").checked;

  if (!keyword) {
    setStatus("请先输入关键词");
    return;
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const runName = `${keyword}-${new Date().toLocaleString()}`;

  const settings = await chrome.storage.local.get(SETTINGS_KEY);
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...(settings[SETTINGS_KEY] || {}),
      compareKeyword: keyword,
      comparePages: maxPages,
      intervalMs,
      enableSpeech
    }
  });

  const res = await chrome.runtime.sendMessage({
    type: "BOT_START_COMPARE",
    payload: { keyword, maxPages, intervalMs, enableSpeech, runId, runName }
  });

  if (!res?.ok) {
    setStatus(`启动失败：${res?.error || "未知错误"}`);
    return;
  }

  state.activeRunId = runId;
  setStatus(`任务已启动：${keyword}`);
  renderRunList();
}

async function stopAll() {
  const res = await chrome.runtime.sendMessage({ type: "BOT_STOP_ALL_COMPARE" });
  setStatus(res?.ok ? "已停止全部任务" : "停止失败");
}

async function clearData() {
  await chrome.storage.local.set({ [SCRAPED_DATA_KEY]: [] });
  state.rows = [];
  state.activeRunId = "all";
  renderRunList();
  renderTable();
  setStatus("数据已清空");
}

function bindEvents() {
  byId("startBtn").addEventListener("click", startCompare);
  byId("stopBtn").addEventListener("click", stopAll);
  byId("refreshBtn").addEventListener("click", refreshData);
  byId("clearBtn").addEventListener("click", clearData);
  byId("exportCsvBtn").addEventListener("click", exportCsv);
  byId("exportExcelBtn").addEventListener("click", exportExcel);
  byId("exportJsonBtn").addEventListener("click", exportJson);
  byId("saveScheduleBtn").addEventListener("click", saveSchedule);
  byId("runScheduleNowBtn").addEventListener("click", runScheduleNow);
}

async function init() {
  const settingsData = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = settingsData[SETTINGS_KEY] || {};
  byId("keyword").value = settings.compareKeyword || "";
  byId("pages").value = settings.comparePages || 2;
  byId("intervalMs").value = settings.intervalMs || 4000;
  byId("speech").checked = Boolean(settings.enableSpeech);

  bindEvents();
  await refreshScheduleFromBackground();
  await refreshData();
}

init().catch((err) => setStatus(`初始化失败：${String(err)}`));
