# 訳す Yakusu — in-place page translator bookmarklet

Click a bookmark on any page (intranet and logged-in pages too) and its visible Japanese text turns into English where it sits. No install, no extension, no key.

Live: https://gutsmcd-cmd.github.io/yakusu/

## Repo layout
The repo root holds the published files (`index.html`, `yakusu.js`, `relay.html`, `icon.svg`). Locally `build.mjs` writes them to `site/`; copy them to the root after a rebuild.

## Files
- `src/yakusu.js` is the readable source. `src/index.template.html` is the install page template.
- `build.mjs` minifies with esbuild and writes `site/yakusu.js`, `site/index.html`, `bookmarklet-inline.txt` and `bookmarklet-loader.txt`.
- `site/` is the folder to publish: `index.html` (install page), `yakusu.js` (hosted script for the loader), `relay.html` (CSP relay popup), `icon.svg`.
- `test/run.mjs` holds the Playwright tests (real sites, a local form page, a local CSP page and GitHub Docs). `shots/` holds the screenshots.

## Build
    node build.mjs            # YAKUSU_BASE=https://…/ to change the host

## How it works
- A TreeWalker visits text nodes only. It skips script, style, code, kbd, samp, textarea, contenteditable, `translate="no"`, `.notranslate`, and inputs' typed values.
- It also translates the attributes placeholder, title, aria-label and alt, plus the `value` of button-type inputs, but only when the input has no `name`, so submitted form data never changes. An `<option>` with no value attribute gets its original text set as its value first.
- Strings are batched (up to 80 strings or about 3,500 characters per request, 2 requests in flight) and sent with a simple CORS POST to `translate.googleapis.com/translate_a/t?client=gtx`. If that fails it falls back to `clients5.google.com/translate_a/t?client=dict-chrome-ex`. Requests use `credentials: omit` and `referrerPolicy: no-referrer`.
- Results are cached in memory and in sessionStorage (`yakusu1:ja:en`). Text near the viewport is translated first.
- A MutationObserver (debounced 350 ms) handles text added later. It also reaches same-origin iframes and frames and open shadow roots.
- The floating EN/JP toggle sits in shadow DOM, styled with adoptedStyleSheets and built without innerHTML, so Trusted Types pages work. Drag "訳" to move it; × restores the page and quits. Clicking the bookmark again toggles EN/JP.
- When CSP connect-src blocks the request (detected via `securitypolicyviolation`), the box shows a message and a button "中継ウィンドウを開く / Open relay". The button opens `relay.html` on GitHub Pages, which does the fetch and returns results by postMessage.
- A privacy warning appears once per site; the OK is saved in that site's localStorage as `yakusu-ok`.
