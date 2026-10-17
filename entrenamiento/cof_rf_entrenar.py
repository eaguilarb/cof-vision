# COF Vision · entrena RF-DETR (personas y cabezas) con los datos de los buses, guarda cada avance en Drive para
# seguir si Colab se corta, y exporta el modelo para la página (ONNX, misma entrada y salida que usa la página).
import argparse, glob, json, os, shutil, sys
import torch, torch.nn as nn, torch.nn.functional as F

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True, help='carpeta del conjunto de datos (con data.yaml)')
ap.add_argument('--salida', required=True, help='carpeta en Drive')
ap.add_argument('--tam', default='nano', choices=['nano', 'small', 'medium'])
ap.add_argument('--epocas', type=int, default=80)
ap.add_argument('--lote', type=int, default=8)
ap.add_argument('--paciencia', type=int, default=15)
ap.add_argument('--device', default='cuda')
a = ap.parse_args()
import rfdetr

# Aumento de datos para cámaras de techo en buses: cambios fuertes de luz (sol, noche), blanco y negro como el
# infrarrojo, compresión del DVR, desenfoque y ruido. Sin giros grandes ni volteo vertical (la cámara está fija).
AUG_BUS = {
    'HorizontalFlip': {'p': 0.5},
    'Affine': {'scale': (0.85, 1.15), 'translate_percent': (-0.05, 0.05), 'rotate': (-5, 5), 'p': 0.4},
    'RandomBrightnessContrast': {'brightness_limit': 0.35, 'contrast_limit': 0.3, 'p': 0.6},
    'ColorJitter': {'brightness': 0.2, 'contrast': 0.2, 'saturation': 0.4, 'hue': 0.05, 'p': 0.4},
    'ToGray': {'p': 0.15},
    'GaussianBlur': {'blur_limit': 3, 'p': 0.2},
    'GaussNoise': {'std_range': (0.01, 0.05), 'p': 0.2},
    'ImageCompression': {'quality_range': (40, 90), 'p': 0.3},
}
Cls = {'nano': rfdetr.RFDETRNano, 'small': rfdetr.RFDETRSmall, 'medium': rfdetr.RFDETRMedium}[a.tam]
out = f'{a.salida}/rfdetr_{a.tam}'
os.makedirs(out, exist_ok=True)
if not os.path.exists(f'{out}/terminado.txt'):
    last = f'{out}/last.ckpt'
    print('== sigue donde quedó' if os.path.exists(last) else '== entrenamiento nuevo', flush=True)
    m = Cls()
    m.train(dataset_dir=a.data, epochs=a.epocas, batch_size=a.lote, grad_accum_steps=max(1, 16 // a.lote), lr=1e-4,
            output_dir=out, aug_config=AUG_BUS, early_stopping=True, early_stopping_patience=a.paciencia,
            checkpoint_interval=1, resume=last if os.path.exists(last) else None, device=a.device, num_workers=2,
            progress_bar='tqdm')
    open(f'{out}/terminado.txt', 'w').write('ok')

# Exportar el mejor: entrada [1,3,640,640] RGB 0-1 (relleno gris), salida [1,300,6] = x0,y0,x1,y1 (px), confianza,
# clase (0 persona, 1 cabeza). Se guarda completo y en versión liviana (int8) para la página.
best = f'{out}/checkpoint_best_total.pth'
m = Cls(pretrain_weights=best)
core = m.model.model.eval().cpu()
res = m.model.resolution
core.export()


class Wrap(nn.Module):
    def __init__(s, core, res, ncls):
        super().__init__()
        s.core, s.res = core, res
        s.register_buffer('mean', torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        s.register_buffer('std', torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))
        lut = torch.full((ncls,), 3.0)
        lut[0], lut[1] = 0.0, 1.0
        s.register_buffer('lut', lut)

    def forward(s, x):
        x = F.interpolate(x, size=(s.res, s.res), mode='bilinear', align_corners=False)
        boxes, logits = s.core((x - s.mean) / s.std)[:2]
        sc, ci = logits.sigmoid().max(-1)
        cx, cy, w, h = boxes.unbind(-1)
        xyxy = torch.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], -1) * 640.0
        return torch.cat([xyxy, sc.unsqueeze(-1), s.lut[ci].unsqueeze(-1)], -1)


with torch.no_grad():
    ncls = core(torch.zeros(1, 3, res, res))[1].shape[-1]
W = Wrap(core, res, ncls).eval()
os.makedirs(f'{a.salida}/modelos', exist_ok=True)
f32 = f'{out}/cof-rfdetr-{a.tam}-f32.onnx'
torch.onnx.export(W, torch.rand(1, 3, 640, 640), f32, input_names=['images'], output_names=['output0'], opset_version=17,
                  do_constant_folding=True, dynamo=False)
from onnxruntime.quantization import quantize_dynamic, QuantType
q8 = f'{out}/cof-rfdetr-{a.tam}.onnx'
quantize_dynamic(f32, q8, weight_type=QuantType.QUInt8)
shutil.copy(q8, f'{a.salida}/modelos/cof-rfdetr-{a.tam}.onnx')
shutil.copy(f32, f'{a.salida}/modelos/cof-rfdetr-{a.tam}-f32.onnx')
shutil.copy(best, f'{a.salida}/modelos/cof-rfdetr-{a.tam}.pth')
# Resultados de la prueba (val) por época.
try:
    import csv
    rows = list(csv.DictReader(open(f'{out}/metrics.csv')))
    keys = [k for k in rows[-1] if 'map' in k.lower()][:6]
    best_row = max((r for r in rows if r.get(keys[0])), key=lambda r: float(r[keys[0]] or 0)) if keys else {}
    txt = f'RF-DETR {a.tam}: épocas {len(set(r.get("epoch") for r in rows))} · mejor ' + ' · '.join(f'{k} {best_row.get(k)}' for k in keys)
except Exception as e:
    txt = f'RF-DETR {a.tam}: listo (sin métricas: {e})'
open(f'{a.salida}/modelos/resultados_rfdetr.txt', 'w').write(txt + '\n')
print(txt)
print('Modelo para la página:', f'{a.salida}/modelos/cof-rfdetr-{a.tam}.onnx')
