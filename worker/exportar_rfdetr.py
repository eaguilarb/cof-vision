# Exporta RF-DETR a ONNX con la misma entrada y salida que usa la página para YOLO:
# entrada [1,3,640,640] RGB 0-1 (con relleno gris), salida [1,300,6] = x0,y0,x1,y1 (px de 640), confianza, clase.
# Clase 0 = persona (la que cuenta la página), 1 = cabeza, 2 = agente, 3 = otra cosa.
import sys, json, torch, torch.nn as nn, torch.nn.functional as F
import rfdetr
size = sys.argv[1]          # nano | small | medium
weights = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '-' else None
out = sys.argv[3] if len(sys.argv) > 3 else f'rfdetr-{size}.onnx'
# Mapa de las clases del modelo a las de la página: {"indice_del_modelo": clase_pagina}
cmap = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {'1': 0}   # COCO: persona = 1
Cls = {'nano': rfdetr.RFDETRNano, 'small': rfdetr.RFDETRSmall, 'medium': rfdetr.RFDETRMedium}[size]
m = Cls(pretrain_weights=weights) if weights else Cls()
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
        for k, v in cmap.items(): lut[int(k)] = float(v)
        s.register_buffer('lut', lut)
    def forward(s, x):
        x = F.interpolate(x, size=(s.res, s.res), mode='bilinear', align_corners=False)
        x = (x - s.mean) / s.std
        boxes, logits = s.core(x)[:2]
        p = logits.sigmoid()
        sc, ci = p.max(-1)
        cx, cy, w, h = boxes.unbind(-1)
        xyxy = torch.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], -1) * 640.0
        cl = s.lut[ci]
        return torch.cat([xyxy, sc.unsqueeze(-1), cl.unsqueeze(-1)], -1)
with torch.no_grad():
    probe = core(torch.zeros(1, 3, res, res))
ncls = probe[1].shape[-1]
W = Wrap(core, res, ncls).eval()
x = torch.rand(1, 3, 640, 640)
with torch.no_grad(): y = W(x)
print('res', res, 'queries', y.shape, 'ncls', ncls)
torch.onnx.export(W, x, out, input_names=['images'], output_names=['output0'], opset_version=17, do_constant_folding=True, dynamo=False)
print('ok', out)
