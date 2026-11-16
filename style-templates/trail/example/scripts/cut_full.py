"""Full-reel cut: keeps between pauses, trimmed to ~0.3 s; one protected ~0.85 s pause before "so it knows what to avoid".
Keep bounds come from the waveform (silencedetect -38 dB, d 0.15). Whisper put phrase-initial words inside the preceding
silence, so word edges that fall inside a detected silence are snapped to its boundary. No mistakes were found in review
(no retakes, stutters or false starts); "basically" is kept as part of the speaker's voice.
Run from the project folder: python -I scripts/cut_full.py"""
import json, subprocess

SRC = 'assets/source/raw.mp4'
FPS = 30
SIL = [(0, 1.196083), (3.64525, 3.840875), (5.442125, 6.481458), (7.828729, 8.008687), (10.915625, 11.470021),
       (12.505625, 13.840104), (15.318854, 17.122917), (19.270104, 19.453021), (22.058125, 23.204708),
       (24.547042, 26.017437), (27.106771, 27.3135), (28.335896, 28.520333), (29.438312, 30.709708),
       (31.682292, 31.921062), (35.340042, 36.297354), (38.106125, 38.321813), (40.303167, 41.398458), (43.787521, 44.2)]
KEEPS = [(1.08, 5.58), (6.36, 10.99), (11.37, 12.60), (13.74, 15.42), (17.02, 22.70), (23.00, 24.65), (25.92, 29.54),
         (30.61, 35.44), (36.20, 40.40), (41.30, 43.90)]
REASONS = ['leading silence', 'pause after "AI-made." tightened', 'pause after "Claude Code." tightened',
           'pause after "Hallmark." tightened', 'pause after "Together AI." tightened (1.8 s)',
           'pause after "AI built this," shortened to a protected ~0.85 s (payoff beat: 26 issues -> 0 and the hero cheer)', 'pause after "avoid." tightened',
           'pause after "fit." tightened', 'pause after "screens." tightened', 'pause after "to you." tightened']

parts, t = [], 0.0
for a, b in KEEPS:
    a2, b2 = round(round(a * FPS) / FPS, 4), round(round(b * FPS) / FPS, 4)  # frame-aligned keeps
    parts.append({'sourceStart': a2, 'sourceEnd': b2, 'start': round(t, 4), 'end': round(t + b2 - a2, 4)})
    t += b2 - a2
D = round(t, 4)

v = ''.join(f"[0:v]trim={k['sourceStart']}:{k['sourceEnd']},setpts=PTS-STARTPTS,fps={FPS}[v{i}];" for i, k in enumerate(parts))
au = ''.join(f"[0:a]atrim={k['sourceStart']}:{k['sourceEnd']},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,"
             f"afade=t=out:st={k['sourceEnd'] - k['sourceStart'] - 0.012:.3f}:d=0.012[a{i}];" for i, k in enumerate(parts))
cat = ''.join(f'[v{i}][a{i}]' for i in range(len(parts))) + f'concat=n={len(parts)}:v=1:a=1[v][a]'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', SRC, '-filter_complex', v + au + cat, '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30',
                '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'assets/edit/cut.mp4'], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'assets/edit/cut.mp4', '-vn', '-ac', '1', '-ar', '48000', '-af',
                'highpass=f=80,afftdn=nf=-30,acompressor=threshold=-20dB:ratio=3:attack=10:release=150:makeup=2,'
                'equalizer=f=3500:t=q:w=1:g=2.5', '-c:a', 'pcm_s16le', 'assets/audio/voice-proc.wav'], check=True)


def snap(s, e):
    for a, b in SIL:
        if a <= s < b: s = b
        if a < e <= b: e = a
    return s, max(e, s + 0.05)


raw = json.load(open('assets/source/raw.transcript.json', encoding='utf-8'))
src_words, words = [], []
for w in raw['words']:
    s, e = snap(w['start'], w['end'])
    src_words.append({'text': w['text'], 'start': round(s, 3), 'end': round(e, 3)})
    k = next((k for k in parts if k['sourceStart'] - 1e-6 <= s < k['sourceEnd']), None)
    if k is None: raise SystemExit(f'word outside keeps: {w}')
    e2 = min(e, k['sourceEnd']); off = k['start'] - k['sourceStart']
    words.append({'text': w['text'], 'start': round(s + off, 3), 'end': round(e2 + off, 3), 'sourceStart': round(s, 3), 'sourceEnd': round(e2, 3)})
json.dump({'text': ' '.join(w['text'] for w in words), 'duration': D, 'words': words}, open('assets/transcript.json', 'w', encoding='utf-8'), indent=1)
json.dump({'provider': raw['provider'], 'audio_duration_secs': raw['audio_duration_secs'],
           'note': 'Source timeline. Word edges inside detected silences snapped to the silence boundary (Whisper placed phrase starts early).',
           'text': raw['text'], 'words': src_words}, open('assets/source-transcript.json', 'w', encoding='utf-8'), indent=1)
rem, prev = [], 0.0
for k, why in zip(parts, REASONS):
    if k['sourceStart'] > prev: rem.append({'sourceStart': prev, 'sourceEnd': k['sourceStart'], 'reason': why + ' (no speech)'})
    prev = k['sourceEnd']
rem.append({'sourceStart': prev, 'sourceEnd': 44.2, 'reason': 'trailing silence'})
json.dump({'duration': D, 'fps': FPS, 'keeps': parts, 'removals': rem,
           'mistakeReview': 'Listened through the transcript: no retakes, stutters or false starts; nothing removed but silence.'},
          open('assets/edit-decisions.json', 'w', encoding='utf-8'), indent=1)
print('duration', D)
print(' '.join(f"[{w['start']:.2f}]{w['text']}" for w in words))
