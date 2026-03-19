const SCRAPED_DATA_KEY = "assistiveBotScrapedData";
const SETTINGS_KEY = "assistiveBotSettings";
const LOGS_KEY = "assistiveBotErrorLogs";

const ui = {
  rawRows: [],
  activeRunId: "all",
  activeAnalysis: "summary",
  activeJump: "panelTask",
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
  darkMode: false,
  trendRangeDays: 14,
  schedule: {
    enabled: false,
    keyword: "",
    maxPages: 2,
    intervalMinutes: 60,
    intervalMs: 4000,
    enableSpeech: false
  },
  scheduleLastRun: null
  ,
  logs: []
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

function cleanShopName(v) {
  let s = String(v || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^\d+\s*年老店/g, "").trim();
  s = s.replace(/^(老店|品牌店|品质店|严选店|企业店|官方店|旗舰店|专营店)/g, "").trim();
  s = s.replace(/[【】\[\]()（）]/g, "").trim();
  return s;
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

function logLevelLabel(level) {
  if (level === "error") return "错误";
  if (level === "warn") return "警告";
  return "信息";
}

function sanitizeRows(rows) {
  return rows.map((row) => {
    const priceNum = parsePrice(row.price);
    const salesNum = parseSales(row.sales);
    const shop = cleanShopName(row.shop || "") || "未知店铺";
    const titleNorm = normalizeTitle(row.title || "");
    const productKey = `${row.platform || "unknown"}|${titleNorm.slice(0, 60)}`;
    return {
      ...row,
      _price: priceNum,
      _sales: salesNum,
      _shop: shop,
      _titleNorm: titleNorm,
      _productKey: productKey
    };
  });
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

function renderRunList() {
  const root = byId("runList");
  root.innerHTML = "";

  const allBtn = document.createElement("div");
  allBtn.className = `run-item ${ui.activeRunId === "all" ? "active" : ""}`;
  allBtn.innerHTML = `<div class="name">全部任务</div><div class="meta">${ui.rawRows.length} 条</div>`;
  allBtn.onclick = () => {
    ui.activeRunId = "all";
    renderAll();
  };
  root.appendChild(allBtn);

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
}

function filteredRowsBase() {
  const rows = rowsByRun();
  const minSales = Number(ui.filters.minSales || "");
  const minPrice = Number(ui.filters.minPrice || "");
  const maxPrice = Number(ui.filters.maxPrice || "");

  return rows.filter((row) => {
    if (ui.filters.platform && ui.filters.platform !== "all" && row.platform !== ui.filters.platform) return false;
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
    map.set(key, {
      ...keep,
      _variants: (old._variants || 1) + 1,
      _sales: Math.max(old._sales || 0, row._sales || 0)
    });
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

function rowsForTable() {
  let rows = filteredRowsBase();
  if (ui.activeAnalysis === "taobao") rows = rows.filter((r) => r.platform === "taobao");
  if (ui.activeAnalysis === "jd") rows = rows.filter((r) => r.platform === "jd");

  const mode = ui.filters.sortMode || "price_asc";
  return [...rows].sort((a, b) => {
    if (mode === "price_desc") return (b._price ?? -1) - (a._price ?? -1);
    if (mode === "sales_desc") return (b._sales ?? -1) - (a._sales ?? -1);
    if (mode === "time_desc") return (b.capturedAt || "").localeCompare(a.capturedAt || "");
    return (a._price ?? Number.POSITIVE_INFINITY) - (b._price ?? Number.POSITIVE_INFINITY);
  });
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
  const step = points.length > 1 ? (width / (points.length - 1)) : 0;
  return points
    .map((v, i) => {
      const x = i * step;
      const y = maxY > 0 ? (height - (v / maxY) * height) : height;
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
    const x = series.length > 1 ? (i * (w / (series.length - 1))) : 0;
    const y = h - (v / maxPrice) * h;
    return `<circle class="point-price" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" />`;
  }).join("");

  const pointsSales = sales.map((v, i) => {
    const x = series.length > 1 ? (i * (w / (series.length - 1))) : 0;
    const y = h - (v / maxSales) * h;
    return `<circle class="point-sales" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" />`;
  }).join("");

  const labels = series.filter((_, i) => i === 0 || i === series.length - 1 || i % Math.max(1, Math.floor(series.length / 4)) === 0)
    .map((x, i) => `<span>${x.date.slice(5)}</span>`)
    .join("<span> </span>");

  return `
    <div class="chart-card">
      <h3>历史趋势（价格均值/销量总和）</h3>
      <div class="legend-mini"><span>绿色：均价</span><span>蓝色：销量</span></div>
      <div class="line-chart-wrap">
        <svg class="line-chart-svg" viewBox="0 0 ${w} 170" preserveAspectRatio="none">
          <line class="axis-line" x1="0" y1="130" x2="${w}" y2="130" />
          <line class="grid-line" x1="0" y1="65" x2="${w}" y2="65" />
          <path class="line-price" d="${pricePath}" />
          <path class="line-sales" d="${salesPath}" />
          ${pointsPrice}
          ${pointsSales}
        </svg>
      </div>
      <div class="legend-mini">${labels}</div>
    </div>
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

    root.innerHTML = [
      trend,
      pieChartHtml("平台占比", byPlatform),
      barChartHtml("平台均价", avgPriceByPlatform, (v) => `¥${v}`),
      barChartHtml("平台总销量", salesByPlatform, (v) => formatNum(v)),
      barChartHtml("平台价格分布", priceBuckets(rows))
    ].join("");
    return;
  }

  const topShopsByCount = groupedCount(rows, (r) => r._shop || "未知店铺").slice(0, 8);
  const topShopsBySales = groupedSum(rows, (r) => r._shop || "未知店铺", (r) => r._sales || 0).slice(0, 8);

  root.innerHTML = [
    trend,
    pieChartHtml("店铺占比Top", topShopsByCount),
    barChartHtml("店铺销量Top", topShopsBySales, (v) => formatNum(v)),
    barChartHtml("价格分布", priceBuckets(rows)),
    barChartHtml("销量分布", salesBuckets(rows))
  ].join("");
}

function renderActiveRunText() {
  const runRows = rowsByRun();
  const modeMap = { summary: "汇总", taobao: "淘宝", jd: "京东", compare: "对比" };
  const runName = ui.activeRunId === "all" ? "全部任务" : (runRows[0]?.keyword || ui.activeRunId);
  byId("activeRunText").textContent = `当前：${runName} · ${modeMap[ui.activeAnalysis]} · 已筛选 ${rowsForTable().length} 条`;
}

function renderTable() {
  const rows = rowsForTable();
  const body = byId("resultBody");
  body.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7">暂无结果，请调整筛选条件或先执行采集。</td>`;
    body.appendChild(tr);
    byId("tableHint").textContent = "当前无匹配结果";
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    const safeTitle = (row.title || "").replace(/"/g, "&quot;");
    tr.innerHTML = `
      <td>${row.platform || "-"}</td>
      <td title="${safeTitle}">${truncate(row.title || "-")}</td>
      <td>${Number.isFinite(row._price) ? `¥${row._price}` : "-"}</td>
      <td>${Number.isFinite(row._sales) ? formatNum(row._sales) : (row.sales || "-")}</td>
      <td>${truncate(row._shop || "-")}</td>
      <td>${row.link ? `<a href="${row.link}" target="_blank" rel="noreferrer">打开</a>` : "-"}</td>
      <td>${row.capturedAt ? new Date(row.capturedAt).toLocaleString() : "-"}</td>
    `;
    body.appendChild(tr);
  }

  byId("tableHint").textContent = `排序：${ui.filters.sortMode} · ${rows.length} 条`;
}

function toCsv(rows) {
  const headers = ["runId", "keyword", "platform", "title", "price", "sales", "shop", "link", "capturedAt"];
  const escapeCell = (v) => {
    const s = String(v ?? "").replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => escapeCell(row[h])).join(","));
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
  const rows = rowsForTable();
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
  const rows = rowsForTable();
  const headers = ["runId", "keyword", "platform", "title", "price", "sales", "shop", "link", "capturedAt"];
  const trs = rows.map((row) => `<tr>${headers.map((h) => `<td>${String(row[h] ?? "").replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset=\"UTF-8\"></head><body><table border=\"1\"><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>${trs}</table></body></html>`;
  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;
  downloadBlob(`compare-${runTag}.xls`, new Blob(["\uFEFF", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  setStatus(`已导出 Excel（${rows.length} 条）`);
}

function exportJson() {
  const rows = rowsForTable();
  const runTag = ui.activeRunId === "all" ? "all" : ui.activeRunId;
  downloadBlob(`compare-${runTag}.json`, new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
  setStatus(`已导出 JSON（${rows.length} 条）`);
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
  downloadBlob(`compare-${runTag}.analysis-report.html`, new Blob(["\uFEFF", html], { type: "text/html;charset=utf-8" }));
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

function setAnalysisButtons() {
  const buttons = Array.from(byId("analysisNav").querySelectorAll(".nav-btn"));
  for (const btn of buttons) btn.classList.toggle("active", btn.dataset.view === ui.activeAnalysis);
}

function setQuickNavButtons() {
  const buttons = Array.from(document.querySelectorAll('.quick-nav .nav-btn'));
  for (const btn of buttons) btn.classList.toggle("active", btn.dataset.jump === ui.activeJump);
}

function applyTheme() {
  document.body.setAttribute("data-theme", ui.darkMode ? "dark" : "light");
  byId("darkMode").checked = ui.darkMode;
}

function renderSavedViews() {
  const sel = byId("savedViewSelect");
  const names = Object.keys(ui.savedViews).sort((a, b) => a.localeCompare(b, "zh-CN"));
  sel.innerHTML = `<option value="">请选择</option>${names.map((n) => `<option value="${n}">${n}</option>`).join("")}`;
}

function applyScheduleToUI() {
  byId("scheduleEnabled").checked = Boolean(ui.schedule.enabled);
  byId("scheduleKeyword").value = ui.schedule.keyword || "";
  byId("schedulePages").value = ui.schedule.maxPages || 2;
  byId("scheduleIntervalMinutes").value = ui.schedule.intervalMinutes || 60;
  byId("scheduleIntervalMs").value = ui.schedule.intervalMs || 4000;
  byId("scheduleSpeech").checked = Boolean(ui.schedule.enableSpeech);
}

function collectScheduleFromUI() {
  ui.schedule = {
    enabled: byId("scheduleEnabled").checked,
    keyword: byId("scheduleKeyword").value.trim(),
    maxPages: Math.max(1, Number(byId("schedulePages").value || 2)),
    intervalMinutes: Math.max(1, Number(byId("scheduleIntervalMinutes").value || 60)),
    intervalMs: Math.max(1000, Number(byId("scheduleIntervalMs").value || 4000)),
    enableSpeech: byId("scheduleSpeech").checked
  };
}

function renderScheduleStatus() {
  const txt = [];
  txt.push(ui.schedule.enabled ? "已开启" : "未开启");
  if (ui.schedule.enabled) txt.push(`每${ui.schedule.intervalMinutes}分钟`);
  if (ui.schedule.keyword) txt.push(`关键词:${ui.schedule.keyword}`);
  if (ui.scheduleLastRun?.at) {
    const at = new Date(ui.scheduleLastRun.at).toLocaleString();
    txt.push(`上次:${ui.scheduleLastRun.status || "-"} @ ${at}`);
  }
  byId("scheduleStatus").textContent = `定时状态：${txt.join(" · ")}`;
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
  const statsRoot = byId("logStats");
  const body = byId("logBody");
  if (!statsRoot || !body) return;

  const logs = [...ui.logs].sort((a, b) => (b.at || 0) - (a.at || 0));
  const total = logs.length;
  const errorCount = logs.filter((x) => x.level === "error").length;
  const warnCount = logs.filter((x) => x.level === "warn").length;
  const infoCount = logs.filter((x) => x.level === "info").length;
  const sourceCount = new Set(logs.map((x) => x.source || "unknown")).size;

  statsRoot.innerHTML = `
    <div><span>${total}</span><small>日志总数</small></div>
    <div><span>${errorCount}</span><small>错误</small></div>
    <div><span>${warnCount}</span><small>警告</small></div>
    <div><span>${infoCount}</span><small>信息</small></div>
    <div><span>${sourceCount}</span><small>来源数</small></div>
  `;

  body.innerHTML = "";
  if (!logs.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">暂无日志</td>`;
    body.appendChild(tr);
    return;
  }

  for (const log of logs.slice(0, 300)) {
    const tr = document.createElement("tr");
    const at = log.at ? new Date(log.at).toLocaleString() : "-";
    const msg = truncate(String(log.message || "-"), 120);
    tr.innerHTML = `
      <td>${at}</td>
      <td>${logLevelLabel(log.level)}</td>
      <td>${log.source || "-"}</td>
      <td>${log.code || "-"}</td>
      <td title="${String(log.message || "").replace(/"/g, "&quot;")}">${msg}</td>
    `;
    body.appendChild(tr);
  }
}

function renderAll() {
  setAnalysisButtons();
  setQuickNavButtons();
  renderRunList();
  renderActiveRunText();
  renderStats(rowsForAnalysis());
  renderAnalysisCharts();
  renderTable();
  renderScheduleStatus();
  renderLogs();
}

async function refreshData() {
  const data = await chrome.storage.local.get(SCRAPED_DATA_KEY);
  ui.rawRows = data[SCRAPED_DATA_KEY] || [];
  renderAll();
  setStatus(`已加载 ${ui.rawRows.length} 条数据`);
}

async function refreshScheduleFromBackground() {
  const res = await chrome.runtime.sendMessage({ type: "BOT_GET_SCHEDULE" });
  if (!res?.ok) return;
  ui.schedule = {
    ...ui.schedule,
    ...(res.scheduleConfig || {})
  };
  ui.scheduleLastRun = res.scheduleLastRun || null;
  applyScheduleToUI();
  renderScheduleStatus();
}

async function saveSchedule() {
  collectScheduleFromUI();
  if (ui.schedule.enabled && !ui.schedule.keyword) {
    setStatus("请填写定时关键词后再开启");
    return;
  }

  const res = await chrome.runtime.sendMessage({ type: "BOT_SET_SCHEDULE", payload: ui.schedule });
  if (!res?.ok) {
    setStatus(`定时配置保存失败：${res?.error || "未知错误"}`);
    return;
  }

  await saveSettings({ scheduleConfig: ui.schedule });
  ui.scheduleLastRun = null;
  renderScheduleStatus();
  setStatus(ui.schedule.enabled ? "定时任务已开启并生效" : "定时任务已关闭");
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

async function applyFiltersAndPersist() {
  collectFiltersFromUI();
  await saveSettings({ dashboardFilters: ui.filters });
  renderAll();
}

async function resetFilters() {
  ui.filters = {
    platform: "all",
    shop: "",
    title: "",
    minSales: "",
    minPrice: "",
    maxPrice: "",
    sortMode: "price_asc"
  };
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
  ui.savedViews[name] = {
    filters: { ...ui.filters },
    analysis: ui.activeAnalysis,
    mergeSimilar: ui.mergeSimilar,
    trendRangeDays: ui.trendRangeDays
  };
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
  byId("trendRangeDays").value = String(ui.trendRangeDays);
  byId("mergeSimilar").checked = ui.mergeSimilar;
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

async function setDarkMode(enabled) {
  ui.darkMode = Boolean(enabled);
  applyTheme();
  await saveSettings({ dashboardDarkMode: ui.darkMode });
}

async function setMergeSimilar(enabled) {
  ui.mergeSimilar = Boolean(enabled);
  await saveSettings({ mergeSimilar: ui.mergeSimilar });
  renderAll();
}

async function setTrendRangeDays(v) {
  ui.trendRangeDays = Math.max(1, Number(v) || 14);
  await saveSettings({ trendRangeDays: ui.trendRangeDays });
  renderAll();
}

function bindEvents() {
  byId("startBtn").addEventListener("click", startCompare);
  byId("stopBtn").addEventListener("click", stopAll);
  byId("refreshBtn").addEventListener("click", refreshData);
  byId("clearBtn").addEventListener("click", clearData);
  byId("exportJsonBtn").addEventListener("click", exportJson);
  byId("exportCsvBtn").addEventListener("click", exportCsv);
  byId("exportExcelBtn").addEventListener("click", exportExcel);
  byId("exportReportBtn").addEventListener("click", exportAnalysisReport);

  byId("applyFilterBtn").addEventListener("click", applyFiltersAndPersist);
  byId("resetFilterBtn").addEventListener("click", resetFilters);
  byId("saveViewBtn").addEventListener("click", saveView);
  byId("applyViewBtn").addEventListener("click", applyView);
  byId("deleteViewBtn").addEventListener("click", deleteView);

  byId("saveScheduleBtn").addEventListener("click", saveSchedule);
  byId("runScheduleNowBtn").addEventListener("click", runScheduleNow);
  byId("refreshLogsBtn").addEventListener("click", refreshLogs);
  byId("clearLogsBtn").addEventListener("click", clearLogs);

  byId("darkMode").addEventListener("change", (e) => setDarkMode(e.target.checked));
  byId("mergeSimilar").addEventListener("change", (e) => setMergeSimilar(e.target.checked));
  byId("trendRangeDays").addEventListener("change", (e) => setTrendRangeDays(e.target.value));

  const navButtons = Array.from(byId("analysisNav").querySelectorAll(".nav-btn"));
  for (const btn of navButtons) {
    btn.addEventListener("click", () => {
      ui.activeAnalysis = btn.dataset.view;
      renderAll();
    });
  }

  const jumpButtons = Array.from(document.querySelectorAll('.quick-nav .nav-btn'));
  for (const btn of jumpButtons) {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.jump;
      const target = byId(targetId);
      ui.activeJump = targetId;
      setQuickNavButtons();
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

async function init() {
  const settings = await loadSettings();

  byId("keyword").value = settings.compareKeyword || "";
  byId("pages").value = settings.comparePages || 2;
  byId("intervalMs").value = settings.intervalMs || 4000;
  byId("speech").checked = Boolean(settings.enableSpeech);

  ui.filters = { ...ui.filters, ...(settings.dashboardFilters || {}) };
  ui.savedViews = settings.dashboardSavedViews || {};
  ui.mergeSimilar = settings.mergeSimilar !== false;
  ui.darkMode = Boolean(settings.dashboardDarkMode);
  ui.trendRangeDays = Math.max(1, Number(settings.trendRangeDays || 14));

  applyFiltersToUI();
  byId("mergeSimilar").checked = ui.mergeSimilar;
  byId("trendRangeDays").value = String(ui.trendRangeDays);
  applyTheme();
  renderSavedViews();

  bindEvents();
  await refreshScheduleFromBackground();
  await refreshLogs();
  await refreshData();
}

init().catch((err) => {
  setStatus(`初始化失败：${String(err)}`);
});
