/**
 * Dola AI Video Watermark Remover — Background Service Worker
 * Manages auto-downloads, deduplication, folder storage, history, and notifications.
 */

const DOLA_DEFAULT_FOLDER = 'Dola';
const DOLA_LEGACY_DEFAULT_FOLDER = 'Dola_Videos';
const DOLA_HISTORY_LIMIT = 100;
const DOLA_TAB_PATTERNS = [
  '*://*.dola.com/*',
  '*://*.doubao.com/*',
  '*://*.seaart.ai/*'
];

let dolaConfig = {
  autoDownload: true,
  subfolder: DOLA_DEFAULT_FOLDER,
  notifications: true,
  totalDownloaded: 0
};

let dolaDownloadHistory = [];
const dolaInProgressKeys = new Set();
const dolaDownloadedKeys = new Set();

// The service worker can be woken by a message before storage is read.
// Every handler awaits this so it never answers with default state.
const dolaReady = dolaLoadState();

async function dolaLoadState() {
  try {
    const res = await chrome.storage.local.get(['dola_downloader_config', 'dola_download_history']);
    if (res.dola_downloader_config) {
      dolaConfig = { ...dolaConfig, ...res.dola_downloader_config };
      // Move installs still on the old untouched default to the new one.
      if (dolaConfig.subfolder === DOLA_LEGACY_DEFAULT_FOLDER) {
        dolaConfig.subfolder = DOLA_DEFAULT_FOLDER;
        await chrome.storage.local.set({ dola_downloader_config: dolaConfig });
      }
    }
    if (Array.isArray(res.dola_download_history)) {
      dolaDownloadHistory = res.dola_download_history;
    }
    for (const item of dolaDownloadHistory) {
      if (item.vid) dolaDownloadedKeys.add(String(item.vid));
      if (item.url) dolaDownloadedKeys.add(item.url);
    }
  } catch (e) {
    console.warn('[Dola Downloader] Failed to load state:', e);
  }
  dolaUpdateBadge();
}

async function dolaSaveState() {
  try {
    dolaDownloadHistory = dolaDownloadHistory.slice(0, DOLA_HISTORY_LIMIT);
    await chrome.storage.local.set({
      dola_downloader_config: dolaConfig,
      dola_download_history: dolaDownloadHistory
    });
  } catch (e) {
    console.warn('[Dola Downloader] Failed to save state:', e);
  }
}

function dolaUpdateBadge() {
  try {
    const count = dolaConfig.totalDownloaded || 0;
    chrome.action.setBadgeText({ text: count > 0 ? (count > 99 ? '99+' : String(count)) : '' });
    chrome.action.setBadgeBackgroundColor({ color: dolaConfig.autoDownload ? '#7c3aed' : '#71717a' });
  } catch {}
}

function dolaSanitizeSegment(str, maxLength = 60) {
  return String(str || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|~]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .substring(0, maxLength);
}

function dolaSanitizeFolder(folder) {
  const parts = String(folder || '')
    .split(/[/\\]+/)
    .map(part => dolaSanitizeSegment(part, 40))
    .filter(Boolean);
  return parts.join('/') || DOLA_DEFAULT_FOLDER;
}

function dolaGenerateFilename(video) {
  const folder = dolaSanitizeFolder(dolaConfig.subfolder);
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').substring(0, 14);
  const cleanPrompt = dolaSanitizeSegment(video.prompt || video.title) || 'video';
  return `${folder}/dola_${timestamp}_${cleanPrompt}.mp4`;
}

async function dolaHandleAutoDownload(video, force = false) {
  if (!video || !video.url) return { ok: false, error: 'Invalid video URL' };
  if (!dolaConfig.autoDownload && !force) return { ok: true, downloaded: false, reason: 'Auto-download is paused' };

  const cleanUrl = String(video.url).trim();
  if (!/^https?:\/\//i.test(cleanUrl)) return { ok: false, error: 'Invalid video URL' };
  const mediaKey = String(video.vid || cleanUrl);

  if (dolaInProgressKeys.has(mediaKey)) {
    return { ok: true, downloaded: false, reason: 'Download already in progress' };
  }
  if (!force && (dolaDownloadedKeys.has(mediaKey) || dolaDownloadedKeys.has(cleanUrl))) {
    return { ok: true, downloaded: false, reason: 'Already downloaded' };
  }

  dolaInProgressKeys.add(mediaKey);
  const filename = dolaGenerateFilename(video);

  try {
    const downloadId = await chrome.downloads.download({
      url: cleanUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    dolaDownloadedKeys.add(mediaKey);
    dolaDownloadedKeys.add(cleanUrl);
    dolaConfig.totalDownloaded = (dolaConfig.totalDownloaded || 0) + 1;

    const historyEntry = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      downloadId,
      vid: mediaKey,
      url: cleanUrl,
      pageUrl: video.pageUrl || '',
      filename,
      prompt: video.prompt || video.title || 'Untitled video',
      resolution: video.height ? `${video.height}p` : '1080p',
      duration: Number(video.duration || 0),
      state: 'in_progress',
      bytes: 0,
      timestamp: Date.now()
    };

    dolaDownloadHistory.unshift(historyEntry);
    await dolaSaveState();
    dolaUpdateBadge();

    if (dolaConfig.notifications) {
      chrome.notifications.create(`dola_${historyEntry.id}`, {
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'Watermark-free video saved',
        message: historyEntry.prompt.length > 80 ? `${historyEntry.prompt.substring(0, 80)}…` : historyEntry.prompt,
        contextMessage: `Downloads/${filename}`,
        priority: 0
      }).catch(() => {});
    }

    return { ok: true, downloaded: true, downloadId, filename };
  } catch (err) {
    console.error('[Dola Downloader] Download failed:', err);
    return { ok: false, error: err.message || String(err) };
  } finally {
    dolaInProgressKeys.delete(mediaKey);
  }
}

// Keep history entries in sync with the real download state.
chrome.downloads.onChanged.addListener(async delta => {
  await dolaReady;
  const entry = dolaDownloadHistory.find(item => item.downloadId === delta.id);
  if (!entry) return;

  let changed = false;
  if (delta.state?.current) {
    entry.state = delta.state.current;
    changed = true;
  }
  if (delta.error?.current) {
    entry.error = delta.error.current;
    changed = true;
  }
  if (delta.totalBytes?.current > 0) {
    entry.bytes = delta.totalBytes.current;
    changed = true;
  }
  if (changed) await dolaSaveState();
});

// Inject only into tabs that don't already have a live bridge, so listeners never stack.
async function dolaEnsureInjected(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'DOLA_PING' });
    if (pong?.ok) return true;
  } catch {}

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['extractor.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (err) {
    console.warn('[Dola Downloader] Injection failed on tab', tabId, err);
    return false;
  }
}

async function dolaAutoInjectIntoExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: DOLA_TAB_PATTERNS });
    await Promise.all(tabs.filter(tab => tab.id).map(tab => dolaEnsureInjected(tab.id)));
  } catch (e) {
    console.warn('[Dola Downloader] autoInject failed:', e);
  }
}

async function dolaScanActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    return { ok: false, message: 'No active tab found.' };
  }

  let host = '';
  try { host = new URL(activeTab.url || '').hostname; } catch {}
  if (!/(^|\.)(dola\.com|doubao\.com|seaart\.ai)$/.test(host)) {
    return { ok: false, message: 'Open dola.com to grab a video.' };
  }

  if (!(await dolaEnsureInjected(activeTab.id))) {
    return { ok: false, message: 'Could not connect. Reload the page.' };
  }

  const scanRes = await chrome.tabs.sendMessage(activeTab.id, { type: 'SCAN_AND_DOWNLOAD_ACTIVE_TAB' });
  if (scanRes?.ok) {
    return { ok: true, downloadedCount: 1, filename: scanRes.filename };
  }
  return { ok: false, downloadedCount: 0, message: scanRes?.message || 'No video detected. Reload the page after it finishes generating.' };
}

const dolaHandlers = {
  AUTO_DOWNLOAD_VIDEO: message => dolaHandleAutoDownload(message.video, Boolean(message.force)),

  GET_DOWNLOADER_STATUS: () => ({
    ok: true,
    config: dolaConfig,
    history: dolaDownloadHistory,
    totalDownloaded: dolaConfig.totalDownloaded || 0
  }),

  TOGGLE_AUTO_DOWNLOAD: async message => {
    dolaConfig.autoDownload = Boolean(message.enabled);
    await dolaSaveState();
    dolaUpdateBadge();
    return { ok: true, autoDownload: dolaConfig.autoDownload };
  },

  UPDATE_CONFIG: async message => {
    const next = message.config || {};
    if ('subfolder' in next) dolaConfig.subfolder = dolaSanitizeFolder(next.subfolder);
    if ('notifications' in next) dolaConfig.notifications = Boolean(next.notifications);
    if ('autoDownload' in next) dolaConfig.autoDownload = Boolean(next.autoDownload);
    await dolaSaveState();
    dolaUpdateBadge();
    return { ok: true, config: dolaConfig };
  },

  CLEAR_HISTORY: async () => {
    dolaDownloadHistory = [];
    dolaConfig.totalDownloaded = 0;
    await dolaSaveState();
    dolaUpdateBadge();
    return { ok: true };
  },

  REMOVE_HISTORY_ITEM: async message => {
    dolaDownloadHistory = dolaDownloadHistory.filter(item => item.id !== message.id);
    await dolaSaveState();
    return { ok: true };
  },

  RETRY_DOWNLOAD: async message => {
    const entry = dolaDownloadHistory.find(item => item.id === message.id);
    if (!entry) return { ok: false, error: 'Entry not found' };
    const res = await dolaHandleAutoDownload({ url: entry.url, vid: entry.vid, prompt: entry.prompt }, true);
    if (res.ok && res.downloaded) {
      dolaDownloadHistory = dolaDownloadHistory.filter(item => item.id !== entry.id);
      await dolaSaveState();
    }
    return res;
  },

  SHOW_DOWNLOAD_ITEM: async message => {
    const id = Number(message.downloadId);
    if (id) {
      const [item] = await chrome.downloads.search({ id });
      if (item && item.state === 'complete' && item.exists !== false) {
        chrome.downloads.show(id);
        return { ok: true };
      }
    }
    chrome.downloads.showDefaultFolder();
    return { ok: true, fallback: true };
  },

  TRIGGER_PAGE_SCAN_AND_DOWNLOAD: dolaScanActiveTab
};

// Legacy message names kept for compatibility.
dolaHandlers.GET_STATUS = dolaHandlers.GET_DOWNLOADER_STATUS;
dolaHandlers.UPDATE_DOWNLOADER_CONFIG = dolaHandlers.UPDATE_CONFIG;
dolaHandlers.CLEAR_DOWNLOAD_HISTORY = dolaHandlers.CLEAR_HISTORY;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message?.type && dolaHandlers[message.type];
  if (!handler) return false;

  dolaReady
    .then(() => handler(message, sender))
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await dolaReady;
  dolaAutoInjectIntoExistingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  dolaReady.then(dolaUpdateBadge);
});
