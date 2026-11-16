"""Local faster-whisper transcription -> kit word-level JSON (no upload)."""
import json, subprocess, sys
from faster_whisper import WhisperModel

src, out = sys.argv[1], sys.argv[2]
dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                     "-of", "csv=p=0", src]).decode().strip())
model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8")
segs, info = model.transcribe(src, language="en", word_timestamps=True, vad_filter=False,
                              condition_on_previous_text=False)
words = []
for s in segs:
    for w in s.words:
        words.append({"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3),
                      "probability": round(w.probability, 3)})
json.dump({"text": " ".join(w["text"] for w in words), "audio_duration_secs": dur,
           "provider": "faster-whisper large-v3-turbo (local)", "words": words}, open(out, "w"), indent=1)
print(len(words), "words")
