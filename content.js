const SCRAPED_DATA_KEY = "assistiveBotScrapedData";

const state = {
  running: false,
  config: null,
  timerId: null,
  iterations: 0,
  announcedStart: false,
  compareCurrentPage: 1,
  compareLastProcessedUrl: "",
  compareEmptyRetry: 0
};

function announce(message) {
  if (!("speechSynthesis" in window)) {
    return;
  }
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
  } catch (_) {
    // Ignore speech errors in pages that block autoplay-style features.
  }
}

function parsePrice(text) {
  const match = (text || "").replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  return match ? match[0] : "";
}

function textFromSelectors(root, selectors) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function getPlatformFromHost() {
  const host = location.hostname;
  if (host.includes("taobao.com")) {
    return "taobao";
  }
  if (host.includes("jd.com")) {
    return "jd";
  }
  return "unknown";
}

function dedupeByLink(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.link) {
      continue;
    }
    if (!map.has(item.link)) {
      map.set(item.link, item);
    }
  }
  return Array.from(map.values());
}

function normalizeProductLink(rawHref) {
  try {
    const url = new URL(rawHref, location.href);
    const blocked = [
      "spm",
      "ali_trackid",
      "scm",
      "initiative_id",
      "from",
      "sourceType",
      "abbucket",
      "union_lens"
    ];
    for (const key of blocked) {
      url.searchParams.delete(key);
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch (_) {
    return rawHref || "";
  }
}

function scrapeTaobao(keyword, page) {
  const links = Array.from(
    document.querySelectorAll(
      [
        'a[href*="item.taobao.com/item.htm"]',
        'a[href*="detail.tmall.com/item.htm"]',
        'a[href*="detail.tmall.hk/hk/item.htm"]',
        'a[href*="world.taobao.com/item/"]'
      ].join(",")
    )
  );

  const records = links
    .map((anchor) => {
      const link = normalizeProductLink(anchor.href);
      if (!link || link.includes("click.simba.taobao.com")) {
        return null;
      }

      const container =
        anchor.closest('[data-name="item"]') ||
        anchor.closest("li") ||
        anchor.closest('div[class*="Card"]') ||
        anchor.closest("div") ||
        anchor;

      const text = (container.innerText || "").replace(/\s+/g, " ").trim();
      const title =
        (anchor.getAttribute("title") || "").trim() ||
        textFromSelectors(container, [
          '[class*="title"]',
          "h3",
          'a[data-spm-anchor-id*="title"]'
        ]) ||
        (anchor.innerText || "").replace(/\s+/g, " ").trim();

      if (!title || title.length < 4) {
        return null;
      }

      const priceText =
        textFromSelectors(container, [
          '[class*="Price--priceInt"]',
          '[class*="priceInt"]',
          '[class*="price"]'
        ]) || parsePrice(text);

      const shop =
        textFromSelectors(container, [
          '[class*="ShopInfo"] a',
          '[class*="shop"] a',
          '[class*="seller"] a'
        ]) || "";

      return {
        keyword,
        platform: "taobao",
        page,
        title,
        price: parsePrice(priceText || text),
        shop,
        link,
        capturedAt: new Date().toISOString()
      };
    })
    .filter(Boolean);
  return dedupeByLink(records);
}

function scrapeJd(keyword, page) {
  const cardNodes = Array.from(
    document.querySelectorAll(
      [
        ".plugin_goodsCardWrapper[data-sku]",
        '[class*="goodsCardWrapper"][data-sku]'
      ].join(",")
    )
  );

  if (cardNodes.length > 0) {
    const recordsFromCards = cardNodes
      .map((card) => {
        const sku = (card.getAttribute("data-sku") || "").trim();
        if (!sku) {
          return null;
        }

        const title =
          textFromSelectors(card, [
            'span[class*="_text_"][title]',
            '[class*="goods_title"] [title]',
            '[class*="title"] [title]'
          ]) ||
          "";
        if (!title || title.length < 2) {
          return null;
        }

        const priceText =
          textFromSelectors(card, [
            '[class*="_price_"]',
            ".p-price i",
            '[class*="price"]'
          ]) || "";
        const shop =
          textFromSelectors(card, [
            '[class*="_name_"] span',
            '[class*="shopFloor"] [class*="name"] span',
            '[class*="shop"] a'
          ]) || "";

        return {
          keyword,
          platform: "jd",
          page,
          title,
          price: parsePrice(priceText),
          shop,
          link: `https://item.jd.com/${sku}.html`,
          capturedAt: new Date().toISOString()
        };
      })
      .filter(Boolean);

    return dedupeByLink(recordsFromCards);
  }

  const links = Array.from(
    document.querySelectorAll(
      [
        'a[href*="item.jd.com/"]',
        'a[href*="//item.jd.com/"]',
        'a[href*="item.m.jd.com/product/"]'
      ].join(",")
    )
  );

  const records = links
    .map((anchor) => {
      const rawHref = anchor.getAttribute("href") || anchor.href || "";
      if (!rawHref || rawHref.includes("ccc-x.jd.com") || rawHref.includes("pro.m.jd.com")) {
        return null;
      }
      const link = normalizeProductLink(
        rawHref.startsWith("//") ? `https:${rawHref}` : rawHref
      );
      if (!link.includes("item.jd.com") && !link.includes("item.m.jd.com")) {
        return null;
      }

      const container =
        anchor.closest("li.gl-item") ||
        anchor.closest('[class*="goodsItem"]') ||
        anchor.closest('[class*="GoodsItem"]') ||
        anchor.closest("li") ||
        anchor.closest("div") ||
        anchor;
      const text = (container.innerText || "").replace(/\s+/g, " ").trim();
      const title =
        (anchor.getAttribute("title") || "").trim() ||
        textFromSelectors(container, [
          ".p-name em",
          '[class*="title"]',
          "h3"
        ]) ||
        (anchor.innerText || "").replace(/\s+/g, " ").trim();
      if (!title || title.length < 4) {
        return null;
      }

      const priceText =
        textFromSelectors(container, [
          ".p-price i",
          '[class*="price"]',
          '[class*="Price"]'
        ]) || parsePrice(text);

      const shop =
        textFromSelectors(container, [
          ".p-shop a",
          ".curr-shop",
          ".shopName",
          '[class*="shop"] a'
        ]) || "";

      return {
        keyword,
        platform: "jd",
        page,
        title,
        price: parsePrice(priceText || text),
        shop,
        link,
        capturedAt: new Date().toISOString()
      };
    })
    .filter(Boolean);
  return dedupeByLink(records);
}

async function storeRecords(records) {
  if (!records.length) {
    return;
  }
  const existing = await chrome.storage.local.get(SCRAPED_DATA_KEY);
  const list = existing[SCRAPED_DATA_KEY] || [];

  function makeKey(record) {
    if (record.link) {
      return `${record.platform || ""}|${record.keyword || ""}|${record.link}`;
    }
    return `${record.url || ""}|${record.title || ""}|${record.capturedAt || ""}`;
  }

  const existingKeys = new Set(
    list.map((r) => makeKey(r))
  );

  for (const record of records) {
    const key = makeKey(record);
    if (existingKeys.has(key)) {
      continue;
    }
    existingKeys.add(key);
    list.push(record);
  }

  await chrome.storage.local.set({ [SCRAPED_DATA_KEY]: list });
}

function getFirstText(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    return "";
  }
  return (el.innerText || el.textContent || "").trim();
}

function getFirstLink(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    return "";
  }
  if (el.href) {
    return el.href;
  }
  const nestedAnchor = el.querySelector("a[href]");
  return nestedAnchor?.href || "";
}

function parseFields(rawText) {
  const lines = (rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map((line) => {
      const idx = line.indexOf("=");
      if (idx <= 0 || idx >= line.length - 1) {
        return null;
      }
      const name = line.slice(0, idx).trim();
      const selector = line.slice(idx + 1).trim();
      if (!name || !selector) {
        return null;
      }
      return { name, selector };
    })
    .filter(Boolean);
}

async function scrapeCurrentPage(config) {
  const fields = parseFields(config.fieldsMapping);
  const data = {
    url: location.href,
    title: document.title,
    capturedAt: new Date().toISOString()
  };

  for (const field of fields) {
    data[field.name] = getFirstText(field.selector);
  }

  if (config.captureLinkSelector) {
    data.capturedLink = getFirstLink(config.captureLinkSelector);
  }

  await storeRecords([data]);
  return data;
}

function tryClick(selector) {
  if (!selector) {
    return false;
  }
  const el = document.querySelector(selector);
  if (!el) {
    return false;
  }
  el.click();
  return true;
}

function getNextSelectorForPlatform(platform) {
  if (platform === "taobao") {
    return [
      ".next-pagination-item.next:not(.next-disabled)",
      ".next-next:not(.next-disabled)",
      "a.next:not(.disabled)",
      "button.next-btn-next:not([disabled])"
    ].join(",");
  }
  if (platform === "jd") {
    return [
      '[class*="_pagination_next_"]:not([class*="_disabled_"])',
      "a.pn-next:not(.disabled)",
      ".pn-next:not(.disabled)",
      '[class*="pagination"] [class*="next"]:not(.disabled)',
      "button.next-btn-next:not([disabled])"
    ].join(",");
  }
  return "";
}

async function reportProgressFromListener(progress) {
  try {
    await chrome.runtime.sendMessage({
      type: "BOT_PROGRESS_UPDATE",
      payload: {
        progress
      }
    });
  } catch (_) {
    // Ignore progress failures.
  }
}

async function runCompareStep() {
  if (!state.running || !state.config) {
    return;
  }

  const platform = state.config.platform || getPlatformFromHost();
  if (platform === "unknown") {
    stopAutomation("当前页面不是支持的比价平台");
    return;
  }

  if (state.compareLastProcessedUrl === location.href) {
    return;
  }

  let records = [];
  if (platform === "taobao") {
    records = scrapeTaobao(state.config.keyword || "", state.compareCurrentPage);
  } else if (platform === "jd") {
    records = scrapeJd(state.config.keyword || "", state.compareCurrentPage);
  }

  if (records.length === 0) {
    state.compareEmptyRetry += 1;
    if (state.compareEmptyRetry <= 3) {
      window.scrollBy({ top: 800, behavior: "smooth" });
      return;
    }
    stopAutomation(`比价结束：${platform} 当前页未采集到商品`);
    return;
  }

  state.compareEmptyRetry = 0;
  state.compareLastProcessedUrl = location.href;

  await storeRecords(records);
  await reportProgressFromListener({
    currentPage: state.compareCurrentPage,
    lastCapturedCount: records.length,
    currentUrl: location.href
  });

  if (state.compareCurrentPage >= Number(state.config.maxPages || 1)) {
    stopAutomation(`比价完成：${platform} 共 ${state.compareCurrentPage} 页`);
    return;
  }

  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });

  const nextSelector = getNextSelectorForPlatform(platform);
  const clicked = tryClick(nextSelector);
  if (!clicked) {
    stopAutomation(`比价结束：${platform} 未找到下一页按钮`);
    return;
  }

  state.compareCurrentPage += 1;
  await reportProgressFromListener({
    currentPage: state.compareCurrentPage,
    currentUrl: location.href
  });
}

async function stepAutomation() {
  if (!state.running || !state.config) {
    return;
  }

  if (state.config.compareMode) {
    await runCompareStep();
    return;
  }

  const cfg = state.config;

  if (cfg.targetClickSelector && state.iterations === 0) {
    tryClick(cfg.targetClickSelector);
  }

  await scrapeCurrentPage(cfg);

  window.scrollBy({
    top: Number(cfg.scrollStep) || 600,
    left: 0,
    behavior: cfg.smoothScroll ? "smooth" : "auto"
  });

  state.iterations += 1;

  const reachedMax = Number(cfg.maxIterations) > 0 && state.iterations >= Number(cfg.maxIterations);
  if (reachedMax) {
    stopAutomation("达到最大执行次数，已停止。");
    return;
  }

  const nearBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 40;
  if (nearBottom && cfg.nextPageSelector) {
    const clicked = tryClick(cfg.nextPageSelector);
    if (clicked && cfg.enableSpeech) {
      announce("已尝试翻到下一页");
    }
  }
}

function startAutomation(config, source = "manual", progress = null) {
  state.running = true;
  state.config = {
    intervalMs: 4000,
    scrollStep: 600,
    maxIterations: 30,
    fieldsMapping: "",
    targetClickSelector: "",
    nextPageSelector: "",
    captureLinkSelector: "",
    smoothScroll: true,
    enableSpeech: false,
    compareMode: false,
    platform: "",
    keyword: "",
    maxPages: 1,
    ...config
  };
  state.iterations = 0;
  state.compareLastProcessedUrl = "";
  state.compareEmptyRetry = 0;
  state.compareCurrentPage = Math.max(1, Number(progress?.currentPage) || 1);

  if (state.timerId) {
    clearInterval(state.timerId);
  }

  state.timerId = setInterval(() => {
    stepAutomation().catch(() => {});
  }, Math.max(800, Number(state.config.intervalMs) || 4000));

  stepAutomation().catch(() => {});

  if (state.config.enableSpeech && (!state.announcedStart || source === "manual")) {
    announce("自动浏览机器人已启动");
    state.announcedStart = true;
  }
}

function stopAutomation(reason = "已停止自动浏览") {
  state.running = false;
  state.config = null;
  state.iterations = 0;
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  announce(reason);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void sender;

  if (message?.type === "BOT_START") {
    startAutomation(message.payload?.config || {}, "manual", null);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "BOT_STOP") {
    stopAutomation("已手动停止");
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "BOT_STATUS") {
    sendResponse({
      ok: true,
      running: state.running,
      iterations: state.iterations,
      compareCurrentPage: state.compareCurrentPage,
      url: location.href
    });
    return;
  }

  if (message?.type === "BOT_RESUME_ON_NAVIGATION") {
    startAutomation(
      message.payload?.config || {},
      "resume",
      message.payload?.progress || null
    );
    sendResponse({ ok: true });
    return;
  }
});
