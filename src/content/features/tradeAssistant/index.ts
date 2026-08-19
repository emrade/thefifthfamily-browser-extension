import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage as send } from '@/shared/messaging';
import { LOG_PREFIX } from '@/shared/log';
import { parseSmugglingV2Panel } from './adapters/smugglingV2PanelAdapter';
import { parseSmugglingAction } from './adapters/smugglingActionAdapter';
import { parseTravelAction, TRACKED_TRAVEL_ACTIONS } from './adapters/travelAdapter';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';

export function handleCapturedRequest(req: CapturedRequest) {
  const url = new URL(req.url, window.location.origin);
  const path = url.pathname;

  // `smug_tab=proto` used to distinguish the real dashboard from a bare tab-switcher
  // stub at `type=smuggling` with no `smug_tab` at all — confirmed no longer true
  // (2026-08-19): the bare URL now returns the full sv2 content directly, no
  // `smug_tab` param needed or sent. Matching on `type=smuggling` alone, regardless
  // of `smug_tab`, covers both the old and new URL shapes rather than depending on
  // one specific query param the game turned out to be free to drop. The old
  // `.sgl-*` parser (`smugglingPanelAdapter.ts`) that used to run here is retired
  // from this dispatch entirely — it was already permanently dead against sv2
  // markup, and kept firing a misleading "failed to parse" error on every single
  // capture once the bare URL started carrying real content, which is actively
  // worse than the silence it's replaced with. The file itself is left alone,
  // matching docs/smuggling-v2-plan.md's "bundled cleanup, not urgent" note.
  if (path.endsWith('/api/panel.php') && url.searchParams.get('type') === 'smuggling') {
    const snapshot = parseSmugglingV2Panel(req.responseText);
    if (!snapshot) {
      recordParseFailure('tradeAssistant');
      console.error(LOG_PREFIX, 'smuggling panel captured but failed to parse the envelope', req.responseText.slice(0, 200));
      return;
    }
    recordParseSuccess('tradeAssistant');
    // A concise per-capture summary — this endpoint fires often (a real session
    // sees it hundreds of times a day), so this stays at `log` rather than `error`
    // and is meant to be filtered for (search devtools console for LOG_PREFIX),
    // not read passively. Exists specifically so "did this actually parse, and
    // did it see the roster" is checkable without adding a temporary debug patch
    // every time it's in question.
    console.log(
      LOG_PREFIX,
      `smuggling panel parsed: fleet=${snapshot.fleet.length} roster=${snapshot.roster.length} blackMarket=${snapshot.blackMarket.length} destinations=${snapshot.destinations.length}`,
    );
    // Most captures don't show the roster at all (see the adapter's own doc
    // comment) — only send when there's actually something to persist.
    if (snapshot.roster.length > 0) {
      send({ type: 'pet-roster-observed', entries: snapshot.roster });
    }
    return;
  }

  if (path.endsWith('/actions/smuggling.php') && req.method === 'POST') {
    const message = parseSmugglingAction(req.requestBody, req.responseText, req.timestamp);
    if (message) send(message);
    // No `else` log here — a null result just means this particular action outcome
    // isn't one we track (e.g. a precondition failure like insufficient cash), which
    // is routine, not an error.
    return;
  }

  if (path.endsWith('/actions/travel_proto.php') && req.method === 'POST') {
    const message = parseTravelAction(req.requestBody, req.responseText, req.timestamp);
    if (message) {
      send(message);
      recordParseSuccess('tradeAssistant');
    } else if (req.requestBody && TRACKED_TRAVEL_ACTIONS.has(new URLSearchParams(req.requestBody).get('action') ?? '')) {
      // A recognised action (get_state/start_trip) that still failed to parse is a
      // real signal — anything else (an untracked action, or `cancel`, whose name
      // survived the rename unverified) is routine, same as the smuggling-action
      // branch above.
      recordParseFailure('tradeAssistant');
    }
    return;
  }
}
