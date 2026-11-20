---
name: approve-reel
description: Approve a finished Reel script and create the resource its comment CTA promises. Use for /approve-reel, /approvereel, or when Mits names a chosen script, such as "approve reel 2 version A".
user_invocable: true
argument-hint: "[batch, Reel number or title, version A, B or C]"
---

# /approve-reel

Only scripts Mits likes get recorded, so a resource is built only after one is approved. Never post, message, publish or set up delivery. Never upload to Gumroad either: since 2026-11-16 Mits reviews every resource PDF in the content dashboard first, and the dashboard uploads it only when he presses its separate upload button (step 9).

Input: a Reel number or title and a version (A, B, or C for Mits's own script), plus a batch. Several Reels can be approved at once. Use the newest batch in `D:/herk-edit-kit/instagram_scripts_output/` if none is named. If the version is missing, ask for it in one line.

## 1. Save the approved script

1. Read the Reel from `D:/herk-edit-kit/instagram_scripts_output/<batch-id>/`: its newest `.txt` file, or the `.md` file in an older batch. If a `-v2` or later file exists, that one is current.
2. If its status is REVIEW REQUIRED, show what needs checking and stop, unless Mits has said to approve it anyway. If so, keep those checks in the approved file.
3. The approved file is `D:/herk-edit-kit/instagram_scripts_output/approved/<batch-id>/<reel-file-name>-version-<a, b or c>.txt`: plain text with no Markdown symbols, starting with a `Status at approval: <status>` line, then sections whose headings sit between lines of `=` signs, as in the exported Reel files, named exactly `SCRIPT`, `INSTAGRAM CAPTION`, `TIKTOK CAPTION`, `YOUTUBE SHORTS` and `CTA`. `ig-insights` and the content dashboard read these names. Build it as a draft in `D:/herk-edit-kit/reels-data/outputs/<batch-id>/.work/approve-<NN>-<a, b or c>.txt`, write and review the captions there (section 3), then save it to the approved path. Never overwrite an approved file.
   **Version C** is Mits's own script, written in the content dashboard (from scratch, or by combining and changing A and B). Its words are in `D:/herk-edit-kit/reels-data/content/version-c/<batch date>-<NNN>-<reel number, two digits>.txt` (the dashboard's approval command names the exact file). Use those words exactly as the `SCRIPT`; never rewrite or "improve" them. If the file is missing or empty, stop and say so. The CTA, search phrases and caption notes still come from the batch file, as for A and B. If Version C uses a different keyword or resource from the batch's CTA, or makes a claim that the caption notes, the batch's records or `corrections.md` contradict, list the mismatches and stop for Mits to decide. A Version C claim the caption notes simply do not cover is never repeated in the captions; list it in your reply as unchecked. The batch's review status applies to Versions A and B and the caption notes: say plainly in your reply that Version C's script was not through the independent review. (In an older batch that already has reviewed captions, a Version C promise the captions or CTA do not make is a mismatch too: list it and stop, and do not edit those captions yourself.)
4. In the `SCRIPT` section only, put every sentence on its own line and leave a blank line between the script's paragraphs, so Mits can read it while recording. Do not change any words, and keep a quoted line such as an example prompt whole on one line. Captions keep their normal layout.

## 2. Create the resource

Skip this step if the CTA is not Comment KEYWORD. If `D:/herk-edit-kit/reels-data/resources.md` already lists the keyword, and that resource delivers what this script promises, reuse it.

Resources are branded PDF guides with a cover page. Draft the guide as Markdown in `D:/herk-edit-kit/reels-data/resource-sources/<keyword>.md`, then build the PDF (steps 7 and 8 below). Include:

1. **What it is:** the tool or plan and who it suits, in two or three lines.
2. **Before you start:** accounts, subscriptions, versions, API keys, permissions and costs.
3. **Step by step:** numbered steps a beginner can follow, with exact commands.
4. **Check it worked:** what the reader should see.
5. **Safety and limits:** what it can access, and what it doesn't do.
6. **Sources:** official links.
7. **Cover details:** write `D:/herk-edit-kit/reels-data/resource-sources/<keyword>.pdf.json`. Copy the shape of an existing one, such as `founder.pdf.json`:
   - `name`: the skill or tool name customers will recognise, such as `Founder Skill` or `Claude Academy`. Optional `nameLines` splits a long name over two cover lines; the second line is the yellow one.
   - `topic`: the useful outcome, taken from the approved reel's YouTube Shorts title or hook, such as `Test a Business Idea on 100 Simulated Buyers`. The file is named `<name> - <topic>.pdf`, so keep it short, clear and in title case. If nothing fits, use `Setup & Practical Guide`.
   - `label`: the small cover label, such as `Skill Setup & Practical Guide`, `Setup & Practical Guide`, `Course Guide` or `Step-by-Step Plan`. `tag` is an optional short line top right, such as `11 free Claude skills`.
   - `subtitle`: one or two sentences on what the guide helps the reader achieve, using only facts from the guide.
   - `inside`: four short lines for the cover's "Inside this guide" list, matching the guide's real sections.
   - `visual` (optional): `{"type":"command"}` shows the guide's first command in a terminal card (set `text` to choose another), `{"type":"quote"}` shows the reel's hook, and `{"type":"dots", ...}` is Founder's buyer grid. Never show a made-up result; label any illustration as one.
   - `reel`: `title` (the approved YouTube Shorts title), `hook` (the script's first line), `approved` (the approved file path) and `url`. Take `url` from `D:/herk-edit-kit/reels-data/insights/links.json` (the `permalink` whose `approved.file` matches), or `null` until the reel is published. A null URL leaves the link out; nothing else changes.
   - `endNote` (optional): a closing line, such as a not-affiliated note for a third-party project.
8. **Build and check it:** run `node D:/herk-edit-kit/.agents/skills/approve-reel/guide_to_pdf.mjs <keyword> --preview`. It writes `D:/herk-edit-kit/instagram_scripts_output/resources/<name> - <topic>.pdf` and a cover image in `resources/previews/`, with Mits's photo from `D:/herk-edit-kit/brand/assets/profile.png` (a text-only cover if that file is missing). It reads simple Markdown: `#` headings, numbered and bullet lists (with code blocks or sub-lists inside a step), bold, italics, inline code, code fences, pipe tables and links. Every URL in the prose becomes a clickable link; URLs inside code stay plain text. It prints `OK`, or `CHECK` with the problems, such as a link that isn't clickable or a cover that overflows. Fix every `CHECK`, then look at the cover preview and at least the first guide page before replying. `--all` rebuilds every guide that has a `.pdf.json`.

9. **Stop before Gumroad. Do not upload.** Once the PDF passes step 8 and you have looked at it, your part ends. Mits opens the content dashboard (`node D:/herk-edit-kit/dashboard/server.mjs`, then http://localhost:4319), looks at the PDF on the project's Resource tab and approves it or asks for changes. Approval and upload are two separate buttons. "Approve this file" records the PDF's SHA-256 in `D:/herk-edit-kit/reels-data/content/pdf-approvals.json` and uploads nothing. Only when Mits then presses "Upload to Gumroad" does the dashboard run `gumroad_upload.mjs <keyword>` itself; "Check upload status" re-reads Gumroad without uploading again. Never run that script from this skill, and never create or edit `pdf-approvals.json`: the script holds any PDF without a matching approval (exit code 4), and a rebuilt PDF needs a new approval. If Mits asks for changes, revise the guide, rebuild with step 8 and tell him it is ready to review again.

   For reference, the upload adds the PDF to the Claude Skills Pack, using the product and content page in `D:/herk-edit-kit/reels-data/gumroad.json`. A resource counts as Claude-related when "Claude" appears in its name, topic, subtitle, reel title or guide title. Set `"gumroad": true` or `false` in the `.pdf.json` to override that. The script:
   - only adds files. It never deletes or replaces one, and never changes the product's name, price, description, covers, publication or checkout fields;
   - skips a PDF already on the product with the same name and size, and flags one with the same name but a different size instead of uploading it again (a rebuilt guide needs Mits to swap it in Gumroad);
   - runs a dry run first and stops if the CLI plans to remove anything;
   - saves before-and-after copies of the product in `reels-data/gumroad-backups/`, re-checks the product after uploading, and adds a line to `reels-data/gumroad-uploads.md`.

   Exit code 3 means the CLI is not logged in: Mits runs `gumroad auth login` and approves it in the browser (never ask for a token). Exit code 4 means a PDF was held because it is not approved. The CLI is in `%LOCALAPPDATA%\gumroad\gumroad.exe`, from https://github.com/antiwork/gumroad-cli. Never upload to any other product or create a new one.

If Mits asks for an editable Word copy, `guide_to_docx.js` still converts the same Markdown: `node D:/herk-edit-kit/.agents/skills/approve-reel/guide_to_docx.js <guide.md> <guide.docx>`.

It must deliver what the script and caption promise, and cover every tool the promise includes.

Use the batch's `records/` entries and `D:/herk-edit-kit/reels-data/corrections.md`, then confirm each command and requirement at the official docs or original repository. Never invent a step, result or personal experience. If something can't be confirmed, leave it out and say so in your reply. Write in plain British English with no emojis.

Add this line to `resources.md`, with the delivery method as `to confirm` unless Mits has given it. The resource file is the PDF:

`- KEYWORD: what the viewer receives | delivery | resource file | draft`

When the reel is published later and its link appears in `links.json`, add the `url` to the `.pdf.json` and rebuild, so the guide links back to the video.

## 3. Captions for Instagram, TikTok and YouTube Shorts

Since 2026-11-18, `/rewrite-reels` no longer writes captions. Its Reel files carry a `CAPTION NOTES` section instead: verified facts, each with its source. You write the three captions here, from the script Mits approved, so they always match what he records.

**Older batches.** If the batch file already has reviewed `INSTAGRAM CAPTION`, `TIKTOK CAPTION` and `YOUTUBE SHORTS` sections, copy them into the approved file unchanged and skip the rest of this section. A batch with only `Caption A` and `Caption B` has no notes: write the TikTok and YouTube Shorts captions below from the approved script and the Instagram caption.

**1. Load and read.** Load `ig-caption` and `ig-human` with the Skill tool. Read the batch's Reel file in `D:/herk-edit-kit/reels-data/outputs/<batch-id>/` (the `reel-NN-*.md` file) for its `CAPTION NOTES`, and its Final Comparison for the `Search phrases`, `CTA` and `Factual warnings` lines. Read `corrections.md`. These rules win over `ig-caption` where they differ.

**2. Use only checked facts.** A caption may state only what the approved script says or what a caption note lists, at the scope the note words it. Never add a figure, tool, command or claim from anywhere else, including your own knowledge. If a caption would be weak without a fact the notes lack, leave it out and say so in your reply.

**3. Rules for all three captions**

1. Absolutely no emojis, decorative symbols, em dashes, excessive punctuation or unnecessary formatting.
2. No links or bare URLs, because none of the three platforms makes them clickable. Verified install commands and prompts from the notes are allowed.
3. Complement the video rather than summarising it. Add what helps someone who has already watched: the exact name, the command, the setup cost, a quick test, or the caveat that was kept out of the script.
4. Natural, conversational British English in short paragraphs. No marketing language, clickbait, exaggerated claims, forced urgency or generic motivation.
5. One ask, matching the script's CTA, with the same keyword on every platform.
6. Hashtags are topic labels on their own last line, never `#fyp`, `#foryou`, `#viral`, `#explorepage`, `#trending` or `#reels`.
7. Write each caption for its platform. Do not paste the Instagram caption three times.
8. No generic "follow for more" ending. Tie any follow ask to the video's topic.
9. Use the search phrases naturally: the main one in the Instagram and TikTok first lines and in the YouTube title, the others in the body. Never stuff keyword lists. Keep names in their normal spelling.

**4. Instagram caption** (`ig-caption` Job A: the video carries the hook). First line under 125 characters, the part shown before "more", stating the payoff with the main search phrase. Body of 50 to 100 words, not counting hashtags, unless useful commands need more. The ask, then 3 to 5 hashtags.

**5. TikTok caption.** First line under 100 characters, a hook-style line built on the main search phrase, because TikTok cuts the caption early. One or two short paragraphs of specifics, 25 to 80 words without hashtags. The ask, then 3 to 5 hashtags.

**6. YouTube Shorts**, laid out as plain text exactly like this:

```
Title: (under 70 characters, main search phrase near the start, says what the viewer gets, no hashtags)

Description:
(One sentence restating the payoff with the main search phrase, because it shows in search.
Two or three short lines of specifics. Then the ask.
Last line: 3 hashtags, the most specific first; #Shorts may be the third if it fits.
30 to 100 words without hashtags.)

Tags: (8 to 12 comma-separated search phrases, most specific first, under 400 characters)
```

**7. Delivery.** If the CTA is Comment KEYWORD, add `Delivery on this platform: to confirm` as the last line of the TikTok caption section and of the YouTube Shorts section, unless `resources.md` gives the delivery for that platform, because the Instagram delivery tool may not cover YouTube or TikTok comments.

**8. Lint.** Write the draft file, then run:

```bash
python -I -X utf8 D:/herk-edit-kit/.agents/skills/approve-reel/check_captions.py <draft> --search "<the batch's search phrases>"
```

Fix every FAIL and review each WARN.

**9. Independent caption review.** You wrote these captions, so someone else checks them. In terminal Claude Code, launch the `reel-reviewer` subagent with: `Run the reel-review skill, caption pass, on <draft path>. Batch <batch-id>, Reel file <reel file path>.` If subagents are unavailable (for example in Codex or a headless mission), run the `reel-review` skill's caption pass yourself, treating the captions as someone else's work, and say so in your reply. Put the line it returns as the approved file's second line, directly under `Status at approval:`: `Caption review: passed`, or `Caption review: needs manual review: <what to check>`. Then save the approved file.

## 4. Reply

Give the approved file path, the caption review result (with anything it says to check), the PDF's filename and path, its cover preview path, and anything left out. Say the PDF is waiting for his approval in the content dashboard and has not been uploaded. Then list what Mits does next: review and approve the guide in the dashboard, then upload it from the dashboard (once Gumroad verifies the upload, the dashboard marks the keyword `live` in `resources.md` by itself), and decide how YouTube and TikTok commenters get it.
