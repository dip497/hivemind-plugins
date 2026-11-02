# Shrinks the 2D pup's sheet, drawn at twice its size by tools/sprites2d.mjs, to the widget's
# pup.webp: eight frames of 160 x 144 a row, one row a pose. A PNG to look at goes to out/.
import sys
from PIL import Image
big = Image.open('out/sprites2d.png').convert('RGBA')
sheet = big.resize((big.width // 2, big.height // 2), Image.LANCZOS)
out = sys.argv[1] if len(sys.argv) > 1 else 'out/pup2d.webp'
sheet.save(out, 'WEBP', quality=90, method=6)
sheet.save('out/pup2d-preview.png')
print(out, sheet.size)
