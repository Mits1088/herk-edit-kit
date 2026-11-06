#!/usr/bin/env python3
"""Check one finished Reel file. Exits 1 on any FAIL.

A pass proves the mechanical checks only, never that the facts are right.

Usage: python -I -X utf8 check_reel.py reel-01-topic.md [--source transcript.md] [--final]
"""

import argparse
import os
import re
import sys
import unicodedata

HEADINGS = [
    ("script_a", "**VERSION A — Faithful Rewrite**"),
    ("script_b", "**VERSION B — Stronger Alternative**"),
    ("instagram", "**INSTAGRAM CAPTION**"),
    ("tiktok", "**TIKTOK CAPTION**"),
    ("youtube", "**YOUTUBE SHORTS**"),
    ("comparison", "**FINAL COMPARISON**"),
]
SCRIPTS = ("script_a", "script_b")
CAPTIONS = ("instagram", "tiktok", "youtube")
COPY = SCRIPTS + CAPTIONS
COMPARISON_FIELDS = ("Recommended version", "Estimated spoken duration", "Key creative differences", "Search phrases",
                     "CTA", "Publication status", "Factual warnings", "Source links")
STATUSES = ("READY TO RECORD", "REVIEW REQUIRED")
PENDING = "PENDING REVIEW"
CORRECTIONS = os.path.expanduser("D:/herk-edit-kit/reels-data/corrections.md")
OPEN_ISSUE_RE = re.compile(r"\bconfirm (you|whether|that|this|the)\b|\bplease (check|confirm|verify)\b|\bunverified\b"
                           r"|\b(could not|couldn't|cannot|can't) (be )?(verify|verified|confirm|confirmed)\b"
                           r"|\bneeds? (checking|verification|review)\b|\bmanual(ly)? (check|verif)", re.I)
HASHTAG_RE = re.compile(r"(?:^|\s)#(\w+)")
KEYWORD_RE = re.compile(r"\b(?i:comment)\s+[\"']?([A-Z][A-Z0-9]{2,})\b")
WORD_RE = re.compile(r"[A-Za-z0-9$%'’-]+")
GENERIC_TAGS = {"fyp", "foryou", "foryoupage", "viral", "explore", "explorepage", "trending", "reels", "reel",
                "instagood", "tiktok", "youtube"}
SCRIPT_MAX_DELTA = 0.20
MAX_ECHO = 0.25       # shared word runs with the source. Above this, paraphrase.
MAX_SIMILAR = 0.5     # shared word runs between A and B, or between two captions. Above this, too alike.
# label, hashtag range, word range (hashtags excluded), first-line character limit
PLATFORM = {
    "instagram": ("INSTAGRAM", (3, 5), (50, 100), 125),
    "tiktok": ("TIKTOK", (3, 5), (25, 80), 100),
    "youtube": ("YOUTUBE", (1, 3), (30, 100), None),
}
YT_TITLE = (70, 100)   # warn above the first, fail above the second (YouTube's limit)
YT_TAGS_CHARS = 400    # YouTube allows 500; stay under this
YT_TAGS_COUNT = (8, 12)


def words(text):
    return [w.lower() for w in WORD_RE.findall(text)]


def overlap(a, b, size=4):
    """Share of a's word runs also found in b."""
    grams = lambda w: {tuple(w[i:i + size]) for i in range(len(w) - size + 1)}
    ga, gb = grams(words(a)), grams(words(b))
    return len(ga & gb) / len(ga) if ga else 0.0


def is_decorative(ch):
    cp = ord(ch)
    return (unicodedata.category(ch) in ("So", "Cs", "Sk") and ch not in "^`"
            or 0x2190 <= cp <= 0x21FF or cp in (0x200D, 0x20E3, 0xFE0F))


def sections(raw):
    positions = [(raw.find(h), key, h) for key, h in HEADINGS]
    if any(p < 0 for p, _, _ in positions):
        missing = [h for p, _, h in positions if p < 0]
        return None, f"missing headings: {', '.join(missing)}"
    if [p for p, _, _ in positions] != sorted(p for p, _, _ in positions):
        return None, "headings are out of order"
    found = {}
    for i, (pos, key, heading) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(raw)
        found[key] = raw[pos + len(heading):end].strip()
    return found, None


def field(comparison, name):
    m = re.search(rf"^- {name}:[ \t]*(.*)$", comparison, re.M)
    return m.group(1).strip() if m else None


def youtube_parts(text):
    """Split the YouTube section into title, description and tags."""
    title = re.search(r"^Title:[ \t]*(.*)$", text, re.M)
    tags = re.search(r"^Tags:[ \t]*(.*)$", text, re.M)
    desc = re.search(r"^Description:[ \t]*\n?(.*?)(?=^Tags:|\Z)", text, re.M | re.S)
    return (title.group(1).strip() if title else "", desc.group(1).strip() if desc else "",
            tags.group(1).strip() if tags else "")


def caption_body(key, text):
    """The text a viewer reads: the YouTube description, or the whole caption."""
    return youtube_parts(text)[1] if key == "youtube" else text


def load_corrections(path):
    """Yield (section, match regex or None, reject regex, reason) from the corrections file."""
    if not os.path.exists(path):
        return []
    rules, section, match = [], "", None
    for line in open(path, encoding="utf-8"):
        if line.startswith("## "):
            section, match = line[3:].strip(), None
        elif m := re.match(r"Match: `(.+)`", line):
            match = m.group(1)
        elif m := re.match(r"- Reject: `(.+?)` - (.*)", line):
            rules.append((section, match, m.group(1), m.group(2)))
    return rules


def check_corrections(parts, add, path):
    copy = {k: parts[k] for k in COPY}
    everything = "\n".join(copy.values())
    hits = 0
    for section, match, pattern, reason in load_corrections(path):
        if match and not re.search(match, everything, re.I):
            continue
        for key, text in copy.items():
            if m := re.search(pattern, text, re.I):
                hits += 1
                add("FAIL", "REJECTED WORDING", f"{key}: \"{m.group(0)}\" ({section}) {reason[:70]}")
    if not hits:
        add("PASS", "REJECTED WORDING", "none found")


def check_captions(parts, add):
    for key in CAPTIONS:
        label, tag_range, word_range, first_limit = PLATFORM[key]
        text = parts[key]
        emoji = sorted({c for c in text if is_decorative(c)})
        add("FAIL" if emoji else "PASS", f"{label} EMOJI", f"{len(emoji)} found {emoji or ''}".strip())
        if "—" in text:
            add("FAIL", f"{label} EM DASH", "remove the em dashes")
        body = caption_body(key, text)
        tags = HASHTAG_RE.findall(body)
        generic = sorted({t for t in tags if t.lower() in GENERIC_TAGS})
        lo, hi = tag_range
        if generic:
            add("FAIL", f"{label} HASHTAGS", f"generic tags describe nothing: {', '.join('#' + t for t in generic)}")
        else:
            add("PASS" if lo <= len(tags) <= hi else "FAIL", f"{label} HASHTAGS", f"{len(tags)} found, want {lo}-{hi}")
        lines = [ln for ln in body.splitlines() if ln.strip()]
        if lines and HASHTAG_RE.search(lines[0]):
            add("FAIL", f"{label} HASHTAGS", "first line starts with hashtags")
        n = len(words(HASHTAG_RE.sub(" ", body)))
        lo, hi = word_range
        add("PASS" if lo <= n <= hi else "WARN", f"{label} LENGTH", f"{n} words without hashtags, want {lo}-{hi}")
        if first_limit and lines:
            first = len(lines[0])
            add("PASS" if first <= first_limit else "WARN", f"{label} FIRST LINE",
                f"{first} characters, shown before the cut up to {first_limit}")
        if re.search(r"https?://|www\.", text):
            add("FAIL", "FORMATTING", f"{key} contains a URL")

    title, desc, tags = youtube_parts(parts["youtube"])
    if not title or not desc or not tags:
        missing = [n for n, v in (("Title", title), ("Description", desc), ("Tags", tags)) if not v]
        add("FAIL", "YOUTUBE LAYOUT", f"missing: {', '.join(missing)}")
    else:
        warn, limit = YT_TITLE
        status = "PASS" if len(title) <= warn else "WARN" if len(title) <= limit else "FAIL"
        add(status, "YOUTUBE TITLE", f"{len(title)} characters, want under {warn}")
        if "#" in title:
            add("FAIL", "YOUTUBE TITLE", "no hashtags in the title")
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        lo, hi = YT_TAGS_COUNT
        ok = lo <= len(tag_list) <= hi and len(tags) <= YT_TAGS_CHARS
        add("PASS" if ok else "WARN" if len(tags) <= 500 else "FAIL", "YOUTUBE TAGS",
            f"{len(tag_list)} tags, {len(tags)} characters, want {lo}-{hi} under {YT_TAGS_CHARS}")

    sim = overlap(caption_body("instagram", parts["instagram"]), parts["tiktok"])
    add("PASS" if sim <= MAX_SIMILAR else "WARN", "CAPTIONS DISTINCT",
        f"{sim:.0%} of Instagram word runs reused on TikTok")


def check_search(parts, add):
    phrases = [p.strip(" \"'.") for p in re.split(r"[;,]", field(parts["comparison"], "Search phrases") or "")]
    phrases = [p for p in phrases if p]
    if not phrases:
        return
    title, desc, _ = youtube_parts(parts["youtube"])
    where = {"instagram": parts["instagram"], "tiktok": parts["tiktok"], "youtube": f"{title}\n{desc}"}
    flat = lambda text: f" {' '.join(words(text))} "   # ignores case and punctuation: "CLAUDE.md file" = "claude md file"
    missing = [f"{k} lacks \"{phrases[0]}\"" for k, text in where.items() if flat(phrases[0]) not in flat(text)]
    add("PASS" if not missing else "WARN", "SEARCH PHRASES",
        "; ".join(missing) if missing else f"main phrase \"{phrases[0]}\" on every platform")


def check_cta(parts, add):
    found = {k: {m.upper() for m in KEYWORD_RE.findall(parts[k]) if m.isupper()} for k in COPY}
    keywords = set().union(*found.values())
    if not keywords:
        add("PASS", "CTA KEYWORD", "no comment keyword")
        return
    if len(keywords) > 1:
        add("FAIL", "CTA KEYWORD", f"different keywords: {', '.join(sorted(keywords))}")
        return
    lacking = [k for k in COPY if not found[k]]
    add("WARN" if lacking else "PASS", "CTA KEYWORD",
        f"{next(iter(keywords))}" + (f", missing from {', '.join(lacking)}" if lacking else " everywhere"))


def check_comparison(comparison, add, final=False):
    missing = [f for f in COMPARISON_FIELDS if not field(comparison, f)]
    add("FAIL" if missing else "PASS", "COMPARISON FIELDS", f"missing: {', '.join(missing)}" if missing else "all present")
    status = (field(comparison, "Publication status") or "").strip("*[] .")
    if status == PENDING and not final:
        add("PASS", "PUBLICATION STATUS", PENDING)
        return
    if status not in STATUSES:
        add("FAIL", "PUBLICATION STATUS", f"'{status}' is not one of {' or '.join(STATUSES)}")
        return
    if not field(comparison, "Independent review"):
        add("FAIL", "PUBLICATION STATUS", f"{status} needs the independent review line")
        return
    add("PASS", "PUBLICATION STATUS", status)
    warnings = (field(comparison, "Factual warnings") or "").rstrip(".").lower()
    links = field(comparison, "Source links") or ""
    if status == "REVIEW REQUIRED" and warnings in ("", "none"):
        add("FAIL", "STATUS EVIDENCE", "REVIEW REQUIRED must say what needs checking")
    elif status == "READY TO RECORD" and OPEN_ISSUE_RE.search(warnings):
        add("FAIL", "STATUS EVIDENCE", "READY TO RECORD, but the warnings leave something open")
    elif status == "READY TO RECORD" and "http" not in links:
        add("WARN", "STATUS EVIDENCE", "READY TO RECORD with no source links")
    else:
        add("PASS", "STATUS EVIDENCE", "consistent with the warnings and links")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("reel")
    ap.add_argument("--source", help="original transcript, for length and echo checks")
    ap.add_argument("--final", action="store_true", help="require a final status from the independent review")
    ap.add_argument("--corrections", default=CORRECTIONS, help="corrections file")
    args = ap.parse_args()

    results = []
    add = lambda status, name, detail: results.append((status, name, detail))

    raw = open(args.reel, encoding="utf-8").read()
    parts, err = sections(raw)
    if err:
        print(f"FAIL  STRUCTURE  {err}")
        sys.exit(1)
    add("PASS", "STRUCTURE", "all six sections, in order")

    for key in COPY:
        if not parts[key] or "{{" in parts[key] or re.search(r"\[[^\]]*\]", parts[key]):
            add("FAIL", "PLACEHOLDER", f"{key} is empty or still has a placeholder")
        if re.search(r"\*\*|^#+ ", parts[key], re.M):
            add("FAIL", "FORMATTING", f"{key} contains markdown")

    check_captions(parts, add)
    check_search(parts, add)
    check_cta(parts, add)
    check_comparison(parts["comparison"], add, args.final)
    check_corrections(parts, add, args.corrections)

    sim = overlap(parts["script_a"], parts["script_b"])
    add("PASS" if sim <= MAX_SIMILAR else "WARN", "A/B DISTINCT", f"{sim:.0%} of A's word runs appear in B")

    if args.source:
        source = open(args.source, encoding="utf-8").read()
        base = len(words(source))
        for key, label in (("script_a", "A"), ("script_b", "B")):
            n = len(words(parts[key]))
            delta = (n - base) / base if base else 0
            ok = abs(delta) <= SCRIPT_MAX_DELTA
            explained = field(parts["comparison"], "Duration change")
            explained = explained and explained.rstrip(".").lower() != "none"
            add("PASS" if ok else "WARN" if explained else "FAIL", f"SCRIPT {label} LENGTH",
                f"{n} words vs source {base} ({delta:+.0%})"
                + ("" if ok else ", explained, for review" if explained else ", unexplained"))
            echo = overlap(parts[key], source)
            add("PASS" if echo <= MAX_ECHO else "WARN", f"SCRIPT {label} ORIGINAL",
                f"{echo:.0%} of word runs copied from the source")

    for status, name, detail in results:
        print(f"{status:<5} {name:<22} {detail}")
    fails = sum(1 for r in results if r[0] == "FAIL")
    print(f"VERDICT  {'FIX' if fails else 'OK'}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
