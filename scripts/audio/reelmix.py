"""reelmix: the shared, speech-aware reel mixer (house profile: audio-library/house-profile.json).

A reel's own scripts/audio.py builds its sounds and hands them over; this module sets every level from the profile:

    import sys; sys.path.insert(0, '<repo>/scripts/audio'); import reelmix
    m = reelmix.Mix(sr=48000, duration=D, words=WORDS, profile=reelmix.load_profile('.'))
    m.set_voice(voice); m.set_bed(bed)
    m.cue(sig, at=12.3, role='accent', name='gate slam', event='gate-lifts')
    report = m.render('assets/audio')

Levels: each sound's loudest K-weighted 100 ms window as mixed, in dB against the voice's median speaking level (the
basis QA measures). A cue is gained to its role's gap target, and a smooth speech-aware curve brings it to the role's
speech target wherever a word is (starting `duck.leadSeconds` early). A guard keeps the summed effects 1 dB under the
loudest active role's ceiling. Music follows the same curve, lifts before a hero and dips under it. The master is
normalised to the profile's integrated loudness with a transparent true-peak limiter whose load is reported.

Outputs in out_dir: stem-voice.wav, stem-bed.wav, stem-sfx.wav (all as mixed, before the master gain), mix-pre.wav,
mix.wav (master), cues.json + cues-applied.wav (each cue as mixed, for QA), mix-levels.json, mix-report.json.
Deterministic: no randomness here; numpy and scipy only.
"""
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d
from scipy.signal import lfilter, resample_poly

ROOT = Path(__file__).resolve().parents[2]
HOP = 0.01  # control-curve resolution (s)


# ---------- profile
def _merge(a, b):
    out = dict(a)
    for k, v in (b or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load_profile(project_dir=None, overrides=None):
    """House profile, then the reel's one-off reel.json audio.profileOverrides, then explicit overrides."""
    p = json.loads((ROOT / 'audio-library' / 'house-profile.json').read_text(encoding='utf8'))
    if project_dir:
        rj = Path(project_dir) / 'reel.json'
        if rj.exists():
            p = _merge(p, (json.loads(rj.read_text(encoding='utf8')).get('audio') or {}).get('profileOverrides'))
    return _merge(p, overrides)


# ---------- measurement (same definitions as create-reel qa-core)
def kweight(x, sr):
    A = 10 ** (3.99984 / 40); w = 2 * np.pi * 1681.974 / sr; al = np.sin(w) / (2 * 0.7071752); c = np.cos(w); r = 2 * np.sqrt(A) * al
    a0 = (A + 1) - (A - 1) * c + r
    y = lfilter([A * ((A + 1) + (A - 1) * c + r) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - r) / a0],
                [1, 2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - r) / a0], x)
    w = 2 * np.pi * 38.13547 / sr; al = np.sin(w) / (2 * 0.5003270); c = np.cos(w); a0 = 1 + al
    return lfilter([(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0], [1, -2 * c / a0, (1 - al) / a0], y)


def level_curve(x, sr, n_frames, win=0.1):
    """K-weighted 100 ms level (dB) centred on each control frame k*HOP."""
    y = kweight(np.asarray(x, np.float64), sr)
    c = np.concatenate([[0.0], np.cumsum(y * y)])
    n, centres = int(win * sr), (np.arange(n_frames) * HOP * sr).astype(int)
    a = np.clip(centres - n // 2, 0, len(y)); b = np.clip(a + n, 0, len(y))
    p = (c[b] - c[a]) / np.maximum(b - a, 1)
    return 10 * np.log10(p + 1e-20)


def lufs(x, sr, dual_mono=True):
    """Integrated loudness (BS.1770 gating). dual_mono: the value of the stereo file with x on both channels."""
    y = kweight(np.asarray(x, np.float64), sr); c = np.concatenate([[0.0], np.cumsum(y * y)])
    n, h = int(0.4 * sr), int(0.1 * sr)
    s = np.arange(0, max(1, len(y) - n + 1), h); z = (c[s + n] - c[s]) / n
    L = lambda v: -0.691 + 10 * np.log10(v + 1e-20)
    z = z[L(z) > -70]
    if not len(z): return -70.0
    z = z[L(z) > L(np.mean(z)) - 10]
    return float(L(np.mean(z)) + (10 * np.log10(2) if dual_mono else 0))


def true_peak(x, sr=None):
    return float(20 * np.log10(np.max(np.abs(resample_poly(x, 4, 1))) + 1e-20))


def onset_index(sig, sr, below_peak_db=24):
    """First sample where the 5 ms RMS comes within below_peak_db of the cue's own peak: its audible onset."""
    n = max(1, int(0.005 * sr)); e = np.sqrt(np.convolve(sig * sig, np.ones(n) / n, mode='same'))
    hit = np.nonzero(e >= e.max() * 10 ** (-below_peak_db / 20))[0]
    return int(hit[0]) if len(hit) else 0


def _smooth(curve, seconds):
    k = max(1, int(round(seconds / HOP)))
    return np.convolve(np.pad(curve, (k, k), mode='edge'), np.ones(k) / k, mode='same')[k:-k]


def peak_limit(x, sr, ceiling_db, hold=0.005, release=0.08):
    """Transparent look-ahead true-peak limiter: gain reduction held over `hold` (centred, so it starts early),
    eased in over a few ms and released smoothly; never lets an (oversampled) peak past the ceiling.
    Returns (limited signal, gain reduction in dB per sample)."""
    from scipy.ndimage import maximum_filter1d
    env = np.max(np.abs(resample_poly(x, 4, 1))[: 4 * len(x)].reshape(-1, 4), axis=1)
    need = np.maximum(0.0, 20 * np.log10(np.maximum(env, 1e-12)) - ceiling_db)      # dB of reduction each sample needs
    held = maximum_filter1d(need, size=max(1, int(hold * sr)))
    k = max(1, int(hold * sr / 2)); eased = np.convolve(held, np.ones(k) / k, mode='same')   # still >= need (see tests)
    a = np.exp(-1 / (release * sr)); rel = lfilter([1 - a], [1, -a], eased)
    gr = np.maximum(eased, rel)
    return x * 10 ** (-gr / 20), gr


def _write(path, x, sr):
    x = np.asarray(x, np.float32)
    wavfile.write(str(path), sr, np.clip(np.stack([x, x], 1) if x.ndim == 1 else x, -1, 1))


# ---------- the mix
class Mix:
    def __init__(self, sr, duration, words, profile):
        self.sr, self.D, self.P = sr, float(duration), profile
        self.N = int(round(self.D * sr)); self.F = int(np.ceil(self.D / HOP)) + 1
        self.words = [w for w in words if float(w['end']) > float(w['start'])]
        self.voice = np.zeros(self.N); self.bed = None; self.cues = []

    def _fit(self, x):
        x = np.asarray(x, np.float64)
        if x.ndim == 2: x = x.mean(1)
        return np.pad(x, (0, max(0, self.N - len(x))))[: self.N]

    def set_voice(self, v): self.voice = self._fit(v)
    def set_bed(self, b): self.bed = self._fit(b)

    def cue(self, sig, at, role, name, event=None, source=None, gain_db=0.0):
        """Place sig so its audible onset lands at `at` (s). role: foley | accent | hero. gain_db: a nudge only;
        the profile sets the level."""
        if role not in self.P['roles']: raise ValueError(f'unknown role {role!r}')
        sig = np.asarray(sig, np.float64)
        if sig.ndim == 2: sig = sig.mean(1)
        on = onset_index(sig, self.sr)
        self.cues.append(dict(sig=sig, at=float(at), onset=on, role=role, name=name, event=event, source=source, nudge=gain_db))

    # speech context on the control grid: 1 where a word is (with lead/tail), smoothed so gains never jump
    def _speech_mask(self):
        d = self.P['duck']; m = np.zeros(self.F)
        for w in self.words:
            a = int(max(0, (float(w['start']) - d['leadSeconds']) / HOP)); b = int(min(self.F, np.ceil((float(w['end']) + d['tailSeconds']) / HOP)))
            m[a:b] = 1
        return np.clip(_smooth(m, d['smoothSeconds']), 0, 1)

    def render(self, out_dir, write=True):
        sr, P, out = self.sr, self.P, Path(out_dir)
        t = np.arange(self.F) * HOP
        ctl = lambda curve_db: np.interp(np.arange(self.N) / sr, t, curve_db)
        # voice: integrated to -16 LUFS before the master, like every reel so far
        gv = 10 ** ((-16 - lufs(self.voice, sr)) / 20); V = self.voice * gv
        # voice peak control: a raw voice can sit 17 dB above its loudness, more than a -14 LUFS / -1.5 dBTP master
        # allows, so its rare peaks are eased on the voice alone (not by squashing the whole mix)
        vp = P['voicePeaks']; V, vgr = peak_limit(V, sr, -16 + vp['maxPeakToLoudnessDb'], release=vp['releaseSeconds'])
        V *= 10 ** ((-16 - lufs(V, sr)) / 20)
        vdb = level_curve(V, sr, self.F)
        inword = np.zeros(self.F, bool)
        for w in self.words: inword[int(float(w['start']) / HOP): int(np.ceil(float(w['end']) / HOP))] = True
        ref = float(np.median(vdb[inword])) if inword.any() else float(np.max(vdb))
        m = self._speech_mask()

        # cues: own level -> role targets, speech-aware curve
        S = np.zeros(self.N); spans = []; heroes = []
        for c in self.cues:
            R = P['roles'][c['role']]; start = int(round(c['at'] * sr)) - c['onset']
            a, b = max(0, start), min(self.N, start + len(c['sig']))
            if b <= a: continue
            x = np.zeros(self.N); x[a:b] = c['sig'][a - start: b - start]
            lev = level_curve(x, sr, self.F); peak = float(np.max(lev)) - ref
            g = (R['target']['gap'] * (1 - m) + R['target']['speech'] * m) - peak + c['nudge']
            y = x * 10 ** (ctl(g) / 20)
            S += y; spans.append((c, a, b, y))
            if c['role'] == 'hero': heroes.append((a / sr, b / sr))
        # guard on the sum: 1 dB under the loudest active role's ceiling for the context
        if spans:
            ceil = np.full(self.F, -np.inf)
            for c, a, b, _ in spans:
                R = P['roles'][c['role']]; fa, fb = int(a / sr / HOP), int(np.ceil(b / sr / HOP)) + 1
                cm = np.where(m[fa:fb] > 0.5, R['max']['speech'], R['max']['gap']) - 1
                ceil[fa:fb] = np.maximum(ceil[fa:fb], cm)
            over = level_curve(S, sr, self.F) - ref - ceil
            red = np.where(np.isfinite(ceil), np.minimum(0, -over), 0)
            red = _smooth(minimum_filter1d(red, size=int(0.12 / HOP)), 0.03)
            gs = 10 ** (ctl(red) / 20); S *= gs
            spans = [(c, a, b, y * gs) for c, a, b, y in spans]

        # bed: same curve, lift before a hero, dip under it, capped behind speech
        B = np.zeros(self.N)
        if self.bed is not None and np.any(self.bed):
            bp = P['bed']; bl = level_curve(self.bed, sr, self.F); live = bl > np.max(bl) - 40
            med = float(np.median(bl[live])) - ref
            g = bp['target']['gap'] * (1 - m) + bp['target']['speech'] * m - med
            shape = np.zeros(self.F)
            for h0, h1 in heroes:
                k0, k1 = int(h0 / HOP), int(np.ceil(h1 / HOP)); kl = int(bp['preHeroLiftSeconds'] / HOP)
                shape[max(0, k0 - kl):k0] = np.maximum(shape[max(0, k0 - kl):k0], np.linspace(0, bp['preHeroLiftDb'], k0 - max(0, k0 - kl)))
                shape[k0:k1] = np.minimum(shape[k0:k1], bp['heroDipDb'])
            g = g + _smooth(shape, 0.15)
            cap = np.minimum(0, bp['max']['speech'] - (bl + g - ref))
            g = g + np.where(m > 0.5, _smooth(minimum_filter1d(cap, size=int(0.2 / HOP)), 0.1), 0)
            B = self.bed * 10 ** (ctl(g) / 20)

        pre = V + B + S
        # master: integrated target, then a true-peak limiter at (target - 0.5 dB) to leave room for the AAC encode
        M = P['master']; ceil_db = M['truePeakDbtp'] - 0.5
        mg = 10 ** ((M['integratedLufs'] - lufs(pre, sr)) / 20)
        mix, grdb = peak_limit(pre * mg, sr, ceil_db)
        mg2 = 10 ** ((M['integratedLufs'] - lufs(mix, sr)) / 20)  # one correction for what the limiter took
        mix, grdb = peak_limit(pre * mg * mg2, sr, ceil_db); mg *= mg2

        rows, applied, off = [], [], 0
        sdb = None
        for i, (c, a, b, y) in enumerate(spans):
            seg = y[a:b]; lev = level_curve(y, sr, self.F); k = int(np.argmax(lev))
            rows.append(dict(i=i, name=c['name'], role=c['role'], event=c['event'], source=c['source'], at=round(c['at'], 4),
                             start=round(a / sr, 4), end=round(b / sr, 4), offset=off, length=len(seg),
                             peak_db=round(float(lev[k] - ref), 2), peak_t=round(k * HOP, 3),
                             context='speech' if vdb[k] >= ref + P['speechWindowDb'] else 'gap'))
            applied.append(seg); off += len(seg)
        report = dict(profile=dict(name=P['name'], version=P['version']), voice_ref_k_db=round(ref, 2),
                      master_gain_db=round(20 * np.log10(mg), 2), integrated_lufs=round(lufs(mix, sr), 2), true_peak_dbtp=round(true_peak(mix), 2),
                      limiter=dict(max_reduction_db=round(float(grdb.max()), 2), share_touched=round(float(np.mean(grdb > 1.0)), 4)),
                      voice_peaks=dict(max_reduction_db=round(float(vgr.max()), 2), share_touched=round(float(np.mean(vgr > 1.0)), 4)),
                      cues={r: sum(1 for x in rows if x['role'] == r) for r in P['roles']})
        if write:
            out.mkdir(parents=True, exist_ok=True)
            _write(out / 'stem-voice.wav', V, sr); _write(out / 'stem-bed.wav', B, sr); _write(out / 'stem-sfx.wav', S, sr)
            _write(out / 'mix-pre.wav', pre, sr)
            wavfile.write(str(out / 'mix.wav'), sr, (np.clip(np.stack([mix, mix], 1), -1, 1) * 32767).astype(np.int16))
            _write(out / 'cues-applied.wav', np.concatenate(applied) if applied else np.zeros(1), sr)  # dual mono, like every stem
            (out / 'cues.json').write_text(json.dumps(dict(sr=sr, voice_ref_k_db=report['voice_ref_k_db'], cues=rows), indent=1), encoding='utf8')
            (out / 'mix-levels.json').write_text(json.dumps(dict(voice=1, sfx=1, bed=1, sfx_stem='applied', bed_stem='applied',
                                                                 note='stems are written as mixed (before the master gain); reelmix'), indent=1), encoding='utf8')
            (out / 'mix-report.json').write_text(json.dumps(report, indent=1), encoding='utf8')
        self.result = dict(V=V, B=B, S=S, mix=mix, rows=rows, ref=ref, mask=m)
        return report


def load_sound(path, sr=48000):
    """A library sound as mono float at sr (ffmpeg decodes anything)."""
    import subprocess
    d = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(d, np.float32).astype(np.float64)
