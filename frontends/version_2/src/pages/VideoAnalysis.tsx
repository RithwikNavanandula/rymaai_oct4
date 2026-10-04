import { useState, useRef, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { apiClient, getApiUrl } from '@/lib/apiClient';
import { toast } from 'sonner';
import {
    Upload, FileVideo, Play, Download, Trash2, Loader2, CheckCircle, XCircle,
    Activity, Package, ArrowRight, ArrowLeft, Zap, Settings2, Film,
    TrendingUp, Target, BarChart3, RefreshCw, AlertTriangle
} from 'lucide-react';
import { useDetectionStore } from '@/stores/useDetectionStore';

interface VideoJobStatus {
    job_id: string;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    frames_total: number;
    frames_processed: number;
    offloaded_count: number;
    loaded_count: number;
    detections_total: number;
    error: string | null;
    has_output_video: boolean;
    processing_time?: number;
}

// Available models from backend/models folder
const AVAILABLE_MODELS = [
    { name: 'sugar_bag_final', displayName: 'Sugar Bag Final', description: 'Production model' },
    { name: 'sugar_bag_finetuned', displayName: 'Sugar Bag Finetuned', description: 'Fine-tuned model' },
    { name: 'sugar_bag_improved', displayName: 'Sugar Bag Improved', description: 'Improved accuracy' },
    { name: 'best', displayName: 'Best', description: 'Best overall' },
    { name: 'best_dec20', displayName: 'Best (Dec 20)', description: 'December update' },
    { name: 'yolov8s-worldv2', displayName: 'YOLOv8s World', description: 'Small, fast' },
    { name: 'yolov8x-worldv2', displayName: 'YOLOv8x World', description: 'Large, accurate' },
];

// Helper function to get object label based on selected model
const getObjectLabel = (modelName: string, plural = true): string => {
    const lowerName = modelName.toLowerCase();
    if (lowerName.includes('sugar') || lowerName.includes('bag')) {
        return plural ? 'Sugar Bags' : 'Sugar Bag';
    }
    return plural ? 'Objects' : 'Object';
};

export default function VideoAnalysis() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { confidenceThreshold } = useSettingsStore();
    const { stats, setStats } = useDetectionStore();

    // State
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [videoPreview, setVideoPreview] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>('sugar_bag_final');
    const [direction, setDirection] = useState<'left_to_right' | 'right_to_left'>('left_to_right');
    const [skipFrames, setSkipFrames] = useState(2);
    const [linePosition, setLinePosition] = useState(45); // 45% from left

    // Processing state
    const [isProcessing, setIsProcessing] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<VideoJobStatus | null>(null);
    const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

    // Polling for job status
    useEffect(() => {
        if (jobId && !pollingInterval) {
            const interval = setInterval(async () => {
                try {
                    const { data } = await apiClient.get<VideoJobStatus>(`/api/video/status/${jobId}`);
                    setJobStatus(data);

                    if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                        clearInterval(interval);
                        setPollingInterval(null);
                        setIsProcessing(false);

                        if (data.status === 'completed') {
                            toast.success(`✅ Analysis complete! ${data.offloaded_count} ${getObjectLabel(selectedModel)} offloaded`, {
                                duration: 5000
                            });

                            // Update dashboard stats
                            const isSugarBag = selectedModel.toLowerCase().includes('sugar') || selectedModel.toLowerCase().includes('bag');
                            setStats({
                                totalOut: stats.totalOut + data.offloaded_count,
                                totalIn: stats.totalIn + data.loaded_count,
                                todayOut: stats.todayOut + data.offloaded_count,
                                todayIn: stats.todayIn + data.loaded_count,
                                sugarBagCount: isSugarBag ? (stats.sugarBagCount + data.offloaded_count + data.loaded_count) : stats.sugarBagCount
                            });
                        } else if (data.status === 'failed') {
                            toast.error(`❌ Processing failed: ${data.error}`);
                        }
                    }
                } catch (error) {
                    console.error('Polling error:', error);
                }
            }, 1000);
            setPollingInterval(interval);
        }

        return () => {
            if (pollingInterval) clearInterval(pollingInterval);
        };
    }, [jobId]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('video/')) {
            toast.error('Please select a video file');
            return;
        }

        setSelectedFile(file);
        setVideoPreview(URL.createObjectURL(file));
        setJobId(null);
        setJobStatus(null);
    };

    const handleStartAnalysis = async () => {
        if (!selectedFile) {
            toast.error('Please select a video file');
            return;
        }

        setIsProcessing(true);
        setJobStatus(null);

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('confidence', confidenceThreshold.toString());
        formData.append('fps', skipFrames.toString());
        formData.append('save_video', 'true');
        formData.append('direction', direction);
        formData.append('line_position', (linePosition / 100).toString());
        if (selectedModel) {
            formData.append('model', selectedModel);
        }

        try {
            const { data } = await apiClient.post<{ job_id: string }>('/api/video/process_optimized', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setJobId(data.job_id);
            toast.info('🎬 Video analysis started...');
        } catch (error: any) {
            toast.error(`Failed to start analysis: ${error.message || 'Unknown error'}`);
            setIsProcessing(false);
        }
    };

    const handleDownloadVideo = () => {
        if (!jobId) return;
        window.open(`${getApiUrl()}/api/video/download/${jobId}`, '_blank');
        toast.success('Downloading processed video...');
    };

    const handleClear = () => {
        if (pollingInterval) clearInterval(pollingInterval);
        if (videoPreview) URL.revokeObjectURL(videoPreview);
        setSelectedFile(null);
        setVideoPreview(null);
        setJobId(null);
        setJobStatus(null);
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleCancel = async () => {
        if (!jobId) return;
        try {
            await apiClient.post(`/api/video/cancel/${jobId}`);
            toast.info('Processing cancelled');
            if (pollingInterval) clearInterval(pollingInterval);
            setPollingInterval(null);
            setIsProcessing(false);
        } catch (error) {
            toast.error('Failed to cancel');
        }
    };

    const progressPercentage = jobStatus?.progress ?? 0;

    return (
        <div className="min-h-screen">
            <Header
                title="Video Analysis"
                subtitle="Analyze videos for sugar bag offloading detection"
                actions={
                    <Badge variant={isProcessing ? 'warning' : jobStatus?.status === 'completed' ? 'success' : 'secondary'}>
                        {isProcessing ? 'Processing' : jobStatus?.status === 'completed' ? 'Complete' : 'Ready'}
                    </Badge>
                }
            />

            <div className="p-4 md:p-6 space-y-6">
                {/* Configuration Card */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Settings2 className="h-5 w-5" />
                            Analysis Configuration
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {/* Model Selection */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">Detection Model</label>
                                <Select
                                    value={selectedModel}
                                    onChange={(e) => setSelectedModel(e.target.value)}
                                    disabled={isProcessing}
                                    className="w-full"
                                >
                                    {AVAILABLE_MODELS.map((model) => (
                                        <option key={model.name} value={model.name}>
                                            {model.displayName} - {model.description}
                                        </option>
                                    ))}
                                </Select>
                            </div>

                            {/* Direction */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">Counting Direction</label>
                                <Select
                                    value={direction}
                                    onChange={(e) => setDirection(e.target.value as typeof direction)}
                                    disabled={isProcessing}
                                    className="w-full"
                                >
                                    <option value="left_to_right">Left → Right (Offload)</option>
                                    <option value="right_to_left">Right → Left (Load)</option>
                                </Select>
                            </div>

                            {/* Skip Frames */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">Process Every N Frames</label>
                                <Select
                                    value={skipFrames.toString()}
                                    onChange={(e) => setSkipFrames(parseInt(e.target.value))}
                                    disabled={isProcessing}
                                    className="w-full"
                                >
                                    <option value="1">Every frame (slow, accurate)</option>
                                    <option value="2">Every 2nd frame</option>
                                    <option value="3">Every 3rd frame</option>
                                    <option value="5">Every 5th frame (fast)</option>
                                </Select>
                            </div>

                            {/* Confidence Display */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">Confidence Threshold</label>
                                <div className="flex items-center gap-2 h-10 px-3 bg-muted rounded-md">
                                    <Target className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-mono">{(confidenceThreshold * 100).toFixed(0)}%</span>
                                    <span className="text-xs text-muted-foreground ml-auto">(Set in Settings)</span>
                                </div>
                            </div>
                        </div>

                        {/* Line Position */}
                        <div className="space-y-2 mt-4">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-muted-foreground">Detection Line Position</label>
                                <span className="text-sm font-mono font-bold text-primary">{linePosition}%</span>
                            </div>
                            <input
                                type="range"
                                min="15"
                                max="85"
                                step="5"
                                value={linePosition}
                                onChange={(e) => setLinePosition(Number(e.target.value))}
                                disabled={isProcessing}
                                className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer
                                           [&::-webkit-slider-thumb]:appearance-none
                                           [&::-webkit-slider-thumb]:w-4
                                           [&::-webkit-slider-thumb]:h-4
                                           [&::-webkit-slider-thumb]:rounded-full
                                           [&::-webkit-slider-thumb]:bg-primary
                                           [&::-webkit-slider-thumb]:cursor-pointer"
                            />
                        </div>
                    </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Video Upload & Preview */}
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                    <FileVideo className="h-5 w-5" />
                                    Video Upload
                                </span>
                                <div className="flex items-center gap-2">
                                    {jobStatus?.has_output_video && (
                                        <Button variant="secondary" size="sm" onClick={handleDownloadVideo}>
                                            <Download className="h-4 w-4 mr-1" /> Download Result
                                        </Button>
                                    )}
                                    {selectedFile && !isProcessing && (
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
                                accept="video/*"
                                onChange={handleFileSelect}
                                className="hidden"
                            />

                            {videoPreview ? (
                                <div className="space-y-4">
                                    <div className="relative bg-black rounded-lg overflow-hidden mx-auto" style={{ maxWidth: '480px', maxHeight: '320px' }}>
                                        <video
                                            src={videoPreview}
                                            className="w-full h-full object-contain"
                                            style={{ maxHeight: '320px' }}
                                            controls={!isProcessing}
                                        />

                                        {/* Processing Overlay */}
                                        {isProcessing && (
                                            <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center z-10">
                                                <div className="relative mb-6">
                                                    <div className="w-24 h-24 rounded-full border-4 border-primary/20" />
                                                    <div
                                                        className="absolute inset-0 w-24 h-24 rounded-full border-4 border-primary border-t-transparent animate-spin"
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <span className="text-2xl font-bold text-white">{progressPercentage}%</span>
                                                    </div>
                                                </div>

                                                <p className="text-xl font-bold text-white mb-2">
                                                    Analyzing Video...
                                                </p>

                                                {jobStatus && (
                                                    <div className="text-center text-gray-300 space-y-2">
                                                        <p className="text-sm">
                                                            Frame {jobStatus.frames_processed} / {jobStatus.frames_total}
                                                        </p>

                                                        {/* Progress bar */}
                                                        <div className="w-80 bg-white/20 rounded-full h-2 overflow-hidden">
                                                            <div
                                                                className="h-full bg-gradient-to-r from-primary to-green-400 transition-all duration-300"
                                                                style={{ width: `${progressPercentage}%` }}
                                                            />
                                                        </div>

                                                        {/* Live count */}
                                                        <div className="mt-6 grid grid-cols-2 gap-4">
                                                            <div className="p-4 bg-orange-500/20 rounded-lg border border-orange-500/30">
                                                                <div className="text-3xl font-bold text-orange-400">
                                                                    {jobStatus.offloaded_count}
                                                                </div>
                                                                <div className="text-sm text-orange-300 flex items-center justify-center gap-1">
                                                                    <ArrowRight className="h-4 w-4" />
                                                                    {getObjectLabel(selectedModel)} Out
                                                                </div>
                                                            </div>
                                                            <div className="p-4 bg-blue-500/20 rounded-lg border border-blue-500/30">
                                                                <div className="text-3xl font-bold text-blue-400">
                                                                    {jobStatus.loaded_count}
                                                                </div>
                                                                <div className="text-sm text-blue-300 flex items-center justify-center gap-1">
                                                                    <ArrowLeft className="h-4 w-4" />
                                                                    {getObjectLabel(selectedModel)} In
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    className="mt-6"
                                                    onClick={handleCancel}
                                                >
                                                    <XCircle className="h-4 w-4 mr-1" /> Cancel
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    {/* File info & Start button */}
                                    {!isProcessing && !jobStatus?.status && (
                                        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                                            <div className="flex items-center gap-3">
                                                <Film className="h-8 w-8 text-muted-foreground" />
                                                <div>
                                                    <p className="font-medium truncate max-w-xs">{selectedFile?.name}</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        {((selectedFile?.size || 0) / 1024 / 1024).toFixed(2)} MB
                                                    </p>
                                                </div>
                                            </div>
                                            <Button onClick={handleStartAnalysis} size="lg" className="gap-2">
                                                <Play className="h-5 w-5" />
                                                Start Analysis
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-border rounded-xl p-16 text-center hover:border-primary/50 hover:bg-muted/30 transition-all cursor-pointer"
                                >
                                    <Upload className="h-16 w-16 mx-auto mb-6 text-muted-foreground" />
                                    <p className="text-xl font-medium mb-2">Upload Video for Analysis</p>
                                    <p className="text-muted-foreground">
                                        Upload a video to count sugar bag offloading movements
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-4">
                                        Supported: MP4, AVI, MOV, MKV
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Results Panel */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                    <BarChart3 className="h-5 w-5" />
                                    Results
                                </span>
                                {jobStatus?.status === 'completed' && (
                                    <Badge variant="success">
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Complete
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {jobStatus?.status === 'completed' ? (
                                <div className="space-y-6">
                                    {/* Main Result */}
                                    <div className="text-center py-6 bg-gradient-to-br from-primary/10 to-orange-500/10 rounded-xl border">
                                        <Package className="h-12 w-12 mx-auto mb-3 text-primary" />
                                        <div className="text-6xl font-bold text-primary mb-2">
                                            {jobStatus.offloaded_count}
                                        </div>
                                        <p className="text-lg text-muted-foreground">
                                            {getObjectLabel(selectedModel)} Offloaded
                                        </p>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-3 bg-muted/30 rounded-lg text-center">
                                            <div className="text-2xl font-bold text-blue-500">
                                                {jobStatus.loaded_count}
                                            </div>
                                            <div className="text-xs text-muted-foreground">{getObjectLabel(selectedModel)} In</div>
                                        </div>
                                        <div className="p-3 bg-muted/30 rounded-lg text-center">
                                            <div className="text-2xl font-bold text-green-500">
                                                {jobStatus.detections_total}
                                            </div>
                                            <div className="text-xs text-muted-foreground">Total Detections</div>
                                        </div>
                                    </div>

                                    {/* Details */}
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between p-2 bg-muted/20 rounded">
                                            <span className="text-muted-foreground">Frames Processed</span>
                                            <span className="font-mono">{jobStatus.frames_processed}</span>
                                        </div>
                                        <div className="flex justify-between p-2 bg-muted/20 rounded">
                                            <span className="text-muted-foreground">Model</span>
                                            <span className="font-mono">{selectedModel || 'Default'}</span>
                                        </div>
                                        <div className="flex justify-between p-2 bg-muted/20 rounded">
                                            <span className="text-muted-foreground">Direction</span>
                                            <span className="flex items-center gap-1">
                                                {direction === 'left_to_right' ? (
                                                    <>L <ArrowRight className="h-3 w-3" /> R</>
                                                ) : (
                                                    <>R <ArrowLeft className="h-3 w-3" /> L</>
                                                )}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Download Button */}
                                    {jobStatus.has_output_video && (
                                        <Button onClick={handleDownloadVideo} className="w-full gap-2">
                                            <Download className="h-4 w-4" />
                                            Download Annotated Video
                                        </Button>
                                    )}

                                    {/* New Analysis */}
                                    <Button variant="outline" onClick={handleClear} className="w-full gap-2">
                                        <RefreshCw className="h-4 w-4" />
                                        New Analysis
                                    </Button>
                                </div>
                            ) : jobStatus?.status === 'failed' ? (
                                <div className="text-center py-8">
                                    <AlertTriangle className="h-16 w-16 mx-auto mb-4 text-destructive opacity-50" />
                                    <p className="text-lg font-medium text-destructive mb-2">Analysis Failed</p>
                                    <p className="text-sm text-muted-foreground mb-4">{jobStatus.error}</p>
                                    <Button variant="outline" onClick={handleClear}>
                                        Try Again
                                    </Button>
                                </div>
                            ) : jobStatus ? (
                                <div className="text-center py-8">
                                    <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
                                    <p className="text-lg font-medium">Processing...</p>
                                    <p className="text-sm text-muted-foreground mt-2">
                                        {jobStatus.frames_processed} / {jobStatus.frames_total} frames
                                    </p>
                                </div>
                            ) : (
                                <div className="text-center py-12 text-muted-foreground">
                                    <Activity className="h-16 w-16 mx-auto mb-4 opacity-30" />
                                    <p className="text-lg font-medium">No Results Yet</p>
                                    <p className="text-sm mt-2">
                                        Upload a video and start analysis to see results
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Info Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20">
                        <CardContent className="p-4 flex items-center gap-4">
                            <div className="p-3 bg-orange-500/20 rounded-lg">
                                <Package className="h-6 w-6 text-orange-500" />
                            </div>
                            <div>
                                <p className="font-medium">Offload Detection</p>
                                <p className="text-sm text-muted-foreground">
                                    Counts bags moving left→right
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
                        <CardContent className="p-4 flex items-center gap-4">
                            <div className="p-3 bg-blue-500/20 rounded-lg">
                                <TrendingUp className="h-6 w-6 text-blue-500" />
                            </div>
                            <div>
                                <p className="font-medium">Enhanced Tracking</p>
                                <p className="text-sm text-muted-foreground">
                                    Advanced trajectory analysis
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
                        <CardContent className="p-4 flex items-center gap-4">
                            <div className="p-3 bg-green-500/20 rounded-lg">
                                <Zap className="h-6 w-6 text-green-500" />
                            </div>
                            <div>
                                <p className="font-medium">T4 GPU Optimized</p>
                                <p className="text-sm text-muted-foreground">
                                    FP16 half-precision for speed
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
