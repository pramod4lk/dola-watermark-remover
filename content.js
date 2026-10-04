/**
 * Dola AI Video Watermark Remover — Content Script (Isolated World)
 * Connects MAIN-world extractor (extractor.js) to background.js for 100% Watermark-Free raw downloads.
 */
(() => {
  'use strict';

  // Background re-injects this script on demand; never register listeners twice.
  if (window.__DOLA_BRIDGE_INITIALIZED__ && chrome.runtime?.id) return;
  window.__DOLA_BRIDGE_INITIALIZED__ = true;

  const downloadedMediaKeys = new Set();
  let latestExtractedVideos = [];

  const TOAST_ICON_OK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="m8 12.5 2.7 2.7L16 9.8"/></svg>';

  function showDownloadToast(title, subtitle = 'Saved without watermark') {
    try {
      document.getElementById('dola-auto-toast')?.remove();

      const toast = document.createElement('div');
      toast.id = 'dola-auto-toast';
      toast.setAttribute('role', 'status');
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: rgba(255, 255, 255, 0.96);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 12px 32px rgba(15, 15, 30, 0.14), 0 2px 6px rgba(15, 15, 30, 0.06);
        color: #09090b;
        padding: 12px 16px 12px 14px;
        border-radius: 12px;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 360px;
        animation: dolaSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: none;
      `;

      toast.innerHTML = `
        ${TOAST_ICON_OK}
        <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <span style="font-weight: 600; font-size: 12.5px; letter-spacing: -0.01em;">${escapeHtml(subtitle)}</span>
          <span style="color: #71717a; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(title || 'Saved to Downloads')}</span>
        </div>
      `;

      if (!document.getElementById('dola-toast-style')) {
        const style = document.createElement('style');
        style.id = 'dola-toast-style';
        style.textContent = `
          @keyframes dolaSlideIn {
            from { transform: translateY(16px) scale(0.98); opacity: 0; }
            to { transform: translateY(0) scale(1); opacity: 1; }
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      }

      (document.body || document.documentElement).appendChild(toast);

      setTimeout(() => {
        toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    } catch {}
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function parseDetail(detail) {
    if (typeof detail !== 'string') return detail || null;
    try {
      return JSON.parse(detail);
    } catch {
      return null;
    }
  }

  function triggerDownload(video, force = false) {
    return new Promise(resolve => {
      if (!video || !video.url) return resolve({ ok: false, error: 'Invalid video' });

      const cleanUrl = String(video.url).trim();
      if (!/^https?:\/\//i.test(cleanUrl)) return resolve({ ok: false, error: 'Invalid video URL' });

      const mediaKey = String(video.vid || cleanUrl);
      if (!force && downloadedMediaKeys.has(mediaKey)) {
        return resolve({ ok: true, downloaded: false, reason: 'Already downloaded' });
      }

      // Extension was reloaded/updated while this page stayed open.
      if (!chrome.runtime?.id) {
        console.warn('[Dola Downloader] Extension context invalidated. Please refresh the page.');
        return resolve({ ok: false, error: 'Extension was reloaded. Refresh the page.' });
      }

      downloadedMediaKeys.add(mediaKey);

      try {
        chrome.runtime.sendMessage({
          type: 'AUTO_DOWNLOAD_VIDEO',
          force,
          video: {
            ...video,
            url: cleanUrl,
            pageUrl: window.location.href,
            prompt: video.prompt || video.title || ''
          }
        }, response => {
          if (chrome.runtime.lastError || !response?.ok) {
            downloadedMediaKeys.delete(mediaKey);
            return resolve({ ok: false, error: response?.error || chrome.runtime.lastError?.message });
          }
          if (response.downloaded) {
            showDownloadToast(video.prompt || video.title || 'Dola video');
          }
          resolve(response);
        });
      } catch (err) {
        downloadedMediaKeys.delete(mediaKey);
        resolve({ ok: false, error: err.message || String(err) });
      }
    });
  }

  function requestMainWorldMedia(timeoutMs = 1500) {
    return new Promise(resolve => {
      let settled = false;
      const finish = videos => {
        if (settled) return;
        settled = true;
        window.removeEventListener('DOLA_CHAT_MEDIA_RESPONSE', onResponse);
        resolve(videos);
      };
      const onResponse = event => {
        const detail = parseDetail(event?.detail);
        latestExtractedVideos = detail?.videos || [];
        finish(latestExtractedVideos);
      };
      window.addEventListener('DOLA_CHAT_MEDIA_RESPONSE', onResponse);
      window.dispatchEvent(new CustomEvent('DOLA_GET_CHAT_MEDIA'));
      setTimeout(() => finish(latestExtractedVideos), timeoutMs);
    });
  }

  // 1. Listen for new unwatermarked video extractions from extractor.js
  window.addEventListener('DOLA_VIDEO_EXTRACTED', event => {
    const video = parseDetail(event.detail);
    if (video?.url) {
      latestExtractedVideos = [...latestExtractedVideos, video];
      triggerDownload(video);
    }
  });

  // 2. Handle requests from the background worker / popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'DOLA_PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'SCAN_AND_DOWNLOAD_ACTIVE_TAB') {
      (async () => {
        const videos = await requestMainWorldMedia(2000);
        const validVideos = (videos || []).filter(v => v && v.url);

        if (!validVideos.length) {
          sendResponse({ ok: false, message: 'No video found yet. Reload the page once generation finishes.' });
          return;
        }

        const target = validVideos[validVideos.length - 1];
        const res = await triggerDownload(target, true);
        if (res.ok && res.downloaded) {
          sendResponse({ ok: true, filename: res.filename, url: target.url });
        } else {
          sendResponse({ ok: false, message: res.error || res.reason || 'Download failed.' });
        }
      })().catch(err => sendResponse({ ok: false, message: err.message || String(err) }));
      return true;
    }

    return false;
  });
})();
