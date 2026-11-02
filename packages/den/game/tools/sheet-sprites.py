# Lays the rendered frames out as the widget's sprite sheet: rows walk, sit, sleep, beg, jump, run,
# shake, roll, spin, carry, ball, eight frames each, every frame shrunk from twice its size so its edges stay soft.
import sys
from PIL import Image
FW, FH, N = 160, 128, 8
rows = ['walk', 'sit', 'sleep', 'beg', 'jump', 'run', 'shake', 'roll', 'spin', 'carry', 'ball']
sheet = Image.new('RGBA', (FW * N, FH * len(rows)), (0, 0, 0, 0))
for r, name in enumerate(rows):
    for i in range(N):
        im = Image.open(f'out/sprites/{name}-{i}.png').convert('RGBA').resize((FW, FH), Image.LANCZOS)
        sheet.paste(im, (i * FW, r * FH))
out = sys.argv[1] if len(sys.argv) > 1 else 'out/pup.webp'
sheet.save(out, 'WEBP', quality=88, method=6)
# A PNG to look at, kept out of the widget's folder (everything there is installed).
sheet.save('out/pup-preview.png')
print(out, sheet.size)
