#!/usr/bin/env python3
"""Downloads and reads the game's public wiki (https://www.thefifthfamily.com/wiki.php).

The public wiki serves the same pages the in-game wiki panel does, whole and
without a login, so nothing here touches the player's account. Each download is
kept as a dated copy, so a section can be compared with an earlier one to see
what the game changed. See .claude/skills/use-wiki/SKILL.md.

    wiki.py sections                     list every section (fetches the landing page)
    wiki.py fetch intel crimes           download sections (skips one already fetched today)
    wiki.py fetch --all                  every section, one request a second
    wiki.py text intel                   the WHOLE page as readable text — read this to answer questions
    wiki.py parse intel                  newest copy as JSON (cards, tables) for bulk number work;
                                         warns on stderr when part of the page isn't in its output
    wiki.py parse intel --csv            one row per card: name, level, chips
    wiki.py diff intel                   full-text changes vs the copy before it (+ card chip summary)
    wiki.py history intel                stored copies of a section
    wiki.py ingame arena                 newest whole in-game copy from the exported archives
                                         (for sections the public site lacks: arena)

Copies live in $TFF_WIKI_DIR (default ~/Downloads/tff archives/wiki/<section>/<UTC time>.html).
The pages are third-party HTML: parse them, never execute them; run with python3 -I.
"""

import argparse
import csv
import datetime
import difflib
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

BASE = "https://www.thefifthfamily.com/wiki.php"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0"
DOWNLOADS = Path(os.environ.get("TFF_DOWNLOADS_DIR", Path.home() / "Downloads")).expanduser()
WIKI_DIR = Path(os.environ.get("TFF_WIKI_DIR", DOWNLOADS / "tff archives" / "wiki")).expanduser()
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


# ---------------------------------------------------------------- download

def url_for(section):
    return BASE if section == "index" else f"{BASE}?section={section}"


def download(section):
    req = urllib.request.Request(url_for(section), headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        if err.code == 404:
            # Some sections (arena, combat) are only in the game's own wiki panel.
            raise SystemExit(
                f"{section}: not on the public wiki (404) — it's in-game only. Open it in the game's wiki, "
                f"export the archive, then run: wiki.py ingame {section}")
        raise SystemExit(f"{section}: HTTP {err.code} from the public wiki")
    except urllib.error.URLError as err:
        raise SystemExit(f"{section}: couldn't reach the public wiki ({err.reason})")


def copies(section):
    d = WIKI_DIR / section
    return sorted(d.glob("*.html")) if d.is_dir() else []


def fetch(section, force=False):
    """Stores a new dated copy unless today's already exists (or the page is
    byte-identical to the newest copy, which is then only reported)."""
    existing = copies(section)
    today = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d")
    if existing and existing[-1].name.startswith(today) and not force:
        print(f"{section}: already fetched today ({existing[-1].name}), use --force to refetch")
        return existing[-1]
    text = download(section)
    if existing and existing[-1].read_text(encoding="utf-8") == text:
        print(f"{section}: unchanged since {existing[-1].name}")
        return existing[-1]
    stamp = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H-%M-%SZ")
    path = WIKI_DIR / section / f"{stamp}.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"{section}: saved {len(text):,} bytes -> {path}")
    return path


def latest(section, fetch_if_missing=True):
    existing = copies(section)
    if existing:
        return existing[-1]
    if not fetch_if_missing:
        raise SystemExit(f"no stored copy of {section!r} in {WIKI_DIR}")
    return fetch(section)


# ---------------------------------------------------------------- tiny DOM

class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.children, self.parent = tag, dict(attrs), [], parent

    @property
    def classes(self):
        return (self.attrs.get("class") or "").split()

    def has(self, cls):
        return cls in self.classes

    def text(self):
        out = []
        for c in self.children:
            out.append(c if isinstance(c, str) else c.text())
        return "".join(out)

    def clean(self):
        return re.sub(r"\s+", " ", self.text()).strip()

    def walk(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.walk()

    def find_all(self, cls=None, tag=None):
        return [n for n in self.walk() if (cls is None or n.has(cls)) and (tag is None or n.tag == tag)]

    def find(self, cls=None, tag=None):
        return next((n for n in self.walk() if (cls is None or n.has(cls)) and (tag is None or n.tag == tag)), None)


class Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root", {}, None)
        self.cur = self.root
        self.skip = 0  # inside <script>/<style>

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
            return
        if self.skip:
            return
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        if not self.skip:
            self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag in VOID:
            return
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        if not self.skip:
            self.cur.children.append(data)


def dom(text):
    b = Builder()
    b.feed(text)
    return b.root


# ---------------------------------------------------------------- page model

def parts(node):
    """Text of each direct child element (or bare text), in order — keeps the
    separate spans of a line (stat, label, modifier, approach) apart."""
    out = []
    for c in node.children:
        t = re.sub(r"\s+", " ", c if isinstance(c, str) else c.text()).strip()
        if t:
            out.append(t)
    return out


def table_of(t):
    head = [th.clean() for th in t.find_all(tag="th")]
    rows = []
    for tr in t.find_all(tag="tr"):
        cells = [td.clean() for td in tr.children if isinstance(td, Node) and td.tag == "td"]
        if cells:
            rows.append(dict(zip(head, cells)) if head and len(head) == len(cells) else cells)
    return {"columns": head, "rows": rows}


def chips_of(node):
    """Labelled chips as {label: value}, plus the values of any chip that has no
    label (Arena boss cards lead with one holding the exclusive item's name)."""
    out, unlabelled = {}, []
    for chip in node.find_all("w2-chip"):
        b = chip.find(tag="b")
        label = "".join(c for c in chip.children if isinstance(c, str)).strip()
        if label:
            out[label] = b.clean() if b else ""
        else:
            unlabelled.append(chip.clean())
    return out, unlabelled


def card_of(node):
    head = node.find("w2-crime-head")
    name = node.find("w2-crime-name")
    lvl = node.find("w2-lvl")
    lvl_text = lvl.clean() if lvl else None
    card = {
        "name": name.clean() if name else None,
        "level": int(m.group(1)) if lvl_text and (m := re.fullmatch(r"LVL (\d+)", lvl_text)) else None,
        # The head's corner tag when it isn't a level: an Arena boss's tier
        # ("common"), a Mastery family's bonus ("DEX +10%").
        "tag": lvl_text if lvl_text and not re.fullmatch(r"LVL \d+", lvl_text) else None,
        "badges": [b.clean() for b in (head.find_all("wiki-badge") if head else [])],
        "subtitle": None,
        "chips": {},
        "labels": [],  # unlabelled chips
        "lists": [],   # {"heading", "lines": [[part, ...]]}
        "pools": [],   # {"heading", "title", "items" | "table"}
        "tables": [],
        "notes": [],
    }
    for cnt in node.children:
        if isinstance(cnt, Node) and cnt.has("w2-cnt"):
            card["subtitle"] = cnt.clean()
            break
    for chips in node.find_all("w2-chips"):
        labelled, unlabelled = chips_of(chips)
        card["chips"].update(labelled)
        card["labels"] += unlabelled
    heading = None
    inside_pool = set()
    for n in node.walk():
        if n.has("w2-loot-h"):
            heading = n.clean()
        elif n.has("w2-pool-flat") or n.tag == "li":
            # Flat rows (approaches, loot lines) and plain bullet lists
            # (a crime's Required Items) both become lines under the heading.
            if not card["lists"] or card["lists"][-1]["heading"] != heading:
                card["lists"].append({"heading": heading, "lines": []})
            card["lists"][-1]["lines"].append(parts(n))
        elif n.has("w2-pool"):
            summary = n.find(tag="summary")
            body = n.find("w2-pool-body")
            entry = {"heading": heading, "title": parts(summary) if summary else []}
            tbl = n.find("wiki-table")
            if tbl:
                entry["table"] = table_of(tbl)
                inside_pool.update(id(x) for x in [tbl])
            if body:
                entry["items"] = [p for p in parts(body) if p != "·"]
            card["pools"].append(entry)
    for t in node.find_all("wiki-table"):
        if id(t) not in inside_pool:
            card["tables"].append(table_of(t))
    # Loose descriptive lines: small divs with only text, outside lists/pools/chips.
    for n in node.walk():
        if n.tag == "div" and not n.classes and all(isinstance(c, str) for c in n.children):
            t = n.clean()
            if t:
                card["notes"].append(t)
    return card


def parse_page(text):
    root = dom(text)
    content = root.find("wiki-content") or root
    page = {
        "title": (content.find("wiki-title") or Node("x", {}, None)).clean() or None,
        "subtitle": (content.find("wiki-subtitle") or Node("x", {}, None)).clean() or None,
        "notes": [],
        "groups": [],
    }
    group = {"title": None, "cards": [], "tables": []}
    page["groups"].append(group)

    def visit(n):
        nonlocal group
        for c in n.children:
            if not isinstance(c, Node):
                continue
            # Section titles head most pages' groups; some (Arena Bosses) use a
            # plain subheading between cards instead.
            if c.has("wiki-section-title") or c.has("w2-loot-h"):
                group = {"title": c.clean(), "cards": [], "tables": []}
                page["groups"].append(group)
            elif c.has("w2-note"):
                page["notes"].append(c.clean())
            elif c.has("w2-crime"):
                group["cards"].append(card_of(c))
            elif c.has("wiki-table"):
                group["tables"].append(table_of(c))
            else:
                visit(c)

    visit(content)
    page["groups"] = [g for g in page["groups"] if g["cards"] or g["tables"]]
    return page


def sections_of(text):
    root = dom(text)
    out = {}
    for a in root.find_all("wiki-nav-item"):
        href = a.attrs.get("href") or a.attrs.get("onclick") or ""
        m = re.search(r"section=([a-z0-9_]+)", href)
        if m:
            out.setdefault(m.group(1), a.clean())
    return out


# ---------------------------------------------------------------- full text

# Elements that start their own line. Everything else (span, b, a, img, ...) is
# inline and joins its neighbours with a space.
BLOCK_TAGS = {"div", "p", "details", "summary", "tr", "li", "ul", "ol", "table", "thead", "tbody",
              "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "br"}
HEADING_MARK = {"wiki-title": "#", "wiki-section-title": "##", "w2-loot-h": "###", "w2-crime-head": "####"}


def page_text(text):
    """The page's whole visible content as readable lines, nothing dropped:
    headings marked with #, a card's head on one line, chips as `Label: value`,
    table rows as `a | b | c`. This — not `parse` — is what to read when
    answering a question; `parse` is only a convenience for bulk numbers."""
    root = dom(text)
    content = root.find("wiki-content") or root
    lines = []

    def inline(n):
        if isinstance(n, str):
            return n
        if n.tag in ("input", "img"):
            return " "
        return " " + "".join(inline(c) for c in n.children) + " "

    def emit(s, prefix=""):
        s = re.sub(r"\s+", " ", s).strip()
        if s:
            lines.append(f"{prefix}{s}")

    def chip(n):
        b = n.find(tag="b")
        label = "".join(c for c in n.children if isinstance(c, str)).strip()
        value = re.sub(r"\s+", " ", inline(b)).strip() if b else ""
        return f"{label}: {value}" if label and value else (label or value)

    def block(n):
        if n.has("wiki-search"):
            return
        mark = next((m for cls, m in HEADING_MARK.items() if n.has(cls)), None)
        if mark:
            lines.append("")
            emit(inline(n), mark + " ")
            return
        if n.has("w2-chips"):
            emit("  ·  ".join(chip(c) for c in n.find_all("w2-chip")))
            return
        if n.tag == "tr":
            cells = [re.sub(r"\s+", " ", inline(c)).strip() for c in n.children if isinstance(c, Node) and c.tag in ("td", "th")]
            emit(" | ".join(cells))
            return
        if n.tag == "table":
            lines.append("")
        # Text directly inside this block, between its child blocks, becomes its own line.
        run = []
        for c in n.children:
            if isinstance(c, Node) and (c.tag in BLOCK_TAGS or any(c.has(k) for k in HEADING_MARK) or c.has("w2-chips")):
                emit("".join(inline(x) for x in run))
                run = []
                block(c)
            else:
                run.append(c)
        emit("".join(inline(x) for x in run))

    block(content)
    out = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", out).strip() + "\n"


def _words(s):
    # Edge punctuation stripped so JSON's `30,` matches the page's `30`.
    return [w for w in (t.strip(".,'") for t in re.findall(r"[A-Za-z0-9%$.,+\-']+", s)) if w]


def coverage(text, page):
    """Share of the page's visible words that never made it into `parse`'s
    output, with a sample — so a section whose layout the parser doesn't know
    can't silently lose data. `LVL` is excluded: levels are kept as numbers."""
    # A card's collapsible toggle ("Approaches", "Loot & Requirements") is a
    # button label, not data; its contents are what count.
    root = dom(text)
    toggles = {}
    for card in root.find_all("w2-crime"):
        for d in card.children:
            if isinstance(d, Node) and d.tag == "details":
                s = next((c for c in d.children if isinstance(c, Node) and c.tag == "summary"), None)
                for w in _words(s.text()) if s else []:
                    toggles[w] = toggles.get(w, 0) + 1
    visible = []
    for w in _words(page_text(text)):
        if w == "LVL":
            continue
        if toggles.get(w):
            toggles[w] -= 1
            continue
        visible.append(w)
    pool = {}
    for w in _words(json.dumps(page, ensure_ascii=False)):
        pool[w] = pool.get(w, 0) + 1
    missed = []
    for w in visible:
        if pool.get(w):
            pool[w] -= 1
        else:
            missed.append(w)
    return (len(missed) / len(visible) if visible else 0.0), missed


# ---------------------------------------------------------------- commands

def flat_cards(page):
    for g in page["groups"]:
        for c in g["cards"]:
            yield g["title"], c


def cmd_sections(args):
    for key, label in sections_of(download("index")).items():
        n = len(copies(key))
        print(f"{key:14} {label}{f'  ({n} stored)' if n else ''}")


def cmd_fetch(args):
    names = list(sections_of(download("index"))) if args.all else args.sections
    if not names:
        raise SystemExit("name sections, or --all")
    for i, s in enumerate(names):
        if i:
            time.sleep(1)
        fetch(s, force=args.force)


def cmd_text(args):
    sys.stdout.write(page_text(latest(args.section).read_text(encoding="utf-8")))


def warn_coverage(section, text, page):
    share, missed = coverage(text, page)
    if share > 0.02:
        print(f"warning: {share:.0%} of {section}'s visible text isn't in this output "
              f"(e.g. {' '.join(missed[:20])}) — read `wiki.py text {section}` for the full page",
              file=sys.stderr)


def cmd_parse(args):
    path = latest(args.section)
    text = path.read_text(encoding="utf-8")
    page = parse_page(text)
    page["source"] = str(path)
    warn_coverage(args.section, text, page)
    if args.csv:
        rows = [{"group": g, "name": c["name"], "level": c["level"], "tag": c["tag"], "subtitle": c["subtitle"],
                 "badges": " / ".join(c["badges"]), "labels": " / ".join(c["labels"]), **c["chips"]}
                for g, c in flat_cards(page)]
        cols = list(dict.fromkeys(k for r in rows for k in r))
        w = csv.DictWriter(sys.stdout, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
        return
    print(json.dumps(page, indent=1, ensure_ascii=False))


def card_key(group, card):
    return f"{group} / {card['name']}"


def cmd_diff(args):
    """Compares the full text of the two newest copies, so a changed sentence
    anywhere counts — then, as a summary, which parsed cards' chips moved."""
    paths = copies(args.section)
    if len(paths) < 2:
        raise SystemExit(f"need two stored copies of {args.section!r} (have {len(paths)}); fetch again on another day")
    raw_old, raw_new = (p.read_text(encoding="utf-8") for p in paths[-2:])
    print(f"{paths[-2].name} -> {paths[-1].name}")
    text_old, text_new = page_text(raw_old).splitlines(), page_text(raw_new).splitlines()
    if text_old == text_new:
        print("content identical — only markup/styling differs" if raw_old != raw_new else "byte-identical")
        return

    old, new = parse_page(raw_old), parse_page(raw_new)
    a = {card_key(g, c): c for g, c in flat_cards(old)}
    b = {card_key(g, c): c for g, c in flat_cards(new)}
    summary = [f"+ {k}" for k in sorted(b.keys() - a.keys())] + [f"- {k}" for k in sorted(a.keys() - b.keys())]
    for k in sorted(a.keys() & b.keys()):
        for ch in sorted(set(a[k]["chips"]) | set(b[k]["chips"])):
            if a[k]["chips"].get(ch) != b[k]["chips"].get(ch):
                summary.append(f"~ {k}: {ch} {a[k]['chips'].get(ch)} -> {b[k]['chips'].get(ch)}")
    if summary:
        print("\nCards (summary of parsed chips):")
        print("\n".join(summary))

    print("\nFull text changes:")
    shown = 0
    for line in difflib.unified_diff(text_old, text_new, lineterm="", n=args.context):
        if line.startswith(("---", "+++")):
            continue
        print(line)
        shown += 1
        if shown >= args.limit:
            print(f"... (more; rerun with --limit to see past {args.limit} lines)")
            break


def cmd_ingame(args):
    """Stores the newest whole in-game capture of a section, read from the
    player's exported archives — for sections the public site doesn't serve
    (`arena`). Archives are scanned newest first; the first one holding an uncut
    copy wins."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from archive_paths import find_archives  # noqa: E402

    needle = f'"endpoint":"GET /api/panel.php?section={args.section}&type=wiki_v2"'
    paths = args.archive or list(reversed(find_archives()))
    for path in paths:
        best = None
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                if needle not in line:
                    continue
                row = json.loads(line)
                if row.get("truncated") or row.get("status") != 200:
                    continue
                if best is None or row["timestamp"] > best["timestamp"]:
                    best = row
        if best is None:
            continue
        page = json.loads(best["responseBody"])["html"]
        stamp = datetime.datetime.fromtimestamp(best["timestamp"] / 1000, datetime.UTC).strftime("%Y-%m-%dT%H-%M-%SZ")
        existing = copies(args.section)
        if existing and existing[-1].read_text(encoding="utf-8") == page:
            print(f"{args.section}: unchanged since {existing[-1].name}")
            return
        out = WIKI_DIR / args.section / f"{stamp}-ingame.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page, encoding="utf-8")
        print(f"{args.section}: in-game copy from {best['isoTime']} ({Path(path).name}) -> {out}")
        return
    raise SystemExit(
        f"no whole in-game copy of {args.section!r} in the archives — open that wiki page in the game, "
        "then export (Download New Since Last Export)")


def cmd_history(args):
    for p in copies(args.section):
        print(p.name, f"{p.stat().st_size:,}", hashlib.sha256(p.read_bytes()).hexdigest()[:12])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sections").set_defaults(fn=cmd_sections)
    f = sub.add_parser("fetch")
    f.add_argument("sections", nargs="*")
    f.add_argument("--all", action="store_true")
    f.add_argument("--force", action="store_true", help="refetch even if already fetched today")
    f.set_defaults(fn=cmd_fetch)
    p = sub.add_parser("parse")
    p.add_argument("section")
    p.add_argument("--csv", action="store_true")
    p.set_defaults(fn=cmd_parse)
    t = sub.add_parser("text", help="the whole page as readable text (read this to answer questions)")
    t.add_argument("section")
    t.set_defaults(fn=cmd_text)
    d = sub.add_parser("diff")
    d.add_argument("section")
    d.add_argument("--context", type=int, default=1, help="unchanged lines shown around each change")
    d.add_argument("--limit", type=int, default=400, help="max diff lines printed")
    d.set_defaults(fn=cmd_diff)
    g = sub.add_parser("ingame", help="store the newest whole in-game capture of a section from the archives")
    g.add_argument("section")
    g.add_argument("--archive", action="append", help="archive file(s) to read instead of every archive")
    g.set_defaults(fn=cmd_ingame)
    h = sub.add_parser("history")
    h.add_argument("section")
    h.set_defaults(fn=cmd_history)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
