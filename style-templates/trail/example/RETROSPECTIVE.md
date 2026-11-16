# hallmark-websites: retrospective (final 4cb73503bbc3, approved by Mits 12 Nov 2026)

## What worked
- Trial-first: a 6.1 s Studio trial of the reference layout (title stack, fixed browser frame, caption lane, presenter
  panel) was approved before planning the rest; the hook never changed afterwards.
- Real evidence everywhere it existed: Hallmark's own theme previews, README credit line, 50-theme gallery, the
  "One prompt, two pages" comparison (26 vs 0 issues) and the Refract page captured at 1440/834/390 px. Only the
  theme-deal scene (s07) is simulated, and it is labelled.
- One motif carried the reel: the frame that holds still until the hero; Refract seen in the hook, picked, built, checked.

## What failed, why, and which kind of lesson
| Note | Underlying reason | Kind |
| --- | --- | --- |
| "The whole video looks like it's always split screen" | I treated the reference's split as the reel's only layout. visual-principles §3 already says to choose full frame when the picture is the explanation | Existing principle not applied: memory note for Gate B |
| First full-screen attempt scaled the split world 1.2-1.27x and left an empty band | An enlarged split picture is not a 9:16 composition (also already in §3) | Same principle; rebuilt as full-bleed layers (gallery wall, stacked comparison, full-height devices) |
| "The crowd noise is not necessary in this one" | A crowd cheer is a hero for a win or a crowd story, not for a calm product proof | Project preference, with a general caution in memory |
| Seek-check pixel diffs on the frame's corners; t=0 video diff; Studio's data-hf-id | Late compositor promotion, blur on a clipped child, the checker never seeking media, Studio rewriting the file | Technical defects, promoted to create-reel `references/qa.md` (Seek safety) |
| Hallmark page visible before its rise (v003) | A `fromTo` start below the frame still left part of the page on screen | Build bug, fixed (parked fully offscreen) |
