# Spectrogram strip of a WAV: python3 tools/spec.py in.wav out.png [fmax] [label,label,...] [slot seconds]
import sys, wave, numpy as np
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
fmax = float(sys.argv[3]) if len(sys.argv) > 3 else 8000
labels = sys.argv[4].split(',') if len(sys.argv) > 4 else []
slot = float(sys.argv[5]) if len(sys.argv) > 5 else 0
w = wave.open(src); sr = w.getframerate(); n = w.getnframes(); ch = w.getnchannels()
x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
if ch > 1: x = x.reshape(-1, ch).mean(1)
N, hop = 1024, 128
win = np.hanning(N)
frames = [x[i:i + N] * win for i in range(0, len(x) - N, hop)]
S = np.abs(np.fft.rfft(np.array(frames), axis=1))
freqs = np.fft.rfftfreq(N, 1 / sr)
S = S[:, freqs <= fmax]
db = 20 * np.log10(S + 1e-6)
db = np.clip((db - (db.max() - 70)) / 70, 0, 1)
img = (255 * (1 - db.T[::-1])).astype(np.uint8)
im = Image.fromarray(img).convert('RGB')
H = 300
im = im.resize((min(2400, im.width), H))
dr = ImageDraw.Draw(im)
for f in range(1000, int(fmax), 1000):
    y = H - int(f / fmax * H)
    dr.line((0, y, 12, y), fill=(200, 0, 0)); dr.text((14, y - 6), f'{f//1000}k', fill=(200, 0, 0))
if slot and labels:
    total = len(x) / sr
    for i, l in enumerate(labels):
        px = int(i * slot / total * im.width)
        dr.line((px, 0, px, H), fill=(0, 0, 255)); dr.text((px + 3, 2), l, fill=(0, 0, 255))
im.save(out); print(out, im.size, 'sr', sr, 'secs', round(len(x) / sr, 2))
