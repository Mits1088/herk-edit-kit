# Local changes to this copy of motionmaxxing

Upstream: https://github.com/Tejashmakwana/motionmaxxing
Revision: 8c8ec0f2a6f6c9a0da15cd24f7b1298ab298368c (2026-10-06)
Installed with: `bash install.sh --dir <kit>/.agents/skills/motionmaxxing --copy` (no .git, no docs/media).
License: Apache-2.0 (LICENSE, NOTICE in this folder). Bundled third-party components keep their own licenses.

Changes made here (everything else is byte-identical to upstream):

1. Added `runtime/hero3d/package.json` with `{"type": "module"}`. The kit root is CommonJS, so
   `npm run check` syntax-checked the three.js browser modules as CommonJS and reported 58 false errors.
   The file only changes how Node parses those modules; browsers ignore it.
2. Added this file.

To update: clone the new upstream revision next to the kit, review install.sh and the diff, reinstall with
`--copy` into a fresh folder, re-apply the changes above, then run `npm run sync:skills`, `npm run check`
and `npm test`.

How Reel Studio uses it: the judgment, direction and review references, `scripts/lint.mjs` and
`scripts/look.py`. It does not load `runtime/motion.js`, the bundled GSAP or `scripts/render.mjs` inside
HyperFrames compositions (see `.agents/skills/create-reel/references/modes.md`).
