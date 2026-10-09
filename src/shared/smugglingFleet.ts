/** Which line of a fleet tile holds the pet's name. Confirmed change
 *  (2026-10-09, between 06:13 and 09:32 UTC): tiles went from
 *  `<b>Raven</b><span>The Strip</span>` to
 *  `<b>Black-Market Steroids &times;36</b><span>George &middot; Industrial District</span>`
 *  — the bold line became the cargo and the name moved in front of the
 *  district. Reading the bold line after that change made every active pet
 *  look idle, so Pet Courier sent busy pets in every `v2_launch`. The
 *  separator only appears in the new layout, so its presence picks the
 *  line; without it this falls back to the old bold-line name. `separator`
 *  is `&middot;` for raw HTML, `·` for DOM text. Shared by both
 *  smuggling panel parsers (background regex and content DOM), which read
 *  the same tile. */
export function fleetPetName(bold: string, sub: string, separator: string): string {
  const sepIdx = sub.indexOf(separator);
  if (sepIdx > 0) return sub.slice(0, sepIdx).trim();
  return bold.trim();
}
