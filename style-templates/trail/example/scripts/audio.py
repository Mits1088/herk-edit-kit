"""Full-reel audio, mixed by the shared house mixer (scripts/audio/reelmix.py, audio-library/house-profile.json).
Voice: the cut's own track, cleaned (scripts/cut_full.py). Bed: "Funky_beat.wav" by Spol (CC0,
freesound.org/people/Spol/sounds/337671), looped on bar lines (approved by Mits after the trial). Effects are synthesized
locally (scripts/sfxlib.py) and sit only on visible actions; no hero cue (Mits: no crowd noise on this one). Run from the project folder: python -I scripts/audio.py"""
import json, sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(ROOT / 'scripts' / 'audio'))
import sfxlib as v  # noqa: E402
import reelmix  # noqa: E402

SR, D = v.SR, v.D
PLAN = json.load(open('assets/plan.json', encoding='utf-8'))
EVL = PLAN['events']
EV = {}
for e in EVL: EV.setdefault(e['type'], []).append(e['time'])
SC = {s['id']: s for s in PLAN['scenes']}


def load(path):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64) / (32768 if x.dtype == np.int16 else (2 ** 31 if x.dtype == np.int32 else 1))
    if x.ndim > 1: x = x.mean(axis=1)
    return x if sr == SR else resample_poly(x, SR, sr)


def pad(x, n): return np.pad(x, (0, max(0, n - len(x))))[:max(n, len(x))]
def mixs(*parts):
    n = max(int(o * SR) + len(s) for s, o, _ in parts) + 1; out = np.zeros(n)
    for s, o, g in parts: i = int(round(o * SR)); out[i:i + len(s)] += s * g
    return out


def music():
    """Loop the CC0 groove on bar lines (beat about 0.72 s, bar 2.88 s); 0.2 s equal-power crossfade; fade at the end."""
    x = load('assets/audio/music/funky-beat-spol-337671.wav')
    s0 = int(0.01 * SR); L = 6 * 2.88
    n = int(0.2 * SR); t = np.linspace(0, np.pi / 2, n); Ls = int(L * SR)
    seg = x[s0: s0 + Ls + n]
    out = seg.copy()
    while len(out) < D * SR + SR:
        out[-n:] = out[-n:] * np.cos(t) + seg[:n] * np.sin(t)
        out = np.concatenate([out, seg[n:]])
    out = out[:int(D * SR)]
    fi, fo = int(0.03 * SR), int(0.8 * SR)
    out[:fi] *= np.linspace(0, 1, fi); out[-fo:] *= np.linspace(1, 0, fo)
    return out


def wipe():
    a = v.s_air(0.30, 1200, 7000) * 0.8
    a[int(0.24 * SR):int(0.24 * SR) + int(0.05 * SR)] += v.s_tick(4200, 0.006) * 0.5
    return a


def land(f=170): return mixs((v.s_tap(f), 0, .8), (v.s_tick(2600, .006), 0, .3))
def keys(dur, rate=14):
    """Soft typing: seeded ticks at about `rate` per second."""
    out = np.zeros(int(dur * SR) + SR // 10); rng = np.random.default_rng(3); t = 0.0
    while t < dur:
        i = int(t * SR); k = v.s_tick(2200 + rng.integers(-400, 400), 0.004) * (0.5 + 0.3 * rng.random())
        out[i:i + len(k)] += k; t += 1 / rate * (0.7 + 0.6 * rng.random())
    return out


def main():
    m = reelmix.Mix(SR, D, v.WORDS, reelmix.load_profile('.'))
    m.set_voice(load('assets/audio/voice-proc.wav'))
    m.set_bed(music())
    c = lambda sig, at, role, name, ev: m.cue(sig, at=at, role=role, name=name, event=ev)
    c(land(190), 0.10, 'foley', 'banner lands', 'title-stack')
    for t in EV['example-swap']: c(wipe(), t, 'foley', 'example wipe', 'example-swap')
    c(v.s_blip(560, 1120, 0.16), EV['example-swap'][2] + .08, 'foley', 'Clawd hop', 'example-swap')
    c(v.lp(v.s_air(0.40, 200, 1800), 1800), EV['focus-dim'][0], 'accent', 'results dim', 'focus-dim')
    c(mixs((v.s_tap(150), 0, .8), (v.s_paper(.12), 0, .5)), EV['card-forward'][0] + .12, 'accent', 'card lands', 'card-forward')
    c(v.s_paper(0.30) * .8, EV['card-open'][0], 'foley', 'card opens', 'card-open')
    c(v.s_air(0.36, 600, 5000), EV['install'][0], 'foley', 'file flies in', 'install')
    c(keys(0.6), EV['install'][0] + .02, 'foley', 'install typing', 'install')
    c(v.s_tone(), EV['install'][0] + 1.0, 'accent', 'skill added', None)
    c(v.s_air(0.34, 300, 3000) * .7, SC['s02']['start'] - .06, 'foley', 'to face', 'name')
    c(v.s_paper(0.22), EV['name'][0] + .1, 'foley', 'name underline', 'name')
    m.cue(v.s_air(0.30, 300, 3000) * .6, at=SC['s03']['start'] - .2, role='foley', name='to split', event=None, gain_db=-8)
    c(v.s_paper(0.24), EV['highlight'][0], 'foley', 'README marker', 'highlight')
    m.cue(wipe(), at=SC['s04']['start'] - .14, role='foley', name='gallery wipe', event=None, gain_db=-8)
    c(keys(0.5, 22) * .8, EV['count'][0], 'foley', 'counter rolls', 'count')
    c(wipe(), SC['s05']['start'], 'foley', 'compare wipe', 'tells')
    for k in ('tells', 'tell-2', 'tell-3'): c(v.s_stop() * .7, EV[k][0] + .04, 'foley', 'tell chip', k)
    c(v.s_air(0.42, 800, 6000), EV['slider-sweep'][0] + .14, 'accent', 'slider sweep', 'slider-sweep')
    # 0 issues: a bright two-note tone and a soft tap as the chip lands (no crowd, per Mits)
    c(mixs((v.s_tone(), 0, 1), (v.s_tone() * .8, .09, 1)), EV['issues-zero'][0], 'accent', '0 issues', 'issues-zero')
    c(v.s_blip(560, 1120, 0.16), EV['issues-zero'][0] + .02, 'foley', 'Clawd cheers', 'issues-zero')
    # into and out of the full-bleed beats: the speaker panel slides away and back
    tfull = [SC['s04']['start'] - .04, SC['s06']['start'] - .04, EV['full-screen'][0]]
    tback = [SC['s05']['start'] - .04, SC['s07']['start'] - .04, SC['s09']['start'] - .06]
    for t in tfull: m.cue(v.s_air(0.38, 300, 3500) * .7, at=t - .16, role='foley', name='to full screen', event=None, gain_db=-8)
    for t in tback: m.cue(v.s_air(0.32, 400, 4000) * .6, at=t, role='foley', name='back to split', event=None, gain_db=-6)
    c(wipe(), SC['s07']['start'], 'foley', 'deal wipe', 'type')
    c(keys(1.3), EV['type'][0], 'foley', 'prompt typing', 'type')
    for i in range(3): c(mixs((v.s_paper(.08), 0, .8), (v.s_tick(1800, .006), .02, .4)), EV['deal'][0] + i * .07, 'foley', 'card dealt', 'deal')
    c(v.s_blip(520, 1040, 0.16), EV['pick'][0], 'accent', 'Refract picked', 'pick')
    c(wipe(), SC['s08']['start'], 'foley', 'build wipe', 'build')
    for i in range(0, 9, 2): c(v.s_tick(1600 + 120 * i, .006), EV['build'][0] + i * .045, 'foley', 'block', 'build')
    c(v.s_air(0.5, 400, 4000) * .7, EV['build'][0] + .4, 'foley', 'page fills', 'build')
    c(land(210), EV['browser'][0] + .1, 'foley', 'page loads', 'browser')
    c(v.s_air(0.36, 500, 5000), EV['resize'][0], 'accent', 'to tablet', 'resize')
    tph = [w['start'] for w in v.WORDS if w['text'].strip('.').lower() == 'screens'][0] - .08
    c(v.s_air(0.34, 700, 6000), tph, 'accent', 'to phone', 'resize')
    for k, t in enumerate([EV['resize'][0] + .26, tph + .26, tph + .5]): c(v.s_blip(700 + 90 * k, 1300 + 90 * k, .12), t, 'foley', 'width tick', 'resize')
    c(v.s_blip(560, 1120, 0.16), EV['reviewer-in'][0] + .02, 'foley', 'reviewer hops in', 'reviewer-in')
    c(v.s_air(0.7, 1500, 7000) * .6, EV['blink'][0] + .14, 'foley', 'scan', 'blink')
    c(v.s_tone(), EV['blink'][0] + .82, 'accent', 'reviewed', 'blink')
    c(v.s_air(0.6, 300, 3000), EV['hand-back'][0] + .06, 'accent', 'back to you', 'hand-back')
    c(v.s_air(0.34, 300, 3000) * .7, SC['s10']['start'] - .06, 'foley', 'to face', 'keyword')
    c(land(180), EV['keyword'][0] + .05, 'accent', 'comment bubble', 'keyword')
    rep = m.render('assets/audio')
    print(json.dumps(rep, indent=1)[:900])


if __name__ == '__main__':
    main()
