/**
 * "Near repeat" comparison for the archive's busiest pages.
 *
 * The extension's own automations re-read the Smuggling, Crimes and Careers
 * pages every few seconds. Most reads differ from the last stored one only in
 * numbers (timers, counters, cash), which `skipsIdenticalRepeat` can't catch.
 * `numberlessText` reduces a body to what's left once numbers are ignored, so
 * such a read can be dropped (see `nearRepeatIntervalFor` in policy.ts).
 *
 * Two things besides digits are normalised, both checked on real pages
 * (2026-11-03) before being added:
 *
 * - The Crimes page embeds its crime-button script base64-encoded
 *   (`eval(atob('…'))`, ~27 KB). Base64 re-encodes the whole block when one
 *   digit inside changes (`recalcCrimes(0)` → `recalcCrimes(20)`), so every
 *   read looked new. The block is decoded and compared like the rest of the
 *   page: a change to the script itself still counts.
 *
 * scripts/merge-archives.py (`numberless_hash`) applies the same rule to the
 * history on disk; keep the two in step.
 */

/** ASCII digits only. Python's `\d` also matches other scripts' digits, so
 *  the merge script uses `[0-9]` too. */
const DIGITS = /[0-9]+/g;

/** A base64 payload passed to `atob(` in the page's markup. The page body is
 *  JSON-wrapped HTML, so the quote may be escaped. */
const ATOB_PAYLOAD = /(atob\(\\?')([A-Za-z0-9+/=]{100,})/g;

function decodeBase64Utf8(b64: string): string | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The body as compared for near repeats. Never stored or shown. */
export function numberlessText(body: string): string {
  const decoded = body.replace(ATOB_PAYLOAD, (whole, prefix: string, b64: string) => {
    const text = decodeBase64Utf8(b64);
    return text === null ? whole : prefix + text;
  });
  return decoded.replace(DIGITS, '');
}
