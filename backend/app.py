#!/usr/bin/env python3
"""
AI CCTV Backend - v4.1
Complete implementation with real stats, analytics, detection saving, inventory updates
"""

import os
import cv2
import sqlite3
import uuid
import subprocess
import numpy as np
import threading
import time
import jwt
import logging
import re
import csv
import io
from datetime import datetime, timedelta
from pathlib import Path
from functools import wraps
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Tuple, Generator
from enum import Enum

from flask import Flask, jsonify, request, Response, send_file, send_from_directory, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

# Path to the built React frontend
FRONTEND_DIST = Path(__file__).parent.parent / 'frontends' / 'version_5' / 'dist'


# ============================================================================
# CONFIGURATION
# ============================================================================

class Config:
    BASE_DIR = Path(__file__).parent
    MODEL_DIR = Path(os.getenv('MODEL_DIR', str(BASE_DIR / 'models')))
    UPLOAD_DIR = Path(os.getenv('UPLOAD_DIR', str(BASE_DIR / 'uploads')))
    DB_PATH = os.getenv('DB_PATH', str(BASE_DIR / 'aicctv.db'))
    JWT_SECRET = os.getenv('JWT_SECRET', 'ai-cctv-secret-key-2024')
    JWT_EXPIRY_HOURS = int(os.getenv('JWT_EXPIRY_HOURS', 24))
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', '*')
    RATE_LIMIT_REQUESTS = int(os.getenv('RATE_LIMIT_REQUESTS', 100))
    RATE_LIMIT_WINDOW = int(os.getenv('RATE_LIMIT_WINDOW', 60))
    ML_DEVICE = os.getenv('ML_DEVICE', 'auto')
    ML_DEFAULT_CONFIDENCE = float(os.getenv('ML_CONFIDENCE', 0.5))
    ML_MAX_DETECTIONS = int(os.getenv('ML_MAX_DETECTIONS', 50))
    COMPRESSION_TIMEOUT = int(os.getenv('COMPRESSION_TIMEOUT', 600))
    MAX_UPLOAD_SIZE = int(os.getenv('MAX_UPLOAD_MB', 500)) * 1024 * 1024

Config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================================
# LOGGING
# ============================================================================

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger('ai_cctv')

# ============================================================================
# ML INITIALIZATION
# ============================================================================

try:
    os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD'] = '0'
    import torch
    DEVICE = 'cuda' if (Config.ML_DEVICE == 'auto' and torch.cuda.is_available()) else Config.ML_DEVICE if Config.ML_DEVICE != 'auto' else 'cpu'
    if DEVICE == 'cuda':
        logger.info(f"🎮 GPU: {torch.cuda.get_device_name(0)}")
    else:
        logger.info("💻 Running on CPU")
except ImportError:
    torch = None
    DEVICE = 'cpu'
    logger.warning("⚠️ PyTorch not available")

try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
    logger.info("✅ YOLO available")
except ImportError:
    YOLO = None
    YOLO_AVAILABLE = False
    logger.warning("⚠️ YOLO not available")

# Optional barcode support
try:
    from pyzbar import pyzbar
    BARCODE_AVAILABLE = True
except ImportError:
    BARCODE_AVAILABLE = False

# ============================================================================
# EXCEPTIONS
# ============================================================================

class APIError(Exception):
    def __init__(self, message: str, status_code: int = 400, details: dict = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details
    def to_dict(self) -> dict:
        result = {'error': self.message, 'status_code': self.status_code}
        if self.details: result['details'] = self.details
        return result

class ValidationError(APIError):
    def __init__(self, message: str, errors: dict = None): super().__init__(message, 400, errors)

class AuthenticationError(APIError):
    def __init__(self, message: str = "Authentication required"): super().__init__(message, 401)

class AuthorizationError(APIError):
    def __init__(self, message: str = "Permission denied"): super().__init__(message, 403)

class NotFoundError(APIError):
    def __init__(self, resource: str = "Resource"): super().__init__(f"{resource} not found", 404)

# ============================================================================
# VALIDATION
# ============================================================================

class Validator:
    def __init__(self, data: dict):
        self.data = data or {}
        self.errors: Dict[str, List[str]] = {}
    
    def require(self, field: str, message: str = None) -> 'Validator':
        value = self.data.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            self._add_error(field, message or f"{field} is required")
        return self
    
    def email(self, field: str) -> 'Validator':
        value = self.data.get(field, '')
        if value and not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', value):
            self._add_error(field, "Invalid email format")
        return self
    
    def min_length(self, field: str, length: int) -> 'Validator':
        value = self.data.get(field, '')
        if value and len(str(value)) < length:
            self._add_error(field, f"{field} must be at least {length} characters")
        return self
    
    def max_length(self, field: str, length: int) -> 'Validator':
        value = self.data.get(field, '')
        if value and len(str(value)) > length:
            self._add_error(field, f"{field} must be at most {length} characters")
        return self
    
    def in_list(self, field: str, allowed: list) -> 'Validator':
        value = self.data.get(field)
        if value is not None and value not in allowed:
            self._add_error(field, f"{field} must be one of: {', '.join(map(str, allowed))}")
        return self
    
    def _add_error(self, field: str, message: str) -> None:
        if field not in self.errors: self.errors[field] = []
        self.errors[field].append(message)
    
    def validate(self) -> dict:
        if self.errors: raise ValidationError("Validation failed", self.errors)
        return self.data

# ============================================================================
# RATE LIMITER
# ============================================================================

class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window = window_seconds
        self.requests: Dict[str, List[float]] = {}
        self._lock = threading.Lock()
    
    def is_allowed(self, key: str) -> Tuple[bool, int]:
        now = time.time()
        with self._lock:
            if key not in self.requests: self.requests[key] = []
            self.requests[key] = [t for t in self.requests[key] if now - t < self.window]
            remaining = self.max_requests - len(self.requests[key])
            if len(self.requests[key]) >= self.max_requests: return False, 0
            self.requests[key].append(now)
            return True, remaining - 1
    
    def get_key(self) -> str:
        return getattr(request, 'user_id', None) or request.remote_addr or 'anonymous'
    
    def cleanup(self) -> None:
        """Remove stale keys to prevent unbounded memory growth."""
        now = time.time()
        with self._lock:
            stale = [k for k, ts in self.requests.items()
                     if not ts or all(now - t >= self.window for t in ts)]
            for k in stale:
                del self.requests[k]

rate_limiter = RateLimiter(Config.RATE_LIMIT_REQUESTS, Config.RATE_LIMIT_WINDOW)

# ============================================================================
# DATABASE
# ============================================================================

class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()
    
    @property
    def connection(self) -> sqlite3.Connection:
        if not hasattr(self._local, 'connection') or self._local.connection is None:
            self._local.connection = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES)
            self._local.connection.row_factory = sqlite3.Row
            self._local.connection.execute("PRAGMA foreign_keys = ON")
        return self._local.connection
    
    def close(self) -> None:
        if hasattr(self._local, 'connection') and self._local.connection:
            self._local.connection.close()
            self._local.connection = None
    
    @contextmanager
    def get_cursor(self):
        cursor = self.connection.cursor()
        try:
            yield cursor
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        finally:
            cursor.close()
    
    def execute(self, query: str, params: tuple = ()) -> sqlite3.Cursor:
        return self.connection.execute(query, params)
    
    def fetchone(self, query: str, params: tuple = ()) -> Optional[sqlite3.Row]:
        return self.execute(query, params).fetchone()
    
    def fetchall(self, query: str, params: tuple = ()) -> List[sqlite3.Row]:
        return self.execute(query, params).fetchall()
    
    def insert(self, table: str, data: dict) -> str:
        columns = ', '.join(data.keys())
        placeholders = ', '.join(['?' for _ in data])
        query = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
        with self.get_cursor() as cursor:
            cursor.execute(query, tuple(data.values()))
            return data.get('id', cursor.lastrowid)
    
    def update(self, table: str, data: dict, where: str, where_params: tuple) -> int:
        set_clause = ', '.join([f"{k} = ?" for k in data.keys()])
        query = f"UPDATE {table} SET {set_clause} WHERE {where}"
        with self.get_cursor() as cursor:
            cursor.execute(query, tuple(data.values()) + where_params)
            return cursor.rowcount
    
    def delete(self, table: str, where: str = "1=1", params: tuple = ()) -> int:
        with self.get_cursor() as cursor:
            cursor.execute(f"DELETE FROM {table} WHERE {where}", params)
            return cursor.rowcount
    
    def init_schema(self) -> None:
        schema = """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'viewer',
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS detections (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            confidence REAL NOT NULL,
            direction TEXT,
            inference_ms REAL,
            camera_id TEXT,
            detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS inventory (
            id TEXT PRIMARY KEY,
            product_name TEXT UNIQUE NOT NULL,
            count_in INTEGER DEFAULT 0,
            count_out INTEGER DEFAULT 0,
            current_stock INTEGER DEFAULT 0,
            min_threshold INTEGER DEFAULT 10,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS trucks (
            id TEXT PRIMARY KEY,
            plate_number TEXT NOT NULL,
            direction TEXT DEFAULT 'IN',
            driver_name TEXT,
            company TEXT,
            purpose TEXT,
            detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            exit_at TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS scans (
            id TEXT PRIMARY KEY,
            barcode TEXT,
            product_name TEXT,
            batch_number TEXT,
            mfg_date TEXT,
            exp_date TEXT,
            rack_no TEXT,
            shelf_no TEXT,
            direction TEXT DEFAULT 'IN',
            scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS faces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            encoding BLOB,
            image_path TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            severity TEXT DEFAULT 'info',
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- ── Phase-1 supply-chain tables ─────────────────────────────
        CREATE TABLE IF NOT EXISTS bays (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            camera_source INTEGER DEFAULT 0,
            location TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shifts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP,
            operator_name TEXT,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS loading_jobs (
            id TEXT PRIMARY KEY,
            bay_id TEXT,
            truck_id TEXT,
            truck_plate TEXT NOT NULL,
            product_name TEXT DEFAULT 'Sugar Bag',
            target_count INTEGER NOT NULL,
            loaded_count INTEGER DEFAULT 0,
            direction TEXT DEFAULT 'OUT',
            shift_id TEXT,
            status TEXT DEFAULT 'pending',
            operator_name TEXT,
            notes TEXT,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (bay_id) REFERENCES bays(id),
            FOREIGN KEY (shift_id) REFERENCES shifts(id)
        );

        -- Extend detections to carry job/shift context
        -- (ALTER TABLE is idempotent via the try in seed_data)

        CREATE INDEX IF NOT EXISTS idx_detections_date ON detections(detected_at);
        CREATE INDEX IF NOT EXISTS idx_detections_type ON detections(type);
        CREATE INDEX IF NOT EXISTS idx_detections_direction ON detections(direction);
        CREATE INDEX IF NOT EXISTS idx_trucks_date ON trucks(detected_at);
        CREATE INDEX IF NOT EXISTS idx_trucks_plate ON trucks(plate_number);
        CREATE INDEX IF NOT EXISTS idx_scans_date ON scans(scanned_at);
        CREATE INDEX IF NOT EXISTS idx_scans_barcode ON scans(barcode);
        CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(is_read);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON loading_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_bay ON loading_jobs(bay_id);
        CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(started_at);
        """
        with self.get_cursor() as cursor:
            cursor.executescript(schema)
        # Add columns that may not exist in older DBs (safe migration)
        for col_sql in [
            "ALTER TABLE detections ADD COLUMN shift_id TEXT",
            "ALTER TABLE detections ADD COLUMN job_id TEXT",
            "ALTER TABLE detections ADD COLUMN bay_id TEXT",
        ]:
            try:
                with self.get_cursor() as c:
                    c.execute(col_sql)
            except Exception:
                pass  # column already exists
        logger.info("✅ Database schema initialized")

    
    def seed_data(self) -> None:
        if not self.fetchone("SELECT id FROM users WHERE email = ?", ('demo@aicctv.com',)):
            self.insert('users', {
                'id': str(uuid.uuid4()),
                'email': 'demo@aicctv.com',
                'password_hash': generate_password_hash('demo123'),
                'name': 'Demo User',
                'role': 'admin'
            })
            logger.info("✅ Demo user created (demo@aicctv.com / demo123)")
        
        for product in ['Sugar Bag', 'Full Crate', 'Half Crate', 'Box', 'Pallet']:
            if not self.fetchone("SELECT id FROM inventory WHERE product_name = ?", (product,)):
                self.insert('inventory', {'id': str(uuid.uuid4()), 'product_name': product})
        logger.info("✅ Seed data loaded")

db = Database(Config.DB_PATH)

# ============================================================================
# HELPERS
# ============================================================================

def create_alert(alert_type: str, message: str, severity: str = 'info'):
    """Create a new alert"""
    db.insert('alerts', {
        'id': str(uuid.uuid4()),
        'type': alert_type,
        'message': message,
        'severity': severity
    })

def save_detection_to_db(detection_type: str, confidence: float, direction: str = None, inference_ms: float = 0):
    """Save a detection to database"""
    try:
        db.insert('detections', {
            'id': str(uuid.uuid4()),
            'type': detection_type,
            'confidence': confidence,
            'direction': direction,
            'inference_ms': inference_ms
        })
    except Exception as e:
        logger.error(f"Failed to save detection: {e}")

def update_inventory_from_detection(product_type: str, direction: str = 'IN', count: int = 1):
    """Update inventory based on detection"""
    label_to_product = {
        'sugar_bag': 'Sugar Bag', 'sugar': 'Sugar Bag',
        'full_crate': 'Full Crate', 'crate': 'Full Crate',
        'half_crate': 'Half Crate', 'box': 'Box', 'pallet': 'Pallet'
    }
    product_name = label_to_product.get(product_type.lower(), product_type)
    
    item = db.fetchone("SELECT * FROM inventory WHERE LOWER(product_name) = LOWER(?)", (product_name,))
    
    if not item:
        db.insert('inventory', {
            'id': str(uuid.uuid4()),
            'product_name': product_name,
            'count_in': count if direction == 'IN' else 0,
            'count_out': count if direction == 'OUT' else 0,
            'current_stock': count if direction == 'IN' else 0
        })
    else:
        with db.get_cursor() as cursor:
            if direction == 'IN':
                cursor.execute("UPDATE inventory SET count_in = count_in + ?, current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (count, count, item['id']))
            else:
                cursor.execute("UPDATE inventory SET count_out = count_out + ?, current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?", (count, count, item['id']))

def check_low_stock_alerts():
    """Check inventory for low stock and create alerts.
    Uses 2 queries total instead of N+1 LIKE scans.
    """
    low_items = db.fetchall("SELECT product_name, current_stock, min_threshold FROM inventory WHERE current_stock < min_threshold")
    if not low_items:
        return
    today = datetime.now().strftime('%Y-%m-%d')
    # Single query for all low_stock messages today; check membership in Python
    existing_rows = db.fetchall("SELECT message FROM alerts WHERE type = 'low_stock' AND DATE(created_at) = ?", (today,))
    alerted_today = {row['message'] for row in existing_rows}
    for item in low_items:
        msg = f"Low stock: {item['product_name']} has only {item['current_stock']} units (threshold: {item['min_threshold']})"
        if msg not in alerted_today:
            create_alert('low_stock', msg, 'warning')

# ============================================================================
# AUTHENTICATION
# ============================================================================

def create_token(user_id: str, role: str, name: str) -> str:
    return jwt.encode({'user_id': user_id, 'role': role, 'name': name, 'exp': datetime.utcnow() + timedelta(hours=Config.JWT_EXPIRY_HOURS)}, Config.JWT_SECRET, algorithm='HS256')

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, Config.JWT_SECRET, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Token expired")
    except jwt.InvalidTokenError:
        raise AuthenticationError("Invalid token")

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            try:
                payload = decode_token(auth_header[7:])
                request.user_id = payload['user_id']
                request.user_role = payload['role']
                request.user_name = payload.get('name', '')
            except:
                request.user_id = 'demo'
                request.user_role = 'admin'
                request.user_name = 'Demo'
        else:
            request.user_id = 'demo'
            request.user_role = 'admin'
            request.user_name = 'Demo'
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            try:
                payload = decode_token(auth_header[7:])
                if payload.get('role') != 'admin': raise AuthorizationError()
                request.user_id = payload['user_id']
                request.user_role = payload['role']
            except AuthorizationError:
                raise
            except:
                request.user_id = 'demo'
                request.user_role = 'admin'
        else:
            request.user_id = 'demo'
            request.user_role = 'admin'
        return f(*args, **kwargs)
    return decorated

def rate_limit(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        allowed, remaining = rate_limiter.is_allowed(rate_limiter.get_key())
        if not allowed: return jsonify({'error': 'Rate limit exceeded'}), 429
        return f(*args, **kwargs)
    return decorated

# ============================================================================
# ML SERVICE
# ============================================================================

@dataclass
class DetectionResult:
    label: str
    confidence: float
    bbox: List[int]
    inference_ms: float
    
    def to_dict(self) -> dict:
        return {'label': self.label, 'confidence': round(self.confidence, 3), 'bbox': self.bbox, 'inference_ms': round(self.inference_ms, 1)}

class MLService:
    _instance = None
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized: return
        # Registry of discovered model paths — does NOT hold loaded model objects
        self._registry: Dict[str, Path] = {}
        # Only the currently active model is loaded into memory
        self._loaded_model: Any = None
        self._active_model: Optional[str] = None
        self._latest_detections: List[DetectionResult] = []
        self._lock = threading.Lock()
        self._initialized = True
    
    @property
    def device(self) -> str: return DEVICE
    @property
    def active_model_name(self) -> Optional[str]: return self._active_model
    @property
    def loaded_models(self) -> Dict[str, dict]:
        """Returns all discovered models; marks which one is currently loaded."""
        return {
            name: {'loaded': name == self._active_model, 'device': DEVICE if name == self._active_model else None}
            for name in self._registry
        }
    @property
    def latest_detections(self) -> List[dict]: return [d.to_dict() for d in self._latest_detections]
    
    def register_model(self, path: Path, name: str = None) -> bool:
        """Register a model path without loading it into memory."""
        name = name or path.stem
        if not path.exists():
            logger.warning(f"⚠️ Model file not found: {path}")
            return False
        self._registry[name] = path
        logger.info(f"📋 Model '{name}' registered (not yet loaded)")
        return True
    
    def register_models_from_directory(self, directory: Path) -> int:
        """Scan a directory and register all .pt files without loading them."""
        if not directory.exists(): return 0
        count = 0
        for mf in sorted(directory.glob('*.pt')):
            if self.register_model(mf): count += 1
        return count
    
    def _load_model_into_memory(self, name: str) -> bool:
        """Internal: actually load a registered model into memory."""
        if not YOLO_AVAILABLE: return False
        path = self._registry.get(name)
        if path is None:
            logger.error(f"❌ Model '{name}' not in registry")
            return False
        try:
            model = YOLO(str(path))
            if DEVICE == 'cuda': model.to('cuda')
            self._loaded_model = model
            logger.info(f"✅ Model '{name}' loaded into memory on {DEVICE}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to load '{name}': {e}")
            return False
    
    def _unload_current_model(self):
        """Unload the current model from memory to free RAM."""
        if self._loaded_model is not None:
            logger.info(f"🗑️ Unloading model '{self._active_model}' from memory")
            self._loaded_model = None
            if torch is not None and DEVICE == 'cuda':
                torch.cuda.empty_cache()
    
    def switch_model(self, name: str) -> bool:
        """Switch active model: unloads the current one, loads the new one."""
        if name not in self._registry:
            return False
        if name == self._active_model:
            return True  # Already active
        with self._lock:
            self._unload_current_model()
            if self._load_model_into_memory(name):
                self._active_model = name
                return True
            return False
    
    # Legacy compatibility: kept so existing call-sites don't break
    def load_model(self, path: Path, name: str = None) -> bool:
        """Register and immediately load a model (used for the initial default)."""
        name = name or path.stem
        self.register_model(path, name)
        return self.switch_model(name)
    
    def load_models_from_directory(self, directory: Path) -> int:
        """Register all models in a directory (lazy — none are loaded yet)."""
        return self.register_models_from_directory(directory)
    
    def get_active_model(self) -> Any:
        return self._loaded_model
    
    def detect(self, frame: np.ndarray, confidence: float = 0.5, draw: bool = True) -> Tuple[np.ndarray, List[DetectionResult]]:
        model = self.get_active_model()
        if model is None: return frame, []
        
        with self._lock:
            start = time.time()
            results = model(frame, conf=confidence, verbose=False)
            ms = (time.time() - start) * 1000
            
            detections = []
            for r in results:
                for box in r.boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    conf = float(box.conf[0])
                    label = model.names[int(box.cls[0])]
                    detections.append(DetectionResult(label, conf, [x1, y1, x2, y2], ms))
                    if draw:
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        cv2.putText(frame, f"{label}: {conf:.2f}", (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            
            self._latest_detections = detections[:Config.ML_MAX_DETECTIONS]
            return frame, detections
    
    def health_check(self) -> dict:
        return {'device': DEVICE, 'models_loaded': 1 if self._loaded_model else 0, 'active_model': self._active_model}

ml_service = MLService()

# ============================================================================
# CAMERA & COMPRESSION
# ============================================================================

class VideoCamera:
    def __init__(self, source: int = 0):
        self._cap = cv2.VideoCapture(source)
        self._raw_frame = None
        self._processed_frame = None
        self._frame_lock = threading.Lock()
        self._running = True

        # Tracker and positions
        self.tracker = SimpleCentroidTracker()
        self.previous_positions = {}
        self.line_position = 0.45  # 45% of width — configurable via PATCH /api/camera/line

        # Live session crossing counters (reset when camera restarts)
        self.session_in = 0
        self.session_out = 0
        
        self._thread = threading.Thread(target=self._update, daemon=True)
        self._thread.start()

    def _update(self):
        last_inference_time = 0
        inference_interval = 0.1  # Max 10 FPS for ML inference to save CPU/GPU
        
        while self._running:
            ret, frame = self._cap.read()
            if ret:
                now = time.time()
                if now - last_inference_time >= inference_interval:
                    last_inference_time = now
                    h, w = frame.shape[:2]
                    
                    # Detect objects (conf=0.5, draw=False to do custom drawing)
                    _, detections = ml_service.detect(frame, confidence=Config.ML_DEFAULT_CONFIDENCE, draw=False)
                    
                    processed_frame = frame.copy()
                    
                    # Track centroids
                    centroids = []
                    for det in detections:
                        x1, y1, x2, y2 = det.bbox
                        cx = (x1 + x2) / 2
                        cy = (y1 + y2) / 2
                        centroids.append((cx, cy))
                        
                        # Draw bounding box
                        cv2.rectangle(processed_frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        cv2.putText(processed_frame, f"{det.label}: {det.confidence:.2f}", (x1, y1-10), 
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                    
                    tracked_objects = self.tracker.update(centroids)
                    lp = self.line_position
                    line_x = int(w * lp)
                    
                    for oid, (cx, cy) in tracked_objects.items():
                        norm_x = cx / w
                        if oid in self.previous_positions:
                            prev_x = self.previous_positions[oid]
                            
                            # Left to right -> OUT (offloaded)
                            if prev_x < lp and norm_x >= lp:
                                if oid not in self.tracker.crossed:
                                    self.tracker.crossed.add(oid)
                                    self.session_out += 1
                                    save_detection_to_db('sugar_bag', 1.0, 'OUT', 0.0)
                                    update_inventory_from_detection('Sugar Bag', 'OUT', 1)
                                    logger.info(f"🎒 [Live Feed] Bag {oid} crossed OUT")
                            
                            # Right to left -> IN (loaded)
                            elif prev_x > lp and norm_x <= lp:
                                if oid not in self.tracker.crossed:
                                    self.tracker.crossed.add(oid)
                                    self.session_in += 1
                                    save_detection_to_db('sugar_bag', 1.0, 'IN', 0.0)
                                    update_inventory_from_detection('Sugar Bag', 'IN', 1)
                                    logger.info(f"🎒 [Live Feed] Bag {oid} crossed IN")
                                    
                        self.previous_positions[oid] = norm_x
                        
                        # Draw centroid and ID
                        cv2.circle(processed_frame, (int(cx), int(cy)), 4, (0, 0, 255), -1)
                        cv2.putText(processed_frame, f"ID {oid}", (int(cx) - 10, int(cy) - 10), 
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
                    
                    # Draw vertical tracking line
                    cv2.line(processed_frame, (line_x, 0), (line_x, h), (255, 0, 0), 2)
                    cv2.putText(processed_frame, "TRACKING LINE", (line_x + 10, 30), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
                    
                    # Session counter overlay (bottom-left)
                    cv2.putText(processed_frame, f"IN:  {self.session_in}", (10, h - 44), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (50, 220, 50), 2)
                    cv2.putText(processed_frame, f"OUT: {self.session_out}", (10, h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (50, 80, 255), 2)

                    with self._frame_lock:
                        self._processed_frame = processed_frame
                        self._frame_id += 1  # signal encoder cache is stale

                else:
                    with self._frame_lock:
                        if self._processed_frame is None:
                            self._processed_frame = frame.copy()
            time.sleep(0.01)

    def get_frame(self):
        with self._frame_lock:
            return self._processed_frame.copy() if self._processed_frame is not None else None

    # ---- low-latency MJPEG helper ----
    # Encodes once per new frame, caches result. Resizes to ≤ 1280px wide for bandwidth.
    _encoded_cache: bytes = None
    _encoded_cache_id: int = 0
    _frame_id: int = 0

    def get_encoded_frame(self) -> bytes | None:
        with self._frame_lock:
            if self._processed_frame is None:
                return None
            # Only re-encode if the frame changed (tracked by _frame_id)
            if self._encoded_cache_id == self._frame_id:
                return self._encoded_cache
            frame = self._processed_frame

        # Resize to max 1280px wide to cut bandwidth (outside lock to not block capture)
        h, w = frame.shape[:2]
        max_w = 1280
        if w > max_w:
            scale = max_w / w
            frame = cv2.resize(frame, (max_w, int(h * scale)), interpolation=cv2.INTER_LINEAR)

        # Encode at quality 70 — good enough for monitoring, ~4-5x smaller than default
        ok, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ok:
            return None
        encoded = buf.tobytes()

        with self._frame_lock:
            self._encoded_cache = encoded
            self._encoded_cache_id = self._frame_id
        return encoded

    def _mark_frame_updated(self):
        """Called inside _update after writing a new processed frame."""
        self._frame_id += 1

    def stop(self):
        self._running = False
        if self._cap: self._cap.release()

camera: Optional[VideoCamera] = None


class CameraManager:
    """Manages one VideoCamera per bay (keyed by bay_id string).
    Falls back to the legacy single `camera` global for the /api/video_feed route.
    """
    def __init__(self):
        self.cameras: Dict[str, VideoCamera] = {}
        self._lock = threading.Lock()

    def get_or_create(self, bay_id: str, source: int = 0) -> VideoCamera:
        with self._lock:
            if bay_id not in self.cameras or not self.cameras[bay_id]._running:
                logger.info(f"📷 Starting camera for bay {bay_id} (source={source})")
                self.cameras[bay_id] = VideoCamera(source)
            return self.cameras[bay_id]

    def stop(self, bay_id: str):
        with self._lock:
            cam = self.cameras.pop(bay_id, None)
            if cam:
                cam.stop()
                logger.info(f"📷 Camera stopped for bay {bay_id}")

    def stop_all(self):
        with self._lock:
            for cam in self.cameras.values():
                cam.stop()
            self.cameras.clear()


camera_manager = CameraManager()


class JobStatus(Enum):
    PROCESSING = 'processing'
    COMPLETED = 'completed'
    FAILED = 'failed'

@dataclass
class CompressionJob:
    id: str
    input_path: Path
    output_path: Path
    status: JobStatus = JobStatus.PROCESSING
    original_size: int = 0
    compressed_size: int = 0
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        result = {'job_id': self.id, 'status': self.status.value, 'original_size': self.original_size}
        if self.status == JobStatus.COMPLETED:
            ratio = (1 - self.compressed_size / self.original_size) * 100 if self.original_size > 0 else 0
            result['compressed_size'] = self.compressed_size
            result['ratio'] = round(ratio, 1)
        if self.error: result['error'] = self.error
        return result

compression_jobs: Dict[str, CompressionJob] = {}

# ============================================================================
# FLASK APP
# ============================================================================

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = Config.MAX_UPLOAD_SIZE
CORS(app, resources={r"/*": {"origins": "*"}}, max_age=3600)  # cache preflight for 1 h

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        return response

@app.errorhandler(APIError)
def handle_api_error(error):
    return jsonify(error.to_dict()), error.status_code

@app.teardown_appcontext
def teardown_db(exception):
    db.close()

# ============================================================================
# ROUTES: CORE
# ============================================================================

@app.route('/api/info')
def index():
    """Backend metadata — moved to /api/info so '/' serves the React frontend."""
    return jsonify({'name': 'AI CCTV Backend', 'version': '4.1', 'status': 'running', 'gpu': DEVICE == 'cuda'})


@app.route('/health')
@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', **ml_service.health_check()})

# ============================================================================
# ROUTES: AUTH
# ============================================================================

@app.route('/api/auth/login', methods=['POST'])
@rate_limit
def login():
    data = request.json or {}
    Validator(data).require('email').email('email').require('password').validate()
    user = db.fetchone("SELECT * FROM users WHERE email = ? AND is_active = 1", (data['email'],))
    if not user or not check_password_hash(user['password_hash'], data['password']):
        raise AuthenticationError("Invalid email or password")
    token = create_token(user['id'], user['role'], user['name'])
    return jsonify({'access_token': token, 'user': {'id': user['id'], 'email': user['email'], 'name': user['name'], 'role': user['role']}})

# ============================================================================
# ROUTES: MODELS
# ============================================================================

@app.route('/api/models', methods=['GET'])
@token_required
def list_models():
    return jsonify({'available': ml_service.loaded_models, 'active': ml_service.active_model_name})

@app.route('/api/models/switch', methods=['POST'])
@token_required
def switch_model():
    name = (request.json or {}).get('model')
    if ml_service.switch_model(name): return jsonify({'active': name})
    raise NotFoundError("Model")

# ============================================================================
# ROUTES: DETECTION
# ============================================================================

@app.route('/api/detect_frame', methods=['POST'])
@token_required
def detect_frame():
    if 'image' not in request.files: raise ValidationError("No image provided")
    
    file_bytes = np.frombuffer(request.files['image'].read(), np.uint8)
    image = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if image is None: raise ValidationError("Invalid image")
    
    save = request.form.get('save', 'false').lower() == 'true'
    direction = request.form.get('direction')
    confidence = float(request.form.get('confidence', Config.ML_DEFAULT_CONFIDENCE))
    
    _, detections = ml_service.detect(image, confidence=confidence, draw=False)
    
    if save:
        for det in detections[:10]:
            save_detection_to_db(det.label, det.confidence, direction, det.inference_ms)
            if direction: update_inventory_from_detection(det.label, direction)
    
    return jsonify({'detections': [d.to_dict() for d in detections], 'count': len(detections), 'saved': save})

@app.route('/api/detections/live')
@token_required
def live_detections():
    return jsonify(ml_service.latest_detections)

@app.route('/api/detections')
@token_required
def get_detections():
    limit = min(int(request.args.get('limit', 50)), 200)
    dets = db.fetchall("SELECT * FROM detections ORDER BY detected_at DESC LIMIT ?", (limit,))
    return jsonify([dict(d) for d in dets])

@app.route('/api/detections/record', methods=['POST'])
@token_required
def record_detection():
    data = request.json or {}
    Validator(data).require('type').require('direction').in_list('direction', ['IN', 'OUT']).validate()
    
    detection_id = str(uuid.uuid4())
    db.insert('detections', {
        'id': detection_id,
        'type': data['type'],
        'confidence': data.get('confidence', 1.0),
        'direction': data['direction'],
        'inference_ms': data.get('inference_ms', 0)
    })
    update_inventory_from_detection(data['type'], data['direction'], data.get('count', 1))
    
    return jsonify({'id': detection_id, 'message': f"Detection recorded ({data['direction']})"}), 201

# ============================================================================
# ROUTES: STATS (REAL DATA)
# ============================================================================

@app.route('/api/stats')
@token_required
def get_stats():
    inv = db.fetchone("SELECT COALESCE(SUM(count_in),0) as total_in, COALESCE(SUM(count_out),0) as total_out, COALESCE(SUM(current_stock),0) as total_stock FROM inventory")
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    today_stats = db.fetchone("""
        SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END),0) as today_in,
               COALESCE(SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END),0) as today_out
        FROM detections WHERE DATE(detected_at) = ?
    """, (today,))
    
    yesterday_stats = db.fetchone("""
        SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END),0) as yesterday_in,
               COALESCE(SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END),0) as yesterday_out
        FROM detections WHERE DATE(detected_at) = ?
    """, (yesterday,))
    
    y_in = yesterday_stats['yesterday_in'] if yesterday_stats else 0
    y_out = yesterday_stats['yesterday_out'] if yesterday_stats else 0
    t_in = today_stats['today_in'] if today_stats else 0
    t_out = today_stats['today_out'] if today_stats else 0
    
    in_pct = ((t_in - y_in) / max(1, y_in)) * 100
    out_pct = ((t_out - y_out) / max(1, y_out)) * 100
    
    in_trend = f"{in_pct:+.1f}%"
    out_trend = f"{out_pct:+.1f}%"
    
    sugar = db.fetchone("SELECT COALESCE(current_stock,0) as count FROM inventory WHERE LOWER(product_name) LIKE '%sugar%'")
    
    trucks = db.fetchone("""
        SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END),0) as trucks_in,
               COALESCE(SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END),0) as trucks_out
        FROM trucks WHERE DATE(detected_at) = ?
    """, (today,))
    
    return jsonify({
        'total_in': inv['total_in'], 'total_out': inv['total_out'], 'total_stock': inv['total_stock'],
        'today_in': today_stats['today_in'] if today_stats else 0,
        'today_out': today_stats['today_out'] if today_stats else 0,
        'in_trend': in_trend, 'out_trend': out_trend,
        'in_up': in_pct >= 0, 'out_up': out_pct >= 0,
        'sugar_bag_count': sugar['count'] if sugar else 0,
        'trucks_in_today': trucks['trucks_in'] if trucks else 0,
        'trucks_out_today': trucks['trucks_out'] if trucks else 0,
        'gpu_active': DEVICE == 'cuda',
        'active_model': ml_service.active_model_name,
        'timestamp': datetime.now().isoformat()
    })


# ============================================================================
# ROUTES: ANALYTICS (REAL DATA)
# ============================================================================

@app.route('/api/analytics')
@token_required
def get_analytics():
    today = datetime.now().strftime('%Y-%m-%d')
    days = int(request.args.get('days', 7))
    
    hourly_data = db.fetchall("""
        SELECT CAST(strftime('%H', detected_at) AS INTEGER) as hour,
               SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END) as in_count,
               SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) as out_count,
               COUNT(*) as total
        FROM detections WHERE DATE(detected_at) = ?
        GROUP BY hour ORDER BY hour
    """, (today,))
    
    hourly_dict = {row['hour']: row for row in hourly_data}
    hourly = [{'hour': h, 'in_count': hourly_dict[h]['in_count'] if h in hourly_dict else 0, 'out_count': hourly_dict[h]['out_count'] if h in hourly_dict else 0, 'total': hourly_dict[h]['total'] if h in hourly_dict else 0} for h in range(24)]
    
    daily_data = db.fetchall("""
        SELECT DATE(detected_at) as date,
               SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END) as in_count,
               SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) as out_count,
               COUNT(*) as total
        FROM detections WHERE detected_at >= DATE('now', ?)
        GROUP BY DATE(detected_at) ORDER BY date
    """, (f'-{days} days',))
    
    type_dist = db.fetchall("SELECT type, COUNT(*) as count FROM detections WHERE detected_at >= DATE('now', '-7 days') GROUP BY type ORDER BY count DESC LIMIT 10")
    
    peak = db.fetchone("SELECT CAST(strftime('%H', detected_at) AS INTEGER) as hour, COUNT(*) as count FROM detections WHERE DATE(detected_at) = ? GROUP BY hour ORDER BY count DESC LIMIT 1", (today,))
    
    return jsonify({
        'hourly': hourly,
        'daily': [dict(d) for d in daily_data],
        'type_distribution': [dict(t) for t in type_dist],
        'summary': {'peak_hour': peak['hour'] if peak else None, 'peak_count': peak['count'] if peak else 0}
    })

# ============================================================================
# ROUTES: INVENTORY
# ============================================================================

@app.route('/api/inventory')
@token_required
def get_inventory():
    items = db.fetchall("SELECT * FROM inventory ORDER BY product_name")
    return jsonify([dict(i) for i in items])

@app.route('/api/inventory', methods=['POST'])
@admin_required
def add_inventory():
    data = request.json or {}
    Validator(data).require('product_name').validate()
    if db.fetchone("SELECT id FROM inventory WHERE product_name = ?", (data['product_name'],)):
        raise ValidationError("Product already exists")
    item_id = str(uuid.uuid4())
    db.insert('inventory', {'id': item_id, 'product_name': data['product_name'], 'min_threshold': data.get('min_threshold', 10)})
    return jsonify({'id': item_id}), 201

@app.route('/api/inventory/<item_id>/update', methods=['POST'])
@token_required
def update_inventory_count(item_id):
    data = request.json or {}
    Validator(data).require('direction').in_list('direction', ['IN', 'OUT']).validate()
    count = int(data.get('count', 1))
    direction = data['direction']
    
    item = db.fetchone("SELECT * FROM inventory WHERE id = ?", (item_id,))
    if not item: raise NotFoundError("Inventory item")
    
    with db.get_cursor() as cursor:
        if direction == 'IN':
            cursor.execute("UPDATE inventory SET count_in = count_in + ?, current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (count, count, item_id))
        else:
            cursor.execute("UPDATE inventory SET count_out = count_out + ?, current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?", (count, count, item_id))
    
    return jsonify({'message': f'Updated {direction}', 'count': count})

# ============================================================================
# ROUTES: TRUCKS
# ============================================================================

@app.route('/api/trucks')
@token_required
def get_trucks():
    trucks = db.fetchall("SELECT * FROM trucks ORDER BY detected_at DESC LIMIT 50")
    return jsonify([dict(t) for t in trucks])

@app.route('/api/trucks', methods=['POST'])
@token_required
def add_truck():
    data = request.json or {}
    plate = data.get('truck_number') or data.get('plate_number')
    if not plate: raise ValidationError("Plate number required")
    tid = str(uuid.uuid4())
    db.insert('trucks', {'id': tid, 'plate_number': plate.upper(), 'direction': data.get('direction', 'IN'), 'driver_name': data.get('driver_name'), 'company': data.get('company'), 'purpose': data.get('purpose')})
    return jsonify({'id': tid}), 201

@app.route('/api/trucks/<truck_id>/exit', methods=['POST'])
@token_required
def truck_exit(truck_id):
    truck = db.fetchone("SELECT * FROM trucks WHERE id = ?", (truck_id,))
    if not truck: raise NotFoundError("Truck")
    db.update('trucks', {'direction': 'OUT', 'exit_at': datetime.now().isoformat()}, 'id = ?', (truck_id,))
    return jsonify({'message': 'Truck exit recorded'})

@app.route('/api/trucks/reset', methods=['DELETE'])
@token_required
def reset_trucks():
    count = db.delete('trucks')
    return jsonify({'deleted': count})

# ============================================================================
# ROUTES: FACES
# ============================================================================

@app.route('/api/faces')
@token_required
def get_faces():
    faces = db.fetchall("SELECT id, name, created_at FROM faces ORDER BY created_at DESC")
    return jsonify([dict(f) for f in faces])

@app.route('/api/faces', methods=['POST'])
@token_required
def add_face():
    data = request.json or {}
    Validator(data).require('name').validate()
    with db.get_cursor() as cursor:
        cursor.execute("INSERT INTO faces (name) VALUES (?)", (data['name'],))
        face_id = cursor.lastrowid
    return jsonify({'id': face_id, 'message': 'Face registered'}), 201

@app.route('/api/faces/<int:face_id>', methods=['DELETE'])
@token_required
def delete_face(face_id):
    if db.delete('faces', 'id = ?', (face_id,)) == 0: raise NotFoundError("Face")
    return jsonify({'message': 'Face deleted'})

# ============================================================================
# ROUTES: SCANS
# ============================================================================

@app.route('/api/scans')
@token_required
def get_scans():
    scans = db.fetchall("SELECT * FROM scans ORDER BY scanned_at DESC LIMIT 100")
    return jsonify([dict(s) for s in scans])

@app.route('/api/scans', methods=['POST'])
@token_required
def add_scan():
    data = request.json or {}
    # Require either barcode or batch_number
    if not data.get('barcode') and not data.get('batch_number'):
        raise ValidationError("Either barcode or batch_number is required")
    
    exp_date = data.get('exp_date', '')
    is_expired = False
    days_until = None
    if exp_date:
        try:
            # Try multiple date formats
            for fmt in ['%Y-%m-%d', '%d/%m/%y', '%d/%m/%Y', '%d-%m-%Y']:
                try:
                    exp = datetime.strptime(exp_date, fmt)
                    days_until = (exp - datetime.now()).days
                    is_expired = days_until < 0
                    break
                except ValueError:
                    continue
        except: pass
    
    scan_id = str(uuid.uuid4())
    db.insert('scans', {
        'id': scan_id, 
        'barcode': data.get('barcode', ''), 
        'product_name': data.get('product_name', ''),
        'batch_number': data.get('batch_number', ''), 
        'mfg_date': data.get('mfg_date', ''),
        'exp_date': exp_date, 
        'rack_no': data.get('rack_no', ''), 
        'shelf_no': data.get('shelf_no', ''),
        'direction': data.get('direction', 'IN')
    })
    return jsonify({'id': scan_id, 'is_expired': is_expired, 'days_until_expiry': days_until}), 201

@app.route('/api/scans/<scan_id>', methods=['DELETE'])
@token_required
def delete_scan(scan_id):
    if db.delete('scans', 'id = ?', (scan_id,)) == 0: raise NotFoundError("Scan")
    return jsonify({'message': 'Scan deleted'})

@app.route('/api/barcode/decode', methods=['POST'])
@token_required
def decode_barcode():
    if not BARCODE_AVAILABLE: raise APIError("Barcode decoding not available", 503)
    if 'image' not in request.files: raise ValidationError("No image provided")
    
    file_bytes = np.frombuffer(request.files['image'].read(), np.uint8)
    image = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if image is None: raise ValidationError("Invalid image")
    
    barcodes = pyzbar.decode(image)
    results = []
    for bc in barcodes:
        x, y, w, h = bc.rect
        results.append({'data': bc.data.decode('utf-8'), 'type': bc.type, 'bbox': [x, y, x+w, y+h]})
    return jsonify({'barcodes': results, 'count': len(results)})

# ============================================================================
# ROUTES: OCR
# ============================================================================

# Try to import pytesseract for OCR
try:
    import pytesseract
    from PIL import Image
    import io as io_module
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

# Known beverage flavors for OCR detection
KNOWN_FLAVORS = [
    'PEPSI', 'COLA', 'SPRITE', 'FANTA', '7UP', '7 UP', 'MIRINDA',
    'MOUNTAIN DEW', 'DEW', 'SLICE', 'MAAZA', 'FROOTI', 'APPY',
    'LIMCA', 'THUMS UP', 'THUMBS UP', 'MANGO', 'ORANGE', 'LEMON',
    'STING', 'GATORADE', 'TROPICANA', 'AQUAFINA', 'KINLEY',
    'NIMBOOZ', 'TROPICANA', 'REAL', 'PAPER BOAT', 'RAW', 'TROPICO'
]

def find_flavour(text: str) -> str:
    """Find product flavour from OCR text"""
    upper = text.upper()
    
    for f in KNOWN_FLAVORS:
        if f in upper:
            # Title case the flavor
            return ' '.join(w.capitalize() for w in f.split())
    
    # Try to find "FLAVOR" or "FLAVOUR" followed by product name
    flavor_match = re.search(r'(?:FLAVOR|FLAVOUR)\s+(\w+)', upper)
    if flavor_match:
        return flavor_match.group(1).capitalize()
    
    return ''

def find_all_dates(text: str) -> list:
    """Find all dates in various formats"""
    dates = []
    # DD/MM/YY or DD/MM/YYYY (also handles . and - separators)
    regex = r'(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})'
    for match in re.finditer(regex, text):
        raw = match.group(0)
        # Normalize date
        d, mo, y = match.groups()
        if len(y) == 2:
            y = '20' + y
        normalized = f"{d.zfill(2)}/{mo.zfill(2)}/{y}"
        dates.append({
            'raw': raw,
            'normalized': normalized,
            'index': match.start()
        })
    return dates

def find_batch(text: str) -> str:
    """Find batch number - optimized for XX-XXXX-XXXX format"""
    upper = text.upper()
    
    patterns = [
        r'(\d{2}-\d{4}-\d{4})',  # 25-8902-0014 (exact format)
        r'BATCH\s*NO\.?\s*[:\s]*([A-Z0-9\-]{6,})',
        r'B\.?\s*NO\.?\s*[:\s]*([A-Z0-9\-]{6,})',
        r'LOT\s*(?:NO\.?)?\s*[:\s]*([A-Z0-9\-]{5,})',
    ]
    
    for p in patterns:
        match = re.search(p, upper)
        if match:
            batch = match.group(1).strip()
            # Make sure it's not a date
            if not re.match(r'^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$', batch):
                return batch
    
    return ''

def parse_dates_from_context(text: str, dates: list) -> dict:
    """Parse dates based on context (MFG/EXP keywords position)"""
    upper = text.upper()
    result = {'mfg': '', 'expiry': ''}
    
    if not dates:
        return result
    
    # Find keyword positions
    mfg_keywords = ['MANUFACTURE DATE', 'MFG DATE', 'MFG DT', 'MFD', 'PACKED', 'PKD']
    exp_keywords = ['EXPIRY DATE', 'EXP DATE', 'EXP DT', 'BEST BEFORE', 'USE BY', 'BB']
    
    mfg_pos = -1
    for kw in mfg_keywords:
        pos = upper.find(kw)
        if pos != -1 and (mfg_pos == -1 or pos < mfg_pos):
            mfg_pos = pos
    
    exp_pos = -1
    for kw in exp_keywords:
        pos = upper.find(kw)
        if pos != -1 and (exp_pos == -1 or pos < exp_pos):
            exp_pos = pos
    
    # If MFG keyword found and we have at least 2 dates
    if mfg_pos != -1 and len(dates) >= 2:
        dates_after = [d for d in dates if d['index'] > mfg_pos]
        if len(dates_after) >= 2:
            result['mfg'] = dates_after[0]['normalized']
            result['expiry'] = dates_after[1]['normalized']
            return result
    
    # Fallback: use date order (first = MFG, second = EXP)
    if len(dates) >= 2:
        result['mfg'] = dates[0]['normalized']
        result['expiry'] = dates[1]['normalized']
    elif len(dates) == 1:
        if exp_pos != -1 and (mfg_pos == -1 or exp_pos < mfg_pos):
            result['expiry'] = dates[0]['normalized']
        else:
            result['mfg'] = dates[0]['normalized']
    
    return result

def parse_label_text(text: str) -> dict:
    """Parse OCR text to extract batch, expiry, MFG date, and flavour - optimized for PepsiCo labels"""
    result = {
        'batch_no': '',
        'expiry_date': '',
        'mfg_date': '',
        'flavour': '',
        'raw_text': text[:300] if text else ''
    }
    
    if not text:
        return result
    
    # Find all dates
    dates = find_all_dates(text)
    
    # Extract batch number
    result['batch_no'] = find_batch(text)
    
    # Extract dates based on context
    date_info = parse_dates_from_context(text, dates)
    result['mfg_date'] = date_info['mfg']
    result['expiry_date'] = date_info['expiry']
    
    # Extract flavour
    result['flavour'] = find_flavour(text)
    
    # Validate: swap dates if expiry < mfg
    if result['mfg_date'] and result['expiry_date']:
        try:
            mfg_parts = result['mfg_date'].split('/')
            exp_parts = result['expiry_date'].split('/')
            mfg_date = datetime(int(mfg_parts[2]), int(mfg_parts[1]), int(mfg_parts[0]))
            exp_date = datetime(int(exp_parts[2]), int(exp_parts[1]), int(exp_parts[0]))
            if exp_date < mfg_date:
                result['mfg_date'], result['expiry_date'] = result['expiry_date'], result['mfg_date']
        except:
            pass
    
    return result

@app.route('/api/ocr/scan', methods=['POST'])
@token_required
def ocr_scan():
    """OCR scan an image to extract label data"""
    if not OCR_AVAILABLE:
        raise APIError("OCR not available. Install pytesseract and pillow.", 503)
    
    if 'image' not in request.files:
        raise ValidationError("No image provided")
    
    try:
        file = request.files['image']
        img = Image.open(io_module.BytesIO(file.read()))
        
        # Run OCR
        text = pytesseract.image_to_string(img)
        result = parse_label_text(text)
        
        return jsonify({
            'success': True,
            'batch_no': result['batch_no'],
            'mfg_date': result['mfg_date'],
            'expiry_date': result['expiry_date'],
            'flavour': result['flavour'],
            'raw_text': result['raw_text']
        })
    except Exception as e:
        log(f"OCR error: {e}", "ERROR")
        return jsonify({
            'success': False,
            'error': str(e),
            'batch_no': '',
            'mfg_date': '',
            'expiry_date': '',
            'flavour': ''
        })

# ============================================================================
# ROUTES: ALERTS
# ============================================================================

@app.route('/api/alerts')
@token_required
def get_alerts():
    unread = request.args.get('unread', 'false').lower() == 'true'
    limit = min(int(request.args.get('limit', 50)), 100)
    q = "SELECT * FROM alerts WHERE is_read = 0 ORDER BY created_at DESC LIMIT ?" if unread else "SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?"
    return jsonify([dict(a) for a in db.fetchall(q, (limit,))])

@app.route('/api/alerts/<alert_id>/read', methods=['POST'])
@token_required
def mark_alert_read(alert_id):
    if db.update('alerts', {'is_read': 1}, 'id = ?', (alert_id,)) == 0: raise NotFoundError("Alert")
    return jsonify({'message': 'Alert marked as read'})

@app.route('/api/alerts/read-all', methods=['POST'])
@token_required
def mark_all_read():
    db.update('alerts', {'is_read': 1}, '1=1', ())
    return jsonify({'message': 'All alerts marked as read'})

# ============================================================================
# ROUTES: CAMERA
# ============================================================================

@app.route('/api/camera/start', methods=['POST'])
@token_required
def start_camera():
    global camera
    if camera is None:
        try:
            camera = VideoCamera(0)
            return jsonify({'status': 'started'})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    return jsonify({'status': 'already running'})

@app.route('/api/camera/stop', methods=['POST'])
@token_required
def stop_camera():
    global camera
    if camera:
        camera.stop()
        camera = None
    return jsonify({'status': 'stopped'})

@app.route('/api/camera/status')
@token_required
def camera_status():
    """Returns live session crossing counts and current line position."""
    if camera is None:
        return jsonify({'active': False, 'session_in': 0, 'session_out': 0, 'line_position': 0.45})
    return jsonify({
        'active': True,
        'session_in': camera.session_in,
        'session_out': camera.session_out,
        'line_position': camera.line_position,
    })

@app.route('/api/camera/line', methods=['PATCH'])
@token_required
def set_camera_line():
    """Update tracking line position (0.0–1.0) without restarting the camera."""
    data = request.get_json(silent=True) or {}
    pos = data.get('position')
    if pos is None or not (0.0 <= float(pos) <= 1.0):
        return jsonify({'error': 'position must be a float between 0.0 and 1.0'}), 400
    if camera is None:
        return jsonify({'error': 'Camera is not running'}), 400
    camera.line_position = float(pos)
    return jsonify({'line_position': camera.line_position})


@app.route('/api/video_feed')
def video_feed():
    """MJPEG stream with optional ?quality=low for remote/slow-connection viewers.
    normal: 1280px, Q70, 15fps  ≈ 3–8 Mbps
    low:     480px,  Q40,  6fps  ≈ 0.3–1 Mbps (works on a 1 Mbps upload)
    """
    low = request.args.get('quality') == 'low'
    fps   = 6   if low else 15
    width = 480 if low else 1280
    qual  = 40  if low else 70

    def gen():
        interval = 1.0 / fps
        while camera:
            t0 = time.time()
            frame = camera.get_frame()
            if frame is not None:
                h, w = frame.shape[:2]
                if w > width:
                    frame = cv2.resize(frame, (width, int(h * width / w)), interpolation=cv2.INTER_LINEAR)
                ok, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, qual])
                if ok:
                    yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n'
            elapsed = time.time() - t0
            rem = interval - elapsed
            if rem > 0:
                time.sleep(rem)
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/video_feed/low')
def video_feed_low():
    """Convenience alias for ?quality=low — link this in the UI for remote viewers."""
    from flask import redirect
    return redirect('/api/video_feed?quality=low')



# ============================================================================
# ROUTES: BAYS  (multi-camera loading dock management)
# ============================================================================

@app.route('/api/bays', methods=['GET'])
@token_required
def list_bays():
    bays = db.fetchall("SELECT * FROM bays ORDER BY name")
    return jsonify({'bays': bays})

@app.route('/api/bays', methods=['POST'])
@token_required
def create_bay():
    d = request.get_json(silent=True) or {}
    if not d.get('name'):
        raise ValidationError("name is required")
    bay_id = str(uuid.uuid4())
    db.insert('bays', {
        'id': bay_id,
        'name': d['name'],
        'camera_source': int(d.get('camera_source', 0)),
        'location': d.get('location', ''),
        'is_active': 1,
    })
    return jsonify({'id': bay_id, 'message': 'Bay created'}), 201

@app.route('/api/bays/<bay_id>', methods=['PATCH'])
@token_required
def update_bay(bay_id):
    d = request.get_json(silent=True) or {}
    fields = {k: v for k, v in d.items() if k in ('name', 'camera_source', 'location', 'is_active')}
    if fields:
        set_clause = ', '.join(f"{k}=?" for k in fields)
        db.execute(f"UPDATE bays SET {set_clause} WHERE id=?", (*fields.values(), bay_id))
    return jsonify({'message': 'Updated'})

@app.route('/api/bays/<bay_id>', methods=['DELETE'])
@token_required
def delete_bay(bay_id):
    db.execute("DELETE FROM bays WHERE id=?", (bay_id,))
    return jsonify({'message': 'Deleted'})

@app.route('/api/bays/<bay_id>/feed')
def bay_video_feed(bay_id):
    """MJPEG stream for a specific bay camera."""
    bay = db.fetchone("SELECT * FROM bays WHERE id=?", (bay_id,))
    if not bay:
        return jsonify({'error': 'Bay not found'}), 404
    src = bay['camera_source']
    cam = camera_manager.get_or_create(bay_id, src)

    def gen():
        interval = 1.0 / 15
        while True:
            t0 = time.time()
            buf = cam.get_encoded_frame()
            if buf:
                yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf + b'\r\n'
            elapsed = time.time() - t0
            rem = interval - elapsed
            if rem > 0:
                time.sleep(rem)
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/bays/<bay_id>/start', methods=['POST'])
@token_required
def start_bay_camera(bay_id):
    bay = db.fetchone("SELECT * FROM bays WHERE id=?", (bay_id,))
    if not bay:
        raise ValidationError("Bay not found")
    camera_manager.get_or_create(bay_id, bay['camera_source'])
    return jsonify({'status': 'started', 'bay_id': bay_id})

@app.route('/api/bays/<bay_id>/stop', methods=['POST'])
@token_required
def stop_bay_camera(bay_id):
    camera_manager.stop(bay_id)
    return jsonify({'status': 'stopped', 'bay_id': bay_id})

@app.route('/api/bays/<bay_id>/status')
@token_required
def bay_camera_status(bay_id):
    cam = camera_manager.cameras.get(bay_id)
    if cam is None:
        return jsonify({'active': False, 'session_in': 0, 'session_out': 0, 'line_position': 0.45})
    return jsonify({'active': True, 'session_in': cam.session_in, 'session_out': cam.session_out,
                    'line_position': cam.line_position})


# ============================================================================
# ROUTES: SHIFTS
# ============================================================================

@app.route('/api/shifts', methods=['GET'])
@token_required
def list_shifts():
    shifts = db.fetchall(
        "SELECT s.*, "
        "(SELECT COUNT(*) FROM detections d WHERE d.shift_id=s.id) as detection_count "
        "FROM shifts s ORDER BY s.started_at DESC LIMIT 50"
    )
    return jsonify({'shifts': shifts})

@app.route('/api/shifts/active', methods=['GET'])
@token_required
def get_active_shift():
    shift = db.fetchone("SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    return jsonify({'shift': shift})

@app.route('/api/shifts/start', methods=['POST'])
@token_required
def start_shift():
    d = request.get_json(silent=True) or {}
    # Auto-close any open shift first
    db.execute("UPDATE shifts SET ended_at=CURRENT_TIMESTAMP WHERE ended_at IS NULL")
    shift_id = str(uuid.uuid4())
    db.insert('shifts', {
        'id': shift_id,
        'name': d.get('name', f"Shift {shift_id[:6]}"),
        'operator_name': d.get('operator_name', ''),
        'notes': d.get('notes', ''),
    })
    logger.info(f"🕐 Shift started: {shift_id}")
    return jsonify({'id': shift_id, 'message': 'Shift started'}), 201

@app.route('/api/shifts/end', methods=['POST'])
@token_required
def end_shift():
    d = request.get_json(silent=True) or {}
    shift = db.fetchone("SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    if not shift:
        return jsonify({'error': 'No active shift'}), 400
    db.execute("UPDATE shifts SET ended_at=CURRENT_TIMESTAMP, notes=? WHERE id=?",
               (d.get('notes', shift.get('notes', '')), shift['id']))
    # Close any open jobs for this shift
    db.execute("UPDATE loading_jobs SET status='completed', completed_at=CURRENT_TIMESTAMP "
               "WHERE shift_id=? AND status='active'", (shift['id'],))
    logger.info(f"🕐 Shift ended: {shift['id']}")
    return jsonify({'message': 'Shift ended', 'shift_id': shift['id']})

@app.route('/api/shifts/<shift_id>', methods=['GET'])
@token_required
def get_shift(shift_id):
    shift = db.fetchone("SELECT * FROM shifts WHERE id=?", (shift_id,))
    if not shift:
        return jsonify({'error': 'Not found'}), 404
    jobs = db.fetchall("SELECT * FROM loading_jobs WHERE shift_id=?", (shift_id,))
    counts = db.fetchone(
        "SELECT SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END) as total_in, "
        "SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) as total_out "
        "FROM detections WHERE shift_id=?", (shift_id,))
    return jsonify({'shift': shift, 'jobs': jobs, 'counts': counts})


# ============================================================================
# ROUTES: LOADING JOBS
# ============================================================================

@app.route('/api/jobs', methods=['GET'])
@token_required
def list_jobs():
    status = request.args.get('status')
    if status:
        jobs = db.fetchall("SELECT * FROM loading_jobs WHERE status=? ORDER BY created_at DESC LIMIT 100", (status,))
    else:
        jobs = db.fetchall("SELECT * FROM loading_jobs ORDER BY created_at DESC LIMIT 100")
    return jsonify({'jobs': jobs})

@app.route('/api/jobs', methods=['POST'])
@token_required
def create_job():
    d = request.get_json(silent=True) or {}
    if not d.get('truck_plate') or not d.get('target_count'):
        raise ValidationError("truck_plate and target_count are required")
    # Get active shift
    shift = db.fetchone("SELECT id FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    job_id = str(uuid.uuid4())
    db.insert('loading_jobs', {
        'id': job_id,
        'bay_id': d.get('bay_id'),
        'truck_plate': d['truck_plate'].upper().strip(),
        'product_name': d.get('product_name', 'Sugar Bag'),
        'target_count': int(d['target_count']),
        'direction': d.get('direction', 'OUT'),
        'shift_id': shift['id'] if shift else None,
        'operator_name': d.get('operator_name', ''),
        'notes': d.get('notes', ''),
        'status': 'pending',
    })
    logger.info(f"📋 Loading job created: {job_id} | Truck: {d['truck_plate']} | Target: {d['target_count']}")
    return jsonify({'id': job_id, 'message': 'Job created'}), 201

@app.route('/api/jobs/<job_id>', methods=['GET'])
@token_required
def get_job(job_id):
    job = db.fetchone("SELECT * FROM loading_jobs WHERE id=?", (job_id,))
    if not job:
        return jsonify({'error': 'Not found'}), 404
    detections = db.fetchall(
        "SELECT * FROM detections WHERE job_id=? ORDER BY detected_at DESC LIMIT 50", (job_id,))
    return jsonify({'job': job, 'detections': detections})

@app.route('/api/jobs/<job_id>/start', methods=['POST'])
@token_required
def start_job(job_id):
    job = db.fetchone("SELECT * FROM loading_jobs WHERE id=?", (job_id,))
    if not job:
        return jsonify({'error': 'Not found'}), 404
    db.execute("UPDATE loading_jobs SET status='active', started_at=CURRENT_TIMESTAMP WHERE id=?", (job_id,))
    # Attach job to bay camera if bay is set
    if job['bay_id']:
        cam = camera_manager.cameras.get(job['bay_id'])
        if cam:
            cam.active_job_id = job_id
    logger.info(f"▶️  Job started: {job_id}")
    return jsonify({'message': 'Job started'})

@app.route('/api/jobs/<job_id>/complete', methods=['PATCH'])
@token_required
def complete_job(job_id):
    job = db.fetchone("SELECT * FROM loading_jobs WHERE id=?", (job_id,))
    if not job:
        return jsonify({'error': 'Not found'}), 404
    db.execute("UPDATE loading_jobs SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=?", (job_id,))
    if job['bay_id']:
        cam = camera_manager.cameras.get(job['bay_id'])
        if cam and getattr(cam, 'active_job_id', None) == job_id:
            cam.active_job_id = None
    create_alert('job_completed', f"Job completed: Truck {job['truck_plate']} — {job['loaded_count']}/{job['target_count']} bags", 'info')
    logger.info(f"✅ Job completed: {job_id}")
    return jsonify({'message': 'Job completed'})

@app.route('/api/jobs/<job_id>/cancel', methods=['PATCH'])
@token_required
def cancel_job(job_id):
    db.execute("UPDATE loading_jobs SET status='cancelled' WHERE id=?", (job_id,))
    return jsonify({'message': 'Job cancelled'})


def _increment_job_count(job_id: str, direction: str):
    """Called from camera tracking when a bag crosses the line with an active job."""
    if not job_id:
        return
    job = db.fetchone("SELECT * FROM loading_jobs WHERE id=? AND status='active'", (job_id,))
    if not job:
        return
    new_count = job['loaded_count'] + 1
    db.execute("UPDATE loading_jobs SET loaded_count=? WHERE id=?", (new_count, job_id))
    target = job['target_count']
    if new_count >= target:
        db.execute("UPDATE loading_jobs SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=?", (job_id,))
        create_alert('job_complete', f"✅ Truck {job['truck_plate']}: {new_count}/{target} bags loaded — COMPLETE", 'success')
        logger.info(f"🎯 Job {job_id} reached target ({new_count}/{target})")
    elif new_count == target - 10:
        create_alert('job_near_complete', f"⚠️ Truck {job['truck_plate']}: {new_count}/{target} bags — 10 remaining", 'warning')


# ============================================================================
# ROUTES: REPORTS  (PDF + Excel)
# ============================================================================

def _build_daily_data(date_str: str) -> dict:
    """Collect all data for a given date (YYYY-MM-DD) to use in reports."""
    detections = db.fetchall(
        "SELECT * FROM detections WHERE DATE(detected_at)=? ORDER BY detected_at", (date_str,))
    jobs = db.fetchall(
        "SELECT * FROM loading_jobs WHERE DATE(created_at)=? ORDER BY created_at", (date_str,))
    shifts = db.fetchall(
        "SELECT * FROM shifts WHERE DATE(started_at)=? ORDER BY started_at", (date_str,))
    totals = db.fetchone(
        "SELECT SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END) as total_in, "
        "SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) as total_out, "
        "COUNT(*) as total FROM detections WHERE DATE(detected_at)=?", (date_str,))
    return {'date': date_str, 'detections': detections, 'jobs': jobs,
            'shifts': shifts, 'totals': totals or {}}

@app.route('/api/reports/daily')
@token_required
def daily_report_json():
    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    return jsonify(_build_daily_data(date_str))

@app.route('/api/reports/pdf')
@token_required
def daily_report_pdf():
    """Generate and stream a PDF daily report."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet
    except ImportError:
        return jsonify({'error': 'reportlab not installed'}), 500

    import io
    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    data = _build_daily_data(date_str)
    totals = data['totals']

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm,
                            topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    story = []

    # Title
    story.append(Paragraph(f"<b>AI CCTV Daily Report</b>", styles['Title']))
    story.append(Paragraph(f"Date: {date_str}", styles['Normal']))
    story.append(Spacer(1, 0.5*cm))

    # Summary box
    summary = [
        ['Metric', 'Value'],
        ['Total Detections', str(totals.get('total', 0))],
        ['Bags IN', str(totals.get('total_in', 0))],
        ['Bags OUT', str(totals.get('total_out', 0))],
        ['Loading Jobs', str(len(data['jobs']))],
        ['Shifts', str(len(data['shifts']))],
    ]
    t = Table(summary, colWidths=[8*cm, 6*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#7c3aed')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8f7ff')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f0ff')]),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.5*cm))

    # Loading Jobs table
    if data['jobs']:
        story.append(Paragraph('<b>Loading Jobs</b>', styles['Heading2']))
        job_rows = [['Truck', 'Product', 'Target', 'Loaded', 'Status', 'Operator']]
        for j in data['jobs']:
            job_rows.append([j['truck_plate'], j['product_name'], str(j['target_count']),
                             str(j['loaded_count']), j['status'], j.get('operator_name', '—')])
        jt = Table(job_rows, colWidths=[3*cm, 3*cm, 2.5*cm, 2.5*cm, 2.5*cm, 3*cm])
        jt.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e1b4b')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.4, colors.lightgrey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f0ff')]),
        ]))
        story.append(jt)
        story.append(Spacer(1, 0.5*cm))

    # Shifts table
    if data['shifts']:
        story.append(Paragraph('<b>Shifts</b>', styles['Heading2']))
        shift_rows = [['Name', 'Operator', 'Started', 'Ended']]
        for s in data['shifts']:
            shift_rows.append([s['name'], s.get('operator_name', '—'),
                               str(s['started_at'])[:16], str(s.get('ended_at', 'Active'))[:16]])
        st = Table(shift_rows, colWidths=[4*cm, 4*cm, 5*cm, 4*cm])
        st.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e1b4b')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.4, colors.lightgrey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f0ff')]),
        ]))
        story.append(st)

    doc.build(story)
    buf.seek(0)
    return Response(buf.read(), mimetype='application/pdf',
                    headers={'Content-Disposition': f'attachment; filename="report_{date_str}.pdf"'})

@app.route('/api/reports/excel')
@token_required
def daily_report_excel():
    """Generate and stream an Excel daily report."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        return jsonify({'error': 'openpyxl not installed'}), 500

    import io
    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    data = _build_daily_data(date_str)

    wb = openpyxl.Workbook()
    # ── Summary sheet ──
    ws = wb.active
    ws.title = 'Summary'
    hdr_fill = PatternFill('solid', fgColor='7C3AED')
    hdr_font = Font(color='FFFFFF', bold=True)
    ws.append(['AI CCTV Daily Report', date_str])
    ws['A1'].font = Font(bold=True, size=14)
    ws.append([])
    ws.append(['Metric', 'Value'])
    for cell in ws[3]: cell.fill = hdr_fill; cell.font = hdr_font
    totals = data['totals']
    for row in [['Total Detections', totals.get('total', 0)],
                ['Bags IN', totals.get('total_in', 0)],
                ['Bags OUT', totals.get('total_out', 0)],
                ['Loading Jobs', len(data['jobs'])],
                ['Shifts', len(data['shifts'])]]:
        ws.append(row)
    ws.column_dimensions['A'].width = 20
    ws.column_dimensions['B'].width = 15

    # ── Jobs sheet ──
    ws2 = wb.create_sheet('Loading Jobs')
    headers = ['Truck Plate', 'Product', 'Target', 'Loaded', 'Status', 'Operator', 'Bay', 'Started', 'Completed']
    ws2.append(headers)
    for cell in ws2[1]: cell.fill = hdr_fill; cell.font = hdr_font
    for j in data['jobs']:
        ws2.append([j['truck_plate'], j['product_name'], j['target_count'], j['loaded_count'],
                    j['status'], j.get('operator_name', ''), j.get('bay_id', ''),
                    str(j.get('started_at', '')), str(j.get('completed_at', ''))])
    for col in ws2.columns:
        ws2.column_dimensions[col[0].column_letter].width = 16

    # ── Shifts sheet ──
    ws3 = wb.create_sheet('Shifts')
    ws3.append(['Name', 'Operator', 'Started', 'Ended', 'Notes'])
    for cell in ws3[1]: cell.fill = hdr_fill; cell.font = hdr_font
    for s in data['shifts']:
        ws3.append([s['name'], s.get('operator_name', ''), str(s['started_at']),
                    str(s.get('ended_at', 'Active')), s.get('notes', '')])
    for col in ws3.columns:
        ws3.column_dimensions[col[0].column_letter].width = 20

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(buf.read(),
                    mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': f'attachment; filename="report_{date_str}.xlsx"'})


# ============================================================================
# ROUTES: COMPRESSION
# ============================================================================

@app.route('/api/compression/upload', methods=['POST'])
@token_required
def compress_upload():
    if 'file' not in request.files: raise ValidationError("No file")
    f = request.files['file']
    jid = str(uuid.uuid4())[:8]
    inp = Config.UPLOAD_DIR / f"{jid}_in{Path(f.filename).suffix}"
    out = Config.UPLOAD_DIR / f"{jid}_out.mp4"
    f.save(inp)
    
    job = CompressionJob(jid, inp, out, original_size=inp.stat().st_size)
    compression_jobs[jid] = job
    
    def compress():
        try:
            subprocess.run(['ffmpeg', '-y', '-i', str(inp), '-c:v', 'libx264', '-crf', '28', str(out)], capture_output=True, timeout=Config.COMPRESSION_TIMEOUT)
            if out.exists():
                job.status = JobStatus.COMPLETED
                job.compressed_size = out.stat().st_size
            else: job.status = JobStatus.FAILED
        except Exception as e:
            job.status = JobStatus.FAILED
            job.error = str(e)
    
    threading.Thread(target=compress, daemon=True).start()
    return jsonify({'job_id': jid, 'status': 'processing'}), 202

@app.route('/api/compression/status/<jid>')
@token_required
def compression_status(jid):
    job = compression_jobs.get(jid)
    if not job: raise NotFoundError("Job")
    return jsonify(job.to_dict())

@app.route('/api/compression/download/<jid>')
def compression_download(jid):
    job = compression_jobs.get(jid)
    if not job or job.status != JobStatus.COMPLETED: raise NotFoundError("File")
    return send_file(job.output_path, as_attachment=True)

# ============================================================================
# VIDEO PROCESSING - DATA STRUCTURES
# ============================================================================

from collections import deque
from typing import Set

@dataclass
class VideoJob:
    id: str
    status: str  # queued, processing, completed, failed, cancelled
    progress: int
    frames_total: int
    frames_processed: int
    offloaded_count: int
    loaded_count: int = 0
    detections_total: int = 0
    error: Optional[str] = None
    input_path: Optional[Path] = None
    output_path: Optional[Path] = None
    created_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    config: dict = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            'job_id': self.id,
            'status': self.status,
            'progress': self.progress,
            'frames_total': self.frames_total,
            'frames_processed': self.frames_processed,
            'offloaded_count': self.offloaded_count,
            'loaded_count': self.loaded_count,
            'detections_total': self.detections_total,
            'error': self.error,
            'has_output_video': self.output_path is not None and self.output_path.exists() if self.output_path else False,
            'config': self.config
        }

video_processing_jobs: Dict[str, VideoJob] = {}
video_processing_lock = threading.Lock()

def cleanup_old_video_jobs(max_age_hours: int = 6):
    """Clean up old video processing jobs"""
    cutoff = datetime.now() - timedelta(hours=max_age_hours)
    with video_processing_lock:
        to_delete = [jid for jid, job in video_processing_jobs.items() 
                     if job.created_at < cutoff]
        for jid in to_delete:
            job = video_processing_jobs[jid]
            if job.input_path and job.input_path.exists():
                try: job.input_path.unlink()
                except: pass
            if job.output_path and job.output_path.exists():
                try: job.output_path.unlink()
                except: pass
            del video_processing_jobs[jid]

def cleanup_old_compression_jobs(max_age_hours: int = 6):
    """Clean up completed/failed compression jobs to prevent unbounded dict growth."""
    cutoff = datetime.now() - timedelta(hours=max_age_hours)
    stale = [jid for jid, job in list(compression_jobs.items())
             if job.status in (JobStatus.COMPLETED, JobStatus.FAILED)]
    for jid in stale:
        job = compression_jobs[jid]
        for path in (job.input_path, job.output_path):
            if path and path.exists():
                try: path.unlink()
                except: pass
        del compression_jobs[jid]

def save_video_detection(det_type: str, conf: float, direction: str, count: int = 1):
    """Batch-insert video detections in a single transaction."""
    if count <= 0:
        return
    rows = [{'id': str(uuid.uuid4()), 'type': det_type, 'confidence': conf,
             'direction': direction, 'inference_ms': 0}
            for _ in range(count)]
    try:
        with db.get_cursor() as cursor:
            cursor.executemany(
                "INSERT INTO detections (id, type, confidence, direction, inference_ms) "
                "VALUES (:id, :type, :confidence, :direction, :inference_ms)",
                rows
            )
    except Exception as e:
        logger.error(f"Failed to batch-save video detections: {e}")

# ============================================================================
# SIMPLE TRACKER (for version_5)
# ============================================================================

class SimpleCentroidTracker:
    """Simple centroid tracker for basic left→right counting"""
    
    def __init__(self, max_disappeared: int = 30):
        self.next_id = 0
        self.objects: Dict[int, Tuple[float, float]] = {}
        self.disappeared: Dict[int, int] = {}
        self.max_disappeared = max_disappeared
        self.crossed: set = set()
    
    def register(self, centroid: Tuple[float, float]) -> int:
        self.objects[self.next_id] = centroid
        self.disappeared[self.next_id] = 0
        self.next_id += 1
        return self.next_id - 1
    
    def deregister(self, object_id: int):
        del self.objects[object_id]
        del self.disappeared[object_id]
    
    def update(self, detections: List[Tuple[float, float]]) -> Dict[int, Tuple[float, float]]:
        if len(detections) == 0:
            for oid in list(self.disappeared.keys()):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    self.deregister(oid)
            return self.objects
        
        if len(self.objects) == 0:
            for det in detections:
                self.register(det)
        else:
            object_ids = list(self.objects.keys())
            object_centroids = list(self.objects.values())
            used_detections = set()
            
            for i, oid in enumerate(object_ids):
                ox, oy = object_centroids[i]
                min_dist = float('inf')
                best_det_idx = -1
                
                for j, (dx, dy) in enumerate(detections):
                    if j in used_detections:
                        continue
                    dist = ((ox - dx) ** 2 + (oy - dy) ** 2) ** 0.5
                    if dist < min_dist and dist < 100:
                        min_dist = dist
                        best_det_idx = j
                
                if best_det_idx != -1:
                    self.objects[oid] = detections[best_det_idx]
                    self.disappeared[oid] = 0
                    used_detections.add(best_det_idx)
                else:
                    self.disappeared[oid] += 1
                    if self.disappeared[oid] > self.max_disappeared:
                        self.deregister(oid)
            
            for j, det in enumerate(detections):
                if j not in used_detections:
                    self.register(det)
        
        return self.objects

# ============================================================================
# OPTIMIZED TRACKER (for version_2)
# ============================================================================

@dataclass
class CountingConfig:
    confidence_threshold: float = 0.4
    nms_threshold: float = 0.3
    min_box_area_ratio: float = 0.005
    max_box_area_ratio: float = 0.25
    min_aspect_ratio: float = 0.3
    max_aspect_ratio: float = 3.0
    max_disappeared_frames: int = 20
    max_distance_ratio: float = 0.12
    min_track_frames: int = 3
    line_position: float = 0.45  # 45% from left
    count_zone_width: float = 0.15
    require_direction_frames: int = 5
    min_travel_distance: float = 0.1
    cooldown_frames: int = 15
    roi_x1: float = 0.0
    roi_x2: float = 1.0
    roi_y1: float = 0.0
    roi_y2: float = 1.0

@dataclass
class TrackedObject:
    id: int
    label: str
    confidence: float
    bbox: List[int]
    centroid: Tuple[float, float]
    position_history: deque = field(default_factory=lambda: deque(maxlen=30))
    confidence_history: deque = field(default_factory=lambda: deque(maxlen=10))
    frames_tracked: int = 0
    frames_disappeared: int = 0
    first_seen_frame: int = 0
    last_seen_frame: int = 0
    has_crossed: bool = False
    cross_direction: Optional[str] = None
    cross_frame: Optional[int] = None
    entry_position: Optional[float] = None
    
    def add_position(self, cx: float, cy: float, frame_num: int):
        self.position_history.append((cx, cy, frame_num))
        self.last_seen_frame = frame_num
        self.frames_tracked += 1
        self.frames_disappeared = 0
    
    def add_confidence(self, conf: float):
        self.confidence_history.append(conf)
    
    def get_average_confidence(self) -> float:
        if not self.confidence_history: return self.confidence
        return sum(self.confidence_history) / len(self.confidence_history)
    
    def get_velocity(self) -> Tuple[float, float]:
        if len(self.position_history) < 2: return (0.0, 0.0)
        recent = list(self.position_history)[-5:]
        if len(recent) < 2: return (0.0, 0.0)
        dx = recent[-1][0] - recent[0][0]
        dy = recent[-1][1] - recent[0][1]
        frames = recent[-1][2] - recent[0][2]
        if frames == 0: return (0.0, 0.0)
        return (dx / frames, dy / frames)
    
    def get_travel_distance(self) -> float:
        if not self.position_history or self.entry_position is None: return 0.0
        return abs(self.position_history[-1][0] - self.entry_position)
    
    def is_moving_consistently(self, required_frames: int = 5) -> bool:
        if len(self.position_history) < required_frames: return False
        recent = list(self.position_history)[-required_frames:]
        directions = []
        for i in range(1, len(recent)):
            dx = recent[i][0] - recent[i-1][0]
            if abs(dx) > 0.005:
                directions.append('right' if dx > 0 else 'left')
        if not directions: return False
        return len(set(directions)) == 1

class EnhancedTracker:
    def __init__(self, config: CountingConfig):
        self.config = config
        self.next_id = 0
        self.objects: Dict[int, TrackedObject] = {}
        self.frame_count = 0
        self.counted_ids: Set[int] = set()
        self.count_cooldowns: Dict[int, int] = {}
        self.total_in = 0
        self.total_out = 0
        self.rejected_detections = 0
    
    def _filter_detection(self, bbox: List[int], frame_width: int, frame_height: int) -> bool:
        x1, y1, x2, y2 = bbox
        width = x2 - x1
        height = y2 - y1
        if width <= 0 or height <= 0: return False
        frame_area = frame_width * frame_height
        box_area = width * height
        area_ratio = box_area / frame_area
        if area_ratio < self.config.min_box_area_ratio: return False
        if area_ratio > self.config.max_box_area_ratio: return False
        aspect_ratio = width / height
        if aspect_ratio < self.config.min_aspect_ratio: return False
        if aspect_ratio > self.config.max_aspect_ratio: return False
        cx = (x1 + x2) / 2 / frame_width
        cy = (y1 + y2) / 2 / frame_height
        if not (self.config.roi_x1 <= cx <= self.config.roi_x2): return False
        if not (self.config.roi_y1 <= cy <= self.config.roi_y2): return False
        return True
    
    def _calculate_iou(self, box1: List[int], box2: List[int]) -> float:
        x1 = max(box1[0], box2[0])
        y1 = max(box1[1], box2[1])
        x2 = min(box1[2], box2[2])
        y2 = min(box1[3], box2[3])
        intersection = max(0, x2 - x1) * max(0, y2 - y1)
        area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
        area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
        union = area1 + area2 - intersection
        return intersection / union if union > 0 else 0
    
    def _apply_nms(self, detections: List[Dict], threshold: float) -> List[Dict]:
        if len(detections) == 0: return []
        detections = sorted(detections, key=lambda x: x['confidence'], reverse=True)
        kept = []
        for det in detections:
            dominated = False
            for kept_det in kept:
                if self._calculate_iou(det['bbox'], kept_det['bbox']) > threshold:
                    dominated = True
                    break
            if not dominated: kept.append(det)
        return kept
    
    def update(self, raw_detections: List[Dict], frame_width: int, frame_height: int) -> Dict[int, TrackedObject]:
        self.frame_count += 1
        valid_detections = []
        for det in raw_detections:
            if self._filter_detection(det['bbox'], frame_width, frame_height):
                x1, y1, x2, y2 = det['bbox']
                cx = ((x1 + x2) / 2) / frame_width
                cy = ((y1 + y2) / 2) / frame_height
                valid_detections.append({**det, 'cx': cx, 'cy': cy})
            else:
                self.rejected_detections += 1
        valid_detections = self._apply_nms(valid_detections, self.config.nms_threshold)
        
        if len(valid_detections) == 0:
            for oid in list(self.objects.keys()):
                self.objects[oid].frames_disappeared += 1
                if self.objects[oid].frames_disappeared > self.config.max_disappeared_frames:
                    del self.objects[oid]
            return self.objects
        
        if len(self.objects) == 0:
            for det in valid_detections:
                self._register_object(det)
            return self.objects
        
        object_ids = list(self.objects.keys())
        used_detections = set()
        matched_objects = set()
        matches = []
        
        for oid in object_ids:
            obj = self.objects[oid]
            vx, vy = obj.get_velocity()
            pred_cx, pred_cy = obj.centroid[0] + vx, obj.centroid[1] + vy
            for j, det in enumerate(valid_detections):
                dist = ((pred_cx - det['cx']) ** 2 + (pred_cy - det['cy']) ** 2) ** 0.5
                if dist < self.config.max_distance_ratio:
                    matches.append((dist, oid, j))
        
        matches.sort(key=lambda x: x[0])
        for dist, oid, det_idx in matches:
            if oid in matched_objects or det_idx in used_detections: continue
            det = valid_detections[det_idx]
            self._update_object(oid, det)
            matched_objects.add(oid)
            used_detections.add(det_idx)
        
        for oid in object_ids:
            if oid not in matched_objects:
                self.objects[oid].frames_disappeared += 1
                if self.objects[oid].frames_disappeared > self.config.max_disappeared_frames:
                    del self.objects[oid]
        
        for j, det in enumerate(valid_detections):
            if j not in used_detections:
                self._register_object(det)
        
        return self.objects
    
    def _register_object(self, det: Dict) -> int:
        obj = TrackedObject(
            id=self.next_id, label=det.get('label', 'sugar_bag'), confidence=det.get('confidence', 0.0),
            bbox=det['bbox'], centroid=(det['cx'], det['cy']),
            first_seen_frame=self.frame_count, last_seen_frame=self.frame_count, entry_position=det['cx']
        )
        obj.add_position(det['cx'], det['cy'], self.frame_count)
        obj.add_confidence(det.get('confidence', 0.0))
        self.objects[self.next_id] = obj
        self.next_id += 1
        return self.next_id - 1
    
    def _update_object(self, oid: int, det: Dict):
        obj = self.objects[oid]
        obj.bbox = det['bbox']
        obj.centroid = (det['cx'], det['cy'])
        obj.confidence = det.get('confidence', 0.0)
        obj.add_position(det['cx'], det['cy'], self.frame_count)
        obj.add_confidence(det.get('confidence', 0.0))
    
    def check_line_crossing(self, obj: TrackedObject) -> Optional[str]:
        if obj.has_crossed: return None
        if obj.id in self.count_cooldowns and self.frame_count < self.count_cooldowns[obj.id]: return None
        if obj.frames_tracked < self.config.min_track_frames: return None
        if len(obj.position_history) < self.config.require_direction_frames: return None
        
        positions = list(obj.position_history)
        current_x = positions[-1][0]
        line = self.config.line_position
        zone_half = self.config.count_zone_width / 2
        in_zone = (line - zone_half) <= current_x <= (line + zone_half)
        if not in_zone: return None
        
        prev_positions = positions[:-1]
        was_left = any(p[0] < line - zone_half for p in prev_positions[-5:])
        was_right = any(p[0] > line + zone_half for p in prev_positions[-5:])
        if not (was_left or was_right): return None
        
        if was_left and current_x >= line: direction = 'OUT'
        elif was_right and current_x <= line: direction = 'IN'
        else: return None
        
        if not obj.is_moving_consistently(self.config.require_direction_frames): return None
        if obj.get_travel_distance() < self.config.min_travel_distance: return None
        if obj.get_average_confidence() < self.config.confidence_threshold: return None
        
        obj.has_crossed = True
        obj.cross_direction = direction
        obj.cross_frame = self.frame_count
        self.counted_ids.add(obj.id)
        self.count_cooldowns[obj.id] = self.frame_count + self.config.cooldown_frames
        
        if direction == 'OUT': self.total_out += 1
        else: self.total_in += 1
        
        return direction
    
    def get_counts(self) -> Dict:
        return {'offloaded': self.total_out, 'loaded': self.total_in, 'currently_tracking': len(self.objects), 'total_counted': len(self.counted_ids), 'rejected_detections': self.rejected_detections, 'frame_count': self.frame_count}

# ============================================================================
# ROUTES: VIDEO PROCESSING (SIMPLE - for version_5)
# ============================================================================

@app.route('/api/video/process', methods=['POST'])
@token_required
def process_video_simple():
    """Simple video processing with basic left→right counting (for version_5)"""
    cleanup_old_video_jobs(max_age_hours=6)
    
    if 'file' not in request.files: raise ValidationError("No video file provided")
    video_file = request.files['file']
    if not video_file.filename: raise ValidationError("No filename")
    
    job_id = str(uuid.uuid4())[:8]
    input_path = Config.UPLOAD_DIR / f"{job_id}_input{Path(video_file.filename).suffix}"
    video_file.save(input_path)
    
    confidence = float(request.form.get('confidence', 0.5))
    process_fps = int(request.form.get('fps', 5))
    line_position = float(request.form.get('line_position', 0.45))
    
    job = VideoJob(id=job_id, status='processing', progress=0, frames_total=0, frames_processed=0, offloaded_count=0, input_path=input_path)
    job.config = {'confidence': confidence, 'fps': process_fps, 'line_position': line_position, 'tracker': 'simple'}
    
    with video_processing_lock:
        video_processing_jobs[job_id] = job
    
    def process():
        tracker = SimpleCentroidTracker(max_disappeared=15)
        offloaded = 0
        previous_positions: Dict[int, float] = {}
        
        try:
            cap = cv2.VideoCapture(str(input_path))
            if not cap.isOpened():
                job.status = 'failed'
                job.error = 'Could not open video'
                return
            
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            video_fps = cap.get(cv2.CAP_PROP_FPS) or 30
            frame_skip = max(1, int(video_fps / process_fps))
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            
            job.frames_total = total_frames // frame_skip
            frame_idx = 0
            processed = 0
            
            while True:
                ret, frame = cap.read()
                if not ret: break
                frame_idx += 1
                if frame_idx % frame_skip != 0: continue
                
                processed += 1
                job.frames_processed = processed
                job.progress = int((processed / max(1, job.frames_total)) * 100)
                
                _, detections = ml_service.detect(frame, confidence=confidence, draw=False)
                job.detections_total += len(detections)
                
                centroids = []
                for det in detections:
                    x1, y1, x2, y2 = det.bbox
                    cx = (x1 + x2) / 2
                    cy = (y1 + y2) / 2
                    centroids.append((cx, cy))
                
                tracked_objects = tracker.update(centroids)
                line_x = frame_width * line_position
                
                for oid, (cx, cy) in tracked_objects.items():
                    norm_x = cx / frame_width
                    if oid in previous_positions:
                        prev_x = previous_positions[oid]
                        if prev_x < line_position and norm_x >= line_position:
                            if oid not in tracker.crossed:
                                tracker.crossed.add(oid)
                                offloaded += 1
                                job.offloaded_count = offloaded
                                logger.info(f"🎒 [Simple] Bag {oid} offloaded! Total: {offloaded}")
                    previous_positions[oid] = norm_x
            
            cap.release()
            job.status = 'completed'
            job.progress = 100
            
            if offloaded > 0:
                save_video_detection('sugar_bag', 1.0, 'OUT', offloaded)
                update_inventory_from_detection('Sugar Bag', 'OUT', offloaded)
            
            logger.info(f"✅ [Simple] Video processed: {offloaded} bags from {processed} frames")
            if input_path.exists(): input_path.unlink()
            
        except Exception as e:
            job.status = 'failed'
            job.error = str(e)
            logger.error(f"❌ [Simple] Video processing failed: {e}")
    
    threading.Thread(target=process, daemon=True).start()
    return jsonify({'job_id': job_id, 'status': 'processing', 'message': 'Simple processing started', 'config': job.config}), 202

# ============================================================================
# ROUTES: VIDEO PROCESSING (OPTIMIZED - for version_2)
# ============================================================================

@app.route('/api/video/process_optimized', methods=['POST'])
@token_required
def process_video_optimized():
    """Optimized video processing with enhanced tracking (for version_2)"""
    cleanup_old_video_jobs(max_age_hours=6)
    
    if 'file' not in request.files: raise ValidationError("No video file provided")
    video_file = request.files['file']
    if not video_file.filename: raise ValidationError("No filename")
    
    job_id = str(uuid.uuid4())[:8]
    file_ext = Path(video_file.filename).suffix.lower()
    input_path = Config.UPLOAD_DIR / f"{job_id}_input{file_ext}"
    output_path = Config.UPLOAD_DIR / f"{job_id}_output.mp4"
    video_file.save(input_path)
    
    config = CountingConfig()
    config.confidence_threshold = float(request.form.get('confidence', 0.4))
    config.line_position = float(request.form.get('line_position', 0.45))
    config.min_track_frames = int(request.form.get('min_track_frames', 3))
    config.min_travel_distance = float(request.form.get('min_travel', 0.1))
    config.count_zone_width = float(request.form.get('zone_width', 0.15))
    
    roi_str = request.form.get('roi', '')
    if roi_str:
        try:
            x1, y1, x2, y2 = map(float, roi_str.split(','))
            config.roi_x1, config.roi_y1 = max(0, x1), max(0, y1)
            config.roi_x2, config.roi_y2 = min(1, x2), min(1, y2)
        except: pass
    
    process_fps = int(request.form.get('fps', 10))
    direction_mode = request.form.get('direction', 'left_to_right')
    save_video = request.form.get('save_video', 'true').lower() == 'true'
    
    job = VideoJob(id=job_id, status='processing', progress=0, frames_total=0, frames_processed=0, offloaded_count=0, input_path=input_path, output_path=output_path if save_video else None)
    job.config = {'confidence': config.confidence_threshold, 'fps': process_fps, 'line_position': config.line_position, 'direction': direction_mode, 'tracker': 'optimized'}
    
    with video_processing_lock:
        video_processing_jobs[job_id] = job
    
    def process():
        tracker = EnhancedTracker(config)
        cap = None
        writer = None
        
        try:
            cap = cv2.VideoCapture(str(input_path))
            if not cap.isOpened():
                job.status = 'failed'
                job.error = 'Could not open video'
                return
            
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            video_fps = cap.get(cv2.CAP_PROP_FPS) or 30
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            frame_skip = max(1, int(video_fps / process_fps))
            job.frames_total = max(1, total_frames // frame_skip)
            
            if save_video:
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                writer = cv2.VideoWriter(str(output_path), fourcc, process_fps, (frame_width, frame_height))
            
            frame_idx = 0
            processed = 0
            
            while True:
                ret, frame = cap.read()
                if not ret: break
                frame_idx += 1
                if frame_idx % frame_skip != 0: continue
                
                processed += 1
                job.frames_processed = processed
                job.progress = min(99, int((processed / job.frames_total) * 100))
                
                _, detections = ml_service.detect(frame, confidence=config.confidence_threshold * 0.8, draw=False)
                job.detections_total += len(detections)
                
                det_list = [{'bbox': d.bbox, 'label': d.label, 'confidence': d.confidence} for d in detections]
                tracked = tracker.update(det_list, frame_width, frame_height)
                
                for oid, obj in tracked.items():
                    cross_dir = tracker.check_line_crossing(obj)
                    if cross_dir:
                        should_count = (direction_mode == 'both' or (direction_mode == 'left_to_right' and cross_dir == 'OUT') or (direction_mode == 'right_to_left' and cross_dir == 'IN'))
                        if should_count:
                            if cross_dir == 'OUT':
                                job.offloaded_count = tracker.total_out
                                logger.info(f"📤 [Optimized] Bag OFFLOADED! Total: {tracker.total_out}")
                            else:
                                job.loaded_count = tracker.total_in
                
                if writer:
                    # Draw bounding boxes and line
                    line_x = int(frame_width * config.line_position)
                    cv2.line(frame, (line_x, 0), (line_x, frame_height), (0, 0, 255), 2)
                    for oid, obj in tracked.items():
                        x1, y1, x2, y2 = obj.bbox
                        color = (0, 255, 0) if not obj.has_crossed else (0, 165, 255)
                        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                        cv2.putText(frame, f"ID:{oid}", (x1, y1-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                    cv2.putText(frame, f"OFFLOADED: {tracker.total_out}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                    writer.write(frame)
            
            cap.release()
            if writer: writer.release()
            
            job.status = 'completed'
            job.progress = 100
            counts = tracker.get_counts()
            job.offloaded_count = counts['offloaded']
            job.loaded_count = counts['loaded']
            
            if job.offloaded_count > 0:
                save_video_detection('sugar_bag', 1.0, 'OUT', job.offloaded_count)
                update_inventory_from_detection('Sugar Bag', 'OUT', job.offloaded_count)
            
            logger.info(f"✅ [Optimized] Complete: OUT={job.offloaded_count}, rejected={counts['rejected_detections']}")
            if input_path.exists(): input_path.unlink()
            
        except Exception as e:
            job.status = 'failed'
            job.error = str(e)
            logger.error(f"❌ [Optimized] Failed: {e}")
            if cap: cap.release()
            if writer: writer.release()
    
    threading.Thread(target=process, daemon=True).start()
    return jsonify({'job_id': job_id, 'status': 'processing', 'message': 'Optimized processing started', 'config': job.config}), 202

# ============================================================================
# ROUTES: VIDEO STATUS & DOWNLOAD
# ============================================================================

@app.route('/api/video/status/<job_id>')
@token_required
def video_status(job_id):
    job = video_processing_jobs.get(job_id)
    if not job: raise NotFoundError("Job")
    return jsonify(job.to_dict())

@app.route('/api/video/download/<job_id>')
def video_download(job_id):
    job = video_processing_jobs.get(job_id)
    if not job or job.status != 'completed' or not job.output_path or not job.output_path.exists():
        raise NotFoundError("Video")
    return send_file(job.output_path, as_attachment=True, download_name=f'detected_{job_id}.mp4')

@app.route('/api/video/cancel/<job_id>', methods=['POST'])
@token_required
def video_cancel(job_id):
    job = video_processing_jobs.get(job_id)
    if not job: raise NotFoundError("Job")
    job.status = 'cancelled'
    return jsonify({'message': 'Job cancelled'})

# ============================================================================
# ROUTES: ADMIN
# ============================================================================

@app.route('/api/reset', methods=['POST'])
@admin_required
def reset_data():
    db.delete('detections')
    db.update('inventory', {'count_in': 0, 'count_out': 0, 'current_stock': 0}, '1=1', ())
    db.delete('alerts')
    return jsonify({'status': 'reset'})

# ============================================================================
# STATIC FRONTEND SERVING
# Serves the built React app so the entire stack runs on one port.
# API routes registered above take priority; everything else goes to index.html
# for React Router's client-side navigation.
# ============================================================================

@app.route('/assets/<path:filename>')
def serve_assets(filename):
    """Serve Vite-built JS/CSS/image assets."""
    assets_dir = FRONTEND_DIST / 'assets'
    if assets_dir.exists():
        return send_from_directory(assets_dir, filename)
    return jsonify({'error': 'Frontend not built. Run: npm run build'}), 404

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """Catch-all: serve React index.html for any non-API path (SPA routing)."""
    if FRONTEND_DIST.exists():
        file = FRONTEND_DIST / path
        if path and file.exists() and file.is_file():
            return send_from_directory(FRONTEND_DIST, path)
        return send_from_directory(FRONTEND_DIST, 'index.html')
    # Frontend not built yet — show helpful message
    return (
        '<h2>Frontend not built</h2>'
        '<p>Run: <code>cd frontends/version_5 && npm run build</code></p>'
        '<p>Then restart the backend.</p>'
    ), 200


# ============================================================================
# STARTUP
# ============================================================================

@app.route('/api/video/eval_all', methods=['POST'])
def eval_all_models():
    """Single endpoint to evaluate uploaded video across all models with old & new methods."""
    if 'file' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    video_file = request.files['file']
    line_pos = float(request.form.get('line_position', 0.5))
    conf = float(request.form.get('confidence', 0.4))
    sample_fps = int(request.form.get('fps', 10))

    temp_id = str(uuid.uuid4())[:8]
    temp_path = Config.UPLOAD_DIR / f"eval_{temp_id}.mp4"
    video_file.save(temp_path)

    model_files = [
        ('best', 'best.pt'),
        ('best_dec20', 'best_dec20.pt'),
        ('sugar_bag_final', 'sugar_bag_final.pt'),
        ('sugar_bag_finetuned', 'sugar_bag_finetuned.pt'),
        ('sugar_bag_improved', 'sugar_bag_improved.pt'),
    ]

    results = []

    try:
        from ultralytics import YOLO
        import cv2

        for name, fname in model_files:
            mpath = Config.MODEL_DIR / fname
            if not mpath.exists():
                continue

            try:
                model = YOLO(str(mpath))
            except Exception as e:
                continue

            # OLD METHOD
            cap = cv2.VideoCapture(str(temp_path))
            v_fps = cap.get(cv2.CAP_PROP_FPS) or 30
            f_skip = max(1, int(v_fps / sample_fps))
            fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            tracker_old = SimpleCentroidTracker()
            prev_pos = {}
            count_old = 0
            dets_old = 0
            fi = 0

            while True:
                ret, frame = cap.read()
                if not ret: break
                fi += 1
                if fi % f_skip != 0: continue

                res = model(frame, conf=conf, verbose=False)
                cents = []
                for r in res:
                    for box in r.boxes:
                        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                        cents.append(((x1 + x2) / 2, (y1 + y2) / 2))
                        dets_old += 1

                tracked = tracker_old.update(cents)
                for oid, (cx, cy) in tracked.items():
                    nx = cx / fw
                    if oid in prev_pos:
                        px = prev_pos[oid]
                        if px < line_pos <= nx and oid not in tracker_old.crossed:
                            tracker_old.crossed.add(oid)
                            count_old += 1
                    prev_pos[oid] = nx
            cap.release()

            # NEW METHOD
            cap = cv2.VideoCapture(str(temp_path))
            tracker_new = EnhancedTracker(CountingConfig(line_position=line_pos, confidence_threshold=conf))
            dets_new = 0
            fi = 0

            while True:
                ret, frame = cap.read()
                if not ret: break
                fi += 1
                if fi % f_skip != 0: continue

                res = model(frame, conf=conf, verbose=False)
                raw = []
                for r in res:
                    for box in r.boxes:
                        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                        raw.append({'bbox': [x1, y1, x2, y2], 'label': 'bag', 'confidence': float(box.conf[0])})
                        dets_new += 1

                tracked = tracker_new.update(raw, fw, fh)
                for obj in tracked.values():
                    cross_dir = tracker_new.check_line_crossing(obj)

            cap.release()

            results.append({
                'model': name,
                'old_count': count_old,
                'old_dets': dets_old,
                'new_count': tracker_new.total_out,
                'new_dets': dets_new,
                'diff': tracker_new.total_out - count_old
            })

            del model

    finally:
        if temp_path.exists():
            temp_path.unlink()

    return jsonify({'results': results, 'line_position': line_pos})

def _maintenance_loop():
    """Background thread: periodic housekeeping every 5 minutes.
    Keeps hot-path request handlers free of expensive cleanup work.
    """
    while True:
        time.sleep(300)  # 5 minutes
        for label, fn in [
            ('low_stock_alerts', check_low_stock_alerts),
            ('rate_limiter_cleanup', rate_limiter.cleanup),
            ('compression_cleanup', cleanup_old_compression_jobs),
            ('video_job_cleanup', cleanup_old_video_jobs)
        ]:
            try:
                fn()
            except Exception as e:
                logger.error(f"Maintenance error [{label}]: {e}")

def initialize():
    print("""
    ╔══════════════════════════════════════════════════════════════╗
    ║                    AI CCTV Backend v4.1                      ║
    ╚══════════════════════════════════════════════════════════════╝
    """)
    db.init_schema()
    db.seed_data()
    if Config.MODEL_DIR.exists():
        # Register all .pt files in the models dir (no RAM used yet)
        count = ml_service.register_models_from_directory(Config.MODEL_DIR)
        logger.info(f"📋 {count} model(s) registered")
        # Load only the preferred default model into memory
        default = 'sugar_bag_final'
        if default in ml_service.loaded_models:
            ml_service.switch_model(default)
        elif ml_service.loaded_models:
            # Fall back to the first registered model
            ml_service.switch_model(next(iter(ml_service.loaded_models)))
    print(f"""
    🚀 Server Ready!
       Device: {DEVICE}
       Models: {len(ml_service.loaded_models)}
       Active: {ml_service.active_model_name or 'None'}
    """)

initialize()

# Start background maintenance thread (runs every 5 min, never blocks requests)
threading.Thread(target=_maintenance_loop, daemon=True, name='maintenance').start()
logger.info("🔧 Background maintenance thread started")

if __name__ == '__main__':
    # Direct invocation fallback — prefer using run.py for gevent support
    app.run(host='0.0.0.0', port=5000, threaded=True)

