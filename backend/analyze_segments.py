"""
Analyze detection accuracy across 5 time segments of sugarbags_offloading.mp4
Compares sugar_bag_finetuned.pt vs sugar_bag_final.pt
"""
import cv2, sys, numpy as np
from ultralytics import YOLO

video_path = '/home/rishi/esc/code/rymaai/sugarbags_offloading.mp4'
model_configs = {
    'finetuned': '/home/rishi/esc/code/rymaai/ai_management/backend/models/sugar_bag_finetuned.pt',
    'final':     '/home/rishi/esc/code/rymaai/ai_management/backend/models/sugar_bag_final.pt',
}

print("Loading models...")
models = {k: YOLO(v) for k, v in model_configs.items()}

cap = cv2.VideoCapture(video_path)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS)
duration_sec = total_frames / fps
print(f"Video: {total_frames} frames @ {fps}fps = {duration_sec/60:.1f} min")

# 6 evenly-spaced sample points across the video
n_segments = 6
segment_starts = [int(i * total_frames / n_segments) for i in range(n_segments)]
segment_duration = 3000  # sample 30 seconds worth of frames

print("\n--- Detection results per segment (30 sec window, 1fps sampling) ---")
print(f"{'Timestamp':<15} {'Finetuned dets':>15} {'Final dets':>12} {'Avg brightness':>15} {'Avg contrast':>13}")
print("-" * 70)

for mark in segment_starts:
    ts_sec = mark / fps
    ts_str = f"{int(ts_sec//60):02d}:{int(ts_sec%60):02d}"

    dets = {k: 0 for k in models}
    brightness_vals = []
    contrast_vals = []

    # Sample 1 frame per second (every 100 frames at 100fps)
    sample_step = int(fps)  # 1 frame per second
    sampled = 0
    for offset in range(0, segment_duration, sample_step):
        frame_pos = mark + offset
        if frame_pos >= total_frames:
            break
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_pos)
        ret, frame = cap.read()
        if not ret:
            break
        sampled += 1

        # Brightness/contrast
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        brightness_vals.append(np.mean(gray))
        contrast_vals.append(np.std(gray))

        # Run both models
        for m_name, model in models.items():
            res = model(frame, conf=0.4, verbose=False)
            for r in res:
                dets[m_name] += len(r.boxes)

    avg_brightness = np.mean(brightness_vals) if brightness_vals else 0
    avg_contrast = np.mean(contrast_vals) if contrast_vals else 0
    print(f"t={ts_str} ({sampled} frames sampled): Finetuned={dets['finetuned']:5d} | Final={dets['final']:5d} | Brightness={avg_brightness:.1f} | Contrast={avg_contrast:.1f}")

cap.release()
print("\nDone.")
