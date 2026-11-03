---
name: pre-ship-check
description: Use before reporting a feature, fix or data analysis as done, before /release, and whenever the user asks "did you check…?". Works through what the change rests on — assumptions, stand-ins for the real source, time windows, data limits, failure cases — and verifies each against the code or the data instead of trusting it. Run it on anything non-trivial; for a one-line fix, the CLAUDE.md checklist is enough.
user-invocable: true
argument-hint: "[what is about to be reported or shipped]"
---

# Pre-ship check

The habit this enforces: **don't stop at "it computes correctly", check
that what it rests on is true.** Every miss below was correct arithmetic on
a wrong premise. Each one was found by the player, not by me:
- The request archive was said to keep 30 days, from an old code comment.
  The export headers show ~2 days.
- "Armory adds 5% damage" came from comparing averages that mixed in other
  differences. Checked hit by hit, it adds nothing.
- 20 of 116 fights went unpaired because only one Arena page variant was
  read. Nobody asked why they were missing.
- A record line, "2–4 vs them", mixed two seasons. The count was right; the
  window was wrong.
- Max HP was used as the season marker. The game publishes the real season
  dates on the Arena page.
- Two reviewers were given the same output path, so the second overwrote
  the first.

Work through every section, write the answers down, and **verify, don't
recall**: open the file, run the query, read the real data. If something
can't be verified, say so in the report.

## 1. List the premises

Write down every fact the change or conclusion depends on, including the
"obvious" ones. For example: how long data is kept, which endpoint or page
variant carries it, what a field means, when a period starts, what the
player sees, what another feature does with the same data.

For each one, mark it **verified** (say how: file and line, query, count)
or **assumed**, then verify the assumed ones now. Code comments and
earlier conclusions are claims, not evidence.

## 2. Stand-ins vs the real source

For each value standing in for something else, ask: does the game, the
page or the data state the real thing directly? For example: HP for
"season", one endpoint for "all Arena pages", a correlation for a rule, a
default constant for a live value. If it does, use that. If not, write down
when the stand-in would go wrong.

## 3. Time windows and history

For every number built from history (records, averages, suggestions,
counts):
- **Which period should it cover?** This season, since a patch, a rolling
  window, all-time.
- **Does it mix periods** where the rules or the player's stats differed?
  Look at the actual **dates** in the test output, not just the totals.
- **How much history really exists?** Check the storage limits (e.g. the
  request archive's ~100 MB cap) and the coverage gaps
  (`.claude/skills/use-archives`).

## 4. Complete inputs

When matching or filtering data, count what fell out and find out why:
unpaired fights, unparsed rows, other endpoint variants, truncated bodies.
A gap of 1 in 6 is a finding, not noise.

## 5. Failure cases

Ask what breaks it, and test the ones that apply, preferably against real
data:
- the same thing seen twice: two tabs, a re-import, a live capture plus a
  backfill, a duplicated alarm;
- the boundaries: a new season or day, a year change, the game changing a
  formula, the first run with no data yet;
- old stored data from a previous version still readable;
- the user switching the setting off mid-way; the extension updating under
  an open page;
- two writers to the same file or storage key (including agents).

## 6. Generalise before concluding

For an explanation built on one case (one opponent, one day, one fight),
check similar cases and a control group before reporting it. "It happened
to X" is not "it's why", until the cases without X look different.

## 7. The user's first question

Read the result as the player will. What is the first thing they'd ask:
"does this mix seasons?", "what about when I don't level up?", "where do I
get that file?". Answer it now, in the code or in the report.

## 8. Report

- Say what was verified and how, what's inferred, and what couldn't be
  checked.
- If a premise turned out wrong, say so plainly, and fix any doc or
  description that repeats it.
- For decision-driving analyses or big features, offer an independent
  review: a fresh agent working from a brief, not from my conclusions
  (`docs/agent-briefs/`, with numbered output files).
