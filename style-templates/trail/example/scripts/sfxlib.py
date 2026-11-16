"""Audio for the claude-arena reel (adapted from karpathy-rules), made locally (no paid generation, no film score).

Stems: voice (cut + cleaned by scripts/prep.py), a synthesized warm, bright bed, and a synthesized
SFX score following the visual event map. Bed and effects are ducked under speech from the word timings; the mix is
mastered to about -14 LUFS, true peak <= -1.5 dBTP. Run from the project folder: python -I scripts/audio.py
"""
import json, re, subprocess
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, lfilter

SR = 48000
PLAN = json.load(open('assets/plan.json'))
D = PLAN['duration']
N = int(round(D * SR))
rng = np.random.default_rng(7)  # seeded: the same stems every run
SC = {s['id']: s for s in PLAN['scenes']}
WORDS = json.load(open('assets/transcript.json'))['words']
SNAP, SOFT = 11 / 30, 12 / 30   # ReelEases snapSettle / softLand durations


def w(word, after):
    n = lambda s: re.sub(r"[^a-z0-9'-]", '', s.lower())
    return next(x['start'] for x in WORDS if x['start'] >= after - 1e-3 and n(x['text']) == n(word))


def t_axis(n):
    return np.arange(n) / SR


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def place(buf, sig, t, gain=1.0):
    i = int(round(t * SR))
    j = min(len(buf), i + len(sig))
    if j > i >= 0:
        buf[i:j] += sig[: j - i] * gain


def lufs(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'ebur128', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1])


def note(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------- Bed: D minor, 100 BPM, Dm Bb F C, warm pad + sub + plucks + a soft frame-drum pulse ----------------
def bed():
    beat = 60 / 100
    bar = 4 * beat
    chords = [[50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 53, 57], [48, 55, 60, 64]]
    roots = [38, 34, 29, 36]
    pad = np.zeros(N); sub = np.zeros(N); pl = np.zeros(N)
    t0 = 0.0; ci = 0
    while t0 < D:
        dur = 2 * bar
        n = int(dur * SR) + SR // 2
        tt = t_axis(n)
        env = np.minimum(1, tt / 0.8) * np.minimum(1, np.maximum(0, (dur + 0.5 - tt) / 0.5))
        x = np.zeros(n)
        for m in chords[ci % 4]:
            for det in (-0.08, 0.08):
                x += np.sin(2 * np.pi * note(m) * 2 ** (det / 12) * tt)
        place(pad, lp(x, 1500) * env / 8, t0)
        place(sub, np.sin(2 * np.pi * note(roots[ci % 4] + 12) * tt) * env * 0.35, t0)
        for k in range(8):
            m = chords[ci % 4][(k * 3) % 4] + 12
            pn = int(0.8 * SR); pt = t_axis(pn)
            place(pl, np.sin(2 * np.pi * note(m) * pt) * np.exp(-pt / 0.25) * 0.3, t0 + k * beat)
        t0 += dur; ci += 1
    drum = np.zeros(N)
    k = 0
    while k * beat < D:
        n = int(0.25 * SR); tt = t_axis(n)
        hit = np.sin(2 * np.pi * (70 + 40 * np.exp(-tt / .03)) * tt) * np.exp(-tt / .09) + lp(rng.standard_normal(n), 900) * np.exp(-tt / .02) * .3
        place(drum, hit * (1.0 if k % 4 == 0 else .55), k * beat)
        k += 1
    mix = pad * 0.6 + sub * 0.5 + pl + drum * 0.5
    tt = t_axis(N); g = np.ones(N)
    g *= np.where(tt < 1.6, 0.6, 1)                                         # the first line sits clear
    g *= np.where((tt > SC['s07']['start']) & (tt < SC['s07']['end']), 0.5, 1)     # the countdown: thuds carry it
    g *= np.where((tt > SC['s08']['start']) & (tt < SC['s08']['end']), 1.25, 1)    # the win lifts
    g *= np.where(tt > SC['s11']['start'], 0.55, 1)                          # the ask
    g *= np.where(tt > D - 0.35, np.maximum(0, (D - tt) / 0.35), 1)
    return np.stack([mix * g, mix * g], 1)


# ---------------- SFX palette: soft ticks, taps, air, paper, a warm tone, one chip blip for the jumps ----------------
def env_exp(n, tau):
    return np.exp(-t_axis(n) / tau)


def s_tick(freq=3200, tau=0.008):
    n = int(0.05 * SR); return bp(rng.standard_normal(n), freq * 0.7, freq * 1.3) * env_exp(n, tau)


def s_tap(f=140):
    n = int(0.3 * SR); tt = t_axis(n)
    return np.sin(2 * np.pi * f * tt) * env_exp(n, 0.06) + lp(rng.standard_normal(n), 2500) * env_exp(n, 0.005) * 0.5


def s_air(dur=0.45, lo=600, hi=5000):
    n = int(dur * SR); tt = t_axis(n)
    return bp(rng.standard_normal(n), lo, hi) * np.sin(np.pi * np.minimum(1, tt / dur)) ** 2 * 0.6


def s_tone():
    n = int(0.6 * SR); tt = t_axis(n)
    x = np.sin(2 * np.pi * 660 * tt) + 0.6 * np.sin(2 * np.pi * 990 * tt) + 0.2 * np.sin(2 * np.pi * 1320 * tt)
    return x * np.minimum(1, tt / 0.005) * env_exp(n, 0.16) * 0.35


def s_stop():
    n = int(0.25 * SR); tt = t_axis(n)
    return np.sin(2 * np.pi * 85 * tt) * env_exp(n, 0.05) + lp(rng.standard_normal(n), 1200) * env_exp(n, 0.012) * 0.6


def s_paper(dur=0.3):
    return s_air(dur, 500, 4500) * 0.9


def s_blip(f0=520, f1=1040, dur=0.16):
    """A soft rounded jump blip: a rising sine with a little odd harmonic, low-passed (no square-wave harshness)."""
    n = int(dur * SR); tt = t_axis(n)
    f = f0 * (f1 / f0) ** (tt / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.25 * np.sin(3 * ph)
    return lp(x, 3000) * np.minimum(1, tt / 0.004) * np.exp(-tt / (dur * 0.6)) * 0.5


def s_plug():
    a = s_tap(220) * 0.6; a[:int(0.05 * SR)] += s_tick(1800, 0.01) * 0.6
    return a


def s_chalk(dur, strokes, bright=1.0):
    """Chalk on slate: band-passed noise in short strokes (seeded), each stroke a quick swell and stop."""
    n = int(dur * SR); tt = t_axis(n)
    x = bp(rng.standard_normal(n), 1200, 4200) * 0.8 + bp(rng.standard_normal(n), 2500, 5200) * 0.2 * bright
    per = dur / strokes
    ph = (tt % per) / per
    env = np.sin(np.pi * np.clip(ph / 0.8, 0, 1)) ** 0.6 * (ph < 0.8)
    grit = 0.75 + 0.25 * np.sign(np.sin(2 * np.pi * 37 * tt))
    return x * env * grit * 0.5


def typing(out, text, t, speed=1.0, gain=0.16):
    gaps = [0.05, 0.035, 0.06, 0.03, 0.045, 0.07, 0.04, 0.03, 0.055, 0.04]
    for i in range(1, len(text) + 1):
        if i % 2 == 0:
            place(out, s_tick(2100 + (i % 5) * 120, 0.005), t, gain)
        t += gaps[i % len(gaps)] * speed * (1.6 if text[i - 1] == ' ' else 1)
    return t


def s_crowd(dur, bright=1.0, boo=False):
    """A crowd: many band-passed noise voices with a slow swell; a boo is low and vowel-like, a cheer bright."""
    n = int(dur * SR); tt = t_axis(n)
    x = bp(rng.standard_normal(n), 250, 900) if boo else bp(rng.standard_normal(n), 500, 3800 * bright)
    if boo:
        x = x * (0.6 + 0.4 * np.sin(2 * np.pi * 3.1 * tt)) + np.sin(2 * np.pi * 180 * tt) * 0.05 * np.sin(np.pi * tt / dur)
    return x * np.sin(np.pi * np.minimum(1, tt / dur)) ** 1.2 * 0.6


def s_clash():
    n = int(0.7 * SR); tt = t_axis(n)
    x = sum(np.sin(2 * np.pi * f * tt) * np.exp(-tt / d) for f, d in ((1870, .25), (2630, .18), (3410, .12), (5200, .06)))
    return x * 0.25 + hp(rng.standard_normal(n), 3000) * np.exp(-tt / .015) * 0.6


def s_chain(dur=0.6):
    out = np.zeros(int(dur * SR) + SR // 10)
    for k in range(int(dur / 0.045)):
        place(out, s_tick(1400 + (k % 3) * 300, 0.012), k * 0.045, 0.6 + 0.4 * (k % 2))
    return out


def s_thud():
    n = int(0.4 * SR); tt = t_axis(n)
    return np.sin(2 * np.pi * (60 + 50 * np.exp(-tt / .02)) * tt) * env_exp(n, 0.09) + lp(rng.standard_normal(n), 700) * env_exp(n, 0.03) * 0.5


def sfx():
    """Cues follow the visible actions; the face holds (s02, s11 apart from the box) stay nearly bare."""
    out = np.zeros(N)
    S = lambda i: SC[i]['start']
    # s00: the boo under "bad answers", the gate chain on "make", the crowd as they pour in
    bad = w('bad', 0); place(out, s_crowd(1.0, boo=True), bad, 0.5); place(out, s_air(0.4, 500, 2500), bad - 0.22, 0.25)
    mk = w('make', 0); place(out, s_chain(0.6), mk - 0.05, 0.22); place(out, s_crowd(1.8, 0.8), w('hundred', 0), 0.3)
    place(out, s_tap(130), w('fight', 0) + 0.1, 0.4)
    # s01: chisel taps for the five letters, banners
    ar = w('Arena', S('s01'))
    for i in range(5):
        place(out, s_tick(2600, 0.02), ar - 0.08 + i * 0.07, 0.45); place(out, s_tap(200), ar - 0.08 + i * 0.07, 0.15)
    place(out, s_paper(0.4), w('free', S('s01')) - 0.1, 0.3)
    # s03: Regenerate clicks
    a1 = w('again', S('s03')); a2 = w('again', a1 + 0.1)
    for t in (a1, a2):
        place(out, s_tick(2200, 0.008), t - 0.02, 0.45); place(out, s_air(0.3, 900, 3600), t + 0.1, 0.1)
    # s04: soft drops as the ranks fill; the task scroll unrolls; the copies ripple
    hu = w('hundred', S('s04'))
    for k in range(7):
        place(out, s_tap(150 + k * 10), hu - 0.35 + k * 0.13, 0.12)
    ex = w('exact', S('s04')); place(out, s_paper(0.45), ex - 0.2, 0.35)
    for k in range(10):
        place(out, s_paper(0.12), ex + 0.3 + k * 0.08, 0.08)
    # s05: a metal pick-up per weapon
    ea = w('each', S('s05'))
    for i in range(5):
        place(out, s_tick(3000, 0.03), ea + 0.05 + i * 0.38 + 0.3, 0.3)
    # s06: clash, slash, the patch, the parry
    hd = w('head', S('s06')); place(out, s_clash(), hd + 0.02, 0.55); place(out, s_crowd(1.2, 1.0), hd + 0.05, 0.25)
    at = w('attacks', S('s06')); place(out, s_air(0.25, 1500, 6000), at - 0.12, 0.3); place(out, s_paper(0.2), at + 0.06, 0.4)
    df = w('defends', S('s06')); place(out, s_paper(0.5), df + 0.12, 0.2); place(out, s_clash(), df + 0.7, 0.3)
    # s07: a thud as each number is cut, the crowd reacting a little each time
    t7 = S('s07'); kn = w('knocked', t7); r1 = w('round', t7); af = w('after', t7); r2 = w('round', af); un = w('until', t7); on = w('one', un); stn = w('standing', t7)
    for k, t in enumerate((kn, r1, af, r2, un, on, stn)):
        place(out, s_thud(), t, 0.5 if k < 6 else 0.7)
    place(out, s_crowd(1.4, 1.1), stn + 0.1, 0.35)
    # s08: the hand flips, the laurel lands, the crowd erupts under the shout
    ge = w('get', S('s08')); place(out, s_air(0.3, 700, 3000), ge - 0.3, 0.2); place(out, s_tone(), ge, 0.4)
    place(out, s_crowd(2.6, 1.2), ge, 0.55)
    # s09: ring, the box slides up, the paste, typing, the check
    place(out, s_tick(1800, 0.012), w('Arena', S('s09')), 0.3)
    cc = w('Claude', w('link', S('s09'))); place(out, s_air(0.45, 900, 3600), cc - 0.15, 0.15); place(out, s_tick(1500, 0.015), cc + 0.32, 0.35)
    typing(out, 'Install this skill, then confirm', cc + 0.55, 0.55, 0.12)
    place(out, s_tone(), w('skill', w('install', S('s09'))), 0.3)
    # s10: the lever, the gate, the field clearing
    qk = w('quick', S('s10')); place(out, s_tap(120), qk - 0.2, 0.45); place(out, s_chain(0.3), qk - 0.05, 0.2); place(out, s_air(0.5, 600, 3000), qk + 0.1, 0.2)
    # s11: the comment box, ARENA types, send
    place(out, s_air(0.45, 900, 3600), S('s11'), 0.12)
    typing(out, 'ARENA', w('ARENA', S('s11')) - 0.04, 0.9, 0.2)
    place(out, s_tick(1500, 0.015), w('send', S('s11')), 0.4)
    return np.stack([out, out], 1)


def write(path, x):
    wavfile.write(path, SR, np.clip(x, -1, 1).astype(np.float32))


def main():
    sr, v = wavfile.read('assets/audio/voice-proc.wav')
    v = v.astype(np.float64) / (32768 if v.dtype == np.int16 else 1)
    v = np.pad(v, (0, max(0, N - len(v))))[:N]
    write('assets/audio/stem-voice.wav', np.stack([v, v], 1) * 0.5)
    b = bed(); write('assets/audio/stem-bed.wav', b / np.max(np.abs(b)) * 0.5)
    s = sfx(); write('assets/audio/stem-sfx.wav', s / np.max(np.abs(s)) * 0.5)

    lv, lb = lufs('assets/audio/stem-voice.wav'), lufs('assets/audio/stem-bed.wav')
    gv = 10 ** ((-16 - lv) / 20)
    gb = 10 ** ((-16 - 13 - lb) / 20)  # bed about 13 dB under the voice before ducking
    _, V = wavfile.read('assets/audio/stem-voice.wav'); _, B = wavfile.read('assets/audio/stem-bed.wav'); _, S = wavfile.read('assets/audio/stem-sfx.wav')

    speech = np.zeros(N)
    for x in WORDS:
        speech[int(x['start'] * SR):int(min(D, x['end'] + 0.1) * SR)] = 1
    k = int(0.25 * SR)
    sm = np.convolve(speech, np.ones(k) / k, mode='same')
    duck = 10 ** (-4 * np.clip(sm * 1.6, 0, 1) / 20)
    sduck = 10 ** (-5 * np.clip(sm * 1.6, 0, 1) / 20)  # effects a further 5 dB under speech (find-skills lesson)
    Sx = S * gv * 0.55 * sduck[:, None]
    # Perceived-level guard (v002): K-weighted 100 ms windows, as create-reel QA measures. Every effect sits
    # 19 dB under the voice's median speaking level over speech and 21 dB under where the voice is quiet
    # (pauses, word tails): QA fails at -16 / -18, so this leaves 3 dB of margin. v001's plain-RMS guard read -11 / -9.
    from scipy.ndimage import minimum_filter1d
    def kw(x):
        A = 10 ** (3.99984 / 40); wq = 2 * np.pi * 1681.974 / SR; al = np.sin(wq) / (2 * 0.7071752); c = np.cos(wq); r = 2 * np.sqrt(A) * al
        a0 = (A + 1) - (A - 1) * c + r
        y = lfilter([A * ((A + 1) + (A - 1) * c + r) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - r) / a0],
                    [1, 2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - r) / a0], x)
        wq = 2 * np.pi * 38.13547 / SR; al = np.sin(wq) / (2 * 0.5003270); c = np.cos(wq); a0 = 1 + al
        return lfilter([(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0], [1, -2 * c / a0, (1 - al) / a0], y)
    w100 = int(0.1 * SR)
    env = lambda x: np.sqrt(np.convolve(kw(x) ** 2, np.ones(w100) / w100, mode='same')) + 1e-9
    venv = env(V[:, 0] * gv)
    vref = np.median(venv[speech > 0])                               # the voice's median speaking level, K-weighted
    lim = vref * np.where(venv >= vref * 10 ** (-12 / 20), 10 ** (-19 / 20), 10 ** (-21 / 20))
    lim = minimum_filter1d(lim, size=w100)                           # a hit next to a pause gets the pause limit
    for _ in range(3):                                               # re-measure after each pass: smoothing lets a little through
        g = np.minimum(1, lim / env(Sx[:, 0]))
        g = minimum_filter1d(g, size=int(0.12 * SR))                 # hold the reduction over each hit
        g = np.convolve(g, np.ones(int(0.03 * SR)) / int(0.03 * SR), mode='same')
        Sx = Sx * g[:, None]
    write('assets/audio/sfx-applied.wav', Sx)                       # the effects exactly as they sit in the mix
    print('effects guard applied (3 passes)')
    mix = V * gv + B * gb * duck[:, None] + Sx
    write('assets/audio/mix-pre.wav', mix)

    m1 = subprocess.run(['ffmpeg', '-hide_banner', '-i', 'assets/audio/mix-pre.wav', '-af',
                         'loudnorm=I=-14:TP=-2.2:LRA=7:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    st = json.loads(m1[m1.rindex('{'):m1.rindex('}') + 1])
    af = ('loudnorm=I=-14:TP=-2.2:LRA=7:linear=true:measured_I={input_i}:measured_TP={input_tp}:measured_LRA={input_lra}:'
          'measured_thresh={input_thresh}:offset={target_offset}').format(**st)
    af += ',alimiter=limit=0.68:attack=1:release=60:level=disabled'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'assets/audio/mix-pre.wav', '-af', af, '-ar', '48000', '-c:a', 'pcm_s16le',
                    'assets/audio/mix.wav'], check=True)
    # stem-sfx is rewritten as the applied effects (after ducking and the guard) divided by the sfx gain, so stems x gains = the mix
    write('assets/audio/stem-sfx.wav', Sx / (gv * 0.55))
    json.dump({'voice': gv, 'sfx': gv * 0.55, 'bed': gb, 'sfx_stem': 'applied (ducked, guarded)'}, open('assets/audio/mix-levels.json', 'w'), indent=1)
    print('voice %.1f LUFS, bed %.1f LUFS (stems); master %.1f LUFS' % (lv, lb, lufs('assets/audio/mix.wav')))


if __name__ == "__main__":
    main()
