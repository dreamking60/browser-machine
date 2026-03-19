const RUNNING_TABS_KEY = "assistiveBotRunningTabs";
const SETTINGS_KEY = "assistiveBotSettings";
const SCHEDULE_ALARM = "assistiveBotScheduleCompare";
const LOGS_KEY = "assistiveBotErrorLogs";
const LOGS_MAX = 500;

async function getRunningTabs() {
  const data = await chrome.storage.local.get(RUNNING_TABS_KEY);
  return data[RUNNING_TABS_KEY] || {};
}

async function setRunningTabs(runningTabs) {
  await chrome.storage.local.set({ [RUNNING_TABS_KEY]: runningTabs });
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

async function setSettings(partial) {
  const old = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...old, ...partial } });
}

async function appendLog(level, source, code, message, extra = {}) {
  try {
    const data = await chrome.storage.local.get(LOGS_KEY);
    const logs = data[LOGS_KEY] || [];
    logs.push({
      at: Date.now(),
      level: level || "info",
      source: source || "background",
      code: code || "unknown",
      message: String(message || ""),
      extra
    });
    const trimmed = logs.slice(-LOGS_MAX);
    await chrome.storage.local.set({ [LOGS_KEY]: trimmed });
  } catch (_) {
    // Ignore logging failures.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCompareTargets(keyword) {
  const encoded = encodeURIComponent(keyword);
  return [
    { platform: "taobao", url: `https://s.taobao.com/search?q=${encoded}` },
    { platform: "jd", url: `https://search.jd.com/Search?keyword=${encoded}` }
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
        payload: { config: state.config, progress: state.progress || null }
      });
      if (resp?.ok) return true;
    } catch (_) {
      // Content script may not be ready yet.
    }
    await sleep(900);
  }
  return false;
}

async function hasCompareTaskRunning() {
  const runningTabs = await getRunningTabs();
  return Object.values(runningTabs).some((state) => state?.config?.compareMode);
}

async function stopAllCompareTabs() {
  const runningTabs = await getRunningTabs();
  const entries = Object.entries(runningTabs);

  for (const [tabIdText, state] of entries) {
    const tabId = Number(tabIdText);
    if (!state?.config?.compareMode) continue;
    try {
      await chrome.tabs.sendMessage(tabId, { type: "BOT_STOP" });
    } catch (_) {
      // Ignore tabs that are already gone or not loaded.
    }
    delete runningTabs[tabIdText];
  }

  await setRunningTabs(runningTabs);
}

async function startCompareRun(payload, source = "manual") {
  const keyword = String(payload?.keyword || "").trim();
  const maxPages = Math.max(1, Number(payload?.maxPages) || 3);
  const intervalMs = Math.max(1000, Number(payload?.intervalMs) || 4000);
  const enableSpeech = Boolean(payload?.enableSpeech);
  const runId = String(payload?.runId || "").trim() || createRunId();
  const runName = String(payload?.runName || "").trim() || `${keyword}-${new Date().toLocaleString()}`;

  if (!keyword) {
    await appendLog("error", "compare", "keyword_required", "启动任务失败：关键词为空", { source });
    return { ok: false, error: "Keyword is required" };
  }

  const targets = buildCompareTargets(keyword);
  await Promise.all(
    targets.map(async (target) => {
      const tab = await chrome.tabs.create({ url: target.url, active: false });
      if (!tab?.id) {
        await appendLog("error", "compare", "create_tab_failed", "创建采集标签页失败", { platform: target.platform, source });
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
        enableSpeech,
        source
      };
      const state = { running: true, config, progress: { currentPage: 1 } };
      await registerRunningTab(tab.id, config, { currentPage: 1 });
      await sendResumeToTabWithRetry(tab.id, state, 8);
    })
  );

  return { ok: true, runId };
}

async function syncScheduleAlarm(config) {
  await chrome.alarms.clear(SCHEDULE_ALARM);
  if (!config?.enabled) return { ok: true, enabled: false };

  const intervalMinutes = Math.max(1, Number(config.intervalMinutes) || 60);
  await chrome.alarms.create(SCHEDULE_ALARM, {
    delayInMinutes: 0.1,
    periodInMinutes: intervalMinutes
  });
  return { ok: true, enabled: true, intervalMinutes };
}

async function getScheduleConfigFromSettings() {
  const settings = await getSettings();
  return settings.scheduleConfig || {
    enabled: false,
    keyword: "",
    maxPages: 2,
    intervalMinutes: 60,
    intervalMs: 4000,
    enableSpeech: false
  };
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SCHEDULE_ALARM) return;

  const scheduleConfig = await getScheduleConfigFromSettings();
  if (!scheduleConfig.enabled || !String(scheduleConfig.keyword || "").trim()) {
    await syncScheduleAlarm({ enabled: false });
    await appendLog("warn", "schedule", "disabled_or_empty", "定时任务未开启或关键词为空，已停止调度", {
      enabled: Boolean(scheduleConfig.enabled),
      keyword: scheduleConfig.keyword || ""
    });
    return;
  }

  if (await hasCompareTaskRunning()) {
    await setSettings({ scheduleLastRun: { at: Date.now(), status: "skipped_running" } });
    await appendLog("info", "schedule", "skipped_running", "定时任务跳过：当前已有任务运行中");
    return;
  }

  const runName = `定时任务-${scheduleConfig.keyword}-${new Date().toLocaleString()}`;
  try {
    const res = await startCompareRun({ ...scheduleConfig, runName }, "schedule");
    await setSettings({
      scheduleLastRun: {
        at: Date.now(),
        status: res.ok ? "started" : "failed",
        error: res.ok ? "" : (res.error || "unknown")
      }
    });
    if (!res.ok) {
      await appendLog("error", "schedule", "start_failed", res.error || "定时任务启动失败");
    }
  } catch (err) {
    await setSettings({
      scheduleLastRun: { at: Date.now(), status: "failed", error: String(err) }
    });
    await appendLog("error", "schedule", "alarm_exception", String(err));
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getScheduleConfigFromSettings();
  if (!config.enabled) {
    await chrome.alarms.clear(SCHEDULE_ALARM);
    return;
  }
  await syncScheduleAlarm(config);
});

chrome.runtime.onStartup.addListener(async () => {
  const config = await getScheduleConfigFromSettings();
  if (!config.enabled) {
    await chrome.alarms.clear(SCHEDULE_ALARM);
    return;
  }
  await syncScheduleAlarm(config);
});

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
    startCompareRun(message.payload || {}, "manual")
      .then(sendResponse)
      .catch(async (err) => {
        await appendLog("error", "compare", "start_exception", String(err), { source: "manual" });
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message?.type === "BOT_SET_SCHEDULE") {
    const payload = message.payload || {};
    const scheduleConfig = {
      enabled: Boolean(payload.enabled),
      keyword: String(payload.keyword || "").trim(),
      maxPages: Math.max(1, Number(payload.maxPages) || 2),
      intervalMinutes: Math.max(1, Number(payload.intervalMinutes) || 60),
      intervalMs: Math.max(1000, Number(payload.intervalMs) || 4000),
      enableSpeech: Boolean(payload.enableSpeech)
    };

    setSettings({ scheduleConfig })
      .then(() => syncScheduleAlarm(scheduleConfig))
      .then((syncRes) => sendResponse({ ok: true, scheduleConfig, syncRes }))
      .catch(async (err) => {
        await appendLog("error", "schedule", "set_config_failed", String(err), scheduleConfig);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message?.type === "BOT_GET_SCHEDULE") {
    getSettings()
      .then((settings) => {
        sendResponse({
          ok: true,
          scheduleConfig: settings.scheduleConfig || null,
          scheduleLastRun: settings.scheduleLastRun || null
        });
      })
      .catch(async (err) => {
        await appendLog("error", "schedule", "get_config_failed", String(err));
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message?.type === "BOT_RUN_SCHEDULE_NOW") {
    getScheduleConfigFromSettings()
      .then(async (config) => {
        if (!config.enabled) {
          await appendLog("warn", "schedule", "run_now_disabled", "手动触发失败：定时任务未开启");
          sendResponse({ ok: false, error: "定时任务未开启" });
          return;
        }
        if (!config.keyword) {
          await appendLog("warn", "schedule", "run_now_empty_keyword", "手动触发失败：定时任务关键词为空");
          sendResponse({ ok: false, error: "定时任务关键词为空" });
          return;
        }
        if (await hasCompareTaskRunning()) {
          await appendLog("info", "schedule", "run_now_skipped_running", "手动触发跳过：已有任务运行中");
          sendResponse({ ok: false, error: "当前已有任务运行中" });
          return;
        }
        const runName = `手动触发定时-${config.keyword}-${new Date().toLocaleString()}`;
        const res = await startCompareRun({ ...config, runName }, "schedule_manual");
        await setSettings({ scheduleLastRun: { at: Date.now(), status: res.ok ? "started" : "failed", error: res.error || "" } });
        if (!res.ok) {
          await appendLog("error", "schedule", "run_now_failed", res.error || "手动触发定时任务失败");
        }
        sendResponse(res);
      })
      .catch(async (err) => {
        await appendLog("error", "schedule", "run_now_exception", String(err));
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message?.type === "BOT_PROGRESS_UPDATE") {
    const { tabId, progress } = message.payload || {};
    const effectiveTabId = typeof tabId === "number" ? tabId : typeof sender?.tab?.id === "number" ? sender.tab.id : null;
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
  if (changeInfo.status !== "complete") return;

  getRunningTabs()
    .then((runningTabs) => {
      const state = runningTabs[String(tabId)];
      if (!state?.running || !state?.config) return;
      sendResumeToTabWithRetry(tabId, state, 6).catch(() => {});
    })
    .catch(() => {});
});
