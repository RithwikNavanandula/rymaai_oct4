"""
Benchmark: Old vs New counting method across all models
Video: 23to25.mp4
Line: exact horizontal midpoint (x = 0.5)
Count: left to right crossings only
"""

import os, time, sys
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Tuple, Set
import numpy as np
import cv2

os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD'] = '0'

try:
    from scipy.optimize import linear_sum_assignment
    SCIPY_OK = True
except ImportError:
    SCIPY_OK = False
    print("WARNING: scipy not found, using greedy fallback for matching")

try:
    from ultralytics import YOLO
except ImportError:
    print("ERROR: ultralytics not installed"); sys.exit(1)

VIDEO_PATH  = '/home/rishi/esc/code/rymaai/2330to24.mp4'
MODEL_DIR   = '/home/rishi/esc/code/rymaai/ai_management/backend/models'
LINE_POS    = 0.5
PROCESS_FPS = 10
CONF        = 0.4

MODELS = [
    ('best',                'best.pt'),
    ('best_dec20',          'best_dec20.pt'),
    ('sugar_bag_final',     'sugar_bag_final.pt'),
    ('sugar_bag_finetuned', 'sugar_bag_finetuned.pt'),
    ('sugar_bag_improved',  'sugar_bag_improved.pt'),
]

# ===== OLD METHOD =====

class SimpleCentroidTracker:
    def __init__(self, max_disappeared=30):
        self.next_id = 0
        self.objects = {}
        self.disappeared = {}
        self.max_disappeared = max_disappeared
        self.crossed = set()

    def update(self, detections):
        if not detections:
            for oid in list(self.disappeared):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    del self.objects[oid]; del self.disappeared[oid]
            return self.objects
        if not self.objects:
            for d in detections:
                self.objects[self.next_id] = d
                self.disappeared[self.next_id] = 0
                self.next_id += 1
            return self.objects
        oids = list(self.objects.keys())
        used = set()
        for oid in oids:
            ox, oy = self.objects[oid]
            best, best_idx = float('inf'), -1
            for j,(dx,dy) in enumerate(detections):
                if j in used: continue
                dist = ((ox-dx)**2+(oy-dy)**2)**0.5
                if dist < best and dist < 100:
                    best, best_idx = dist, j
            if best_idx != -1:
                self.objects[oid] = detections[best_idx]
                self.disappeared[oid] = 0
                used.add(best_idx)
            else:
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    del self.objects[oid]; del self.disappeared[oid]
        for j,d in enumerate(detections):
            if j not in used:
                self.objects[self.next_id] = d
                self.disappeared[self.next_id] = 0
                self.next_id += 1
        return self.objects


def run_old(model, video_path, line_pos, conf, process_fps):
    cap = cv2.VideoCapture(video_path)
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_skip = max(1, int(video_fps / process_fps))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    tracker = SimpleCentroidTracker()
    prev_pos = {}
    count = 0
    total_dets = 0
    fi = 0
    while True:
        ret, frame = cap.read()
        if not ret: break
        fi += 1
        if fi % frame_skip != 0: continue
        results = model(frame, conf=conf, verbose=False)
        cents = []
        for r in results:
            for box in r.boxes:
                x1,y1,x2,y2 = map(int, box.xyxy[0].tolist())
                cents.append(((x1+x2)/2, (y1+y2)/2))
                total_dets += 1
        tracked = tracker.update(cents)
        lp = line_pos
        for oid,(cx,cy) in tracked.items():
            nx = cx / w
            if oid in prev_pos:
                px = prev_pos[oid]
                if px < lp <= nx and oid not in tracker.crossed:
                    tracker.crossed.add(oid)
                    count += 1
            prev_pos[oid] = nx
    cap.release()
    return count, total_dets


# ===== NEW METHOD =====

@dataclass
class TrackedObject:
    id: int
    bbox: list
    centroid: tuple
    confidence: float
    position_history: deque = field(default_factory=lambda: deque(maxlen=30))
    confidence_history: deque = field(default_factory=lambda: deque(maxlen=10))
    frames_tracked: int = 0
    frames_disappeared: int = 0
    first_seen_frame: int = 0
    entry_position: float = None
    has_crossed: bool = False

    def add_pos(self, cx, cy, fn):
        self.position_history.append((cx, cy, fn))
        self.frames_tracked += 1
        self.frames_disappeared = 0

    def velocity(self):
        if len(self.position_history) < 2: return 0.0, 0.0
        r = list(self.position_history)[-5:]
        dx = r[-1][0]-r[0][0]; dy = r[-1][1]-r[0][1]
        frames = r[-1][2]-r[0][2]
        return (dx/frames, dy/frames) if frames else (0.0, 0.0)

    def travel(self):
        if not self.position_history or self.entry_position is None: return 0.0
        return abs(self.position_history[-1][0] - self.entry_position)

    def consistent(self, n=4):
        if len(self.position_history) < n: return False
        r = list(self.position_history)[-n:]
        dirs = []
        for i in range(1, len(r)):
            dx = r[i][0]-r[i-1][0]
            if abs(dx) > 0.005: dirs.append(dx > 0)
        return len(dirs) > 0 and len(set(dirs)) == 1

    def avg_conf(self):
        return sum(self.confidence_history)/len(self.confidence_history) if self.confidence_history else self.confidence


class EnhancedTracker:
    def __init__(self, line_pos=0.5):
        self.lp = line_pos
        self.next_id = 0
        self.objects = {}
        self.frame_count = 0
        self.cooldowns = {}
        self.total_out = 0
        self.rejected = 0

    def _iou(self, b1, b2):
        ix1,iy1 = max(b1[0],b2[0]), max(b1[1],b2[1])
        ix2,iy2 = min(b1[2],b2[2]), min(b1[3],b2[3])
        inter = max(0,ix2-ix1)*max(0,iy2-iy1)
        a1 = (b1[2]-b1[0])*(b1[3]-b1[1])
        a2 = (b2[2]-b2[0])*(b2[3]-b2[1])
        u = a1+a2-inter
        return inter/u if u>0 else 0

    def _nms(self, dets, thr=0.35):
        dets = sorted(dets, key=lambda x: x['conf'], reverse=True)
        kept = []
        for d in dets:
            if all(self._iou(d['bbox'], k['bbox']) < thr for k in kept):
                kept.append(d)
        return kept

    def _ok(self, bbox, fw, fh):
        x1,y1,x2,y2 = bbox
        bw,bh = x2-x1, y2-y1
        if bw<=0 or bh<=0: return False
        ar = bw/bh
        area = (bw*bh)/(fw*fh)
        return 0.003 <= area <= 0.3 and 0.25 <= ar <= 4.0

    def update(self, raw, fw, fh):
        self.frame_count += 1
        valid = []
        for d in raw:
            if self._ok(d['bbox'], fw, fh):
                x1,y1,x2,y2 = d['bbox']
                cx=((x1+x2)/2)/fw; cy=((y1+y2)/2)/fh
                valid.append({**d,'cx':cx,'cy':cy})
            else:
                self.rejected += 1
        valid = self._nms(valid)
        if not valid:
            for oid in list(self.objects):
                self.objects[oid].frames_disappeared += 1
                if self.objects[oid].frames_disappeared > 20:
                    del self.objects[oid]
            return self.objects
        if not self.objects:
            for d in valid: self._reg(d)
            return self.objects
        oids = list(self.objects.keys())
        cost = np.full((len(oids), len(valid)), 1e6)
        for i,oid in enumerate(oids):
            obj = self.objects[oid]
            vx,vy = obj.velocity()
            px,py = obj.centroid[0]+vx, obj.centroid[1]+vy
            for j,d in enumerate(valid):
                dist = ((px-d['cx'])**2+(py-d['cy'])**2)**0.5
                if dist < 0.12: cost[i,j] = dist
        matched_o, matched_d = set(), set()
        if SCIPY_OK:
            ri,ci = linear_sum_assignment(cost)
            for i,j in zip(ri,ci):
                if cost[i,j] < 0.12:
                    self._upd(oids[i], valid[j]); matched_o.add(oids[i]); matched_d.add(j)
        else:
            pairs = sorted([(cost[i,j],i,j) for i in range(len(oids)) for j in range(len(valid)) if cost[i,j]<0.12])
            for c,i,j in pairs:
                if oids[i] in matched_o or j in matched_d: continue
                self._upd(oids[i], valid[j]); matched_o.add(oids[i]); matched_d.add(j)
        for oid in oids:
            if oid not in matched_o:
                self.objects[oid].frames_disappeared += 1
                if self.objects[oid].frames_disappeared > 20: del self.objects[oid]
        for j,d in enumerate(valid):
            if j not in matched_d: self._reg(d)
        return self.objects

    def _reg(self, d):
        obj = TrackedObject(id=self.next_id,bbox=d['bbox'],centroid=(d['cx'],d['cy']),
                            confidence=d['conf'],first_seen_frame=self.frame_count,
                            entry_position=d['cx'])
        obj.add_pos(d['cx'],d['cy'],self.frame_count)
        obj.confidence_history.append(d['conf'])
        self.objects[self.next_id] = obj; self.next_id += 1

    def _upd(self, oid, d):
        obj = self.objects[oid]
        obj.bbox=d['bbox']; obj.centroid=(d['cx'],d['cy']); obj.confidence=d['conf']
        obj.add_pos(d['cx'],d['cy'],self.frame_count)
        obj.confidence_history.append(d['conf'])

    def check(self, obj):
        if obj.has_crossed: return
        if self.frame_count < self.cooldowns.get(obj.id, 0): return
        if obj.frames_tracked < 3: return
        if len(obj.position_history) < 4: return
        cx = obj.centroid[0]; lp = self.lp; half = 0.06
        if not (lp-half <= cx <= lp+half): return
        hist = list(obj.position_history)
        prev = hist[:-1]
        was_left = any(p[0] < lp-half for p in prev[-6:])
        if not was_left: return
        if cx < lp: return
        if not obj.consistent(4): return
        if obj.travel() < 0.08: return
        if obj.avg_conf() < CONF: return
        obj.has_crossed = True
        self.cooldowns[obj.id] = self.frame_count + 15
        self.total_out += 1


def run_new(model, video_path, line_pos, conf, process_fps):
    cap = cv2.VideoCapture(video_path)
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_skip = max(1, int(video_fps / process_fps))
    fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    tracker = EnhancedTracker(line_pos=line_pos)
    total_dets = 0
    fi = 0
    while True:
        ret, frame = cap.read()
        if not ret: break
        fi += 1
        if fi % frame_skip != 0: continue
        results = model(frame, conf=conf, verbose=False)
        raw = []
        for r in results:
            for box in r.boxes:
                x1,y1,x2,y2 = map(int, box.xyxy[0].tolist())
                raw.append({'bbox':[x1,y1,x2,y2],'conf':float(box.conf[0])})
                total_dets += 1
        tracked = tracker.update(raw, fw, fh)
        for obj in tracked.values():
            tracker.check(obj)
    cap.release()
    return tracker.total_out, total_dets


# ===== MAIN =====

print()
print("="*85)
print("  SUGAR BAG COUNTING BENCHMARK")
print("  Video: 23to25.mp4  |  Line: 0.50 (exact middle)  |  L->R only")
print("="*85)
print(f"  scipy Hungarian: {'YES' if SCIPY_OK else 'NO (greedy fallback)'}")
print()

results = []

for name, fname in MODELS:
    mpath = os.path.join(MODEL_DIR, fname)
    if not os.path.exists(mpath):
        print(f"  SKIP {name}: not found"); continue

    print(f"\n  Loading {name}...", flush=True)
    try:
        model = YOLO(mpath)
    except Exception as e:
        print(f"  FAILED to load: {e}"); continue

    print(f"    [OLD] ", end='', flush=True)
    t0 = time.time()
    try:
        co, do = run_old(model, VIDEO_PATH, LINE_POS, CONF, PROCESS_FPS)
        to = time.time()-t0
        print(f"count={co:>4}  dets={do:>6}  time={to:.0f}s")
    except Exception as e:
        co, do, to = -1, 0, 0
        print(f"ERROR: {e}")

    print(f"    [NEW] ", end='', flush=True)
    t0 = time.time()
    try:
        cn, dn = run_new(model, VIDEO_PATH, LINE_POS, CONF, PROCESS_FPS)
        tn = time.time()-t0
        print(f"count={cn:>4}  dets={dn:>6}  time={tn:.0f}s")
    except Exception as e:
        cn, dn, tn = -1, 0, 0
        print(f"ERROR: {e}")

    results.append((name, co, do, to, cn, dn, tn))
    del model

print()
print("="*85)
print("  FINAL TABLE")
print("="*85)
hdr = f"  {'Model':<24} | {'OLD Count':>9} | {'OLD Dets':>8} | {'OLD Time':>8} | {'NEW Count':>9} | {'NEW Dets':>8} | {'NEW Time':>8} | {'Delta':>6}"
print(hdr)
print("  " + "-"*81)
for (name, co, do, to, cn, dn, tn) in results:
    if co >= 0 and cn >= 0:
        delta = cn - co
        ds = f"{'+' if delta >= 0 else ''}{delta}"
    else:
        ds = "ERR"
    print(f"  {name:<24} | {co:>9} | {do:>8} | {to:>7.0f}s | {cn:>9} | {dn:>8} | {tn:>7.0f}s | {ds:>6}")
print("="*85)
print(f"  Conf: {CONF}  |  Sample: {PROCESS_FPS}fps (skip 1 in {100//PROCESS_FPS})  |  Line: {LINE_POS}")
print()
