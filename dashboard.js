const SCRAPED_DATA_KEY = "assistiveBotScrapedData";
const SETTINGS_KEY = "assistiveBotSettings";

const ui = {
  allRows: [],
  activeRunId: "all",
  activeAnalysis: "summary"
};

const PALETTE = ["#1b8b5a", "#3ea36f", "#66bb8a", "#8ccfa8", "#afdcc0", "#d1ead9", "#4f7f67", "#7ca88f"];

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

function currentRowsByRun() {
  if (ui.activeRunId === "all") {
    return ui.allRows;
  }
  return ui.allRows.filter((r) => (r.runId || "legacy") === ui.activeRunId);
}

function rowsForAnalysis() {
  const base = currentRowsByRun();
  if (ui.activeAnalysis === "taobao") return base.filter((r) => r.platform === "taobao");
  if (ui.activeAnalysis === "jd") return base.filter((r) => r.platform === "jd");
  return base;
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
    if ((row.capturedAt || "") > (item.lastAt || "")) item.lastAt = row.capturedAt || "";
  }
  return Array.from(grouped.values()).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
}

function groupedCount(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function groupedSum(rows, keyFn, valueFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const v = valueFn(r);
    if (!k || !Number.isFinite(v)) continue;
    map.set(k, (map.get(k) || 0) + v);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function formatNum(n) {
  if (!Number.isFinite(n)) return "-";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(Math.round(n));
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

  for (const run of getRuns(ui.allRows)) {
    const item = document.createElement("div");
    item.className = `run-item ${ui.activeRunId === run.runId ? "active" : ""}`;
    item.innerHTML = `<div class="name">${truncate(run.keyword, 18)}</div><div class="meta">${run.count} 条 · ${run.lastAt ? new Date(run.lastAt).toLocaleString() : "-"}</div>`;
    item.onclick = () => {
      ui.activeRunId = run.runId;
      renderAll();
    };
    root.appendChild(item);
  }
}

function renderStats(rows) {
  const total = rows.length;
  const shopCount = new Set(rows.map((r) => r.shop).filter(Boolean)).size;
  const prices = rows.map((r) => parsePrice(r.price)).filter((n) => n !== null);
  const sales = rows.map((r) => parseSales(r.sales)).filter((n) => n !== null);
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const totalSales = sales.length ? sales.reduce((a, b) => a + b, 0) : null;

  byId("analysisStats").innerHTML = `
    <div><span>${total}</span><small>商品数</small></div>
    <div><span>${shopCount}</span><small>店铺数</small></div>
    <div><span>${avgPrice ? `¥${avgPrice.toFixed(1)}` : "-"}</span><small>均价</small></div>
    <div><span>${totalSales ? formatNum(totalSales) : "-"}</span><small>总销量(估算)</small></div>
  `;
}

function pieChartHtml(title, entries) {
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  let acc = 0;
  const slices = entries.map(([, v], i) => {
    const start = (acc / total) * 360;
    acc += v;
    const end = (acc / total) * 360;
    return `${PALETTE[i % PALETTE.length]} ${start}deg ${end}deg`;
  });

  const legend = entries
    .map(([k, v], i) => `<div class="legend-item"><span class="legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>${truncate(k, 14)} · ${v}</div>`)
    .join("");

  return `
    <div class="chart-card">
      <h3>${title}</h3>
      <div class="pie-wrap">
        <div class="pie" style="background: conic-gradient(${slices.join(",")});"></div>
        <div class="legend">${legend || "<div class='legend-item'>暂无数据</div>"}</div>
      </div>
    </div>
  `;
}

function barChartHtml(title, entries, valueFmt = (v) => String(v)) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const rows = entries
    .map(([k, v]) => {
      const w = Math.max(2, Math.round((v / max) * 100));
      return `<div class="bar-row"><div>${truncate(k, 12)}</div><div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div><div>${valueFmt(v)}</div></div>`;
    })
    .join("");

  return `<div class="chart-card"><h3>${title}</h3><div class="bars">${rows || "暂无数据"}</div></div>`;
}

function priceBuckets(rows) {
  const buckets = [
    ["0-50", 0],
    ["50-100", 0],
    ["100-300", 0],
    ["300-500", 0],
    ["500+", 0]
  ];
  for (const r of rows) {
    const p = parsePrice(r.price);
    if (p === null) continue;
    if (p < 50) buckets[0][1] += 1;
    else if (p < 100) buckets[1][1] += 1;
    else if (p < 300) buckets[2][1] += 1;
    else if (p < 500) buckets[3][1] += 1;
    else buckets[4][1] += 1;
  }
  return buckets;
}

function salesBuckets(rows) {
  const buckets = [
    ["<100", 0],
    ["100-1k", 0],
    ["1k-10k", 0],
    ["10k+", 0]
  ];
  for (const r of rows) {
    const s = parseSales(r.sales);
    if (s === null) continue;
    if (s < 100) buckets[0][1] += 1;
    else if (s < 1000) buckets[1][1] += 1;
    else if (s < 10000) buckets[2][1] += 1;
    else buckets[3][1] += 1;
  }
  return buckets;
}

function renderAnalysisCharts() {
  const rows = rowsForAnalysis();
  const root = byId("analysisCharts");

  if (ui.activeAnalysis === "compare") {
    const byPlatform = groupedCount(rows, (r) => r.platform).slice(0, 8);
    const avgPriceByPlatform = ["taobao", "jd"].map((p) => {
      const ps = rows.filter((r) => r.platform === p).map((r) => parsePrice(r.price)).filter((n) => n !== null);
      const avg = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
      return [p, Number(avg.toFixed(2))];
    });
    const salesByPlatform = ["taobao", "jd"].map((p) => {
      const ss = rows.filter((r) => r.platform === p).map((r) => parseSales(r.sales)).filter((n) => n !== null);
      const sum = ss.length ? ss.reduce((a, b) => a + b, 0) : 0;
      return [p, sum];
    });
    const topShops = groupedCount(rows, (r) => `${r.platform || "?"} · ${r.shop || "未知店铺"}`).slice(0, 8);

    root.innerHTML = [
      pieChartHtml("平台占比", byPlatform),
      barChartHtml("平台均价", avgPriceByPlatform, (v) => `¥${v}`),
      barChartHtml("平台总销量", salesByPlatform, (v) => formatNum(v)),
      barChartHtml("店铺结果数Top", topShops)
    ].join("");
    return;
  }

  const topShopsByCount = groupedCount(rows, (r) => r.shop || "未知店铺").slice(0, 8);
  const topShopsBySales = groupedSum(rows, (r) => r.shop || "未知店铺", (r) => parseSales(r.sales) || 0).slice(0, 8);
  const prices = priceBuckets(rows);
  const sales = salesBuckets(rows);

  root.innerHTML = [
    pieChartHtml("店铺占比Top", topShopsByCount),
    barChartHtml("店铺销量Top", topShopsBySales, (v) => formatNum(v)),
    barChartHtml("价格分布", prices),
    barChartHtml("销量分布", sales)
  ].join("");
}

function renderActiveRunText() {
  const runRows = currentRowsByRun();
  const modeMap = {
    summary: "汇总",
    taobao: "淘宝",
    jd: "京东",
    compare: "对比"
  };
  const runName = ui.activeRunId === "all" ? "全部任务" : (runRows[0]?.keyword || ui.activeRunId);
  byId("activeRunText").textContent = `当前：${runName} · ${modeMap[ui.activeAnalysis]}`;
}

function renderTable() {
  const rows = rowsForAnalysis();
  const body = byId("resultBody");
  body.innerHTML = "";

  const sorted = [...rows].sort((a, b) => {
    const pa = parsePrice(a.price) ?? Number.POSITIVE_INFINITY;
    const pb = parsePrice(b.price) ?? Number.POSITIVE_INFINITY;
    return pa - pb;
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

  byId("tableHint").textContent = `已按价格升序 · ${rows.length} 条`;
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
  const rows = rowsForAnalysis();
  const csv = toCsv(rows);
  const encoding = byId("csvEncoding").value;
  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;

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
  const rows = rowsForAnalysis();
  const headers = ["runId", "keyword", "platform", "title", "price", "sales", "shop", "link", "capturedAt"];
  const trs = rows.map((row) => `<tr>${headers.map((h) => `<td>${String(row[h] ?? "").replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset=\"UTF-8\"></head><body><table border=\"1\"><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>${trs}</table></body></html>`;
  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;
  downloadBlob(`compare-${runTag}.xls`, new Blob(["\uFEFF", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  setStatus(`已导出 Excel（${rows.length} 条）`);
}

function exportJson() {
  const rows = rowsForAnalysis();
  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;
  downloadBlob(`compare-${runTag}.json`, new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
  setStatus(`已导出 JSON（${rows.length} 条）`);
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

async function saveSettings(partial) {
  const prev = await loadSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...prev, ...partial } });
}

function setAnalysisButtons() {
  const root = byId("analysisNav");
  const buttons = Array.from(root.querySelectorAll(".nav-btn"));
  for (const btn of buttons) {
    btn.classList.toggle("active", btn.dataset.view === ui.activeAnalysis);
  }
}

function renderAll() {
  setAnalysisButtons();
  renderRunList();
  renderActiveRunText();
  renderStats(rowsForAnalysis());
  renderAnalysisCharts();
  renderTable();
}

async function refreshData() {
  const data = await chrome.storage.local.get(SCRAPED_DATA_KEY);
  ui.allRows = data[SCRAPED_DATA_KEY] || [];
  renderAll();
  setStatus(`已加载 ${ui.allRows.length} 条数据`);
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
  ui.activeAnalysis = "summary";
  renderAll();
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

  const navButtons = Array.from(byId("analysisNav").querySelectorAll(".nav-btn"));
  for (const btn of navButtons) {
    btn.addEventListener("click", () => {
      ui.activeAnalysis = btn.dataset.view;
      renderAll();
    });
  }

  await refreshData();
}

init().catch((err) => {
  setStatus(`初始化失败：${String(err)}`);
});
