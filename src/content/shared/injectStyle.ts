/** Injects a `<style>` block into the live game page exactly once per id — shared by
 * every content-script feature that adds its own UI directly to the page's DOM
 * (Fight Club's toolbar, Street Intel's highlights), so each one doesn't re-implement
 * the same "have I already added mine?" guard.
 *
 * Falls back to `documentElement` when `head` doesn't exist yet — content scripts
 * run at `document_start`, before `<head>` is guaranteed to have been parsed, and a
 * caller invoking this eagerly at init time (rather than lazily from inside a
 * MutationObserver callback, by which point `<head>` reliably exists) would
 * otherwise throw on `document.head.appendChild` and silently abort whatever ran
 * after it — a `<style>` tag works anywhere in the document, not just `<head>`. */
export function injectStyleOnce(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  (document.head ?? document.documentElement).appendChild(style);
}
