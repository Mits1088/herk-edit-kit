# Website Reel — Detailed Reference and Creative Direction

> Purpose: help Claude create a website reel using the user's existing avatar footage, borrowing this reference's layout, immediate title-led opening, changing website examples and attention control. Begin with a roughly five-second Hyperframe Studio trial.

## 1. Source and scope

| Field | Value |
| --- | --- |
| Source supplied by user | `DfUtovOvQ8U.mp4` |
| Analysis date | 12 November 2026 |
| Source dimensions | 1080 × 1920, portrait 9:16 |
| Video frame rate | 30 fps |
| File duration | Approximately 72.63 seconds |
| Visible opening title | “Claude Code Websites” |
| Visible benefit subtitle | “Without AI Slop” |
| Product named on screen | Hallmark |
| Intended adaptation | Website reel with the user's already-recorded avatar and voice |

### Evidence boundaries

- This is a visual analysis of the supplied video, not independent verification of the product's capabilities, author, repository statistics or marketing claims.
- The opening and its first transition were inspected through quarter-second samples. Later sequences were inspected through half-second, one-second and two-second samples.
- The timeline below describes approximate editorial windows. It is not a frame-accurate edit decision list. Inspect the original video before copying exact entry and exit frames.
- The uploaded file visibly repeats substantial content after the first closing CTA, around the mid-30-second region. Do not treat repeated sequences as a requirement to repeat the new reel. Later timestamps below refer to positions in the supplied file, not a proposed final duration.
- Audio was not auditioned for this analysis. Music genre, effect names, exact sound synchronization and loudness are not established observations.
- Original source code, fonts, easing curves, masks and compositing layers were not available. Numerical animation settings in the adaptation sections are proposed starting points.
- The user's avatar footage for this website reel is not part of the inspected reference. Adapt the crop and masking to the actual supplied avatar asset.

## 2. The central creative lesson

The reference makes its promise legible almost immediately. A title establishes the subject, a short contrasting subtitle states the benefit, a finished website supplies visible evidence, and the presenter provides a human anchor.

The layout stays stable while the website examples change. This creates variety without forcing the viewer to decode a new composition every second.

The opening therefore gives the viewer both an answer and an unanswered question:

- Answer: this is about creating better-looking websites with Claude Code.
- Question: how does it produce these different finished examples?

The sense of anticipation comes from seeing desirable results before the mechanism is explained. It does not require delaying the reveal behind a blank screen or a long title animation.

For the user's version, preserve this relationship: **clear promise + immediately visible result + changing evidence + stable presenter**.

This is an editorial interpretation, not a measured claim about audience retention.

## 3. What the user wants to trial

1. Use the avatar and spoken take that already exist.
2. Match the reference's approximate split-screen dimensions.
3. Make the first three seconds deliberately composed, with the title doing meaningful work.
4. Show attractive, believable website examples early.
5. Use entry, exit, dimming and highlighting to guide attention.
6. Allow Claude creative freedom inside that direction.
7. Build only a roughly five-second opening in Hyperframe Studio for review first.

This document is a reference and implementation aid. It does not replace the user's normal reel workflow or prescribe every scene in the eventual reel.

## 4. Opening timeline: first approximately five seconds

| Approximate time | Observed visual state | Attention function | Adaptation lesson |
| --- | --- | --- | --- |
| 0.00–0.25 s | Presenter and a dark pottery website are already present. The title is still resolving in the earliest sampled frame. | Gives the viewer a subject to look at immediately. | Start with a meaningful composition, even if text takes a few frames to settle. |
| 0.25–0.50 s | Main title is legible; the blue benefit strip finishes revealing its wording. Small coral mascots flank the area above the website. | Establishes topic, benefit and personality. | Keep title animation short enough to support the hook rather than consume it. |
| 0.50–1.25 s | Title and subtitle hold. The first website remains inside the same rounded preview frame while its visible content shifts. Captions update below. | Lets the viewer absorb the promise and inspect a finished result. | Hold the frame steady while the example supplies motion. |
| 1.25–2.25 s | A dark blue website replaces the first example inside the same frame. | Shows a second aesthetic and makes the promise less dependent on one sample. | Pick examples with meaningfully different visual identities. |
| 2.25–3.25 s | A light perfume website replaces the dark example. The headline remains in place. | Produces a strong light/dark contrast while preserving orientation. | Use example selection as part of the animation rhythm. |
| 3.25–4.25 s | A pale blue swimming-related website appears. The title and subtitle progressively leave or fade. | Moves from promise toward explanation. | Remove introductory labels when they stop helping. |
| Around 4.25–5.0 s | The bright composition changes to a dark, blurred backdrop with a terminal window in front. The terminal grows into a taller panel and command entry becomes visible. | Signals a change from results to the mechanism that produces them. | Use a deliberate layout change at the narrative handoff. |

### Important correction to “everything is there at frame zero”

The composition is established immediately, but the sampled first frame still shows an incomplete title reveal. The useful property is near-immediate clarity, not a requirement that every text glyph be fully visible on the first encoded frame.

For the adaptation, a complete title from the first frame is a valid choice. A very brief reveal is also valid if the topic and example are already clear.

## 5. Layout measurements

These measurements are visual estimates from a settled opening frame at approximately 0.6 seconds. They describe that frame, not every later scene.

Coordinates use the top-left of the 1080 × 1920 canvas as `(0, 0)`.

| Element | Approximate bounds or location | Relative meaning |
| --- | --- | --- |
| Main title | x ≈ 105–980; y ≈ 250–315 | Broad centred headline near the upper quarter |
| Blue subtitle banner | x ≈ 275–805; y ≈ 340–445 | Short, high-contrast benefit directly below title |
| Left mascot | x ≈ 100–235; y ≈ 395–490 | Small accent at upper-left of preview |
| Right mascot | x ≈ 845–985; y ≈ 395–495 | Balances left mascot without occupying the central reading area |
| Website preview | x ≈ 115; y ≈ 495; width ≈ 850; height ≈ 460 | Approximately 79% of frame width and 24% of frame height |
| Caption region | y ≈ 1000–1100 | Dedicated bridge between graphics and presenter |
| Top of presenter's hair | y ≈ 1130 | Presenter silhouette starts at approximately 59% of canvas height |
| Rounded presenter backdrop | x ≈ 50; y ≈ 1305; width ≈ 980; continues to bottom | Backdrop starts lower than the person's head |
| Presenter body | Lower frame, extending to bottom edge | Foreground person overlaps the backdrop |

### Why a simple 50/50 crop will not match

The reference is a layered portrait composition. The upper graphics, captions and lower presenter occupy distinct zones, and the presenter's head projects above the rounded background panel.

Calling it “roughly 58% upper content / 42% presenter” is a useful shorthand, but there is no hard horizontal divider at 58%. The silhouette and backdrop start at different heights.

### Suggested initial layout for the trial

Use these values as an initial composition, then refine for the user's avatar:

| Layer | Trial starting point |
| --- | --- |
| Canvas | 1080 × 1920 |
| Main title centre | Around y = 285 |
| Benefit banner centre | Around y = 390 |
| Website frame | x = 115, y = 495, w = 850, h = 460 |
| Caption lane | y = 990–1110 |
| Avatar silhouette top | Around y = 1130 |
| Avatar backdrop | x = 50, y = 1305, w = 980, h = 615 |

Scale positions proportionally when working at a different resolution. At 540 × 960, divide these values by two.

### Avatar integration

- Preserve the user's actual expression, timing and lip synchronization.
- If an alpha cutout or clean mask is available, place the avatar above the rounded backdrop as a separate layer.
- If the avatar arrives as rectangular footage, test background removal only if it produces clean hair and shoulder edges. Otherwise use a considered crop inside a rounded panel.
- Do not distort the avatar to force it into the reference's exact silhouette.
- Keep captions clear of the head and face throughout head movement.
- Check the lower crop against the actual intended platform interface. The reference itself does not establish a universal safe area.

## 6. Visual hierarchy and typography

### Three different text jobs

| Text type | Job | Reference behaviour |
| --- | --- | --- |
| Main title | State the topic | Large, bold, dark sans-serif text |
| Benefit subtitle | State the differentiating promise | White italic serif text on a saturated blue strip |
| Spoken captions | Support the current phrase | Short phrases between website and presenter; selected words change colour or style |

The title and captions do not have to repeat the same sentence. The title provides persistent context while the captions track speech.

### Adaptation guidance

- Write a short topic title and a short benefit phrase derived from the actual script.
- Preserve the user's brand fonts where they serve the same hierarchy.
- Use contrast in weight, style or background to distinguish the subtitle; the reference's exact font is not required.
- Keep each caption phrase brief enough to read while also watching the example.
- Reserve accent colour for a meaningful word or claim rather than colouring every word.
- Avoid placing another headline over the website if the title and subtitle already establish the point.
- Judge title size at a 360-pixel-wide phone preview. The website's tiny body copy can remain contextual, but the headline and selected focal detail must be legible.

## 7. Website examples: selection, cropping and replacement

The opening uses contrasting website styles: a dark pottery design, a dark blue design, a light perfume design and a pale blue swimming design.

The important mechanism is variety inside a stable viewport. Different images, palettes and typographic arrangements demonstrate range without relocating the viewer's focus.

### Choose examples deliberately

1. Start with a finished design that reads well in a wide crop.
2. Change to a visibly different composition or colour treatment.
3. Include a light/dark contrast where the script supports it.
4. Preserve enough page structure to make each example recognisable as a usable website.
5. Use the user's project or genuine available examples where appropriate. Do not imply unrelated websites were generated by a tool without evidence.

### Crop for the claim

- For visual quality: show the hero image, main heading and one meaningful control or content section.
- For functionality: crop or zoom into the relevant interaction.
- For responsiveness: keep the same site identifiable while its viewport changes.
- For code or settings: show the one line or control that explains the action.

### Entry and exit behaviour

Observed: examples occupy the same frame, and content changes without rebuilding the entire scene. The supplied samples do not establish the exact transition algorithm for every replacement.

Proposed for the trial: use a short contained wipe, cut or restrained crossfade. Avoid large card flights that obscure the website during most of its screen time. Keep the border and frame position stable through the replacement.

## 8. Attention control: dimming, blur and active layers

### Observed methods

| Method | Reference evidence | Visual effect |
| --- | --- | --- |
| Bright split composition | Opening and later presenter-plus-website scenes | Friendly, readable overview with human presence |
| Dark blurred backdrop | Terminal and repository demonstrations | Separates the sharp active window from contextual imagery |
| Highlighted source text | Attribution, command and documentation details | Reduces the amount the viewer must read |
| Enlarged number badge | Star count and theme count sequences | Turns a small source detail into a readable focal point |
| Outlined website issues | Audit demonstration | Points to specific problems rather than merely saying a page is flawed |
| Dark diagnostic region | Later website checking sequence | Allows the result and its checks to coexist with different emphasis |
| Return to full presenter | Product naming and final CTA | Gives a spoken statement or request direct human ownership |

### Dimming is a relationship, not a blanket effect

The active item should remain sharp, readable and visually dominant. Supporting material can remain visible at lower contrast so the viewer understands what the detail belongs to.

Do not infer an exact source opacity or blur radius from the encoded footage. The appearance can be produced in several ways.

### Proposed implementation starting points

These values are suggestions, not measured settings from the reference:

- Background dark overlay: test approximately 35–55% opacity.
- Background blur at 1080-wide output: test approximately 12–24 px, depending on the source detail.
- Active foreground window: retain full contrast and readable text.
- Focus transition: test approximately 150–250 ms.
- Selected crop enlargement: test a modest 1.05–1.12 scale change if the crop remains inside its bounds.

Adjust by eye at final output size. A dark source image may need less dimming; a bright page may need more. If blur destroys the useful relationship to the source, reduce it.

### Restore context after emphasis

When a focal badge or highlight finishes its job, remove it before the next claim. If the narrative returns to the same wider view, restore its contrast. Avoid leaving old emphasis layers behind as decorative clutter.

## 9. Later visual sequence ledger

These ranges summarize observed sequences in the first pass and selected repeated material. They are not a complete frame-level shot list.

| Approximate source window | Visual sequence | Entry, emphasis or exit behaviour | Transferable lesson |
| --- | --- | --- | --- |
| 4.25–5.75 s | Terminal and slash command | Bright layout gives way to dark context; terminal expands; command text and selection become visible | Let the mechanism replace the opening promise at a clear narrative turn |
| 5.75–7 s | Presenter naming the tool | Full-height face; stylised product-name caption | Use the face to anchor the important name |
| 7–8.5 s | GitHub README and attribution | Sharp source page; attribution highlight and temporary logo treatment | Show provenance near the claim it supports |
| 8.5–10.5 s | Repository statistics | Source statistic is outlined; large count badge appears over the page | Give a tiny important number its own readable moment |
| 10.5–12.5 s | Theme gallery | Many thumbnail examples; “50 themes” badge arrives, then gallery continues | Make breadth visible as actual examples |
| 12.5–14.5 s | Documentation list | Text crop and highlights; later sampled frames show a horizontal streak/glitch-like transition | Documentation can become visual evidence when its reading task is tightly directed |
| 14.5–17 s | Website audit and comparison | Coloured outlines identify issues; comparison control reveals a different state | Show an observable before/after relationship |
| Around 18–20 s | Bright split with prompt and example | Prompt appears in a large panel; product visual joins it | Return to simpler explanation after dense proof |
| Around 20–26 s | Build, result and viewport variation | Sparse page structure precedes finished site; later viewport narrows | Separate construction, finished quality and responsiveness |
| Around 28–30 s | Website with mascot review | Small mascot sits above the browser frame with changing props/pose | Give character animation a task related to the current explanation |
| Around 32–35 s | Presenter CTA | Full face; “comment” and the keyword become the text focus | Finish with a simple human-directed request |
| Around 36 s onward | Substantial repeated content | Opening and demonstrations recur | Treat as source-file structure, not an instruction for the new edit |
| Around 60–63 s | Finished website, tests and narrow viewport | Website shares space with dark checks; frame changes shape | Demonstrate validation and responsive behaviour with the same identifiable output |
| Around 64–68 s | Return to bright split and mascot | Site stays framed above presenter; mascot changes state; a sampled transition briefly lowers the site's contrast | Restore the main composition after detailed proof |
| Around 69–72 s | Final presenter CTA | Website disappears; presenter and keyword dominate | Clear supporting material away for the closing action |

## 10. Mascot behaviour

The opening mascots sit near the website frame and support the composition without becoming the main subject. Later, a mascot appears associated with the site's review process.

Useful adaptation roles:

- Present an example or draw attention to a meaningful feature.
- Inspect the website at the moment the script discusses review.
- React briefly to a finished result.
- Carry a small prop that clarifies its current role.

Keep the website and presenter as the principal subjects. A mascot should not block a heading, cover a useful control or demand attention during a source citation.

Do not add constant bouncing merely to prevent stillness. A short anticipation, action and settle can communicate more than continuous motion.

## 11. Reusable mechanism inventory

| ID | Mechanism | Trigger → visible action → consequence | Best use |
| --- | --- | --- | --- |
| WEB-M01 | Immediate promise stack | Opening → topic, benefit, result and presenter appear → viewer understands the premise | First three seconds |
| WEB-M02 | Stable frame, varied evidence | Same preview frame → contrasting sites replace each other → range becomes visible | Website quality and design variety |
| WEB-M03 | Title retirement | Explanation begins → title and banner leave → demonstration gains space | Transition out of the hook |
| WEB-M04 | Foreground proof window | Detailed claim → backdrop darkens/blurs and source stays sharp → attention concentrates | GitHub, documentation and terminal evidence |
| WEB-M05 | Source detail enlargement | Small metric → highlight plus enlarged badge → claim becomes readable | Counts or specific source values |
| WEB-M06 | Caption lane | Speech changes → short caption updates in fixed region → continuity without obscuring proof | Split-screen explanation |
| WEB-M07 | Presenter overlap | Rounded lower backdrop → head extends above it → sections feel visually connected | Existing avatar integration |
| WEB-M08 | Audit-to-comparison | Issues outlined → alternative state revealed → improvement can be inspected | Before/after explanations |
| WEB-M09 | Same output, changing viewport | Finished site → frame narrows → responsive variation becomes visible | Responsive design claims |
| WEB-M10 | Task-linked mascot | Review or inspection mentioned → mascot changes pose/prop → character reinforces meaning | Small personality beats |
| WEB-M11 | Human reset | Dense proof ends → full presenter returns → spoken judgement gains emphasis | Naming, qualification or CTA |
| WEB-M12 | Temporary emphasis | Claim begins → badge/highlight appears → emphasis leaves with the claim | Preventing visual accumulation |

## 12. Proposed five-second Hyperframe Studio trial

This is an adaptation proposal, not a reconstruction of the source timing. Align it to the user's actual first sentence.

### Trial content

- Existing avatar footage and synchronized voice.
- Topic title and benefit subtitle derived from the actual script.
- Two or three strong website examples, preferably from the actual subject or project.
- Reference-inspired upper preview, caption lane and lower avatar composition.
- Optional small mascot actions.
- Representative sound design and music if assets are available.

### Proposed timing

| Trial time | Intended experience | Editing note |
| --- | --- | --- |
| 0.00–0.35 s | Avatar, first website and title establish the premise | No empty opening; any title reveal should resolve quickly |
| 0.35–1.40 s | First website can be appreciated | Use restrained internal movement or an intentional crop |
| 1.40–2.50 s | Second example shows contrast | Preserve the preview frame and title positions |
| 2.50–3.60 s | Third example adds range, if the voice permits | Two strong examples are preferable to three unreadable flashes |
| 3.60–5.00 s | Title retires and the next explanatory state begins | Transition on meaning in the actual voice, not solely on this schedule |

If the spoken hook ends earlier or later, adapt the durations. The test is whether the first three seconds communicate the promise and whether the handoff feels natural.

### Deliverable requested from Claude

1. A playable roughly five-second sequence in Hyperframe Studio.
2. Actual avatar and voice, not a silent placeholder or still-only storyboard.
3. Captions and representative motion so pacing can be judged.
4. A clear route to open and replay the sequence.
5. A pause for user feedback before building or rendering the full reel.

## 13. Production notes for implementation

### Suggested layer order

From back to front:

1. Base background or texture.
2. Contextual blurred imagery, when used.
3. Dimming overlay for proof scenes.
4. Website or source window.
5. Local highlights, callouts and metric badges.
6. Mascot elements associated with the active window.
7. Title and subtitle during the hook.
8. Rounded avatar backdrop.
9. Avatar foreground or cropped footage.
10. Spoken captions and final CTA text, positioned to avoid the avatar.

Layer order can change by scene; the goal is consistent visual priority. In particular, keep the dimming overlay behind the active source window.

### Motion properties to keep consistent

- Preview frame position and corner treatment.
- Title and caption alignment.
- Entry and exit direction for related elements.
- Highlight colour and line weight.
- Mascot scale relative to the preview window.
- Short settle periods after major changes.

### Practical checks

- Keep website previews sharp enough for their intended reading task.
- Avoid stretching desktop pages to fill an arbitrary aspect ratio.
- Crop rather than distort, and show responsive layouts only when actually available or clearly illustrated.
- Confirm masks remain clean during avatar movement.
- Ensure transparent effects and filters render consistently in the final export, not only the live browser preview.
- Watch the sequence continuously with the voice. A contact sheet cannot establish smooth motion or lip sync.
- Use the existing workflow's export and caption settings unless the trial reveals a specific problem.

## 14. Sound direction for the adaptation

No source-audio conclusions are claimed here. The following are creative suggestions:

- Keep the voice dominant.
- Use a restrained pulse that supports the website changes.
- Give the first major title or example change a small intentional cue if it improves clarity.
- Reserve stronger cues for a meaningful reveal or completed transformation.
- Avoid assigning a whoosh to every caption or tiny highlight.
- Review the hook once with sound and once muted. The visual premise should survive muted playback; the sound should make the timing feel more deliberate.

## 15. Common failure modes and corrections

| Failure | Why it weakens the trial | Correction |
| --- | --- | --- |
| Blank grid or empty placeholder at the start | Delays the benefit | Begin with a finished, desirable example |
| Long title animation | Uses the hook window before the promise becomes legible | Reveal quickly or start fully composed |
| Tiny full desktop screenshot | Gives texture without understandable evidence | Crop to the relevant page section |
| Literal 50/50 rectangular split | Loses the reference's layered proportions | Recreate preview, caption lane and overlapping presenter separately |
| Website, mascot, title and captions all moving aggressively | Creates competing focal points | Hold the composition while one important element changes |
| Every example has the same visual style | Fails to demonstrate range | Select meaningful contrast in palette and composition |
| Title persists through all later proof | Consumes space after its purpose is complete | Retire it at the narrative handoff |
| Active source also becomes dim | Makes the evidence harder to inspect | Dim supporting layers only |
| Old badges remain after the claim | Accumulates clutter | Give each emphasis layer an intentional exit |
| Mascot covers useful website content | Personality competes with the demonstration | Place character around the frame and give it a relevant task |
| Generated mock shown as authentic product output | Misrepresents what the tool demonstrated | Use genuine evidence or label the illustration |
| Preview judged only from stills | Timing, transitions and audio problems remain unseen | Watch actual continuous playback at phone size |

## 16. Review checklist

### First three seconds

- [ ] A useful visual is present immediately.
- [ ] The topic title is readable almost immediately.
- [ ] The benefit subtitle says something specific and supported by the script.
- [ ] The website looks desirable at phone size.
- [ ] The presenter is recognisable and appropriately sized.
- [ ] Example changes create variety inside a stable frame.
- [ ] Captions do not collide with the title, preview or face.
- [ ] The visual premise is understandable without audio.

### Full five-second trial

- [ ] Actual avatar and voice are synchronized.
- [ ] The title exits at a meaningful point, if it exits within the trial.
- [ ] The next scene begins clearly rather than appearing as a random layout change.
- [ ] Dimming preserves the active item's readability.
- [ ] Mascot behaviour supports the explanation.
- [ ] Website crops and proportions remain credible.
- [ ] Continuous playback has been reviewed, not only still frames.
- [ ] A 360-pixel-wide preview has been inspected.
- [ ] The Hyperframe Studio version is playable and easy to replay.
- [ ] The full reel remains pending user feedback on this trial.

## 17. Concise directive to paste into Claude Code

> Trial the attached reference reel's layout with my existing avatar footage. Match its approximate proportions: website and graphics in the upper section, short captions between the sections, and the presenter in the lower roughly 42%, with their head overlapping a rounded backdrop where practical.
>
> Make the opening feel composed almost immediately: a strong topic title, a short benefit subtitle, an impressive website example and my avatar already visible. Keep the title stable while two or three contrasting examples change inside the same frame. Build anticipation through the quality and variety of the results.
>
> Use the reference's attention control: keep the active example bright and sharp, dim or blur supporting material when a detail needs focus, and introduce highlights when they become relevant. Let the title leave when the demonstration needs the room.
>
> Adapt this to our script and brand, with freedom to improve the execution. Small mascot interactions are welcome where they add personality.
>
> Create only a roughly five-second opening in Hyperframe Studio first, using my actual avatar and voice, captions and representative sound. Watch it at full speed and phone size, then make it playable for my review before building the rest.

## 18. Handoff summary

The transferable design is a title-led opening with immediate finished examples, a stable preview frame, a dedicated caption lane and an overlapping lower presenter. Subsequent scenes change the visual hierarchy as the story moves from promise to proof, explanation and CTA.

Use the measurements as a starting template, the observed mechanisms as inspiration and the five-second preview as the practical test. Keep creative choices open where the user's script or footage calls for a better solution.
