import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { useModels, useSwitchModel, useStartCamera, useStopCamera } from '@/api/hooks/useDetections';
import { useDetectionStore } from '@/stores/useDetectionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { detectionService } from '@/api/services/detection.service';
import { apiClient } from '@/lib/apiClient';
import { formatConfidence, cn, throttle } from '@/lib/utils';
import { toast } from 'sonner';
import {
    Video, VideoOff, Play, Square, Camera, Upload, Activity, Zap, Settings2, Maximize2, Loader2, ImageIcon, Trash2
} from 'lucide-react';

// Upload Detection Component
function UploadDetection() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [uploadedImage, setUploadedImage] = useState<string | null>(null);
    const [detections, setDetections] = useState<Array<{ label: string; confidence: number; bbox: number[] }>>([]);

    // Get confidence threshold from settings
    const { confidenceThreshold } = useSettingsStore();

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => setUploadedImage(e.target?.result as string);
        reader.readAsDataURL(file);

        // Send to API
        setIsProcessing(true);
        const formData = new FormData();
        formData.append('image', file);
        formData.append('confidence', confidenceThreshold.toString());

        try {
            const { data } = await apiClient.post<{ detections: Array<{ label: string; confidence: number; bbox: number[] }> }>('/api/detect_frame', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setDetections(data.detections || []);
            toast.success(`Detected ${data.detections?.length || 0} objects`);
        } catch (error) {
            toast.error('Detection failed');
            console.error(error);
        } finally {
            setIsProcessing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleClear = () => {
        setUploadedImage(null);
        setDetections([]);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Upload & Preview */}
            <Card className="lg:col-span-2">
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><ImageIcon className="h-5 w-5" /> Image Detection</span>
                        {uploadedImage && <Button variant="ghost" size="sm" onClick={handleClear}><Trash2 className="h-4 w-4" /></Button>}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                    {uploadedImage ? (
                        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                            <img src={uploadedImage} alt="Uploaded" className="w-full h-full object-contain" />
                            {isProcessing && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                    <Loader2 className="h-12 w-12 text-white animate-spin" />
                                </div>
                            )}
                        </div>
                    ) : (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-border rounded-xl p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
                        >
                            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                            <p className="text-lg font-medium">Click to upload image</p>
                            <p className="text-sm text-muted-foreground mt-2">JPG, PNG, WebP supported</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Detection Results */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span>Detections</span>
                        <Badge variant={detections.length > 0 ? 'success' : 'secondary'}>{detections.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {detections.length > 0 ? detections.map((d, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                                <div className="flex items-center gap-2">
                                    <div className={cn('w-2 h-2 rounded-full', d.confidence > 0.8 ? 'bg-success' : d.confidence > 0.5 ? 'bg-warning' : 'bg-destructive')} />
                                    <span className="font-medium text-sm">{d.label}</span>
                                </div>
                                <span className="text-sm text-muted-foreground">{formatConfidence(d.confidence)}</span>
                            </div>
                        )) : (
                            <div className="text-center py-8 text-muted-foreground">
                                <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                <p className="text-sm">Upload an image to detect objects</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

type SourceMode = 'webcam' | 'upload';

export default function LiveDetection() {
    const [sourceMode, setSourceMode] = useState<SourceMode>('webcam');
    const [cameraSource, setCameraSource] = useState(0);

    const { data: models, isLoading: modelsLoading } = useModels();
    const switchModel = useSwitchModel();
    const startCamera = useStartCamera();
    const stopCamera = useStopCamera();

    const { camera, activeModel, liveDetections, setLiveDetections, fps, latency, setPerformance } = useDetectionStore();
    const { confidenceThreshold, targetFps, showFpsCounter } = useSettingsStore();

    // Throttled detection polling (2-3 FPS as per improvement plan)
    useEffect(() => {
        if (!camera.isStreaming) return;

        const pollInterval = Math.max(300, 1000 / targetFps);
        let startTime: number;

        const fetchDetections = throttle(async () => {
            startTime = performance.now();
            try {
                const detections = await detectionService.getLiveDetections();
                setLiveDetections(detections);
                const latency = Math.round(performance.now() - startTime);
                setPerformance(Math.round(1000 / pollInterval), latency);
            } catch (error) {
                console.error('Detection poll error:', error);
            }
        }, pollInterval);

        const interval = setInterval(fetchDetections, pollInterval);
        return () => clearInterval(interval);
    }, [camera.isStreaming, targetFps, setLiveDetections, setPerformance]);

    const handleStartCamera = useCallback(() => startCamera.mutate(cameraSource), [cameraSource, startCamera]);
    const handleStopCamera = useCallback(() => stopCamera.mutate(), [stopCamera]);
    const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        switchModel.mutate(e.target.value);
    }, [switchModel]);

    const filteredDetections = liveDetections.filter(d => d.confidence >= confidenceThreshold);

    return (
        <div className="min-h-screen">
            <Header
                title="Live Detection"
                subtitle="Real-time AI object detection"
                actions={
                    <Badge variant={camera.isStreaming ? 'success' : 'secondary'} pulse={camera.isStreaming}>
                        {camera.isStreaming ? 'LIVE' : 'STOPPED'}
                    </Badge>
                }
            />

            <div className="p-4 md:p-6 space-y-6">
                {/* Tab-based Mode Switching (Per improvement plan) */}
                <Card>
                    <CardContent className="p-4">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                            {/* Mode Tabs */}
                            <div className="flex items-center gap-2 p-1 bg-muted rounded-lg">
                                <button
                                    onClick={() => setSourceMode('webcam')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                                        sourceMode === 'webcam' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    <Camera className="h-4 w-4" /> Webcam
                                </button>
                                <button
                                    onClick={() => setSourceMode('upload')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                                        sourceMode === 'upload' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    <Upload className="h-4 w-4" /> Upload
                                </button>
                            </div>

                            {/* Model Selector */}
                            <div className="flex items-center gap-2">
                                <Settings2 className="h-4 w-4 text-muted-foreground" />
                                <Select
                                    value={activeModel}
                                    onChange={handleModelChange}
                                    disabled={modelsLoading || switchModel.isPending}
                                    className="w-[160px]"
                                >
                                    {models?.available && Object.entries(models.available).map(([name, info]) => (
                                        <option key={name} value={name}>{name} {info.loaded ? '✓' : ''}</option>
                                    ))}
                                </Select>
                            </div>

                            {/* Camera Source */}
                            {sourceMode === 'webcam' && (
                                <Select
                                    value={cameraSource.toString()}
                                    onChange={(e) => setCameraSource(parseInt(e.target.value))}
                                    className="w-[100px]"
                                    disabled={camera.isStreaming}
                                >
                                    {[0, 1, 2, 3].map((i) => (
                                        <option key={i} value={i}>Cam {i}</option>
                                    ))}
                                </Select>
                            )}

                            <div className="flex-1" />

                            {/* Camera Controls */}
                            {sourceMode === 'webcam' && (
                                <div className="flex items-center gap-2">
                                    <Button onClick={handleStartCamera} disabled={camera.isStreaming || camera.isPending} loading={camera.isPending && !camera.isStreaming}>
                                        <Play className="h-4 w-4" /> Start
                                    </Button>
                                    <Button variant="destructive" onClick={handleStopCamera} disabled={!camera.isStreaming || camera.isPending} loading={camera.isPending && camera.isStreaming}>
                                        <Square className="h-4 w-4" /> Stop
                                    </Button>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Video Feed */}
                    <Card className="lg:col-span-2">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5" /> Camera Feed</CardTitle>
                            {showFpsCounter && camera.isStreaming && (
                                <div className="flex items-center gap-3 text-sm">
                                    <span className="flex items-center gap-1 text-success"><Activity className="h-4 w-4" />{fps} FPS</span>
                                    <span className="flex items-center gap-1 text-muted-foreground"><Zap className="h-4 w-4" />{latency}ms</span>
                                </div>
                            )}
                        </CardHeader>
                        <CardContent>
                            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                                {camera.isStreaming ? (
                                    <>
                                        <img
                                            src={detectionService.getVideoFeedUrl()}
                                            alt="Live video feed"
                                            className="w-full h-full object-contain"
                                        />
                                        <button className="absolute top-3 right-3 p-2 bg-black/50 rounded-lg hover:bg-black/70 transition-colors">
                                            <Maximize2 className="h-4 w-4 text-white" />
                                        </button>
                                    </>
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                                        <VideoOff className="h-16 w-16 mb-4 opacity-50" />
                                        <p className="text-lg font-medium">Camera Inactive</p>
                                        <p className="text-sm">Click "Start" to begin detection</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Detection Stats Panel */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="flex items-center justify-between">
                                <span>Detections</span>
                                {camera.isStreaming && <Badge variant="success" pulse>{filteredDetections.length}</Badge>}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {filteredDetections.length > 0 ? (
                                    filteredDetections.map((d, i) => (
                                        <div key={d.id || i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 animate-fade-in">
                                            <div className="flex items-center gap-2">
                                                <div className={cn(
                                                    'w-2 h-2 rounded-full',
                                                    d.confidence > 0.8 ? 'bg-success' : d.confidence > 0.5 ? 'bg-warning' : 'bg-destructive'
                                                )} />
                                                <span className="font-medium text-sm">{d.label}</span>
                                            </div>
                                            <span className="text-sm text-muted-foreground">{formatConfidence(d.confidence)}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                        <p className="text-sm">{camera.isStreaming ? 'Waiting for detections...' : 'Start camera to see detections'}</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Upload Mode */}
                {sourceMode === 'upload' && (
                    <UploadDetection />
                )}
            </div>
        </div>
    );
}
