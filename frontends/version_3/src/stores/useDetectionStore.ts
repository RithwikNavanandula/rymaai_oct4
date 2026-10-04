import { create } from 'zustand';

export interface Detection {
    id: string;
    label: string;
    confidence: number;
    bbox?: { x: number; y: number; width: number; height: number };
    timestamp?: string;
    direction?: 'IN' | 'OUT';
}

export interface DetectionStats {
    totalIn: number;
    totalOut: number;
    todayIn: number;
    todayOut: number;
    sugarBagCount: number;
}

interface CameraState {
    isStreaming: boolean;
    isPending: boolean;
    source: number;
}

interface DetectionState {
    // Camera
    camera: CameraState;
    setCamera: (camera: Partial<CameraState>) => void;

    // Models
    activeModel: string;
    availableModels: Record<string, { loaded: boolean }>;
    setActiveModel: (model: string) => void;
    setAvailableModels: (models: Record<string, { loaded: boolean }>) => void;

    // Live Detections
    liveDetections: Detection[];
    setLiveDetections: (detections: Detection[]) => void;
    addDetection: (detection: Detection) => void;
    clearDetections: () => void;

    // Stats
    stats: DetectionStats;
    setStats: (stats: Partial<DetectionStats>) => void;

    // Performance
    fps: number;
    latency: number;
    setPerformance: (fps: number, latency: number) => void;

    // Connection
    isConnected: boolean;
    setIsConnected: (connected: boolean) => void;
}

export const useDetectionStore = create<DetectionState>((set) => ({
    // Camera
    camera: { isStreaming: false, isPending: false, source: 0 },
    setCamera: (camera) => set((state) => ({
        camera: { ...state.camera, ...camera }
    })),

    // Models
    activeModel: 'best_dec20',
    availableModels: {},
    setActiveModel: (model) => set({ activeModel: model }),
    setAvailableModels: (models) => set({ availableModels: models }),

    // Live Detections
    liveDetections: [],
    setLiveDetections: (detections) => set({ liveDetections: detections }),
    addDetection: (detection) => set((state) => ({
        liveDetections: [detection, ...state.liveDetections].slice(0, 50)
    })),
    clearDetections: () => set({ liveDetections: [] }),

    // Stats
    stats: { totalIn: 0, totalOut: 0, todayIn: 0, todayOut: 0, sugarBagCount: 0 },
    setStats: (stats) => set((state) => ({
        stats: { ...state.stats, ...stats }
    })),

    // Performance
    fps: 0,
    latency: 0,
    setPerformance: (fps, latency) => set({ fps, latency }),

    // Connection
    isConnected: false,
    setIsConnected: (connected) => set({ isConnected: connected }),
}));
