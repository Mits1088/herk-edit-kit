# Scene templates

- `dark-graph-paper-template/`: animated background; no footage required. Copy
  the HTML and config into a new video project, then add your story content.
- `left-glass-popout/`: a camera reframe with an animated glass panel. Supply
  your own `assets/source.mp4` with video and audio, and adjust source duration,
  crop, card copy, and timings before rendering.
- `trail/`: Reel Studio product-proof reel (talking head + fixed browser frame +
  full-bleed proof beats). Read `trail/README.md`; the approved Hallmark build is in
  `trail/example/`, the source blueprint in `trail/reference/`. Call it with
  `/create-reel ... use the trail template`.

These are standalone scene starting points, while style-library contains cards.
Templates currently reference a public GSAP CDN. For a self-contained project,
copy `node_modules/gsap/dist/gsap.min.js` into its assets folder and change the
script source to `assets/gsap.min.js`, as the starter setup does.
