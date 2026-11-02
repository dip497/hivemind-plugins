# Lays the rendered frames out as the widget's sprite sheet: rows walk, sit, sleep, beg, jump,
# eight frames each, every frame shrunk from twice its size so its edges stay soft.
import sys
from PIL import Image
FW, FH, N = 160, 128, 8
rows = ['walk', 'sit', 'sleep', 'beg', 'jump']
sheet = Image.new('RGBA', (FW * N, FH * len(rows)), (0, 0, 0, 0))
for r, name in enumerate(rows):
    for i in range(N):
        im = Image.open(f'out/sprites/{name}-{i}.png').convert('RGBA').resize((FW, FH), Image.LANCZOS)
        sheet.paste(im, (i * FW, r * FH))
out = sys.argv[1] if len(sys.argv) > 1 else 'out/pup.webp'
sheet.save(out, 'WEBP', quality=88, method=6)
sheet.save(out.replace('.webp', '-preview.png'))
print(out, sheet.size)
