# Contact sheet of film frames: python3 tools/sheet.py <dir> <first> <last> <every> <out> [cols] [scale]
import sys, os
from PIL import Image, ImageDraw
d, a, b, e, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 5
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 0.4
frames = [i for i in range(a, b + 1, e) if os.path.exists(f'{d}/f{i:04d}.png')]
ims = [Image.open(f'{d}/f{i:04d}.png') for i in frames]
W, H = int(ims[0].width * scale), int(ims[0].height * scale)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows), 'white')
dr = ImageDraw.Draw(sheet)
for k, (i, im) in enumerate(zip(frames, ims)):
    x, y = (k % cols) * W, (k // cols) * H
    sheet.paste(im.resize((W, H)), (x, y))
    dr.rectangle((x, y, x + 52, y + 14), fill='white')
    dr.text((x + 2, y + 1), f'{i/30:.2f}s', fill='black')
sheet.save(out)
print(out, sheet.size)
