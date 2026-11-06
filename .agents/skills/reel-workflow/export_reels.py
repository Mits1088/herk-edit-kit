#!/usr/bin/env python3
"""Export a finished batch as plain-text files: one titled .txt per Reel, plus combined.txt.

Plain text, so scripts and captions paste straight into a teleprompter, Instagram,
TikTok or YouTube without Markdown symbols.
Never overwrites a different file: a changed Reel is saved with a -v2 suffix.

Usage: python -I -X utf8 export_reels.py <batch-folder> [--to <output-root>]
"""

import argparse
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_reel import field, sections  # noqa: E402

OUTPUT_ROOT = "D:/herk-edit-kit/instagram_scripts_output"
TITLE_RE = re.compile(r"^### REEL (\d+)\s*[—-]+\s*(.+)$", re.M)
RULE = "=" * 60


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("'", "").replace("’", "")).strip("-")


def plain(text):
    """Strip the little Markdown the comparison may carry."""
    return re.sub(r"\*\*(.+?)\*\*", r"\1", text).replace("—", "-").strip()


def block(heading, text):
    return [RULE, heading, RULE, "", plain(text), ""]


def body(number, title, parts):
    status = field(parts["comparison"], "Publication status") or "Unknown"
    return "\n".join(
        [f"REEL {number}: {title.upper()}", f"Status: {status}", ""]
        + block("VERSION A - FAITHFUL REWRITE", parts["script_a"])
        + block("VERSION B - STRONGER ALTERNATIVE", parts["script_b"])
        + ["The three captions below work with whichever version you record.", ""]
        + block("INSTAGRAM CAPTION", parts["instagram"])
        + block("TIKTOK CAPTION", parts["tiktok"])
        + block("YOUTUBE SHORTS", parts["youtube"])
        + block("FINAL COMPARISON", parts["comparison"])
    )


def save(path, text):
    """Write path, skipping an identical file and never replacing a different one."""
    stem, ext = os.path.splitext(path)
    n = 1
    while os.path.exists(path):
        if open(path, encoding="utf-8").read() == text:
            return None
        n += 1
        path = f"{stem}-v{n}{ext}"
    with open(path, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(text)
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("batch", help="batch folder containing the reel-*.md files")
    ap.add_argument("--to", default=OUTPUT_ROOT, help="root output folder")
    args = ap.parse_args()

    batch = os.path.expanduser(args.batch).rstrip("/\\")
    dest = os.path.join(args.to, os.path.basename(batch))
    os.makedirs(dest, exist_ok=True)

    written, texts = [], []
    for reel in sorted(glob.glob(os.path.join(batch, "reel-*.md"))):
        raw = open(reel, encoding="utf-8").read()
        parts, err = sections(raw)
        title = TITLE_RE.search(raw)
        if err or not title:
            sys.exit(f"{reel}: {err or 'no REEL title'}")
        number, name = int(title.group(1)), title.group(2).strip()
        text = body(number, name, parts)
        texts.append(text)
        if path := save(os.path.join(dest, f"{number:02d}-{slug(name)}.txt"), text):
            written.append(path)

    if texts and (path := save(os.path.join(dest, "combined.txt"), "\n\n".join(texts))):
        written.append(path)
    print(f"{len(written)} files written in {dest}")
    for path in written:
        print(f"  {path}")


if __name__ == "__main__":
    main()
