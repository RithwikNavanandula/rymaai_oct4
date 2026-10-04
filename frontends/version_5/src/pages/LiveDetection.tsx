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
    Video, VideoOff, Play, Square, Camera, Upload, Activity, Zap, Settings2, Maximize2, Loader2,
    ImageIcon, Trash2, Download, FileVideo, ArrowDownLeft, ArrowUpRight
} from 'lucide-react';

interface Detection {
    label: string;
    confidence: number;
    bbox: number[];
}

// Colors for different detection labels
const COLORS = [
    '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
];

function getColorForLabel(_label: string, index: number): string {
    return COLORS[index % COLORS.length];
}

// Upload Detection Component with Video Support and Downloadable Overlay
function UploadDetection() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    // Get confidence threshold from settings
    const { confidenceThreshold } = useSettingsStore();

    const [isProcessing, setIsProcessing] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<string | null>(null);
    const [fileType, setFileType] = useState<'image' | 'video' | null>(null);
    const [detections, setDetections] = useState<Detection[]>([]);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);

    // Draw bounding boxes on canvas
    const drawDetections = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Get the source (image or video frame)
        let source: HTMLImageElement | HTMLVideoElement | null = null;
        if (fileType === 'image' && imageRef.current) {
            source = imageRef.current;
        } else if (fileType === 'video' && videoRef.current) {
            source = videoRef.current;
        }

        if (!source) return;

        // Set canvas size to match source
        const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
        const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;

        if (width === 0 || height === 0) return;

        canvas.width = width;
        canvas.height = height;

        // Draw the source
        ctx.drawImage(source, 0, 0, width, height);

        // Draw bounding boxes
        detections.forEach((det, i) => {
            const [x1, y1, x2, y2] = det.bbox;
            const color = getColorForLabel(det.label, i);

            // Draw rectangle
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

            // Draw label background
            const label = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
            ctx.font = 'bold 16px Arial';
            const textMetrics = ctx.measureText(label);
            const textHeight = 20;

            ctx.fillStyle = color;
            ctx.fillRect(x1, y1 - textHeight - 4, textMetrics.width + 10, textHeight + 4);

            // Draw label text
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, x1 + 5, y1 - 8);
        });
    }, [detections, fileType]);

    // Redraw when detections change or image loads
    useEffect(() => {
        if (detections.length > 0 && uploadedFile) {
            // Small delay to ensure image/video is loaded
            setTimeout(drawDetections, 100);
        }
    }, [detections, uploadedFile, drawDetections]);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const isVideo = file.type.startsWith('video/');
        setFileType(isVideo ? 'video' : 'image');
        setDetections([]);

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => setUploadedFile(e.target?.result as string);
        reader.readAsDataURL(file);

        if (isVideo) {
            toast.info('Video uploaded. Click "Detect Frame" to analyze current frame.');
        } else {
            // For images, auto-detect
            setIsProcessing(true);
            const formData = new FormData();
            formData.append('image', file);
            formData.append('confidence', confidenceThreshold.toString());

            try {
                const { data } = await apiClient.post<{ detections: Detection[] }>('/api/detect_frame', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                setDetections(data.detections || []);
                toast.success(`Detected ${data.detections?.length || 0} objects`);
            } catch (error) {
                toast.error('Detection failed');
                console.error(error);
            } finally {
                setIsProcessing(false);
            }
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Detect current video frame
    const handleDetectFrame = async () => {
        if (!videoRef.current || fileType !== 'video') return;

        const video = videoRef.current;

        // Create a canvas to capture the frame
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        tempCtx.drawImage(video, 0, 0);

        // Convert to blob
        setIsProcessing(true);
        tempCanvas.toBlob(async (blob) => {
            if (!blob) {
                setIsProcessing(false);
                return;
            }

            const formData = new FormData();
            formData.append('image', blob, 'frame.jpg');
            formData.append('confidence', confidenceThreshold.toString());

            try {
                const { data } = await apiClient.post<{ detections: Detection[] }>('/api/detect_frame', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                setDetections(data.detections || []);
                toast.success(`Detected ${data.detections?.length || 0} objects`);
            } catch (error) {
                toast.error('Detection failed');
                console.error(error);
            } finally {
                setIsProcessing(false);
            }
        }, 'image/jpeg', 0.9);
    };

    // Download annotated image
    const handleDownload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Ensure canvas is drawn
        drawDetections();

        // Create download link
        const link = document.createElement('a');
        link.download = `detected_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        toast.success('Image downloaded!');
    };

    const handleClear = () => {
        setUploadedFile(null);
        setFileType(null);
        setDetections([]);
        setIsVideoPlaying(false);
    };

    const toggleVideoPlay = () => {
        if (!videoRef.current) return;
        if (isVideoPlaying) {
            videoRef.current.pause();
        } else {
            videoRef.current.play();
        }
        setIsVideoPlaying(!isVideoPlaying);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Upload & Preview */}
            <Card className="lg:col-span-2">
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                            {fileType === 'video' ? <FileVideo className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                            {fileType === 'video' ? 'Video Detection' : 'Image Detection'}
                        </span>
                        <div className="flex items-center gap-2">
                            {detections.length > 0 && (
                                <Button variant="secondary" size="sm" onClick={handleDownload}>
                                    <Download className="h-4 w-4 mr-1" /> Download
                                </Button>
                            )}
                            {uploadedFile && (
                                <Button variant="ghost" size="sm" onClick={handleClear}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        onChange={handleFileSelect}
                        className="hidden"
                    />

                    {uploadedFile ? (
                        <div className="space-y-4">
                            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                                {/* Hidden source elements */}
                                {fileType === 'image' && (
                                    <img
                                        ref={imageRef}
                                        src={uploadedFile}
                                        alt="Uploaded"
                                        className="hidden"
                                        onLoad={drawDetections}
                                    />
                                )}
                                {fileType === 'video' && (
                                    <video
                                        ref={videoRef}
                                        src={uploadedFile}
                                        className={detections.length > 0 ? 'hidden' : 'w-full h-full object-contain'}
                                        controls={detections.length === 0}
                                        onLoadedData={() => setIsVideoPlaying(false)}
                                    />
                                )}

                                {/* Canvas with detections */}
                                <canvas
                                    ref={canvasRef}
                                    className={`w-full h-full object-contain ${detections.length > 0 ? 'block' : 'hidden'}`}
                                />

                                {/* Show original image if no detections yet */}
                                {fileType === 'image' && detections.length === 0 && (
                                    <img src={uploadedFile} alt="Uploaded" className="w-full h-full object-contain" />
                                )}

                                {/* Processing overlay */}
                                {isProcessing && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                        <div className="text-center">
                                            <Loader2 className="h-12 w-12 text-white animate-spin mx-auto" />
                                            <p className="text-white mt-2">Detecting objects...</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Video controls */}
                            {fileType === 'video' && (
                                <div className="flex items-center justify-center gap-4">
                                    <Button onClick={toggleVideoPlay} variant="secondary">
                                        {isVideoPlaying ? <Square className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                                        {isVideoPlaying ? 'Pause' : 'Play'}
                                    </Button>
                                    <Button onClick={handleDetectFrame} disabled={isProcessing}>
                                        <Camera className="h-4 w-4 mr-1" />
                                        Detect Frame
                                    </Button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-border rounded-xl p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
                        >
                            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                            <p className="text-lg font-medium">Click to upload image or video</p>
                            <p className="text-sm text-muted-foreground mt-2">JPG, PNG, WebP, MP4, AVI, MOV supported</p>
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
                                    <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: getColorForLabel(d.label, i) }}
                                    />
                                    <span className="font-medium text-sm">{d.label}</span>
                                </div>
                                <span className="text-sm text-muted-foreground">{formatConfidence(d.confidence)}</span>
                            </div>
                        )) : (
                            <div className="text-center py-8 text-muted-foreground">
                                <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                <p className="text-sm">Upload an image or video to detect objects</p>
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
    const [streamQuality, setStreamQuality] = useState<'normal' | 'low'>('normal');

    // Line position: local state drives the slider; synced from server on start
    const [linePosition, setLinePosition] = useState(0.45);
    // Live session counters polled from backend
    const [sessionIn, setSessionIn] = useState(0);
    const [sessionOut, setSessionOut] = useState(0);

    const { data: models, isLoading: modelsLoading } = useModels();
    const switchModel = useSwitchModel();
    const startCamera = useStartCamera();
    const stopCamera = useStopCamera();

    const { camera, activeModel, liveDetections, setLiveDetections, fps, latency, setPerformance } = useDetectionStore();
    const { confidenceThreshold, targetFps, showFpsCounter } = useSettingsStore();

    // Throttled detection polling
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

    // Poll /api/camera/status every 2 s for live session IN/OUT counters and line position
    useEffect(() => {
        if (!camera.isStreaming) return;
        const poll = async () => {
            try {
                const { data } = await apiClient.get<{ session_in: number; session_out: number; line_position: number }>('/api/camera/status');
                setSessionIn(data.session_in);
                setSessionOut(data.session_out);
                setLinePosition(data.line_position); // keep slider in sync
            } catch { /* ignore */ }
        };
        poll(); // immediate first call
        const id = setInterval(poll, 2000);
        return () => clearInterval(id);
    }, [camera.isStreaming]);

    // Reset session counters when camera stops
    useEffect(() => {
        if (!camera.isStreaming) {
            setSessionIn(0);
            setSessionOut(0);
        }
    }, [camera.isStreaming]);

    // Send updated line position to backend
    const handleLinePositionChange = async (value: number) => {
        setLinePosition(value);
        try {
            await apiClient.patch('/api/camera/line', { position: value });
        } catch {
            toast.error('Failed to update line position');
        }
    };

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
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Button onClick={handleStartCamera} disabled={camera.isStreaming || camera.isPending} loading={camera.isPending && !camera.isStreaming}>
                                        <Play className="h-4 w-4" /> Start
                                    </Button>
                                    <Button variant="destructive" onClick={handleStopCamera} disabled={!camera.isStreaming || camera.isPending} loading={camera.isPending && camera.isStreaming}>
                                        <Square className="h-4 w-4" /> Stop
                                    </Button>

                                    {/* Line position slider — only useful while camera is active */}
                                    {camera.isStreaming && (
                                        <div className="flex items-center gap-2 ml-2">
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">Line</span>
                                            <input
                                                type="range"
                                                min="0.10"
                                                max="0.90"
                                                step="0.05"
                                                value={linePosition}
                                                onChange={(e) => handleLinePositionChange(parseFloat(e.target.value))}
                                                className="w-28 accent-primary"
                                                title={`Tracking line at ${Math.round(linePosition * 100)}% of frame width`}
                                            />
                                            <span className="text-xs font-mono text-muted-foreground w-8">{Math.round(linePosition * 100)}%</span>
                                        </div>
                                    )}
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
                            {camera.isStreaming && (
                                <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg text-xs">
                                    <button
                                        onClick={() => setStreamQuality('normal')}
                                        className={`px-2 py-1 rounded-md transition-colors font-medium ${
                                            streamQuality === 'normal'
                                                ? 'bg-background text-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                        title="Full quality — 1280px 15fps (~4 Mbps)">
                                        HD
                                    </button>
                                    <button
                                        onClick={() => setStreamQuality('low')}
                                        className={`px-2 py-1 rounded-md transition-colors font-medium ${
                                            streamQuality === 'low'
                                                ? 'bg-background text-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                        title="Low bandwidth — 480px 6fps (~0.5 Mbps) for remote viewers">
                                        Low
                                    </button>
                                </div>
                            )}
                        </CardHeader>
                        <CardContent>
                            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                                {camera.isStreaming ? (
                                    <>
                                        <img
                                            src={detectionService.getVideoFeedUrl(streamQuality)}
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
                        {/* Session crossing counter — shown only while live */}
                        {camera.isStreaming && (
                            <div className="flex items-center gap-3 px-6 pt-5 pb-2">
                                <div className="flex-1 flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                                    <ArrowDownLeft className="h-4 w-4 text-success" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Session IN</p>
                                        <p className="text-2xl font-bold text-success">{sessionIn}</p>
                                    </div>
                                </div>
                                <div className="flex-1 flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                                    <ArrowUpRight className="h-4 w-4 text-destructive" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Session OUT</p>
                                        <p className="text-2xl font-bold text-destructive">{sessionOut}</p>
                                    </div>
                                </div>
                            </div>
                        )}
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
