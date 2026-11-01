---
name: trivia
description: Use when the user starts a trivia or quiz session about The Fifth Family ("I'll ask some trivia questions", "quiz time", "/trivia"), or pastes in-game quiz/event questions about lore, families, vigilantes, items, vehicles, events or real-world mafia history. Switches into a fast question-answer mode: warm up the right sources once, then answer each question in a line or two with the source and a confidence flag.
user-invocable: true
argument-hint: "[first question, optional]"
---

# Trivia mode

The player is answering quiz questions, usually from an in-game event or a
community quiz. Questions arrive one after another. Each needs a short answer
they can type into the quiz. They don't need a research report.

## On entering the mode

1. Say you're ready in one line. Don't list sources or explain the mode.
2. Warm up the sources most quizzes hit, so later answers are a grep, not a fetch.
   Save the text in the session scratchpad:
   ```
   W=verification/wiki/wiki.py
   for s in syndicates vigilantes items pets chopshop racing rackets realestate forge; do
     python3 -I $W text $s > "$SCRATCH/$s.txt" 2>/dev/null; done
   python3 -I $W text arena > "$SCRATCH/arena.txt"   # in-game copy, stored from the archive
   ```
   `fetch` skips anything already fetched today, so this is cheap to repeat. If
   the first question arrives with the request, answer it as well; don't make
   the player wait for the warm-up to finish first.

## Answer format

- **Lead with the answer in bold.** One sentence of support follows, then the
  source (wiki section + copy date, or archive file). Nothing more unless
  something is uncertain.
- When you're unsure, put the best answer first, say why it's a guess in one
  clause, and name the **next candidate** to try if it's rejected.
- If the player asks for "one word" or "one sentence", give exactly that.
- Real-world history and mafia questions (bakuto, oicho-kabu, omertà, capo,
  rum-running, bratva) are general knowledge: answer directly, no tools, and add
  the in-game tie-in if one exists.

## Where answers live

| Question is about | Look in |
|---|---|
| Family head, leaning stat, blurb | `syndicates` (The Five Families) |
| Vigilante names, nicknames, backstory, lore | `vigilantes` (Legendary tier first) |
| A vigilante's signature / exclusive / "Crowned Legendary" item | `arena` (in-game Arena Bosses wiki): each boss's exclusive item, slot, stats, tickets, draw |
| Item names, rarity, which items exist | `items` (no descriptions, just names, rarity and stats) |
| Vehicles, prestige cars, family plants | `chopshop`, `racing` |
| Pets | `pets` (stats only, no lore) |
| Systems (Forge, Rackets, Real Estate, Street Intel...) | that section's header line describes the system |
| Racket specializations | `rackets`: each card's `### Business` line is "<type> <specialization>". List them with `grep -A1 "^### Business"`. Wiki names: Pure Cash, Restore Drip, Premium Stash, **Family Flavor** (one family's supplies plus a smaller Volkskaya cut, so it feeds that family's reputation), Flavor Supply. The in-game panel uses different labels for the same thing (Syndicate Stock ≈ Family Flavor, Street Supply ≈ Flavor Supply), so give the wiki name and mention the in-game one |
| Racket operating styles | newest export's racket panel: None, Shard Gatherer, Second Serving, Under the Radar |
| Events, bosses, announcements, event giveaways | `docs/events/`, `docs/game-changes/upcoming.md`, then the **newest** export's forum posts, notifications and system mail |

Archive search: grep **the newest single export** in `~/Downloads/tff archives/`
(a few hundred MB). Don't sweep the multi-GB `merged/` files during trivia
without asking: it takes minutes, and the player stopped every one of those
in the first session. Use `LC_ALL=C /usr/bin/grep` (the default grep is ugrep and
rejects long regexes), then strip HTML in Python.

## Lessons from the first session (2026-10-31)

- **A repeated question means the last answer was wrong.** Switch to the next
  candidate straight away and say so. Don't defend the first one or re-run the
  same search.
- **Quiz wording isn't the game's wording.** The quiz said "Family Reputation
  Score", but the page never uses that phrase. The answer (Family Flavor) was in
  the loot table's structure. If a keyword grep finds nothing, read the
  section's labels and entries in full before deciding the answer isn't there.
  Check the wiki before the archive: in-game panels can use different names.
- **Prefer the literal name match.** "Hearty meal" → *Field Meal*, not War Feast.
  "Espresso-themed" → *Roadside Espresso*. Quiz writers usually describe the
  item's own name.
- **Family items come in three-tier ladders.** Iron River: Rations → Field Meal →
  War Feast. Viola: Roadside Espresso → Nitro Blend → Devil's Highway Roast. List
  the ladder so the player has the fallbacks.
- **"Concept", "vibe" or "why" questions are usually community or dev context**
  that isn't in the game data. Example: Spirit of the Bombed = "making fun of
  players complaining about being bombed". Say so up front and give the best
  mechanical guess. Don't present a mechanics summary as the answer.
- **Event giveaways may never reach the wiki.** La Última Ofrenda (Halloween
  vehicle, a tribute dear to the Viola family) wasn't in any source. Event
  rewards come from the event page or mail, so check the newest export first.
- **"System associated with family X"** questions (Forge = Iron River, Real
  Estate = SBP, Rackets = Kito-gumi, Chop Shop = Viola, Street Intel =
  Volkskaya) come from the quiz writer, not from the wiki. Answer with the
  system that matches the description, and mention that the link is the quiz's.
- Never answer a question the quiz forbids the player from answering ("you're
  not allowed to answer this one"). Just say what the sources show.

## Quick reference (wiki copies of 2026-10-31; re-check if it matters)

| Family | Head | Leaning | Plant | Prestige car | Legendary vigilante | Exclusive (Crowned Legendary) |
|---|---|---|---|---|---|---|
| Iron River Syndicate | "Iron" (a title passed from head to head) | STR | Firecracker Vine | Juggernaut | Davi "The Giant" Perreira | The Giant's Breachplate (armor) |
| Society for Balance & Prosperity (SBP) | Haiyan "Old Man" Xiang | DEF | Field Bindweed | Executive | Zhi Xiang (Haiyan's grandson) | Xiang's Treasured Secret |
| Kito-gumi | Yawara Kito | DEX | White Yarrow | Sovereign | Grandma Watanabe | Grandma's Kiseru (a smoking pipe) |
| Viola Family | Massimo Viola | AGI | Creeping Charlie | Apex | Maria (Maria Viola) | Maria's Throat Fetchers |
| Volkskaya | Alyona Sokolov | Balanced (all four) | Persian Lily | Imperial | The Siren | The Siren's Microphone |

- Volkskaya runs the **Thirteen Year Party** (item: Thirteen-Year Guest List).
- Arena Mastery: +1/2/3/4% to the family stat per tier (10% total). Volkskaya
  gives +0.25/0.5/0.75/1% to every stat instead.
- Story-spoiler item: **Massimo's Last Route** (Fifth Family Mythic weapon).
- Most expensive priced consumable: **Don's Blessing**, $2,000,000.
