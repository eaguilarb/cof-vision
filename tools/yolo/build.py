import json, os, shutil, re
d = json.load(open('teacher.json'))
def iou(a, b):
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    i = max(0, x1 - x0) * max(0, y1 - y0); u = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - i
    return i / u if u > 0 else 0
lab = {}
for f, bs in d.items():
    bs = sorted([b for b in bs if b[4] >= 0.4], key=lambda b: -b[4]); keep = []
    for b in bs:
        if all(iou(b, k) < 0.6 for k in keep): keep.append(b)
    lab[f] = keep
# Reparación temporal: persona en la foto anterior y en la siguiente, pero no en esta.
added = 0
for src in ('p46', 'p77'):
    fs = sorted(f for f in lab if f'/{src}_' in f)
    for k in range(1, len(fs) - 1):
        for a in lab[fs[k-1]]:
            if a[4] < 0.5: continue
            for b in lab[fs[k+1]]:
                if b[4] >= 0.5 and iou(a, b) > 0.4:
                    m = [(a[j] + b[j]) / 2 for j in range(4)] + [0.5]
                    if all(iou(m, c) < 0.3 for c in lab[fs[k]]): lab[fs[k]].append(m); added += 1
print('agregadas por continuidad:', added)
num = lambda f: int(re.search(r'_(\d+)\.jpg', f).group(1))
for sp in ('train', 'val'):
    for sub in ('images', 'labels'): os.makedirs(f'ds/{sub}/{sp}', exist_ok=True)
n = {'train': 0, 'val': 0}; nb = {'train': 0, 'val': 0}
for f, bs in lab.items():
    val = (('/p46_' in f and num(f) > 300) or ('/p77_' in f and num(f) > 60))
    sp = 'val' if val else 'train'
    name = os.path.basename(f)
    shutil.copy(f, f'ds/images/{sp}/{name}')
    with open(f'ds/labels/{sp}/{name[:-4]}.txt', 'w') as o:
        for x0, y0, x1, y1, c in bs:
            o.write(f'0 {(x0+x1)/2:.5f} {(y0+y1)/2:.5f} {x1-x0:.5f} {y1-y0:.5f}\n')
    n[sp] += 1; nb[sp] += len(bs)
open('ds/data.yaml', 'w').write(f'path: {os.path.abspath("ds")}\ntrain: images/train\nval: images/val\nnames:\n  0: persona\n')
print(n, nb)
