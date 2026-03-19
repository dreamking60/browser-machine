const SCRAPED_DATA_KEY = "assistiveBotScrapedData";
const SETTINGS_KEY = "assistiveBotSettings";
const LOGS_KEY = "assistiveBotErrorLogs";

const ui = {
  rawRows: [],
  logs: [],
  activeRunId: "all",
  activeAnalysis: "summary",
  filters: {
    platform: "all",
    shop: "",
    title: "",
    minSales: "",
    minPrice: "",
    maxPrice: "",
    sortMode: "price_asc"
  },
  savedViews: {},
  mergeSimilar: true,
  trendRangeDays: 14
};

const PALETTE = ["#1b8b5a", "#3ea36f", "#66bb8a", "#8ccfa8", "#afdcc0", "#d1ead9", "#4f7f67", "#7ca88f"];

const byId = (id) => document.getElementById(id);
const setStatus = (text) => (byId("status").textContent = `状态：${text}`);

function parsePrice(v) {
  const n = Number(String(v || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseSales(v) {
  const s = String(v || "").replace(/,/g, "");
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)(万|千)?\+?/);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  if (m[2] === "万") return Math.round(base * 10000);
  if (m[2] === "千") return Math.round(base * 1000);
  return Math.round(base);
}

function toOptionalNumber(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanShopName(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .replace(/^\d+\s*年老店/g, "")
    .replace(/^(老店|品牌店|品质店|严选店|企业店|官方店|旗舰店|专营店)/g, "")
    .trim();
}

function normalizeTitle(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[【】\[\]()（）\-—_·•:：,.，。!！?？'"“”‘’`~|/\\]/g, "")
    .replace(/\s+/g, "")
    .replace(/(包邮|正版|现货|官方|旗舰|店铺|特装|刷边|典藏|精装|平装|新品|京东|淘宝)/g, "");
}

function truncate(v, len = 64) {
  if (!v) return "";
  return v.length > len ? `${v.slice(0, len)}...` : v;
}

function formatNum(n) {
  if (!Number.isFinite(n)) return "-";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(Math.round(n));
}

function sanitizeRows(rows) {
  return rows.map((row) => {
    const _price = parsePrice(row.price);
    const _sales = parseSales(row.sales);
    const _shop = cleanShopName(row.shop || "") || "未知店铺";
    const _titleNorm = normalizeTitle(row.title || "");
    const _productKey = `${row.platform || "unknown"}|${_titleNorm.slice(0, 60)}`;
    return { ...row, _price, _sales, _shop, _titleNorm, _productKey };
  });
}

function getRuns(rows) {
  const map = new Map();
  for (const row of rows) {
    const runId = row.runId || "legacy";
    if (!map.has(runId)) map.set(runId, { runId, keyword: row.keyword || "未命名任务", count: 0, lastAt: row.capturedAt || "" });
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
  all.className = `run-item ${ui.activeRunId === "all" ? "active" : ""}`;
  all.innerHTML = `<div class="name">全部任务</div><div class="meta">${ui.rawRows.length} 条</div>`;
  all.onclick = () => {
    ui.activeRunId = "all";
    renderAll();
  };
  root.appendChild(all);

  for (const run of getRuns(ui.rawRows)) {
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

function rowsByRun() {
  const rows = ui.activeRunId === "all"
    ? ui.rawRows
    : ui.rawRows.filter((r) => (r.runId || "legacy") === ui.activeRunId);
  return sanitizeRows(rows);
}

function collectFiltersFromUI() {
  ui.filters.platform = byId("filterPlatform").value;
  ui.filters.shop = byId("filterShop").value.trim();
  ui.filters.title = byId("filterTitle").value.trim();
  ui.filters.minSales = byId("filterMinSales").value.trim();
  ui.filters.minPrice = byId("filterMinPrice").value.trim();
  ui.filters.maxPrice = byId("filterMaxPrice").value.trim();
  ui.filters.sortMode = byId("sortMode").value;
}

function applyFiltersToUI() {
  byId("filterPlatform").value = ui.filters.platform || "all";
  byId("filterShop").value = ui.filters.shop || "";
  byId("filterTitle").value = ui.filters.title || "";
  byId("filterMinSales").value = ui.filters.minSales || "";
  byId("filterMinPrice").value = ui.filters.minPrice || "";
  byId("filterMaxPrice").value = ui.filters.maxPrice || "";
  byId("sortMode").value = ui.filters.sortMode || "price_asc";
  byId("trendRangeDays").value = String(ui.trendRangeDays || 14);
  byId("mergeSimilar").checked = ui.mergeSimilar;
}

function filteredRowsBase() {
  const rows = rowsByRun();
  const minSales = toOptionalNumber(ui.filters.minSales);
  const minPrice = toOptionalNumber(ui.filters.minPrice);
  const maxPrice = toOptionalNumber(ui.filters.maxPrice);

  return rows.filter((row) => {
    if (ui.filters.platform !== "all" && row.platform !== ui.filters.platform) return false;
    if (ui.filters.shop && !row._shop.toLowerCase().includes(ui.filters.shop.toLowerCase())) return false;
    if (ui.filters.title && !String(row.title || "").toLowerCase().includes(ui.filters.title.toLowerCase())) return false;
    if (Number.isFinite(minSales) && minSales > 0 && (!Number.isFinite(row._sales) || row._sales < minSales)) return false;
    if (Number.isFinite(minPrice) && minPrice >= 0 && (!Number.isFinite(row._price) || row._price < minPrice)) return false;
    if (Number.isFinite(maxPrice) && maxPrice >= 0 && (!Number.isFinite(row._price) || row._price > maxPrice)) return false;
    return true;
  });
}

function mergeByProduct(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row._productKey || `${row.platform}|${row.link || row.title}`;
    if (!map.has(key)) {
      map.set(key, { ...row, _variants: 1 });
      continue;
    }
    const old = map.get(key);
    const oldPrice = Number.isFinite(old._price) ? old._price : Number.POSITIVE_INFINITY;
    const newPrice = Number.isFinite(row._price) ? row._price : Number.POSITIVE_INFINITY;
    const keep = newPrice < oldPrice ? row : old;
    map.set(key, { ...keep, _variants: (old._variants || 1) + 1, _sales: Math.max(old._sales || 0, row._sales || 0) });
  }
  return Array.from(map.values());
}

function rowsForAnalysis() {
  let rows = filteredRowsBase();
  if (ui.activeAnalysis === "taobao") rows = rows.filter((r) => r.platform === "taobao");
  if (ui.activeAnalysis === "jd") rows = rows.filter((r) => r.platform === "jd");
  if (ui.mergeSimilar) rows = mergeByProduct(rows);
  return rows;
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

function priceBuckets(rows) {
  const buckets = [["0-50", 0], ["50-100", 0], ["100-300", 0], ["300-500", 0], ["500+", 0]];
  for (const r of rows) {
    const p = r._price;
    if (!Number.isFinite(p)) continue;
    if (p < 50) buckets[0][1] += 1;
    else if (p < 100) buckets[1][1] += 1;
    else if (p < 300) buckets[2][1] += 1;
    else if (p < 500) buckets[3][1] += 1;
    else buckets[4][1] += 1;
  }
  return buckets;
}

function salesBuckets(rows) {
  const buckets = [["<100", 0], ["100-1k", 0], ["1k-10k", 0], ["10k+", 0]];
  for (const r of rows) {
    const s = r._sales;
    if (!Number.isFinite(s)) continue;
    if (s < 100) buckets[0][1] += 1;
    else if (s < 1000) buckets[1][1] += 1;
    else if (s < 10000) buckets[2][1] += 1;
    else buckets[3][1] += 1;
  }
  return buckets;
}

function seriesByDay(rows, days) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  const map = new Map();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { date: key, prices: [], sales: [] });
  }
  for (const r of rows) {
    const dt = r.capturedAt ? new Date(r.capturedAt) : null;
    if (!dt || Number.isNaN(dt.getTime())) continue;
    const key = dt.toISOString().slice(0, 10);
    if (!map.has(key)) continue;
    const it = map.get(key);
    if (Number.isFinite(r._price)) it.prices.push(r._price);
    if (Number.isFinite(r._sales)) it.sales.push(r._sales);
  }
  return Array.from(map.values()).map((x) => ({
    date: x.date,
    avgPrice: x.prices.length ? x.prices.reduce((a, b) => a + b, 0) / x.prices.length : 0,
    sumSales: x.sales.length ? x.sales.reduce((a, b) => a + b, 0) : 0
  }));
}

function linePath(points, width, height, maxY) {
  if (!points.length) return "";
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return points
    .map((v, i) => {
      const x = i * step;
      const y = maxY > 0 ? height - (v / maxY) * height : height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function trendChartHtml(rows) {
  const days = Math.max(1, Number(ui.trendRangeDays) || 14);
  const series = seriesByDay(rows, days);
  const prices = series.map((x) => x.avgPrice);
  const sales = series.map((x) => x.sumSales);
  const maxPrice = Math.max(1, ...prices);
  const maxSales = Math.max(1, ...sales);
  const w = 520;
  const h = 130;
  const pricePath = linePath(prices, w, h, maxPrice);
  const salesPath = linePath(sales, w, h, maxSales);

  const pointsPrice = prices.map((v, i) => {
    const x = series.length > 1 ? i * (w / (series.length - 1)) : 0;
    const y = h - (v / maxPrice) * h;
    return `<circle class="point-price" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" />`;
  }).join("");

  const pointsSales = sales.map((v, i) => {
    const x = series.length > 1 ? i * (w / (series.length - 1)) : 0;
    const y = h - (v / maxSales) * h;
    return `<circle class="point-sales" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" />`;
  }).join("");

  const labels = series.filter((_, i) => i === 0 || i === series.length - 1 || i % Math.max(1, Math.floor(series.length / 4)) === 0)
    .map((x) => `<span>${x.date.slice(5)}</span>`)
    .join("<span> </span>");

  return `<div class="chart-card"><h3>历史趋势（价格均值/销量总和）</h3><div class="legend-mini"><span>绿色：均价</span><span>蓝色：销量</span></div><div class="line-chart-wrap"><svg class="line-chart-svg" viewBox="0 0 ${w} 170" preserveAspectRatio="none"><line class="axis-line" x1="0" y1="130" x2="${w}" y2="130" /><line class="grid-line" x1="0" y1="65" x2="${w}" y2="65" /><path class="line-price" d="${pricePath}" /><path class="line-sales" d="${salesPath}" />${pointsPrice}${pointsSales}</svg></div><div class="legend-mini">${labels}</div></div>`;
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
  return `<div class="chart-card"><h3>${title}</h3><div class="pie-wrap"><div class="pie" style="background: conic-gradient(${slices.join(",")});"></div><div class="legend">${legend || "<div class='legend-item'>暂无数据</div>"}</div></div></div>`;
}

function barChartHtml(title, entries, valueFmt = (v) => String(v)) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const rows = entries.map(([k, v]) => {
    const w = Math.max(2, Math.round((v / max) * 100));
    return `<div class="bar-row"><div>${truncate(k, 12)}</div><div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div><div>${valueFmt(v)}</div></div>`;
  }).join("");
  return `<div class="chart-card"><h3>${title}</h3><div class="bars">${rows || "暂无数据"}</div></div>`;
}

function renderStats(rows) {
  const total = rows.length;
  const shopCount = new Set(rows.map((r) => r._shop).filter(Boolean)).size;
  const productCount = new Set(rows.map((r) => r._productKey)).size;
  const prices = rows.map((r) => r._price).filter((n) => Number.isFinite(n));
  const sales = rows.map((r) => r._sales).filter((n) => Number.isFinite(n));
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const totalSales = sales.length ? sales.reduce((a, b) => a + b, 0) : null;

  byId("analysisStats").innerHTML = `
    <div><span>${total}</span><small>结果数</small></div>
    <div><span>${productCount}</span><small>同款数</small></div>
    <div><span>${shopCount}</span><small>店铺数</small></div>
    <div><span>${avgPrice ? `¥${avgPrice.toFixed(1)}` : "-"}</span><small>均价</small></div>
    <div><span>${totalSales ? formatNum(totalSales) : "-"}</span><small>总销量(估算)</small></div>
  `;
}

function renderAnalysisCharts() {
  const rows = rowsForAnalysis();
  const root = byId("analysisCharts");
  if (!rows.length) {
    root.innerHTML = `<div class="chart-card"><h3>暂无数据</h3><div class="bars">请先采集或调整筛选条件。</div></div>`;
    return;
  }

  const trend = trendChartHtml(rows);

  if (ui.activeAnalysis === "compare") {
    const byPlatform = groupedCount(rows, (r) => r.platform).slice(0, 8);
    const avgPriceByPlatform = ["taobao", "jd"].map((p) => {
      const ps = rows.filter((r) => r.platform === p).map((r) => r._price).filter((n) => Number.isFinite(n));
      const avg = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
      return [p, Number(avg.toFixed(2))];
    });
    const salesByPlatform = ["taobao", "jd"].map((p) => {
      const ss = rows.filter((r) => r.platform === p).map((r) => r._sales).filter((n) => Number.isFinite(n));
      const sum = ss.length ? ss.reduce((a, b) => a + b, 0) : 0;
      return [p, sum];
    });

    root.innerHTML = [trend, pieChartHtml("平台占比", byPlatform), barChartHtml("平台均价", avgPriceByPlatform, (v) => `¥${v}`), barChartHtml("平台总销量", salesByPlatform, (v) => formatNum(v)), barChartHtml("平台价格分布", priceBuckets(rows))].join("");
    return;
  }

  const topShopsByCount = groupedCount(rows, (r) => r._shop || "未知店铺").slice(0, 8);
  const topShopsBySales = groupedSum(rows, (r) => r._shop || "未知店铺", (r) => r._sales || 0).slice(0, 8);
  root.innerHTML = [trend, pieChartHtml("店铺占比Top", topShopsByCount), barChartHtml("店铺销量Top", topShopsBySales, (v) => formatNum(v)), barChartHtml("价格分布", priceBuckets(rows)), barChartHtml("销量分布", salesBuckets(rows))].join("");
}

function renderActiveRunText() {
  const runRows = rowsByRun();
  const modeMap = { summary: "汇总", taobao: "淘宝", jd: "京东", compare: "对比" };
  const runName = ui.activeRunId === "all" ? "全部任务" : (runRows[0]?.keyword || ui.activeRunId);
  byId("activeRunText").textContent = `当前：${runName} · ${modeMap[ui.activeAnalysis]} · 已筛选 ${rowsForAnalysis().length} 条`;
}

async function refreshLogs() {
  const data = await chrome.storage.local.get(LOGS_KEY);
  ui.logs = data[LOGS_KEY] || [];
  renderLogs();
}

async function clearLogs() {
  await chrome.storage.local.set({ [LOGS_KEY]: [] });
  ui.logs = [];
  renderLogs();
  setStatus("日志已清空");
}

function renderLogs() {
  const logs = [...ui.logs].sort((a, b) => (b.at || 0) - (a.at || 0));
  const total = logs.length;
  const errorCount = logs.filter((x) => x.level === "error").length;
  const warnCount = logs.filter((x) => x.level === "warn").length;
  const infoCount = logs.filter((x) => x.level === "info").length;
  const sourceCount = new Set(logs.map((x) => x.source || "unknown")).size;

  byId("logStats").innerHTML = `
    <div><span>${total}</span><small>日志总数</small></div>
    <div><span>${errorCount}</span><small>错误</small></div>
    <div><span>${warnCount}</span><small>警告</small></div>
    <div><span>${infoCount}</span><small>信息</small></div>
    <div><span>${sourceCount}</span><small>来源数</small></div>
  `;

  const body = byId("logBody");
  body.innerHTML = "";
  if (!logs.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">暂无日志</td>`;
    body.appendChild(tr);
    return;
  }

  for (const log of logs.slice(0, 300)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${log.at ? new Date(log.at).toLocaleString() : "-"}</td>
      <td>${log.level || "-"}</td>
      <td>${log.source || "-"}</td>
      <td>${log.code || "-"}</td>
      <td title="${String(log.message || "").replace(/"/g, "&quot;")}">${truncate(String(log.message || "-"), 120)}</td>
    `;
    body.appendChild(tr);
  }
}

function exportAnalysisReport() {
  const rows = rowsForAnalysis();
  const topShops = groupedCount(rows, (r) => r._shop).slice(0, 10);
  const topSales = groupedSum(rows, (r) => r._shop, (r) => r._sales || 0).slice(0, 10);
  const platform = groupedCount(rows, (r) => r.platform).slice(0, 10);

  const filtersText = JSON.stringify({
    runId: ui.activeRunId,
    analysis: ui.activeAnalysis,
    mergeSimilar: ui.mergeSimilar,
    trendRangeDays: ui.trendRangeDays,
    filters: ui.filters
  }, null, 2);

  const tr = (entries, fmt = (v) => v) => entries.map(([k, v]) => `<tr><td>${k}</td><td>${fmt(v)}</td></tr>`).join("");

  const html = `
  <html><head><meta charset="UTF-8"><title>分析报告</title>
  <style>body{font-family:Arial,sans-serif;padding:20px}table{border-collapse:collapse;margin:10px 0;width:520px}td,th{border:1px solid #ccc;padding:6px}pre{background:#f4f4f4;padding:8px}</style>
  </head><body>
  <h1>比价分析报告</h1>
  <p>生成时间：${new Date().toLocaleString()}</p>
  <h2>筛选配置</h2><pre>${filtersText}</pre>
  <h2>平台分布</h2><table><tr><th>平台</th><th>结果数</th></tr>${tr(platform)}</table>
  <h2>店铺结果数 Top10</h2><table><tr><th>店铺</th><th>结果数</th></tr>${tr(topShops)}</table>
  <h2>店铺销量 Top10</h2><table><tr><th>店铺</th><th>销量</th></tr>${tr(topSales, (v) => formatNum(v))}</table>
  </body></html>`;

  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;
  const blob = new Blob(["\uFEFF", html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `compare-${runTag}.analysis-report.html`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("已导出分析报告");
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

async function saveSettings(partial) {
  const old = await loadSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...old, ...partial } });
}

function renderSavedViews() {
  const sel = byId("savedViewSelect");
  const names = Object.keys(ui.savedViews).sort((a, b) => a.localeCompare(b, "zh-CN"));
  sel.innerHTML = `<option value="">请选择</option>${names.map((n) => `<option value="${n}">${n}</option>`).join("")}`;
}

async function applyFiltersAndPersist() {
  collectFiltersFromUI();
  await saveSettings({ dashboardFilters: ui.filters, trendRangeDays: ui.trendRangeDays, mergeSimilar: ui.mergeSimilar });
  renderAll();
}

async function resetFilters() {
  ui.filters = { platform: "all", shop: "", title: "", minSales: "", minPrice: "", maxPrice: "", sortMode: "price_asc" };
  applyFiltersToUI();
  await saveSettings({ dashboardFilters: ui.filters });
  renderAll();
}

async function saveView() {
  const name = byId("viewName").value.trim();
  if (!name) {
    setStatus("请先输入视图名称");
    return;
  }
  collectFiltersFromUI();
  ui.savedViews[name] = { filters: { ...ui.filters }, analysis: ui.activeAnalysis, mergeSimilar: ui.mergeSimilar, trendRangeDays: ui.trendRangeDays };
  await saveSettings({ dashboardSavedViews: ui.savedViews });
  renderSavedViews();
  byId("savedViewSelect").value = name;
  setStatus(`已保存视图：${name}`);
}

async function applyView() {
  const name = byId("savedViewSelect").value;
  if (!name || !ui.savedViews[name]) {
    setStatus("请选择有效视图");
    return;
  }
  const view = ui.savedViews[name];
  ui.filters = { ...ui.filters, ...(view.filters || {}) };
  ui.activeAnalysis = view.analysis || "summary";
  ui.mergeSimilar = view.mergeSimilar !== false;
  ui.trendRangeDays = Number(view.trendRangeDays || 14);
  applyFiltersToUI();
  await saveSettings({ dashboardFilters: ui.filters, mergeSimilar: ui.mergeSimilar, trendRangeDays: ui.trendRangeDays });
  renderAll();
  setStatus(`已应用视图：${name}`);
}

async function deleteView() {
  const name = byId("savedViewSelect").value;
  if (!name || !ui.savedViews[name]) {
    setStatus("请选择要删除的视图");
    return;
  }
  delete ui.savedViews[name];
  await saveSettings({ dashboardSavedViews: ui.savedViews });
  renderSavedViews();
  setStatus(`已删除视图：${name}`);
}

function renderAll() {
  const buttons = Array.from(byId("analysisNav").querySelectorAll(".nav-btn"));
  for (const btn of buttons) btn.classList.toggle("active", btn.dataset.view === ui.activeAnalysis);

  renderRunList();
  renderActiveRunText();
  renderStats(rowsForAnalysis());
  renderAnalysisCharts();
  renderLogs();
}

async function refreshData() {
  const data = await chrome.storage.local.get(SCRAPED_DATA_KEY);
  ui.rawRows = data[SCRAPED_DATA_KEY] || [];
  renderAll();
  setStatus(`已加载 ${ui.rawRows.length} 条数据`);
}

function bindEvents() {
  byId("applyFilterBtn").addEventListener("click", async () => {
    collectFiltersFromUI();
    ui.mergeSimilar = byId("mergeSimilar").checked;
    ui.trendRangeDays = Math.max(1, Number(byId("trendRangeDays").value || 14));
    await applyFiltersAndPersist();
  });
  byId("resetFilterBtn").addEventListener("click", resetFilters);
  byId("saveViewBtn").addEventListener("click", saveView);
  byId("applyViewBtn").addEventListener("click", applyView);
  byId("deleteViewBtn").addEventListener("click", deleteView);
  byId("exportReportBtn").addEventListener("click", exportAnalysisReport);
  byId("refreshBtn").addEventListener("click", refreshData);
  byId("refreshLogsBtn").addEventListener("click", refreshLogs);
  byId("clearLogsBtn").addEventListener("click", clearLogs);
  byId("trendRangeDays").addEventListener("change", () => {
    ui.trendRangeDays = Math.max(1, Number(byId("trendRangeDays").value || 14));
    saveSettings({ trendRangeDays: ui.trendRangeDays }).catch(() => {});
    renderAll();
  });
  byId("mergeSimilar").addEventListener("change", () => {
    ui.mergeSimilar = byId("mergeSimilar").checked;
    saveSettings({ mergeSimilar: ui.mergeSimilar }).catch(() => {});
    renderAll();
  });

  for (const btn of Array.from(byId("analysisNav").querySelectorAll(".nav-btn"))) {
    btn.addEventListener("click", () => {
      ui.activeAnalysis = btn.dataset.view;
      renderAll();
    });
  }
}

async function init() {
  const settings = await loadSettings();
  ui.filters = { ...ui.filters, ...(settings.dashboardFilters || {}) };
  ui.savedViews = settings.dashboardSavedViews || {};
  ui.mergeSimilar = settings.mergeSimilar !== false;
  ui.trendRangeDays = Math.max(1, Number(settings.trendRangeDays || 14));

  applyFiltersToUI();
  renderSavedViews();
  bindEvents();
  await refreshLogs();
  await refreshData();
}

init().catch((err) => setStatus(`初始化失败：${String(err)}`));
