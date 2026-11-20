#!/usr/bin/env python3
"""Lint the three platform captions in an approved Reel file, using the same rules as check_reel.py.

The captions are written by /approve-reel from the approved script, so this checks them against that
script: platform lengths and hashtags, no emojis, em dashes or URLs, the main search phrase where it
belongs, one comment keyword shared with the script, and no wording that corrections.md rejects.
A pass proves the mechanical checks only, never that the facts are right. Exits 1 on any FAIL.

Usage: python -I -X utf8 check_captions.py <approved .txt> --search "main phrase, second phrase"
"""

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "reel-workflow"))
from check_reel import CORRECTIONS, check_captions, check_corrections, check_cta, check_search  # noqa: E402

RULE_RE = re.compile(r"^={10,}\s*$")
NAMES = {"SCRIPT": "script", "INSTAGRAM CAPTION": "instagram", "TIKTOK CAPTION": "tiktok",
         "YOUTUBE SHORTS": "youtube", "CTA": "cta"}


def plain_sections(text):
    """Sections whose headings sit between two lines of '=' signs."""
    lines = text.replace("\r", "").split("\n")
    out, name, i = {}, None, 0
    while i < len(lines):
        if RULE_RE.match(lines[i]) and i + 2 < len(lines) and RULE_RE.match(lines[i + 2]) and lines[i + 1].strip():
            name = lines[i + 1].strip()
            out[name] = []
            i += 3
            continue
        if name:
            out[name].append(lines[i])
        i += 1
    return {k: "\n".join(v).strip() for k, v in out.items()}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("approved")
    ap.add_argument("--search", required=True, help="the batch's search phrases, most important first")
    ap.add_argument("--corrections", default=CORRECTIONS)
    args = ap.parse_args()

    found = plain_sections(open(args.approved, encoding="utf-8").read())
    missing = [h for h in NAMES if not found.get(h)]
    if missing:
        print(f"FAIL  STRUCTURE  missing or empty: {', '.join(missing)}")
        sys.exit(1)
    parts = {key: found[h] for h, key in NAMES.items()}
    for key in ("tiktok", "youtube"):   # the delivery note is for Mits, not part of the caption
        parts[key] = re.sub(r"(?im)^Delivery on this platform:.*$", "", parts[key]).strip()
    # check_reel.py expects two scripts and a comparison; the approved file has one script.
    parts.update(script_a=parts["script"], script_b=parts["script"],
                 comparison=f"- Search phrases: {args.search}")

    results = []
    add = lambda status, name, detail: results.append((status, name, detail))
    for key in ("instagram", "tiktok", "youtube"):
        if "{{" in parts[key] or re.search(r"\[[^\]]*\]", parts[key]):
            add("FAIL", "PLACEHOLDER", f"{key} still has a placeholder")
        if re.search(r"\*\*|^#+ ", parts[key], re.M):
            add("FAIL", "FORMATTING", f"{key} contains markdown")
    check_captions(parts, add)
    check_search(parts, add)
    check_cta(parts, add)
    check_corrections(parts, add, args.corrections)

    for status, name, detail in results:
        print(f"{status:<5} {name:<22} {detail}")
    fails = sum(1 for r in results if r[0] == "FAIL")
    print(f"VERDICT  {'FIX' if fails else 'OK'}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
