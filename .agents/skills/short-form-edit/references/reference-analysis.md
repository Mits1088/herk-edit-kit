# Analyze a short-form reference

Use a reference the student supplies and has permission to use. Keep the recording
and analysis inside the private video project. Do not copy its script or assets.

## Watch and record

Watch the full video once for its promise and payoff, then again with timestamps.
For each meaningful change, record:

| Time | Spoken idea | Visual change | Sound cue | Viewer question | Payoff |
| --- | --- | --- | --- | --- | --- |
| Fill from the supplied reference | Verbatim phrase | Framing, footage, or graphic | Audible impact | What remains unresolved | Where it resolves |

Measure the actual resolution, duration, and frame rate. Separate observations
from your interpretation of why a choice works. A fast montage does not imply
that every new edit needs the same number of cuts.

## Transfer the mechanism

- Make the opening visual support a truthful promise in the spoken hook.
- Use a brief crop or caption emphasis on a specific word, then return to rest.
- Cut to moving footage when it supplies evidence or explains something concrete.
- Give each sound cue a visible event; align its audible impact, not its file start.
- Build curiosity that the retained recording actually resolves.
- End after the payoff with enough room for the intended action to be understood.

Write which mechanisms fit this recording and which would distract from it.
Design new copy, scenes, and motion from the student's own transcript and brief.

## Look at the real frames

A reference is optional: without one, plan from the transcript, the brief and
[visual-principles.md](visual-principles.md). With one, study its frames and timing, not a summary:

```bash
ffmpeg -i ref.mp4 -vf "fps=2,scale=180:320,tile=10x5" -frames:v 1 sheet.jpg            # 2 fps contact sheet
ffmpeg -ss 2.6 -i ref.mp4 -frames:v 1 frame.jpg                                         # full-size frames
ffmpeg -ss 1.8 -t 1.6 -i ref.mp4 -vf "fps=10,scale=162:-1,tile=8x2" -frames:v 1 strip.jpg # easing and anticipation
ffmpeg -i ref.mp4 -vf "select='gt(scene,0.25)',showinfo" -an -f null - 2>&1 | grep pts_time # cut times
```

Record per change: the layout (face, split, full-screen illustration, UI), what acts on what, which objects return in
a new state, how numbers are shown, where it holds still, and how captions and type are sized. Do not describe sound
you did not hear.

## Separate technique from styling

| Adopt (technique) | Adapt (to this subject and brand) | Do not borrow |
| --- | --- | --- |
| e.g. a crowd that thins while a counter steps down | the speaker's own numbers as quantities in this project's world | the reference's characters, mascot, palette, typefaces, assets, copy |

Present the adopted ideas at Gate B with one line each on why they suit this reel, and the three keyframes or
equivalent static concepts (create-reel `references/preflight.md`). Imitating a reference's distinctive characters or
assets is never the default; do it only when the person asks and has the rights.
