# Testing Unreleased Changes in Firefox

You don't need to sign and release a build to try a change. Firefox can load the
local build as a **temporary add-on**, and it runs on your real data.

## Load the local build

1. Build it:
   ```bash
   npm run build
   ```
2. In Firefox, go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick `dist/manifest.json` in this project.
4. Reload the game tab so the page picks up the new code.

The local build has the same add-on ID as the installed release
(`thefifthfamily-enhancements@extension`). It replaces the installed one while it's
loaded and should keep its saved data: Arena profile and track record, Auto-Collect
settings and history, and the rest.

## After each code change

- Run `npm run build`, then click **Reload** on the add-on in `about:debugging`, and
  reload the game tab.
- Or run `npm run dev`, which rebuilds on every save. You still click **Reload**
  in `about:debugging` and reload the game tab.

## Check it's using your real data

Anything that learns from your own history (the Arena advisor, the Real Estate
advisor, Auto-Collect) is only as good as the data it sees. Before trusting it:

- **Arena:** the plan above the cards ends with "Your numbers: … HP · ~… damage ·
  ~… armour (measured from N fights)". It should show your current locked HP and
  dozens of fights. If it says "measured from 1 fight" or warns "These look like last
  season's", the temporary add-on isn't seeing your data.
- **Real Estate:** the advisor should show "My collections" figures, not "No
  collections recorded in this browser yet".

## It's temporary

When Firefox restarts, the temporary add-on is removed and the installed release
comes back. To keep a change for good, release it (`/release`) and install the
signed `.xpi` from `web-ext-artifacts/`. See [deployment.md](deployment.md).

## Why not Chrome?

Chrome works for checking layout (`chrome://extensions` → **Developer mode** →
**Load unpacked** → `dist/`), but it keeps its **own, separate data**. A Chrome copy
that has seen one Arena fight months ago will score every opponent against those
old numbers. On 2026-10-16 that turned Nadia Sokolova from Likely 1.28 into
Avoid 0.74. Use Firefox for anything whose numbers matter.
