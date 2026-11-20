# Companion tool checks

Archive checks behind docs/companion-tool-plan.md (2026-11-20). Outputs go to a
scratch folder, never the repo (they hold archive data).

```sh
OUT=<scratch folder>
python3 -I verification/street-intel/companion/extract_scouts.py verification $OUT/scouts.json
python3 -I verification/street-intel/companion/extract_levels.py verification $OUT/levels.json
(cd verification/street-intel && python3 -E -s build_analytics_seed.py --since 2026-08-10 --card-days 1 --out $OUT/seed.json)

python3 -I verification/street-intel/companion/verify_calibration.py . $OUT/scouts.json
python3 -I verification/street-intel/companion/verify_unknown_cards.py . $OUT/scouts.json
python3 -I verification/street-intel/companion/verify_card_value.py $OUT/seed.json $OUT/scouts.json $OUT/levels.json
```

| Script | Question | Result (2026-11-20) |
|---|---|---|
| `verify_calibration.py` | Can a member's hidden bonuses be worked out from one scout? | yes: 97% of later odds within 1 point (6 h, same card type) |
| `verify_unknown_cards.py` | Can members' scouts reveal an unknown card's approach roles? | yes: 87% exact, 13% two-way, 0 wrong |
| `verify_card_value.py` | Do per-card value labels hold? | no: no better than chance; tier ranking flips with level |
