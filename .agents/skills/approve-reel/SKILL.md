---
name: approve-reel
description: Approve a finished Reel script and create the resource its comment CTA promises. Use for /approve-reel, /approvereel, or when Mits names a chosen script, such as "approve reel 2 version A".
user_invocable: true
argument-hint: "[batch, Reel number or title, version A or B]"
---

# /approve-reel

Only scripts Mits likes get recorded, so a resource is built only after one is approved. Never post, message, publish or set up delivery.

Input: a Reel number or title and a version, plus a batch. Several Reels can be approved at once. Use the newest batch in `D:/herk-edit-kit/instagram_scripts_output/` if none is named. If the version is missing, ask for it in one line.

## 1. Save the approved script

1. Read the Reel from `D:/herk-edit-kit/instagram_scripts_output/<batch-id>/`: its newest `.txt` file, or the `.md` file in an older batch. If a `-v2` or later file exists, that one is current.
2. If its status is REVIEW REQUIRED, show what needs checking and stop, unless Mits has said to approve it anyway. If so, keep those checks in the approved file.
3. Save the chosen script, the Instagram, TikTok and YouTube Shorts captions, the search phrases and the CTA line to `D:/herk-edit-kit/instagram_scripts_output/approved/<batch-id>/<reel-file-name>-version-<a or b>.txt`, as plain text with no Markdown symbols. Start with a `Status at approval: <status>` line, then sections whose headings sit between lines of `=` signs, as in the exported Reel files, named exactly `SCRIPT`, `INSTAGRAM CAPTION`, `TIKTOK CAPTION`, `YOUTUBE SHORTS` and `CTA`. `ig-insights` reads these names. Never overwrite a file.
4. In the `SCRIPT` section only, put every sentence on its own line and leave a blank line between the script's paragraphs, so Mits can read it while recording. Do not change any words, and keep a quoted line such as an example prompt whole on one line. Captions keep their normal layout.

## 2. Create the resource

Skip this step if the CTA is not Comment KEYWORD. If `D:/herk-edit-kit/reels-data/resources.md` already lists the keyword, and that resource delivers what this script promises, reuse it.

Resources are always Word documents. Draft the guide as Markdown in `D:/herk-edit-kit/reels-data/resource-sources/<keyword>.md`, then convert it to the finished file (step 7 below). Include:

1. **What it is:** the tool or plan and who it suits, in two or three lines.
2. **Before you start:** accounts, subscriptions, versions, API keys, permissions and costs.
3. **Step by step:** numbered steps a beginner can follow, with exact commands.
4. **Check it worked:** what the reader should see.
5. **Safety and limits:** what it can access, and what it doesn't do.
6. **Sources:** official links.
7. **Convert it:** run `node D:/herk-edit-kit/.agents/skills/approve-reel/guide_to_docx.js D:/herk-edit-kit/reels-data/resource-sources/<keyword>.md D:/herk-edit-kit/instagram_scripts_output/resources/<keyword>.docx`. It uses simple Markdown: `#` headings, numbered and bullet lists, bold, inline code, code fences and pipe tables.

It must deliver what the script and caption promise, and cover every tool the promise includes.

Use the batch's `records/` entries and `D:/herk-edit-kit/reels-data/corrections.md`, then confirm each command and requirement at the official docs or original repository. Never invent a step, result or personal experience. If something can't be confirmed, leave it out and say so in your reply. Write in plain British English with no emojis.

Add this line to `resources.md`, with the delivery method as `to confirm` unless Mits has given it:

`- KEYWORD: what the viewer receives | delivery | resource file | draft`

## 3. YouTube Shorts and TikTok captions

Batches from `/rewrite-reels` now include reviewed Instagram, TikTok and YouTube Shorts captions, shared by both versions. Copy them into the approved file unchanged and skip the rest of this step.

Only an older batch with `Caption A` and `Caption B` lacks them. The same video is posted to YouTube Shorts and TikTok, so append two sections to the approved file after the Instagram caption, written as plain text in the same heading style (no `##` or `**`). Base them on the approved script and caption only: no new claims, figures or tools. Everything in `corrections.md` applies here too. Plain British English, no emojis, no em dashes, no links (neither platform makes caption links clickable on Shorts or TikTok videos).

Pick two or three search phrases first: the words someone would actually type to find this video, such as "claude code plugins" or "claude skills". Use them naturally in the text, not as stuffed lists.

```
## YouTube Shorts

**Title:** (under 70 characters, main search phrase near the start, says what the viewer gets; no clickbait the video doesn't pay off)

**Description:**
(Line 1: one sentence that restates the payoff with the main search phrase; it shows in search results.
Then two or three short lines with the specifics from the Instagram caption, such as the repo name or the command.
Then the ask.
Last line: 3 hashtags, the first being #Shorts only if it fits, otherwise the most specific topic tag.)

**Tags:** (8 to 12 comma-separated search phrases, most specific first, under 400 characters in total)

## TikTok

**Caption:**
(Line 1: hook-style line with the main search phrase, under 100 characters, because TikTok cuts the caption early.
One or two short lines of specifics.
The ask.
3 to 5 hashtags: specific topic tags only, never #fyp, #foryou or #viral.)

**Search phrases:** (the 2 or 3 phrases used, for reference)
```

The ask: if the CTA is Comment KEYWORD, keep the same keyword on both platforms and add under each section `Delivery on this platform: to confirm`, because the Instagram delivery tool may not cover YouTube or TikTok comments. Otherwise reuse the Instagram ask.

If the approved file already has these sections, leave them alone unless Mits asks for a rewrite.

## 4. Reply

Give the approved file and resource paths, and anything left out. Then list what Mits does next: check the guide, set the keyword up in the delivery tool (and decide how YouTube and TikTok commenters get it), and change `draft` to `live` in `resources.md`.
