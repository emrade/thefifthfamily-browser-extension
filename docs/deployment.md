# Deployment Guide

Firefox is the primary target for distribution. Chrome/Edge/Brave are covered too since
they're needed for day-to-day development (no signing required, `Load unpacked` is
instant), but shipping to other people means a signed Firefox build.

## Quick Install (Firefox)

1. Open Firefox and go to `about:addons`
2. Click the gear icon ⚙ → **Install Add-on From File…**
3. Select the `.xpi` from `web-ext-artifacts/`

> No `.xpi` yet? Build and sign it in about 30 seconds — see "How Signing Works" below.

---

## How the Build Works

The extension is written in TypeScript and built with Vite. The build compiles
everything into a `dist/` folder that Firefox (and Chrome) can load directly.

```bash
npm run build   # compiles TypeScript → dist/
```

`dist/` contains:
- `manifest.json` — the extension definition (with compiled JS paths)
- `src/background/index.js` — service worker
- `src/content/index.js` — isolated-world content script (relays captured requests)
- `src/content/mainWorldHook.js` — `"world": "MAIN"` content script (patches `fetch`/`XHR`)
- `src/popup/index.html` + `index.js` + `index.css` — the popup UI
- `icons/` — extension icons at 16, 48, and 128px

### One thing this extension needs that a simpler one wouldn't

The Trade Assistant's capture pipeline depends on a `"world": "MAIN"` content script
(`mainWorldHook.ts`) to see the game's own `fetch`/`XHR` calls — the isolated
content-script world Firefox/Chrome normally sandbox extensions into can't observe
those. `"world": "MAIN"` support landed in **Firefox 128** and **Chrome 111**, so
`manifest.json` pins `browser_specific_settings.gecko.strict_min_version` to `128.0`.
Don't lower that without confirming the capture pipeline still works — on an older
Firefox the `mainWorldHook` script silently fails to register and nothing gets
captured, with no error surfaced to the user.

---

## How Signing Works (Firefox)

Firefox requires all permanently-installed extensions to be signed by Mozilla. Signing
is done via the `web-ext` CLI tool using your Mozilla Add-ons (AMO) API credentials.

### Credentials

API credentials live at: **addons.mozilla.org/developers/addon/api/key**

You need two values:
- **JWT issuer** (looks like `user:12345:678`) — your API key
- **JWT secret** (long hex string) — your API secret

Keep these private — do not commit them to git.

### Sign command

```bash
npx web-ext sign \
  --source-dir dist \
  --api-key "user:XXXXX:XXX" \
  --api-secret "YOUR_SECRET" \
  --channel unlisted
```

`web-ext` uploads `dist/` to Mozilla's servers, runs automated validation, gets it
signed, and downloads a `.xpi` file into `web-ext-artifacts/`.

The full build + sign flow is:

```bash
npm run build
npx web-ext sign --source-dir dist --api-key "..." --api-secret "..." --channel unlisted
```

> `web-ext-artifacts/` is gitignored. The `.xpi` lives only on your local machine
> unless you deliberately share it.

---

## Distribution Options

### Option 1 — Private / personal use only (recommended for now)

Sign with `--channel unlisted`:

- Mozilla signs it (Firefox accepts it permanently), but it does **not** appear on
  addons.mozilla.org and nobody can find it — you control distribution entirely.
- To install: share the `.xpi` file directly, or just install it on your own machine
  via `about:addons` → gear → Install Add-on From File…

### Option 2 — Share with specific people

Same `--channel unlisted` build, just send the `.xpi` to whoever you want to have it.
They install it the same way. Anyone you share it with is stuck on whatever version
you sent until you send them a new one — there's no auto-update channel for unlisted
add-ons shared this way (see "Truly automatic updates" below if that matters).

### Option 3 — Public listing on AMO (anyone can install)

Switch `--channel unlisted` to `--channel listed`:

```bash
npx web-ext sign \
  --source-dir dist \
  --api-key "..." \
  --api-secret "..." \
  --channel listed
```

Mozilla puts it through **human review** before it goes live — typically a few days
for a new extension. Once approved, anyone can find and install it from AMO.

> **Note:** listing requires compliance with Mozilla's
> [Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/).
> Two things worth flagging ahead of review for this extension specifically: it reads
> gameplay data via a `"world": "MAIN"` network hook rather than the page DOM (be ready
> to explain why in the review notes — it's for resilience against the game's own
> markup changing, not to work around anything), and it talks to
> `https://www.thefifthfamily.com` only — no other host permissions, no remote code.

---

## Releasing a New Version

### One-command release (easiest)

Store your credentials in your shell profile so you never have to type them:

```bash
# Add to ~/.zshrc (or ~/.bashrc), then restart your terminal
export AMO_API_KEY="user:XXXXX:XXX"
export AMO_API_SECRET="your-secret-here"
```

Then every release is just:

```bash
npm run release
```

That single command builds and signs in one step. A new `.xpi` appears in
`web-ext-artifacts/` when done. Bump `"version"` in `manifest.json` first — Mozilla
rejects a re-upload at the same version number.

### Install the update in Firefox

Firefox won't auto-install updates for unlisted extensions — you push them manually:

1. `about:addons` → gear ⚙ → **Install Add-on From File…**
2. Select the new `.xpi`

Firefox recognises the same extension ID (`thefifthfamily-enhancements@extension`,
set in `manifest.json`'s `browser_specific_settings.gecko.id`) and replaces the old
version in place — no uninstall needed.

### Truly automatic updates (optional)

To have Firefox silently update in the background (checked every 24 hours) without any
manual reinstall step, add an `update_url` to the manifest pointing at a hosted JSON
file:

**1. Add `update_url` to `manifest.json`:**
```json
"browser_specific_settings": {
  "gecko": {
    "id": "thefifthfamily-enhancements@extension",
    "strict_min_version": "128.0",
    "update_url": "https://your-username.github.io/thefifthfamily-browser-extension/updates.json"
  }
}
```

**2. Create `updates.json` (hosted on GitHub Pages or similar):**
```json
{
  "addons": {
    "thefifthfamily-enhancements@extension": {
      "updates": [
        {
          "version": "0.2.0",
          "update_link": "https://github.com/your-username/thefifthfamily-browser-extension/releases/download/v0.2.0/thefifthfamily-enhancements-0.2.0.xpi"
        }
      ]
    }
  }
}
```

**3. Each release:** bump `"version"` in `manifest.json`, run `npm run release`, upload
the `.xpi` to a GitHub Release, and update `updates.json` with the new version and
download URL.

---

## Chrome / Edge / Brave

Chrome does not require signing for local/unpacked use — this is the fast path for
day-to-day development against the live game.

1. `npm run build`
2. Open `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select `dist/`
4. After any code change: `npm run build` again, then click the ↺ refresh icon on the
   extension's card

To distribute on the Chrome Web Store, you'd need a Google developer account ($5
one-time fee) and to submit through the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) —
not planned right now since Firefox is the target, noted here only for completeness.
