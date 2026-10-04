import { apiClient } from '@/lib/apiClient';
import type { Detection, DetectionStats } from '@/stores/useDetectionStore';

export interface StatsResponse {
    total_in: number;
    total_out: number;
    today_in: number;
    today_out: number;
    sugar_bag_count: number;
    in_trend?: string;
    out_trend?: string;
    in_up?: boolean;
    out_up?: boolean;
}


export interface ModelInfo {
    available: Record<string, { loaded: boolean }>;
    active: string;
}

export interface AnalyticsResponse {
    daily: { total_in: number; total_out: number };
    hourly: Array<{ hour: number; in_count: number; out_count: number }>;
}

export interface DetectionRecord {
    id: number;
    label: string;
    confidence: number;
    direction: 'IN' | 'OUT';
    product_type: string;
    timestamp: string;
}

export const detectionService = {
    async getStats(): Promise<DetectionStats> {
        const { data } = await apiClient.get<StatsResponse>('/api/stats');
        return {
            totalIn: data.total_in,
            totalOut: data.total_out,
            todayIn: data.today_in,
            todayOut: data.today_out,
            sugarBagCount: data.sugar_bag_count,
            inTrend: data.in_trend,
            outTrend: data.out_trend,
            inUp: data.in_up,
            outUp: data.out_up,
        };
    },

    async getAnalytics(): Promise<AnalyticsResponse> {
        const { data } = await apiClient.get<AnalyticsResponse>('/api/analytics');
        return data;
    },

    async getDetections(limit = 100): Promise<DetectionRecord[]> {
        const { data } = await apiClient.get<DetectionRecord[]>(`/api/detections?limit=${limit}`);
        return data;
    },

    async getLiveDetections(): Promise<Detection[]> {
        const { data } = await apiClient.get<Detection[]>('/api/detections/live');
        return data;
    },

    async getModels(): Promise<ModelInfo> {
        const { data } = await apiClient.get<ModelInfo>('/api/models');
        return data;
    },

    async switchModel(modelName: string): Promise<void> {
        await apiClient.post('/api/models/switch', { model: modelName });
    },

    async startCamera(source = 0): Promise<void> {
        await apiClient.post('/api/camera/start', { source });
    },

    async stopCamera(): Promise<void> {
        await apiClient.post('/api/camera/stop');
    },

    async resetData(): Promise<void> {
        await apiClient.post('/api/reset');
    },

    async checkHealth(): Promise<boolean> {
        try { await apiClient.get('/health'); return true; }
        catch { return false; }
    },

    // quality='low' → 480px, 6fps, Q40 (~0.5 Mbps) for remote viewers
    // quality='normal' → 1280px, 15fps, Q70 (~4 Mbps) for local viewers
    getVideoFeedUrl(quality: 'normal' | 'low' = 'normal'): string {
        const baseUrl = localStorage.getItem('ai_cctv_api_url_v3') || 'http://localhost:5000';
        const cleanBase = baseUrl.replace(/['"]/g, '');
        const base = `${cleanBase}/api/video_feed`;
        return quality === 'low' ? `${base}?quality=low` : base;
    },
};
