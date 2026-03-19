const SCRAPED_DATA_KEY = "assistiveBotScrapedData";
const SETTINGS_KEY = "assistiveBotSettings";

const ui = {
  allRows: [],
  activeRunId: "all"
};

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

function parseSales(v) {
  const s = String(v || "").replace(/,/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)(万|千)?/);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  if (m[2] === "万") return Math.round(base * 10000);
  if (m[2] === "千") return Math.round(base * 1000);
  return Math.round(base);
}

function truncate(v, len = 64) {
  if (!v) return "";
  return v.length > len ? `${v.slice(0, len)}...` : v;
}

function getRuns(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const runId = row.runId || "legacy";
    if (!grouped.has(runId)) {
      grouped.set(runId, {
        runId,
        keyword: row.keyword || "未命名任务",
        count: 0,
        lastAt: row.capturedAt || ""
      });
    }
    const item = grouped.get(runId);
    item.count += 1;
    if ((row.capturedAt || "") > (item.lastAt || "")) {
      item.lastAt = row.capturedAt || "";
    }
  }

  return Array.from(grouped.values()).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
}

function renderRunList() {
  const root = byId("runList");
  root.innerHTML = "";

  const allBtn = document.createElement("div");
  allBtn.className = `run-item ${ui.activeRunId === "all" ? "active" : ""}`;
  allBtn.innerHTML = `<div class="name">全部任务</div><div class="meta">${ui.allRows.length} 条</div>`;
  allBtn.onclick = () => {
    ui.activeRunId = "all";
    renderAll();
  };
  root.appendChild(allBtn);

  const runs = getRuns(ui.allRows);
  for (const run of runs) {
    const item = document.createElement("div");
    item.className = `run-item ${ui.activeRunId === run.runId ? "active" : ""}`;
    item.innerHTML = `
      <div class="name">${truncate(run.keyword, 18)}</div>
      <div class="meta">${run.count} 条 · ${run.lastAt ? new Date(run.lastAt).toLocaleString() : "-"}</div>
    `;
    item.onclick = () => {
      ui.activeRunId = run.runId;
      renderAll();
    };
    root.appendChild(item);
  }
}

function currentRows() {
  if (ui.activeRunId === "all") {
    return ui.allRows;
  }
  return ui.allRows.filter((r) => (r.runId || "legacy") === ui.activeRunId);
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

function renderTable(rows) {
  const body = byId("resultBody");
  body.innerHTML = "";

  const sorted = [...rows].sort((a, b) => {
    const pa = parsePrice(a.price) ?? Number.POSITIVE_INFINITY;
    const pb = parsePrice(b.price) ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    const sa = parseSales(b.sales) ?? -1;
    const sb = parseSales(a.sales) ?? -1;
    return sa - sb;
  });

  for (const row of sorted) {
    const tr = document.createElement("tr");
    const safeTitle = (row.title || "").replace(/"/g, "&quot;");
    tr.innerHTML = `
      <td>${row.platform || "-"}</td>
      <td title="${safeTitle}">${truncate(row.title || "-")}</td>
      <td>${row.price ? `¥${row.price}` : "-"}</td>
      <td>${row.sales || "-"}</td>
      <td>${truncate(row.shop || "-")}</td>
      <td>${row.link ? `<a href="${row.link}" target="_blank" rel="noreferrer">打开</a>` : "-"}</td>
      <td>${row.capturedAt ? new Date(row.capturedAt).toLocaleString() : "-"}</td>
    `;
    body.appendChild(tr);
  }
}

function renderActiveRunText(rows) {
  if (ui.activeRunId === "all") {
    byId("activeRunText").textContent = "当前：全部任务";
    return;
  }
  const keyword = rows[0]?.keyword || ui.activeRunId;
  byId("activeRunText").textContent = `当前：${keyword}（${rows.length} 条）`;
}

function toCsv(rows) {
  const headers = ["runId", "keyword", "platform", "title", "price", "sales", "shop", "link", "capturedAt"];
  const escapeCell = (v) => {
    const s = String(v ?? "").replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(","));
  }
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

function exportCsv() {
  const rows = currentRows();
  const csv = toCsv(rows);
  const encoding = byId("csvEncoding").value;
  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;

  if (encoding === "utf-8") {
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(`compare-${runTag}.utf8.csv`, blob);
    setStatus(`已导出 UTF-8 CSV（${rows.length} 条）`);
    return;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=gbk" });
  downloadBlob(`compare-${runTag}.gbk.csv`, blob);
  setStatus(`已导出 GBK CSV（${rows.length} 条）`);
}

function exportExcel() {
  const rows = currentRows();
  const headers = ["runId", "keyword", "platform", "title", "price", "sales", "shop", "link", "capturedAt"];
  const trs = rows
    .map((row) => `<tr>${headers.map((h) => `<td>${String(row[h] ?? "").replace(/</g, "&lt;")}</td>`).join("")}</tr>`)
    .join("");

  const html = `
    <html><head><meta charset="UTF-8"></head><body>
    <table border="1">
      <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      ${trs}
    </table>
    </body></html>
  `;

  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;
  const blob = new Blob(["\uFEFF", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(`compare-${runTag}.xls`, blob);
  setStatus(`已导出 Excel（${rows.length} 条）`);
}

function exportJson() {
  const rows = currentRows();
  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  downloadBlob(`compare-${runTag}.json`, blob);
  setStatus(`已导出 JSON（${rows.length} 条）`);
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
  ui.allRows = data[SCRAPED_DATA_KEY] || [];
  renderAll();
  setStatus(`已加载 ${ui.allRows.length} 条数据`);
}

function renderAll() {
  renderRunList();
  const rows = currentRows();
  renderSummary(rows);
  renderTable(rows);
  renderActiveRunText(rows);
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

  await saveSettings({ compareKeyword: keyword, comparePages: maxPages, intervalMs, enableSpeech });

  const res = await chrome.runtime.sendMessage({
    type: "BOT_START_COMPARE",
    payload: { keyword, maxPages, intervalMs, enableSpeech, runId, runName }
  });

  if (!res?.ok) {
    setStatus(`启动失败：${res?.error || "未知错误"}`);
    return;
  }

  ui.activeRunId = runId;
  setStatus(`任务已启动：${keyword}`);
}

async function stopAll() {
  const res = await chrome.runtime.sendMessage({ type: "BOT_STOP_ALL_COMPARE" });
  setStatus(res?.ok ? "已停止全部任务" : "停止失败");
}

async function clearData() {
  await chrome.storage.local.set({ [SCRAPED_DATA_KEY]: [] });
  ui.activeRunId = "all";
  await refreshData();
  setStatus("数据已清空");
}

async function init() {
  const settings = await loadSettings();
  byId("keyword").value = settings.compareKeyword || "";
  byId("pages").value = settings.comparePages || 2;
  byId("intervalMs").value = settings.intervalMs || 4000;
  byId("speech").checked = Boolean(settings.enableSpeech);

  byId("startBtn").addEventListener("click", startCompare);
  byId("stopBtn").addEventListener("click", stopAll);
  byId("refreshBtn").addEventListener("click", refreshData);
  byId("clearBtn").addEventListener("click", clearData);
  byId("exportJsonBtn").addEventListener("click", exportJson);
  byId("exportCsvBtn").addEventListener("click", exportCsv);
  byId("exportExcelBtn").addEventListener("click", exportExcel);

  await refreshData();
}

init().catch((err) => {
  setStatus(`初始化失败：${String(err)}`);
});
