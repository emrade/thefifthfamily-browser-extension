import {
  SHAPE_MAX_EVENTS,
  SHAPE_REMOVAL_MAX_FRACTION,
  SHAPE_REWRITE_CONFIRM_OBSERVATIONS,
  SHAPE_UNIVERSAL_MIN_OBSERVATIONS,
  SHAPE_WARMUP_MS,
  SHAPE_WARMUP_OBSERVATIONS,
} from '@/shared/constants';
import type { EndpointProfile, PendingRemoval, StructuralEvent, TokenStat } from './types';

/** How much of a response is kept verbatim on a profile, purely as human context
 *  next to a token list. Small on purpose — the full body is one lookup away in
 *  `requestLog`. */
export const SAMPLE_CHARS = 2_000;

export interface FoldResult {
  profile: EndpointProfile;
  /** Events this observation produced, so the caller can log them. Kept out of the
   *  fold itself to keep it pure and reusable from the offline rebuild, which
   *  would otherwise spam the console with thousands of historical events. */
  newEvents: StructuralEvent[];
}

/**
 * Folds one observation into an endpoint's structural profile.
 *
 * Pure, so the exact same logic backs the live write path and the offline rebuild
 * over an existing archive. That matters more than it sounds: a rebuild that
 * classified tokens even slightly differently from the live path would produce an
 * index that disagreed with itself depending on when it was built.
 *
 * The model tracks a cumulative *vocabulary* rather than a set of distinct
 * structures. An earlier design stored one row per distinct token set and treated
 * "more than one" as a change, which measured the wrong thing entirely: a single
 * endpoint routinely returns several unrelated structures, and any optional
 * element forks the set every time it toggles. Against real traffic that reported
 * every endpoint as changed within an hour of first use.
 */
export function foldObservation(
  existing: EndpointProfile | null,
  endpoint: string,
  tokens: string[],
  sample: string,
  timestamp: number,
): FoldResult {
  if (!existing) {
    const vocabulary: Record<string, TokenStat> = {};
    for (const token of tokens) vocabulary[token] = { firstSeen: timestamp, count: 1 };
    return {
      profile: {
        endpoint,
        firstSeen: timestamp,
        lastSeen: timestamp,
        count: 1,
        tokens: vocabulary,
        events: [],
        sample: sample.slice(0, SAMPLE_CHARS),
      },
      newEvents: [],
    };
  }

  const seen = new Set(tokens);
  const priorObservations = existing.count;

  // Nothing is reported until an endpoint's normal repertoire has been observed.
  // That repertoire is wider than it looks: `panel.php?type=smuggling` returns a
  // market listing *or* a customs raid screen, `travel.php` returns a city list, a
  // confirmation, or an error, and a cooldown timer blinks five classes in and out
  // between consecutive polls. All normal, all must be learned rather than announced.
  const established =
    priorObservations >= SHAPE_WARMUP_OBSERVATIONS && timestamp - existing.firstSeen >= SHAPE_WARMUP_MS;

  const newEvents: StructuralEvent[] = [];

  // Computed once, outside the `established` gate, because the rewrite watch below
  // needs it too.
  const removedUniversalRaw = Object.entries(existing.tokens)
    .filter(([token, stat]) => stat.count === priorObservations && !seen.has(token))
    .map(([token]) => token);

  if (established) {
    const newTokens = tokens.filter((token) => !(token in existing.tokens));
    if (newTokens.length) {
      newEvents.push({ at: timestamp, kind: 'new-tokens', tokens: newTokens, observations: priorObservations });
    }

    // "Universal" is measured against the observation count *before* this response,
    // so a token qualifies only if it was present every single previous time.
    // Optional tokens never reach that bar, which is what makes this immune to the
    // blinking-cooldown case that broke the previous design.
    const removedUniversal = removedUniversalRaw;

    // A variant switch drops nearly the whole vocabulary at once — a raid screen
    // shares almost nothing with a market listing. A real removal is targeted, so a
    // wholesale disappearance is read as "this is a different page", not "these
    // fields are gone". Once it has happened those tokens are no longer universal,
    // so this can only ever misjudge the first occurrence.
    const vocabularySize = Object.keys(existing.tokens).length;
    const targeted =
      removedUniversal.length > 0 &&
      removedUniversal.length <= Math.max(1, Math.floor(vocabularySize * SHAPE_REMOVAL_MAX_FRACTION)) &&
      priorObservations >= SHAPE_UNIVERSAL_MIN_OBSERVATIONS;

    if (targeted) {
      newEvents.push({
        at: timestamp,
        kind: 'removed-universal',
        tokens: removedUniversal,
        observations: priorObservations,
      });
    }
  }

  // A mass disappearance is not dismissed outright — it is watched.
  //
  // Suppressing it entirely (the previous behaviour) left the index blind to a
  // rewritten endpoint, which is the single event this whole index exists to
  // catch: a rewrite drops most of its vocabulary at once, exactly like a raid
  // screen replacing a market listing. The two are indistinguishable at the
  // moment they happen and trivially distinguishable afterwards — the variant
  // comes back, the rewrite does not.
  const massRemoval =
    established &&
    removedUniversalRaw.length > Math.max(1, Math.floor(Object.keys(existing.tokens).length * SHAPE_REMOVAL_MAX_FRACTION));

  let pendingRemoval: PendingRemoval | null = existing.pendingRemoval ?? null;

  if (pendingRemoval) {
    const returned = pendingRemoval.tokens.some((token) => seen.has(token));
    if (returned) {
      // It came back, so it was a variant all along. Drop the watch silently —
      // this is the common case and is not worth reporting.
      pendingRemoval = null;
    } else {
      pendingRemoval = { ...pendingRemoval, observationsSince: pendingRemoval.observationsSince + 1 };
      if (pendingRemoval.observationsSince >= SHAPE_REWRITE_CONFIRM_OBSERVATIONS) {
        newEvents.push({
          at: timestamp,
          kind: 'endpoint-rewritten',
          tokens: pendingRemoval.tokens,
          observations: priorObservations,
        });
        pendingRemoval = null;
      }
    }
  } else if (massRemoval) {
    pendingRemoval = { tokens: removedUniversalRaw, since: timestamp, observationsSince: 1 };
  }

  const vocabulary = { ...existing.tokens };
  for (const token of tokens) {
    const stat = vocabulary[token];
    vocabulary[token] = stat ? { firstSeen: stat.firstSeen, count: stat.count + 1 } : { firstSeen: timestamp, count: 1 };
  }

  return {
    profile: {
      ...existing,
      lastSeen: Math.max(existing.lastSeen, timestamp),
      count: priorObservations + 1,
      tokens: vocabulary,
      events: [...existing.events, ...newEvents].slice(-SHAPE_MAX_EVENTS),
      pendingRemoval,
      sample: sample.slice(0, SAMPLE_CHARS),
    },
    newEvents,
  };
}
