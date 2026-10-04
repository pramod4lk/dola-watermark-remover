/**
 * Dola AI Video Watermark Remover — Popup Controller
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const autoDownloadToggle = $('dola-auto-download-toggle');
  const notificationsToggle = $('dola-notifications-toggle');
  const btnDownloadScreen = $('btn-download-screen');
  const btnDownloadScreenText = $('btn-download-screen-text');
  const heroHint = $('hero-hint');
  const pageStatus = $('page-status');
  const pageStatusText = $('page-status-text');
  const statTotal = $('stat-total');
  const statToday = $('stat-today');
  const statLast = $('stat-last');
  const subfolderInput = $('dola-subfolder-input');
  const saveFolderBtn = $('btn-dola-save-folder');
  const historyList = $('dola-history-list');
  const historyCount = $('dola-history-count');
  const clearHistoryBtn = $('btn-dola-clear-history');
  const clearConfirm = $('clear-confirm');
  const clearConfirmBtn = $('btn-clear-confirm');
  const clearCancelBtn = $('btn-clear-cancel');
  const openDolaBtn = $('btn-open-dola');

  const DEFAULT_HINT = 'Saves the latest generated video on this tab in original quality.';
  const SUPPORTED_HOST = /(^|\.)(dola\.com|doubao\.com|seaart\.ai)$/;

  const ICONS = {
    complete: '<svg class="item-state" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Saved"><circle cx="12" cy="12" r="9.5"/><path d="m8 12.5 2.7 2.7L16 9.8"/></svg>',
    in_progress: '<svg class="item-state" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-label="Downloading"><path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5"/></svg>',
    interrupted: '<svg class="item-state" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Failed"><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/></svg>'
  };

  let savedFolder = '';
  let autoDownloadOn = true;
  let tabSupported = false;
  let hintTimer = null;

  function send(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, res => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false });
          }
        });
      } catch (err) {
        resolve({ ok: false, error: err.message || String(err) });
      }
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatTime(timestamp) {
    if (!timestamp) return '—';
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
  }

  function formatDuration(seconds) {
    if (!seconds) return '';
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function setHint(text, tone = '', resetMs = 0) {
    clearTimeout(hintTimer);
    heroHint.textContent = text;
    heroHint.dataset.tone = tone;
    if (resetMs) {
      hintTimer = setTimeout(() => setHint(defaultHint()), resetMs);
    }
  }

  function defaultHint() {
    return tabSupported ? DEFAULT_HINT : 'Open a Dola AI or Doubao tab to grab videos.';
  }

  function updatePageStatus() {
    if (!tabSupported) {
      pageStatus.dataset.state = 'idle';
      pageStatusText.textContent = 'Not on Dola';
    } else if (!autoDownloadOn) {
      pageStatus.dataset.state = 'paused';
      pageStatusText.textContent = 'Auto paused';
    } else {
      pageStatus.dataset.state = 'connected';
      pageStatusText.textContent = 'Watching';
    }
  }

  function renderStats(history, total) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    statTotal.textContent = String(total);
    statToday.textContent = String(history.filter(item => item.timestamp >= startOfDay.getTime()).length);
    statLast.textContent = history[0] ? formatTime(history[0].timestamp) : '—';
  }

  function renderHistoryItem(item) {
    const state = item.state === 'interrupted' || item.state === 'in_progress' ? item.state : 'complete';
    const title = item.prompt || item.filename || 'Untitled video';
    const meta = [];

    if (state === 'interrupted') {
      meta.push('<span class="tag-error">Download failed</span>');
    } else if (state === 'in_progress') {
      meta.push('<span class="tag">Downloading…</span>');
    } else {
      meta.push(`<span class="tag">${escapeHtml(item.resolution || '1080p')}</span>`);
      if (item.bytes) meta.push(`<span>${formatBytes(item.bytes)}</span>`);
      if (item.duration) meta.push(`<span>${formatDuration(item.duration)}</span>`);
    }
    meta.push(`<span>${formatTime(item.timestamp)}</span>`);

    const actions = state === 'interrupted'
      ? `<button class="icon-btn retry" data-action="retry" title="Retry download" aria-label="Retry download" type="button">${ICONS.retry}</button>`
      : `<button class="icon-btn" data-action="show" title="Show in folder" aria-label="Show in folder" type="button">${ICONS.folder}</button>`;

    return `
      <li class="history-item" data-state="${state}" data-id="${escapeHtml(item.id)}" data-download-id="${Number(item.downloadId) || ''}">
        ${ICONS[state]}
        <div class="history-details">
          <div class="history-prompt" title="${escapeHtml(item.filename || title)}">${escapeHtml(title)}</div>
          <div class="history-meta">${meta.join('<span class="sep">·</span>')}</div>
        </div>
        <div class="item-actions">
          ${actions}
          <button class="icon-btn" data-action="remove" title="Remove from list" aria-label="Remove from list" type="button">${ICONS.remove}</button>
        </div>
      </li>
    `;
  }

  function renderHistory(items) {
    historyCount.textContent = String(items.length);
    clearHistoryBtn.hidden = items.length === 0 || !clearConfirm.hidden;
    if (!items.length) clearConfirm.hidden = true;

    if (!items.length) {
      historyList.innerHTML = `
        <li class="empty-state">
          ${ICONS.empty}
          <strong>No downloads yet</strong>
          <span>Generate a video on Dola AI and it will be saved here automatically, without the watermark.</span>
        </li>
      `;
      return;
    }

    historyList.innerHTML = items.slice(0, 50).map(renderHistoryItem).join('');
  }

  async function refresh() {
    const res = await send({ type: 'GET_DOWNLOADER_STATUS' });
    if (!res.ok) return;

    const config = res.config || {};
    const history = Array.isArray(res.history) ? res.history : [];

    autoDownloadOn = config.autoDownload !== false;
    autoDownloadToggle.checked = autoDownloadOn;
    notificationsToggle.checked = config.notifications !== false;

    savedFolder = config.subfolder || 'Dola';
    if (document.activeElement !== subfolderInput) {
      subfolderInput.value = savedFolder;
      saveFolderBtn.hidden = true;
    }

    renderStats(history, res.totalDownloaded || 0);
    renderHistory(history);
    updatePageStatus();
  }

  async function detectActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const host = tab?.url ? new URL(tab.url).hostname : '';
      tabSupported = SUPPORTED_HOST.test(host);
    } catch {
      tabSupported = false;
    }
    updatePageStatus();
    setHint(defaultHint());
  }

  // Toggles
  autoDownloadToggle.addEventListener('change', async () => {
    autoDownloadOn = autoDownloadToggle.checked;
    updatePageStatus();
    await send({ type: 'TOGGLE_AUTO_DOWNLOAD', enabled: autoDownloadOn });
  });

  notificationsToggle.addEventListener('change', () => {
    send({ type: 'UPDATE_CONFIG', config: { notifications: notificationsToggle.checked } });
  });

  // Folder
  async function saveFolder() {
    const folder = subfolderInput.value.trim() || 'Dola';
    const res = await send({ type: 'UPDATE_CONFIG', config: { subfolder: folder } });
    if (!res.ok) {
      setHint('Could not save folder.', 'error', 2500);
      return;
    }
    savedFolder = res.config.subfolder;
    subfolderInput.value = savedFolder;
    saveFolderBtn.hidden = true;
    subfolderInput.blur();
    setHint(`Videos will be saved to Downloads/${savedFolder}/`, 'success', 2500);
  }

  subfolderInput.addEventListener('input', () => {
    saveFolderBtn.hidden = subfolderInput.value.trim() === savedFolder;
  });

  subfolderInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveFolder();
    if (event.key === 'Escape') {
      subfolderInput.value = savedFolder;
      saveFolderBtn.hidden = true;
      subfolderInput.blur();
    }
  });

  saveFolderBtn.addEventListener('mousedown', event => event.preventDefault());
  saveFolderBtn.addEventListener('click', saveFolder);

  // Clear history — inline confirm (window.confirm() is unreliable in extension popups)
  function showClearConfirm(show) {
    clearConfirm.hidden = !show;
    clearHistoryBtn.hidden = show || historyList.querySelector('.history-item') === null;
    if (show) clearConfirmBtn.focus();
  }

  clearHistoryBtn.addEventListener('click', () => showClearConfirm(true));
  clearCancelBtn.addEventListener('click', () => showClearConfirm(false));

  clearConfirmBtn.addEventListener('click', async () => {
    clearConfirmBtn.disabled = true;
    const res = await send({ type: 'CLEAR_HISTORY' });
    clearConfirmBtn.disabled = false;
    if (!res.ok) {
      showClearConfirm(false);
      setHint(res.error || 'Could not clear history.', 'error', 3000);
      return;
    }
    renderStats([], 0);
    renderHistory([]);
    showClearConfirm(false);
    setHint('Download history cleared.', 'success', 2500);
  });

  // History item actions
  historyList.addEventListener('click', async event => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.history-item');
    const id = row?.dataset.id;

    if (btn.dataset.action === 'show') {
      send({ type: 'SHOW_DOWNLOAD_ITEM', downloadId: Number(row.dataset.downloadId) || null });
    } else if (btn.dataset.action === 'remove') {
      await send({ type: 'REMOVE_HISTORY_ITEM', id });
      refresh();
    } else if (btn.dataset.action === 'retry') {
      btn.disabled = true;
      const res = await send({ type: 'RETRY_DOWNLOAD', id });
      if (!res.ok) setHint(res.error || 'Retry failed. The link may have expired.', 'error', 3500);
      refresh();
    }
  });

  // Grab video on screen
  function setButtonState(state, text) {
    btnDownloadScreen.dataset.state = state;
    btnDownloadScreen.disabled = state === 'busy';
    btnDownloadScreenText.textContent = text;
  }

  btnDownloadScreen.addEventListener('click', async () => {
    setButtonState('busy', 'Finding video…');
    setHint('Looking for the original stream on this tab…');

    const res = await send({ type: 'TRIGGER_PAGE_SCAN_AND_DOWNLOAD' });

    if (res.ok && res.downloadedCount > 0) {
      setButtonState('success', 'Saved without watermark');
      setHint(res.filename ? `Downloads/${res.filename}` : 'Saved to your Downloads folder.', 'success', 4000);
    } else {
      setButtonState('error', 'No video found');
      setHint(res.message || res.error || 'No video detected on this tab.', 'error', 4000);
    }

    setTimeout(() => setButtonState('idle', 'Download video on screen'), 2600);
    refresh();
  });

  openDolaBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.dola.com/' });
    window.close();
  });

  // Live updates while the popup is open (new downloads, state changes)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.dola_download_history || changes.dola_downloader_config)) {
      refresh();
    }
  });

  $('app-version').textContent = `v${chrome.runtime.getManifest().version}`;

  detectActiveTab();
  refresh();
})();
