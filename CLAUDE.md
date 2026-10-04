# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome extension (Manifest V3, plain JavaScript, no build step or dependencies) that catches videos generated on Dola AI (`dola.com`) and Doubao (`doubao.com`) and downloads the original, unwatermarked MP4.

## Commands

There is no package.json, bundler, linter or test suite.

- Syntax-check after editing: `for f in *.js; do node --check "$f"; done`
- Validate the manifest: `python3 -m json.tool manifest.json >/dev/null`
- Run manually: `chrome://extensions` → Developer mode → **Load unpacked** → select the repo root. After changing code, click reload on the extension and refresh any open Dola tabs (old content scripts stay orphaned until the page reloads).

### Automated testing in headless Chrome

Branded Chrome (v137+) ignores `--load-extension`. To drive the real extension, launch Chrome with `--headless=new --remote-debugging-pipe --enable-unsafe-extension-debugging --user-data-dir=<tmp>`, talk CDP over file descriptors 3/4 (messages are NUL-terminated JSON), and call `Extensions.loadUnpacked { path }`. The unpacked extension ID is fixed for a given path. Then open `chrome-extension://<id>/popup.html` as a page target. From there you can call `chrome.runtime.sendMessage(...)` to exercise the background worker, and use `Emulation.setDeviceMetricsOverride` (380×600) and `Emulation.setEmulatedMedia` (`prefers-color-scheme`) to check layout. `AUTO_DOWNLOAD_VIDEO` with `force: true` and any https URL creates real history entries (they end up `interrupted`, which is fine for UI testing).

Do not use `pkill -f` / `pgrep -f` with a pattern that appears in your own Bash command line; it kills the shell running the command.

## Architecture

Data passes through three execution contexts. You need to read all three files to follow it.

1. **`extractor.js` — page's MAIN world** (content script with `"world": "MAIN"`, `document_start`). Wraps `fetch` and `XMLHttpRequest` to watch `/im/chain/single`, `/chat/completion` (an SSE stream) and `/samantha/` responses, and scans router-data `<script data-fn-args>` tags. It looks for `fallback_api` URLs, re-requests them with `logo_type=unwatermarked&codec_type=8&channel=no`, picks the highest bitrate × resolution entry from `video_list`, and decodes `main_url`. That value is either a plain URL, loose base64, or a `qAAB` token decrypted with AES-CBC. The key and IV come from SHA-512(SHA-512(key_seed[0:32]) ‖ fixed salt). The fetch hook must read `response.clone()` and return the original response untouched; replacing the `Response` previously made the page hang when the stream errored.
2. **`content.js` — isolated world.** A bridge. It receives `DOLA_VIDEO_EXTRACTED` window events and forwards them as `AUTO_DOWNLOAD_VIDEO` to the background worker. It answers the background's `DOLA_PING` and `SCAN_AND_DOWNLOAD_ACTIVE_TAB` messages (the latter asks the extractor for its list via `DOLA_GET_CHAT_MEDIA` / `DOLA_CHAT_MEDIA_RESPONSE`). It also shows the in-page toast.
3. **`background.js` — service worker.** Handles downloads, removes duplicates, keeps history, sets the badge and shows notifications. Messages are routed through the `dolaHandlers` map. Legacy aliases (`GET_STATUS`, `UPDATE_DOWNLOADER_CONFIG`, `CLEAR_DOWNLOAD_HISTORY`) are kept for compatibility.

Invariants that span files:

- **Events between worlds carry JSON strings** in `CustomEvent.detail` (`JSON.stringify` in the extractor, `parseDetail` in the content script). Objects don't reliably cross between the page's world and the extension's.
- **Never stack listeners.** The background calls `dolaEnsureInjected(tabId)`, which sends `DOLA_PING` first and only injects if nothing answers. Both scripts also guard with window flags (`__DOLA_EXTRACTOR_INITIALIZED__`, `__DOLA_BRIDGE_INITIALIZED__`). Re-injecting on every service-worker wake used to cause duplicate downloads.
- **The service worker can wake on a message before storage loads.** Every handler runs after `await dolaReady`; keep it that way when adding handlers.
- **Duplicate removal happens at two layers:** a per-page `Set` in `content.js`, and `dolaDownloadedKeys` in the background (refilled from history `vid`/`url` on load). A key is only marked as downloaded after `chrome.downloads.download` succeeds, so failed downloads can be retried. `force: true` (manual scan, retry) skips the "already downloaded" check but not the "in progress" check.
- **History entries follow the real download state** through `chrome.downloads.onChanged` (`in_progress` / `complete` / `interrupted`, plus file size). The popup subscribes to `chrome.storage.onChanged` and redraws live.
- **Storage** (`chrome.storage.local`): `dola_downloader_config` `{ autoDownload, subfolder, notifications, totalDownloaded }` and `dola_download_history` (newest first, capped at 100). The default folder is `Dola`. A stored legacy value of `Dola_Videos` is changed to `Dola` on load. Folder and file names go through `dolaSanitizeFolder` / `dolaSanitizeSegment`, because Chrome rejects some characters with "Invalid filename".

## Popup UI

`popup.html` / `popup.css` / `popup.js` (380px wide). The popup is fixed at **600px tall**, which is Chrome's maximum popup height. The page itself must never scroll: every section has `flex-shrink: 0`, and only `.history-list` fills the remaining space and scrolls, with a scoped `::-webkit-scrollbar`. Don't add `scrollbar-width`/`scrollbar-color` there; in Chrome they override the custom `::-webkit-scrollbar` styles. Anything that adds height above the history list takes space away from the list. Colors are CSS custom properties with a `prefers-color-scheme: dark` override. Don't use `window.confirm()` in the popup (it's unreliable in extension popups); use inline confirmation (see the Clear all flow).

`AGENTS.md` contains binding UI rules. In short: no sparkle icons; no colored or bordered boxes around icons; no card boxing (separate content with whitespace or divider lines); badges and tags are plain text; lists use single divider lines.

## Icons

`icon{16,32,48,128}.png` are rendered from `assets/icon-small.svg` (used for 16/32px, fills the canvas) and `assets/icon.svg` (used for 48/128px; 128px uses Chrome's recommended 96px artwork with 16px padding). The style is a filled violet circle with a white glyph, to match other toolbar icons. No SVG rasterizer is installed. Render the SVG at 512px in headless Chrome with a transparent background (`Emulation.setDefaultBackgroundColorOverride`), then downscale with Pillow (LANCZOS). The popup header uses `icon128.png` at 44px with `margin: -5px` to offset that padding.
