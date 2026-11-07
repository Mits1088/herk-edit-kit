"""Tests for scripts/audio/reelmix.py (run by tests/reelmix.test.mjs, or: python -m pytest tests/test_reelmix.py -q)."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'audio'))
import reelmix  # noqa: E402

SR, D = 16000, 6.0
rng = np.random.default_rng(1)
# words every 0.5 s, with a protected 1 s pause from 2.6 to 3.6 s
WORDS = [dict(text='w', start=s, end=s + 0.35) for s in [0.2, 0.7, 1.2, 1.7, 2.2, 3.6, 4.1, 4.6, 5.1]]


def voice():
    v = np.zeros(int(D * SR)); t = np.arange(len(v)) / SR
    for w in WORDS:
        a, b = int(w['start'] * SR), int(w['end'] * SR)
        v[a:b] = 0.2 * np.sin(2 * np.pi * 180 * t[a:b]) + 0.05 * rng.standard_normal(b - a)
    return v


def burst(seconds, amp=0.8, f=900):
    t = np.arange(int(seconds * SR)) / SR
    return amp * np.sin(2 * np.pi * f * t) * np.exp(-t * 1.5)


def mixed(cues, bed=None, profile=None):
    m = reelmix.Mix(SR, D, WORDS, profile or reelmix.load_profile())
    m.set_voice(voice())
    if bed is not None: m.set_bed(bed)
    for c in cues: m.cue(**c)
    rep = m.render('.', write=False)
    return m, rep


def test_hero_in_a_pause_reaches_its_gap_target():
    m, _ = mixed([dict(sig=burst(0.6), at=2.7, role='hero', name='cheer')])
    row = m.result['rows'][0]
    assert row['context'] == 'gap'
    assert -4.5 <= row['peak_db'] <= -1.5, row


def test_hero_ducks_under_the_next_word_smoothly_and_early():
    m, _ = mixed([dict(sig=burst(1.6, f=700), at=2.8, role='hero', name='cheer')])
    S, ref, P = m.result['S'], m.result['ref'], reelmix.load_profile()
    lev = reelmix.level_curve(S, SR, m.F) - ref
    k = int(3.75 / reelmix.HOP)  # inside the word at 3.6-3.95
    assert lev[k] <= P['roles']['hero']['max']['speech'], lev[k]
    # the duck has already started before the word (lead), and never jumps
    x = np.zeros_like(S); x[int(2.8 * SR):int(2.8 * SR) + int(1.6 * SR)] = burst(1.6, f=700)[: len(S) - int(2.8 * SR)]
    g = 20 * np.log10(np.abs(S[int(2.85 * SR):int(4.3 * SR)]) + 1e-9) - 20 * np.log10(np.abs(x[int(2.85 * SR):int(4.3 * SR)]) + 1e-9)
    ok = np.abs(x[int(2.85 * SR):int(4.3 * SR)]) > 1e-3
    gk = np.array([np.median(g[i:i + 160][ok[i:i + 160]]) for i in range(0, len(g) - 160, 160) if ok[i:i + 160].sum() > 20])
    assert np.max(np.abs(np.diff(gk))) < 1.5, 'gain moves more than 1.5 dB per 10 ms'


def test_loud_foley_is_held_to_the_foley_ceiling():
    m, _ = mixed([dict(sig=burst(0.15, amp=1.0, f=3000), at=1.25, role='foley', name='tick')])
    P = reelmix.load_profile()
    assert m.result['rows'][0]['peak_db'] <= P['roles']['foley']['max']['speech']


def test_cue_onset_lands_on_its_time():
    sig = np.concatenate([np.zeros(int(0.08 * SR)), burst(0.3)])  # leading silence in the file
    m, _ = mixed([dict(sig=sig, at=2.9, role='accent', name='slam')])
    S = m.result['S']; on = reelmix.onset_index(S[int(2.5 * SR):], SR) / SR + 2.5
    assert abs(on - 2.9) < 0.006, on


def test_master_hits_loudness_and_true_peak():
    bed = 0.3 * rng.standard_normal(int(D * SR))
    _, rep = mixed([dict(sig=burst(0.6), at=2.7, role='hero', name='cheer')], bed=bed)
    P = reelmix.load_profile()
    assert abs(rep['integrated_lufs'] - P['master']['integratedLufs']) < 0.6, rep
    assert rep['true_peak_dbtp'] <= P['master']['truePeakDbtp'], rep


def test_peak_limiter_never_passes_the_ceiling_and_leaves_quiet_audio_alone():
    x = 0.1 * np.sin(2 * np.pi * 440 * np.arange(2 * SR) / SR); x[8000:8040] += 0.9  # one sharp peak
    y, gr = reelmix.peak_limit(x, SR, -6.0)
    assert reelmix.true_peak(y) <= -6.0 + 0.05
    assert np.allclose(y[:7800], x[:7800])           # untouched before the peak (only a few ms of look-ahead)
    assert gr[8040 + int(0.5 * SR):].max() < 0.1     # fully recovered within 0.5 s (80 ms release)


def test_bed_sits_behind_speech():
    bed = 0.5 * rng.standard_normal(int(D * SR))
    m, _ = mixed([], bed=bed)
    B, ref, P = m.result['B'], m.result['ref'], reelmix.load_profile()
    lev = reelmix.level_curve(B, SR, m.F) - ref
    k = int(4.25 / reelmix.HOP)
    assert lev[k] <= P['bed']['max']['speech'] + 0.5, lev[k]
    assert lev[int(3.1 / reelmix.HOP)] > lev[k] + 4  # lifts in the pause


def test_reel_overrides_merge_without_touching_the_house_profile(tmp_path):
    (tmp_path / 'reel.json').write_text('{"audio": {"profileOverrides": {"roles": {"hero": {"target": {"gap": -6}}}}}}', encoding='utf8')
    p = reelmix.load_profile(tmp_path)
    assert p['roles']['hero']['target']['gap'] == -6 and p['roles']['hero']['target']['speech'] == -13
    assert reelmix.load_profile()['roles']['hero']['target']['gap'] == -3
