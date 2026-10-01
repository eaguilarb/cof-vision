# Arma el conjunto de entrenamiento del detector de cabezas con los archivos que descarga «cabezas.html».
# Uso: python3 heads_dataset.py salida/ marcas1.json marcas2.json ...
# Cada cabeza marcada (centro y tamaño) pasa a una caja YOLO de la clase 0 («cabeza»). El 15 % final de las fotos de cada
# archivo queda para medir (nunca se entrena con ellas).
import base64, json, os, sys

out = sys.argv[1]
for sub in ('images/train', 'images/val', 'labels/train', 'labels/val'):
    os.makedirs(os.path.join(out, sub), exist_ok=True)
nf = nh = 0
for path in sys.argv[2:]:
    data = json.load(open(path))
    tag = os.path.splitext(os.path.basename(path))[0][:40]
    frames = data['frames']
    for k, f in enumerate(frames):
        split = 'val' if k >= len(frames) * 0.85 else 'train'
        name = f'{tag}_{int(f["t"] * 100):07d}'
        jpg = base64.b64decode(f['jpg'].split(',', 1)[1])
        open(os.path.join(out, 'images', split, name + '.jpg'), 'wb').write(jpg)
        with open(os.path.join(out, 'labels', split, name + '.txt'), 'w') as fh:
            for h in f['heads']:
                # La caja es un poco más alta que ancha (como en la herramienta).
                w, hh = h['s'], h['s'] * 1.1
                fh.write(f'0 {h["x"]:.5f} {h["y"]:.5f} {min(w, 1):.5f} {min(hh, 1):.5f}\n')
                nh += 1
        nf += 1
open(os.path.join(out, 'data.yaml'), 'w').write(f'path: {os.path.abspath(out)}\ntrain: images/train\nval: images/val\nnames:\n  0: cabeza\n')
print(f'{nf} fotos, {nh} cabezas → {out}')
