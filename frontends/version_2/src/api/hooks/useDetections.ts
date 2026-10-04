import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { detectionService } from '../services/detection.service';
import { useDetectionStore } from '@/stores/useDetectionStore';
import { toast } from 'sonner';

export function useStats() {
    const { setStats, setIsConnected } = useDetectionStore();
    return useQuery({
        queryKey: ['stats'],
        queryFn: async () => {
            const stats = await detectionService.getStats();
            setStats(stats);
            setIsConnected(true);
            return stats;
        },
        refetchInterval: 5000,
        retry: 2,
        staleTime: 3000,
    });
}

export function useAnalytics() {
    return useQuery({
        queryKey: ['analytics'],
        queryFn: () => detectionService.getAnalytics(),
        staleTime: 30000,
    });
}

export function useDetections(limit = 100) {
    return useQuery({
        queryKey: ['detections', limit],
        queryFn: () => detectionService.getDetections(limit),
        refetchInterval: 10000,
    });
}

export function useModels() {
    const { setActiveModel, setAvailableModels } = useDetectionStore();
    return useQuery({
        queryKey: ['models'],
        queryFn: async () => {
            const models = await detectionService.getModels();
            setActiveModel(models.active);
            setAvailableModels(models.available);
            return models;
        },
        staleTime: 60000,
    });
}

export function useSwitchModel() {
    const queryClient = useQueryClient();
    const { setActiveModel } = useDetectionStore();
    return useMutation({
        mutationFn: detectionService.switchModel,
        onSuccess: (_, modelName) => {
            setActiveModel(modelName);
            queryClient.invalidateQueries({ queryKey: ['models'] });
            toast.success(`Model switched to ${modelName}`);
        },
        onError: () => toast.error('Failed to switch model'),
    });
}

export function useStartCamera() {
    const { setCamera } = useDetectionStore();
    return useMutation({
        mutationFn: detectionService.startCamera,
        onMutate: () => setCamera({ isPending: true }),
        onSuccess: () => {
            setCamera({ isStreaming: true, isPending: false });
            toast.success('Camera started');
        },
        onError: () => {
            setCamera({ isPending: false });
            toast.error('Failed to start camera');
        },
    });
}

export function useStopCamera() {
    const { setCamera } = useDetectionStore();
    return useMutation({
        mutationFn: detectionService.stopCamera,
        onMutate: () => setCamera({ isPending: true }),
        onSuccess: () => {
            setCamera({ isStreaming: false, isPending: false });
            toast.success('Camera stopped');
        },
        onError: () => {
            setCamera({ isPending: false });
            toast.error('Failed to stop camera');
        },
    });
}

export function useResetData() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: detectionService.resetData,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stats'] });
            queryClient.invalidateQueries({ queryKey: ['detections'] });
            toast.success('Data reset successfully');
        },
        onError: () => toast.error('Failed to reset data'),
    });
}

export function useHealthCheck() {
    const { setIsConnected } = useDetectionStore();
    return useQuery({
        queryKey: ['health'],
        queryFn: async () => {
            const healthy = await detectionService.checkHealth();
            setIsConnected(healthy);
            return healthy;
        },
        refetchInterval: 10000,
        retry: false,
    });
}
