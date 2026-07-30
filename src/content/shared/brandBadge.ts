/**
 * The small gold diamond "V" crest + "Fifth Family / <subtitle>" label used to mark
 * any UI a content-script feature injects into the live game page as coming from
 * this extension, not the game itself — same crest as the popup header. Shared so
 * Fight Club's toolbar and Street Intel's highlights (and any future in-page
 * feature) all carry the identical mark instead of each re-implementing it.
 */
export const BRAND_BADGE_CSS = `
.ff-brand { display: flex; align-items: center; gap: 8px; }
.ff-crest {
  width: 22px; height: 22px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transform: rotate(45deg);
  background: linear-gradient(135deg, rgba(201,168,76,.24), rgba(201,168,76,.05));
  border: 1px solid rgba(201,168,76,.5);
  border-radius: 4px;
}
.ff-crest span {
  transform: rotate(-45deg);
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 800;
  font-size: 10.5px;
  color: #e8c766;
}
.ff-brand-text { display: flex; flex-direction: column; gap: 1px; line-height: 1; }
.ff-brand-text strong {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .06em;
  color: #d9c48a;
  white-space: nowrap;
}
.ff-brand-text small {
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 7px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: #6b6455;
  white-space: nowrap;
}
`;

export function brandBadgeHtml(subtitle: string): string {
  return '<div class="ff-brand"><div class="ff-crest"><span>V</span></div>'
    + `<div class="ff-brand-text"><strong>Fifth Family</strong><small>${subtitle}</small></div></div>`;
}
