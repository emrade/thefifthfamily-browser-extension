export interface PanelEnvelope {
  title: string;
  html: string;
}

/**
 * Every `GET /api/panel.php?type=X` response shares this one envelope —
 * `{"ok":true,"title":"...","html":"..."}` — confirmed identical across at least
 * `type=smuggling`, `type=street_intel`, and `type=travel` (the travel panel is just
 * a loading shell; its real data comes from a separate `/api/travel.php` call, but
 * the shell itself still arrives in this same envelope). Lives outside
 * features/tradeAssistant since it isn't Trade-Assistant-specific — any future
 * feature parsing a panel.php response (e.g. the planned Street Intel Assistant)
 * should unwrap through here rather than re-deriving this per adapter.
 */
export function unwrapPanelEnvelope(responseText: string): PanelEnvelope | null {
  let json: any;
  try {
    json = JSON.parse(responseText);
  } catch {
    return null;
  }
  if (!json?.ok || typeof json.html !== 'string') return null;
  return { title: typeof json.title === 'string' ? json.title : '', html: json.html };
}
