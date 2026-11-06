---
name: rewrite-reels
description: Rewrite Instagram Reel transcripts into two scripts each, plus one SEO-friendly caption each for Instagram, TikTok and YouTube Shorts. Use for /rewrite-reels, /rewritereels, or when given reel transcripts to rewrite.
user_invocable: true
argument-hint: "[transcripts, or a file or folder path]"
---

# /rewrite-reels

Input: pasted transcripts, `.md` or `.txt` files, or a folder. On Telegram the same command appears as `/rewritereels`, and files arrive as "Document received" messages.

Ask no setup questions. Mits drops new transcripts in `D:/herk-edit-kit/Instagram_transcript/`. If no transcripts were given, use the files sitting directly in that folder, not in its `processed/` subfolder, plus any sitting directly in `D:/herk-edit-kit/reels-data/inputs/`, not in its batch subfolders. If there are none, ask for transcripts in one line.

Run `pwd` to choose the route.

## Route 1: inside ClaudeClaw (the path contains `.claudeclaw/agents/main`)

1. Pick the next unused batch ID, `batch-YYYY-MM-DD-NNN`, by checking `D:/herk-edit-kit/reels-data/inputs/` and `D:/herk-edit-kit/reels-data/outputs/`.
2. Put every file in `D:/herk-edit-kit/reels-data/inputs/<batch-id>/`, keeping filenames. Move files that sit directly in `inputs/`, so they aren't processed twice. Copy files from `Instagram_transcript/`, then move each original to `Instagram_transcript/processed/<batch-id>/` for the same reason. Copy files from anywhere else, including Telegram uploads, which are deleted after 24 hours. Save pasted transcripts there as `pasted-01.md`, `pasted-02.md` and so on. Split a single file holding several transcripts into one file per transcript, such as at `## Reel:` headings or `.mp4` filename lines, and ignore any intro line above the first transcript.
3. Create the output folder with plain `mkdir D:/herk-edit-kit/reels-data/outputs/<batch-id>`, so an existing batch fails rather than being reused.
4. Create one mission per transcript, in order, using the mission tool if available, otherwise the command below. Each transcript needs its own mission, because a single run stops after 30 tool rounds and verifying a whole batch takes more. `<NN>` is the two-digit Reel number and `<M>` is the total.

   ```bash
   node D:/claudeclaw-os/dist/mission-cli.js create --agent instagram-script-writer --title "Rewrite reels <batch-id> reel <NN>" "Run the reel-workflow skill on one transcript: Reel <NN> of <M> in batch <batch-id>. Source: D:/herk-edit-kit/reels-data/inputs/<batch-id>/<file>. The batch is already set up. Follow the One-Reel missions section. Do not hand back."
   ```

5. Queue the review after those missions. The lower priorities make these run last, whatever order the Reels finish in:

   ```bash
   node D:/claudeclaw-os/dist/mission-cli.js create --agent instagram-script-writer --priority 4 --title "Review reels <batch-id>" "Run the reel-review skill, review pass, on batch <batch-id>. Do not hand back."
   node D:/claudeclaw-os/dist/mission-cli.js create --agent instagram-script-writer --priority 3 --title "Apply review changes <batch-id>" "Follow the Apply review changes section of the reel-workflow skill on batch <batch-id>. Do not hand back."
   node D:/claudeclaw-os/dist/mission-cli.js create --agent instagram-script-writer --priority 2 --title "Final review <batch-id>" "Run the reel-review skill, final pass, on batch <batch-id>. A handback is required when finished."
   ```

6. Reply in one line: the batch ID and how many transcripts were queued. Do not rewrite anything yourself.

If a Reel mission fails, queue that Reel again, then queue the three review missions again. Earlier Reels stay on disk and are not redone.

When the handback arrives, pass its report on unchanged. Mission output can't attach files, so if Mits then asks for the batch, reply in the normal turn with `[SEND_FILE:D:/herk-edit-kit/instagram_scripts_output/<batch-id>/combined.txt]` on its own line. Finished Reels are in that folder as plain-text `.txt` files, one titled file per Reel with both versions and the Instagram, TikTok and YouTube Shorts captions.

## Route 2: terminal Claude Code

Launch the `reel-rewriter` subagent with the transcripts or file paths, including any picked up from `Instagram_transcript/`. Then run the review in order: the `reel-reviewer` subagent for the review pass, `reel-rewriter` to apply the review changes, and `reel-reviewer` for the final pass.

If those subagents are unavailable (for example in Codex), run the same four stages yourself in order: the `reel-workflow` skill for every transcript, the `reel-review` skill's review pass, the `reel-workflow` skill's Apply review changes section, then the `reel-review` skill's final pass. Treat the review stages as someone else's work. When it finishes, read `combined.md` from the batch folder and show both scripts and the Instagram, TikTok and YouTube Shorts captions in full for every Reel, with each comparison underneath.
