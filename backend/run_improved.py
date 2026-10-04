"""
Run sugar_bag_improved.pt with exact settings from the screencast:
  - Confidence: 0.50
  - Line position: 0.45
  - Every 3rd frame
  - Direction: Left -> Right (OUT)

On both:
  1. eval_ebc979c9.mp4
  2. 2330to24.mp4
"""
import cv2, sys
from pathlib import Path

sys.path.append('/home/rishi/esc/code/rymaai/ai_management/backend')
from app import EnhancedTracker, CountingConfig
from ultralytics import YOLO

model = YOLO('/home/rishi/esc/code/rymaai/ai_management/backend/models/sugar_bag_improved.pt')

CONF     = 0.50
LINE_POS = 0.45
F_SKIP   = 3   # every 3rd frame

videos = {
    'eval_ebc979c9.mp4': '/home/rishi/esc/code/rymaai/ai_management/backend/uploads/eval_ebc979c9.mp4',
    '2330to24.mp4':      '/home/rishi/esc/code/rymaai/2330to24.mp4',
}

for label, path in videos.items():
    cap = cv2.VideoCapture(path)
    fw    = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh    = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps   = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"\n{'='*60}")
    print(f"Video : {label}")
    print(f"Size  : {fw}x{fh} @ {fps}fps  ({total/fps:.1f}s)")
    print(f"Model : sugar_bag_improved.pt  conf={CONF}  line={LINE_POS}")
    print(f"{'='*60}")

    cfg = CountingConfig()
    cfg.line_position          = LINE_POS
    cfg.confidence_threshold   = CONF
    cfg.min_box_area_ratio     = 0.001
    cfg.min_travel_distance    = 0.01
    cfg.min_track_frames       = 2
    cfg.max_disappeared_frames = 30

    tracker = EnhancedTracker(cfg)
    fi = 0
    dets = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        fi += 1
        if fi % F_SKIP != 0:
            continue

        res = model(frame, conf=CONF, verbose=False)
        raw = []
        for r in res:
            for box in r.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                raw.append({
                    'bbox': [x1, y1, x2, y2],
                    'label': 'bag',
                    'confidence': float(box.conf[0])
                })
                dets += 1

        tracked = tracker.update(raw, fw, fh)
        for obj in tracked.values():
            tracker.check_line_crossing(obj)

    cap.release()

    print(f"  Frames sampled : {fi // F_SKIP}")
    print(f"  Raw detections : {dets}")
    print(f"  OUT (offloaded): {tracker.total_out}")
    print(f"  IN  (loaded)   : {tracker.total_in}")
