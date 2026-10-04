"""
Extract 6 short clips (10 sec each) evenly spaced across sugarbags_offloading.mp4
and run all available models on them.
Reports per-segment detection counts for each model.
"""
import cv2, sys, numpy as np
from ultralytics import YOLO
from pathlib import Path

MODEL_DIR = Path('/home/rishi/esc/code/rymaai/ai_management/backend/models')
SOURCE    = '/home/rishi/esc/code/rymaai/sugarbags_offloading.mp4'
CONF      = 0.4
CLIP_SEC  = 10   # 10 seconds per clip
SAMPLE_FPS = 2   # sample 2 frames per second inside each clip

MODELS = {
    'best':                'best.pt',
    'best_dec20':          'best_dec20.pt',
    'sugar_bag_final':     'sugar_bag_final.pt',
    'sugar_bag_finetuned': 'sugar_bag_finetuned.pt',
    'sugar_bag_improved':  'sugar_bag_improved.pt',
}

print("Loading models...")
loaded = {}
for name, fname in MODELS.items():
    p = MODEL_DIR / fname
    if p.exists():
        loaded[name] = YOLO(str(p))
        print(f"  ✓ {name}")

cap = cv2.VideoCapture(SOURCE)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
src_fps      = cap.get(cv2.CAP_PROP_FPS)
clip_frames  = int(CLIP_SEC * src_fps)
sample_step  = max(1, int(src_fps / SAMPLE_FPS))

# 6 evenly-spaced start positions
n_clips = 6
clip_starts = [int(i * total_frames / n_clips) for i in range(n_clips)]

print(f"\nVideo: {total_frames/src_fps/60:.1f} min @ {src_fps}fps")
print(f"Clips: {n_clips} x {CLIP_SEC}s, sampling {SAMPLE_FPS}fps\n")

# header
header = f"{'Segment':<12}" + "".join(f"{n:>22}" for n in loaded.keys())
print(header)
print("-" * len(header))

results_table = []

for start in clip_starts:
    ts_sec = start / src_fps
    ts_str = f"{int(ts_sec//60):02d}:{int(ts_sec%60):02d}"
    segment_counts = {name: 0 for name in loaded}
    frames_sampled = 0

    for offset in range(0, clip_frames, sample_step):
        pos = start + offset
        if pos >= total_frames:
            break
        cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
        ret, frame = cap.read()
        if not ret:
            break
        frames_sampled += 1
        for name, model in loaded.items():
            res = model(frame, conf=CONF, verbose=False)
            segment_counts[name] += sum(len(r.boxes) for r in res)

    # normalise to per-second
    per_sec = {k: v / CLIP_SEC for k, v in segment_counts.items()}
    row = f"t={ts_str:<9}" + "".join(f"{per_sec[n]:>22.1f}" for n in loaded.keys())
    print(row)
    results_table.append((ts_str, segment_counts))

cap.release()

# Summary: best model overall
print("\n--- Total detections across all 6 clips ---")
totals = {name: 0 for name in loaded}
for _, seg in results_table:
    for k, v in seg.items():
        totals[k] += v
for name, total in sorted(totals.items(), key=lambda x: -x[1]):
    print(f"  {name:<25}: {total:>6} total dets")

best = max(totals, key=totals.get)
print(f"\n✅ Highest detection model: {best}")
print("Done.")
