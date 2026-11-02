# Lays the rendered frames out as the Den pup widget's sprites (tools/sprites.mjs draws them): one
# sheet a pose, its 24 frames in a row, each shrunk from twice its size so its edges and fur stay
# soft. `python3 tools/sheet-sprites.py [widget folder]`; a PNG of every pose to look at goes to out/.
import sys
from PIL import Image
FW, FH, N = 320, 256, 24
POSES = ['walk', 'sit', 'sleep', 'beg', 'jump', 'run', 'shake', 'roll', 'spin', 'carry', 'ball']
out = sys.argv[1] if len(sys.argv) > 1 else 'out'
preview = Image.new('RGBA', (FW // 2 * N, FH // 2 * len(POSES)), (0, 0, 0, 0))
for r, name in enumerate(POSES):
    sheet = Image.new('RGBA', (FW * N, FH), (0, 0, 0, 0))
    for i in range(N):
        im = Image.open(f'out/sprites/{name}-{i}.png').convert('RGBA').resize((FW, FH), Image.LANCZOS)
        sheet.paste(im, (i * FW, 0))
    sheet.save(f'{out}/pup-{name}.webp', 'WEBP', quality=86, method=6)
    preview.paste(sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS), (0, r * FH // 2))
    print(f'{out}/pup-{name}.webp', sheet.size)
# Kept out of the widget's folder: everything there is installed.
preview.save('out/pup-preview.png')
