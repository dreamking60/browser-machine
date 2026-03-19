const RUNNING_TABS_KEY = "assistiveBotRunningTabs";

async function getRunningTabs() {
  const data = await chrome.storage.local.get(RUNNING_TABS_KEY);
  return data[RUNNING_TABS_KEY] || {};
}

async function setRunningTabs(runningTabs) {
  await chrome.storage.local.set({ [RUNNING_TABS_KEY]: runningTabs });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCompareTargets(keyword) {
  const encoded = encodeURIComponent(keyword);
  return [
    {
      platform: "taobao",
      url: `https://s.taobao.com/search?q=${encoded}`
    },
    {
      platform: "jd",
      url: `https://search.jd.com/Search?keyword=${encoded}`
    }
  ];
}

function createRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function registerRunningTab(tabId, config, progress = null) {
  const runningTabs = await getRunningTabs();
  runningTabs[String(tabId)] = {
    running: true,
    config,
    progress: progress || null,
    updatedAt: Date.now()
  };
  await setRunningTabs(runningTabs);
}

async function sendResumeToTabWithRetry(tabId, state, maxRetry = 6) {
  for (let i = 0; i < maxRetry; i += 1) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: "BOT_RESUME_ON_NAVIGATION",
        payload: {
          config: state.config,
          progress: state.progress || null
        }
      });
      if (resp?.ok) {
        return true;
      }
    } catch (_) {
      // Content script may not be ready yet.
    }
    await sleep(900);
  }
  return false;
}

async function stopAllCompareTabs() {
  const runningTabs = await getRunningTabs();
  const entries = Object.entries(runningTabs);

  for (const [tabIdText, state] of entries) {
    const tabId = Number(tabIdText);
    if (!state?.config?.compareMode) {
      continue;
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type: "BOT_STOP" });
    } catch (_) {
      // Ignore tabs that are already gone or not loaded.
    }
    delete runningTabs[tabIdText];
  }

  await setRunningTabs(runningTabs);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BOT_TAB_SET_RUNNING") {
    const { tabId, running, config } = message.payload || {};
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "Invalid tabId" });
      return;
    }

    getRunningTabs()
      .then(async (runningTabs) => {
        if (running) {
          runningTabs[String(tabId)] = {
            running: true,
            config: config || null,
            progress: null,
            updatedAt: Date.now()
          };
        } else {
          delete runningTabs[String(tabId)];
        }
        await setRunningTabs(runningTabs);
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));

    return true;
  }

  if (message?.type === "BOT_START_COMPARE") {
    const keyword = (message.payload?.keyword || "").trim();
    const maxPages = Math.max(1, Number(message.payload?.maxPages) || 3);
    const intervalMs = Math.max(1000, Number(message.payload?.intervalMs) || 4000);
    const enableSpeech = Boolean(message.payload?.enableSpeech);
    const runId = (message.payload?.runId || "").trim() || createRunId();
    const runName = (message.payload?.runName || "").trim() || `${keyword}-${new Date().toLocaleString()}`;

    if (!keyword) {
      sendResponse({ ok: false, error: "Keyword is required" });
      return;
    }

    const targets = buildCompareTargets(keyword);

    Promise.all(
      targets.map(async (target) => {
        const tab = await chrome.tabs.create({ url: target.url, active: false });
        if (!tab?.id) {
          return;
        }

        const config = {
          compareMode: true,
          platform: target.platform,
          keyword,
          runId,
          runName,
          maxPages,
          intervalMs,
          enableSpeech
        };
        const state = {
          running: true,
          config,
          progress: { currentPage: 1 }
        };
        await registerRunningTab(tab.id, config, { currentPage: 1 });
        await sendResumeToTabWithRetry(tab.id, state, 8);
      })
    )
      .then(() => sendResponse({ ok: true, runId }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));

    return true;
  }

  if (message?.type === "BOT_PROGRESS_UPDATE") {
    const { tabId, progress } = message.payload || {};
    const effectiveTabId =
      typeof tabId === "number" ? tabId : typeof sender?.tab?.id === "number" ? sender.tab.id : null;
    if (typeof effectiveTabId !== "number") {
      sendResponse({ ok: false, error: "Invalid tabId" });
      return;
    }

    getRunningTabs()
      .then(async (runningTabs) => {
        if (!runningTabs[String(effectiveTabId)]) {
          sendResponse({ ok: true });
          return;
        }
        runningTabs[String(effectiveTabId)].progress = {
          ...(runningTabs[String(effectiveTabId)].progress || {}),
          ...(progress || {})
        };
        runningTabs[String(effectiveTabId)].updatedAt = Date.now();
        await setRunningTabs(runningTabs);
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));

    return true;
  }

  if (message?.type === "BOT_STOP_ALL_COMPARE") {
    stopAllCompareTabs()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getRunningTabs()
    .then(async (runningTabs) => {
      if (runningTabs[String(tabId)]) {
        delete runningTabs[String(tabId)];
        await setRunningTabs(runningTabs);
      }
    })
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  getRunningTabs()
    .then((runningTabs) => {
      const state = runningTabs[String(tabId)];
      if (!state?.running || !state?.config) {
        return;
      }
      sendResumeToTabWithRetry(tabId, state, 6).catch(() => {});
    })
    .catch(() => {});
});
