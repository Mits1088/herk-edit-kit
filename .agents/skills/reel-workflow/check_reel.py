#!/usr/bin/env python3
"""Check one finished Reel file. Exits 1 on any FAIL.

A pass proves the mechanical checks only, never that the facts are right.

Two layouts are accepted. New batches carry CAPTION NOTES (verified facts for the captions), because the
captions are written by /approve-reel from the approved script. Older batches carry the three platform
captions instead, and are still checked as before.

Usage: python -I -X utf8 check_reel.py reel-01-topic.md [--source transcript.md] [--seconds 45] [--wpm 165] [--final]

Script length is judged by time, not by word count: the source's real duration (from --seconds, or a
"Duration: 45s" line in the source file) against each script spoken at Mits's pace (--wpm, else the
"Pace:" line in voice.md, else 165). Source creators often talk far faster than Mits, so matching
their word count makes the script too long.
"""

import argparse
import os
import re
import sys
import unicodedata

HEADINGS = [
    ("script_a", "**VERSION A — Faithful Rewrite**"),
    ("script_b", "**VERSION B — Stronger Alternative**"),
    ("notes", "**CAPTION NOTES**"),
    ("comparison", "**FINAL COMPARISON**"),
]
LEGACY_HEADINGS = [
    ("script_a", "**VERSION A — Faithful Rewrite**"),
    ("script_b", "**VERSION B — Stronger Alternative**"),
    ("instagram", "**INSTAGRAM CAPTION**"),
    ("tiktok", "**TIKTOK CAPTION**"),
    ("youtube", "**YOUTUBE SHORTS**"),
    ("comparison", "**FINAL COMPARISON**"),
]
SCRIPTS = ("script_a", "script_b")
CAPTIONS = ("instagram", "tiktok", "youtube")
NOTE_RE = re.compile(r"^- .+\|\s*(https?://\S+|corrections\.md)(\s*,\s*https?://\S+)*\s*$", re.I)
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
SCRIPT_HARD_OVER = 0.35   # longer than this over the source duration fails even when explained
VOICE = "D:/herk-edit-kit/reels-data/voice.md"
DEFAULT_WPM = 165
META_LINE_RE = re.compile(r"^\s*(#+ |(source|published|duration|creator|url|reach|views|likes|captured|stats|note from mits)\b[^:]{0,20}:)", re.I)
DURATION_RE = re.compile(r"^\s*duration\b[^:]{0,20}:\s*([\d.]+)\s*s", re.I | re.M)
SENT_RE = re.compile(r"[^.!?]+[.!?]?")
STOPWORDS = set("""a an the and or but so if then than that this these those it its it's is are was were be been
being to of in on at for from with by as into about over under up down out you your you're i i'll i'm me my we our
they their them he she his her what which who whom when where why how all any some more most other such no not only
own same too very can will just do does did done have has had get gets got there here one each also even like
because than ve ll re s t don't doesn't isn't aren't""".split())
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


def is_legacy(raw):
    """True for an older Reel file that still carries the three platform captions."""
    return "**CAPTION NOTES**" not in raw and "**INSTAGRAM CAPTION**" in raw


def copy_keys(parts):
    """The sections a viewer will hear or read, or that feed the captions."""
    return SCRIPTS + (CAPTIONS if "instagram" in parts else ("notes",))


def sections(raw):
    headings = LEGACY_HEADINGS if is_legacy(raw) else HEADINGS
    positions = [(raw.find(h), key, h) for key, h in headings]
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
    copy = {k: parts[k] for k in copy_keys(parts)}
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


def check_notes(parts, add):
    """Caption notes: one verified fact per line, each with its source, so /approve-reel can write captions from them."""
    lines = [ln.strip() for ln in parts["notes"].splitlines() if ln.strip()]
    bad = [ln for ln in lines if not NOTE_RE.match(ln)]
    if not lines:
        add("FAIL", "CAPTION NOTES", "empty: list the verified facts the captions may use")
    elif bad:
        add("FAIL", "CAPTION NOTES", f"{len(bad)} line(s) not '- fact | source URL': {bad[0][:60]}")
    else:
        add("PASS", "CAPTION NOTES", f"{len(lines)} facts, each with a source")


def check_cta(parts, add):
    keys = [k for k in copy_keys(parts) if k != "notes"]
    found = {k: {m.upper() for m in KEYWORD_RE.findall(parts[k]) if m.isupper()} for k in keys}
    keywords = set().union(*found.values())
    if not keywords:
        add("PASS", "CTA KEYWORD", "no comment keyword")
        return
    if len(keywords) > 1:
        add("FAIL", "CTA KEYWORD", f"different keywords: {', '.join(sorted(keywords))}")
        return
    lacking = [k for k in keys if not found[k]]
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


def spoken_source(text):
    """The transcript body only: drop headings and metadata lines that would inflate the word count."""
    return "\n".join(ln for ln in text.splitlines() if not META_LINE_RE.match(ln))


def voice_wpm(path=VOICE):
    try:
        m = re.search(r"Pace:\**\s*(\d+)\s*words per minute", open(path, encoding="utf-8").read(), re.I)
        return int(m.group(1)) if m else DEFAULT_WPM
    except OSError:
        return DEFAULT_WPM


def check_repetition(key, label, text, add):
    """Flag scripts that drone: many sentences opening the same way, or one idea word said again and again."""
    sentences = [s.strip() for s in SENT_RE.findall(text) if len(words(s)) >= 2]
    openers = {}
    for s in sentences:
        first = re.sub(r"['’](s|ll|re|ve|d)$", "", words(s)[0])   # "It's" and "It" are the same opener
        openers[first] = openers.get(first, 0) + 1
    worst = max(openers.items(), key=lambda kv: kv[1], default=("", 0))
    if sentences and worst[1] >= 4 and worst[1] / len(sentences) >= 0.3:
        add("WARN", f"SCRIPT {label} OPENERS", f"{worst[1]} of {len(sentences)} sentences start with \"{worst[0]}\"")
    else:
        add("PASS", f"SCRIPT {label} OPENERS", "varied")
    counts = {}
    for w in words(text):
        if w not in STOPWORDS and len(w) > 3:
            counts[w] = counts.get(w, 0) + 1
    repeated = sorted((w for w, c in counts.items() if c >= 3), key=lambda w: -counts[w])
    if repeated:
        add("WARN", f"SCRIPT {label} REPEATS",
            ", ".join(f"{w} x{counts[w]}" for w in repeated[:6]) + ": say each idea once unless it is the name")
    else:
        add("PASS", f"SCRIPT {label} REPEATS", "no word used 3+ times")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("reel")
    ap.add_argument("--source", help="original transcript, for length and echo checks")
    ap.add_argument("--seconds", type=float, help="the source Reel's real duration in seconds")
    ap.add_argument("--wpm", type=int, help="Mits's speaking rate (default: voice.md Pace line, else 165)")
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
    legacy = "instagram" in parts
    add("PASS", "STRUCTURE", f"all {len(parts)} sections, in order" + (" (older layout with captions)" if legacy else ""))

    for key in copy_keys(parts):
        if not parts[key] or "{{" in parts[key] or re.search(r"\[[^\]]*\]", parts[key]):
            add("FAIL", "PLACEHOLDER", f"{key} is empty or still has a placeholder")
        if re.search(r"\*\*|^#+ ", parts[key], re.M):
            add("FAIL", "FORMATTING", f"{key} contains markdown")

    if legacy:
        check_captions(parts, add)
        check_search(parts, add)
    else:
        check_notes(parts, add)
    check_cta(parts, add)
    check_comparison(parts["comparison"], add, args.final)
    check_corrections(parts, add, args.corrections)

    sim = overlap(parts["script_a"], parts["script_b"])
    add("PASS" if sim <= MAX_SIMILAR else "WARN", "A/B DISTINCT", f"{sim:.0%} of A's word runs appear in B")

    for key, label in (("script_a", "A"), ("script_b", "B")):
        check_repetition(key, label, parts[key], add)

    if args.source:
        raw_source = open(args.source, encoding="utf-8").read()
        source = spoken_source(raw_source)
        wpm = args.wpm or voice_wpm()
        seconds = args.seconds
        if not seconds and (m := DURATION_RE.search(raw_source)):
            seconds = float(m.group(1))
        if seconds:
            add("PASS", "SOURCE DURATION", f"{seconds:.0f}s real; budget {seconds * wpm / 60:.0f} words at {wpm} wpm")
        else:
            seconds = len(words(source)) / DEFAULT_WPM * 60
            add("WARN", "SOURCE DURATION", f"no real duration, estimated {seconds:.0f}s from word count. "
                "Add 'Duration: Ns' to the source or pass --seconds; fast talkers make this estimate too long")
        explained = field(parts["comparison"], "Duration change")
        explained = explained and explained.rstrip(".").lower() != "none"
        for key, label in (("script_a", "A"), ("script_b", "B")):
            n = len(words(parts[key]))
            spoken = n / wpm * 60
            delta = (spoken - seconds) / seconds if seconds else 0
            if abs(delta) <= SCRIPT_MAX_DELTA:
                status, note = "PASS", ""
            elif delta > SCRIPT_HARD_OVER:
                status, note = "FAIL", ", too long even with an explanation: cut repetition and qualifiers"
            elif explained:
                status, note = "WARN", ", explained, for review"
            else:
                status, note = "FAIL", ", unexplained"
            add(status, f"SCRIPT {label} LENGTH",
                f"{n} words = {spoken:.0f}s at {wpm} wpm vs source {seconds:.0f}s ({delta:+.0%}){note}")
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
