"""
Fingerprint: which model generated detected_e239e830.mp4?

Strategy:
1. Extract 5 raw sample frames from the original sugarbags_offloading.mp4
   (we don't know the exact timestamps, so we sample across the whole video)
2. Run all 5 models on each raw frame and record bounding box counts + avg confidence
3. Also read the detected video and count how many green boxes are visible
   per sampled frame (by counting connected green contours in the annotation layer)
4. The model whose detection count best matches the annotated detected video = winner
"""
import cv2, sys, numpy as np
from ultralytics import YOLO
from pathlib import Path

MODEL_DIR  = Path('/home/rishi/esc/code/rymaai/ai_management/backend/models')
DETECTED   = '/home/rishi/esc/code/rymaai/detected_e239e830.mp4'
SOURCE     = '/home/rishi/esc/code/rymaai/sugarbags_offloading.mp4'

MODELS = {
    'best':               'best.pt',
    'best_dec20':         'best_dec20.pt',
    'sugar_bag_final':    'sugar_bag_final.pt',
    'sugar_bag_finetuned':'sugar_bag_finetuned.pt',
    'sugar_bag_improved': 'sugar_bag_improved.pt',
}

print("Loading models...")
loaded = {}
for name, fname in MODELS.items():
    p = MODEL_DIR / fname
    if p.exists():
        loaded[name] = YOLO(str(p))
        print(f"  ✓ {name}")
    else:
        print(f"  ✗ {name} (not found)")

# ── Step 1: measure bounding boxes visible in detected_e239e830.mp4 ──────────
print("\nAnalysing detected_e239e830.mp4 for drawn green boxes per frame...")
dcap = cv2.VideoCapture(DETECTED)
det_fps  = dcap.get(cv2.CAP_PROP_FPS)
det_total = int(dcap.get(cv2.CAP_PROP_FRAME_COUNT))

# Sample 10 frames evenly
sample_frames = [int(i * det_total / 10) for i in range(10)]
detected_box_counts = []
for sf in sample_frames:
    dcap.set(cv2.CAP_PROP_POS_FRAMES, sf)
    ret, frame = dcap.read()
    if not ret:
        continue
    # Count green bounding boxes: isolate bright green pixels (0,255,0)
    lower = np.array([40,  200, 0],   dtype=np.uint8)
    upper = np.array([80,  255, 100], dtype=np.uint8)
    hsv   = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask  = cv2.inRange(hsv, lower, upper)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # Filter noise: only contours large enough to be a bounding box edge
    rects = [c for c in contours if cv2.contourArea(c) > 100]
    detected_box_counts.append(len(rects))
dcap.release()

avg_detected_boxes = np.mean(detected_box_counts) if detected_box_counts else 0
print(f"  Green box contours per frame (avg): {avg_detected_boxes:.1f}")
print(f"  Counts: {detected_box_counts}")

# ── Step 2: run all models on sample frames from source video ─────────────────
print("\nRunning all models on source video samples...")
scap = cv2.VideoCapture(SOURCE)
src_total = int(scap.get(cv2.CAP_PROP_FRAME_COUNT))
src_fps   = scap.get(cv2.CAP_PROP_FPS)

sample_positions = [int(i * src_total / 10) for i in range(10)]
model_results = {name: [] for name in loaded}

for pos in sample_positions:
    scap.set(cv2.CAP_PROP_POS_FRAMES, pos)
    ret, frame = scap.read()
    if not ret:
        continue
    for name, model in loaded.items():
        res = model(frame, conf=0.4, verbose=False)
        count = sum(len(r.boxes) for r in res)
        model_results[name].append(count)
scap.release()

# ── Step 3: compare ───────────────────────────────────────────────────────────
print("\n--- Model vs Detected Video Comparison ---")
print(f"{'Model':<25} {'Avg dets':>10} {'Diff from detected':>20}")
print("-" * 55)
best_match = None
best_diff  = float('inf')
for name, counts in model_results.items():
    avg = np.mean(counts) if counts else 0
    diff = abs(avg - avg_detected_boxes)
    marker = " ← BEST MATCH" if diff < best_diff else ""
    if diff < best_diff:
        best_diff  = diff
        best_match = name
    print(f"{name:<25} {avg:>10.1f} {diff:>20.1f}{marker}")

print(f"\n✅ Most likely model used: {best_match} (diff={best_diff:.1f})")
