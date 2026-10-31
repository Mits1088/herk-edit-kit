# Visual storytelling principles

How to decide what a reel's visuals do. These are decision principles, not effects to add. None of them requires a
character, a recurring object, a physical metaphor, animated numbers, a layout mix or an amount of speaker time.
Authentic footage, a plain demonstration or the speaker's face is often the strongest choice; say so when it is.

They were drawn from reels that worked and from the notes that fixed the ones that did not (for example a talking-head
reel whose graphics were a row of similar cards, rebuilt so that one actor caused every change on screen). Use the
reasoning, never another reel's characters, palette or assets. The project's DESIGN.md decides the look; the brief wins.

## 1. Cause and effect

Show something making the change: a person, a hand, a cursor, an interface, a process, a tool, a character, or the
speaker's gesture. A list that fades in is a state; a list that a cursor checks off is an event.

- Talking head: the speaker names a setting, the real UI toggle flips in a split above them.
- Faceless explainer: a drawn pipeline where each stage visibly produces the input of the next.
- Brand promo: the product's own control performs the claim (the grinder's dial turns and the grind changes).
- When not to: the speaker's conviction carries the line, or the real footage already shows the cause.

## 2. Continuity

Introduce what matters, bring it back when it means something, and let its state change: unanswered becomes answered,
broken becomes fixed, full becomes empty. No object count is required, and many reels need none.

- One interface that the reel keeps returning to, one step further each time.
- A number planted early that the payoff resolves.
- When not to: a hard cut to new evidence is clearer than forcing an object to travel; a callback that does not change
  meaning is decoration.

## 3. Attention-led layout

Choose the frame by what the viewer must understand right now: the face for conviction, humour and trust; full-screen
footage or graphics when the idea is the hero; a split when both matter; a close-up when a detail decides the point.
Avoid one layout on repeat because it is the default.

- When not to: a reel built on the speaker's performance may stay on the face almost throughout; that is a choice.

Layout rhythm, as judgement rather than a quota (learnt on the Claude Code mods reel, October 2026):

- A change of layout (split, full frame, face) reads as a new picture; zooming or panning inside one layout mostly
  does not. When a stretch feels like one held frame, consider a layout change before adding camera moves.
- Full frame suits the moment the picture is the explanation (a mechanism, a before and after, a tip's payoff) or
  the idea is tall (a pipe, a stack, a sorter). Design it for 9:16 height; an enlarged split picture wastes it.
- The face suits opinions, contrasts ("rather than…"), set-ups for a reveal and the call to action.
- Full-frame moments usually land in about 2-4 s; longer is fine when something keeps developing on screen.
- No duration or cut count is a rule. A long scene with meaningful action or a strong performance can hold; judge
  whether the picture is still developing and whether the viewer has a reason to keep watching.

## 4. Visualised explanation

When a number, comparison, process or abstract idea is hard to grasp as speech, turn it into something the viewer can
see change: quantities instead of labels, a before and after, a mechanism in motion. Keep claims as authentic as the
evidence: reconstructions are labelled, measured values are not invented.

- When not to: the number is incidental, the real screenshot is clearer, or a label is all the moment needs.

## 5. Intentional pacing

Plan anticipation, action, reaction and stillness. A wind-up or a held beat before a result makes it land; a quiet
frame after a climax lets it register. Constant motion is not energy, and stillness with a reason (`holdReason`) is valid.

- When not to: reading load is already high; do not add motion to a frame that needs to be read.

## 6. Visual hierarchy

One thing leads each frame. Captions support it: their size, case, style and position follow the chosen direction
and the platform's safe area, not one fixed recipe. Emphasis is spent on the word or object that matters, not spread.

## 7. Every major visual has a job

Each one advances the explanation, shows evidence, establishes context or creates a deliberate feeling. If a visual
only repeats the caption or decorates, replace it with the example, the evidence or the consequence, or cut back to
the speaker.

## 8. Show the benefit, not the interface

Viewers stay for what changes for them: the time saved, the mess avoided, the result they get. A technically accurate
UI mock (status lines, chips, settings) asks them to read and infer the point; show the consequence instead (the
copy-paste grind that stops, the scattered sessions that become one board, the small job that routes itself), and
keep UI for the moment the exact interface is the takeaway (the prompt to copy). One running example across the tips
(the same small project each time) is easier to follow than a new example per tip.

- When not to: the real screen recording is the proof, or the audience already knows the interface and wants it.

## At Gate B

Answer these from the plan's existing fields (create-reel `references/preflight.md`); there is no separate schema:

| Question | Where it lives |
|---|---|
| What is the primary visual mechanism? | the hook's and hero scene's `visualIntent` |
| What does the viewer see happen, not just appear? | `visualIntent`, `events` |
| What returns, if anything, and how has it changed? | `motifs`, `carryIn` / `carryOut` |
| How do the layouts serve attention? | `layout` per scene, `visualPurpose` |
| Which numbers deserve a visual demonstration, and which are fine as speech? | scenes whose anchor or intent names a number |
| Where do anticipation, motion and stillness go? | `events`, `holdReason` |
| Why is each visual better than generic footage or a title card? | `asset.whyThis` |
