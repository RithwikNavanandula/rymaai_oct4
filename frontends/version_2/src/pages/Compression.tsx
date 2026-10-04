import { useState, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/apiClient';
import { formatFileSize, cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Film, Upload, Download, Trash2, CheckCircle, Loader2, FileVideo, Zap, Clock, HardDrive } from 'lucide-react';

interface CompressionJob { id: string; status: 'pending' | 'processing' | 'done' | 'error'; progress: number; originalSize?: number; compressedSize?: number; }

export default function Compression() {
    const [jobs, setJobs] = useState<CompressionJob[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        try {
            const { data } = await apiClient.post<{ job_id: string }>('/api/compression/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            setJobs(prev => [{ id: data.job_id, status: 'pending', progress: 0, originalSize: file.size }, ...prev]);
            toast.success('Compression started');
            pollJobStatus(data.job_id);
        } catch { toast.error('Upload failed'); }
        finally { setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
    };

    const pollJobStatus = async (jobId: string) => {
        const poll = async () => {
            try {
                const { data } = await apiClient.get<{ status: 'pending' | 'processing' | 'done' | 'error'; progress: number; compressed_size?: number }>(`/api/compression/status/${jobId}`);
                setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: data.status, progress: data.progress, compressedSize: data.compressed_size } : j));
                if (data.status === 'processing' || data.status === 'pending') setTimeout(poll, 2000);
                else if (data.status === 'done') toast.success('Compression complete!');
            } catch { setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error' } : j)); }
        };
        poll();
    };

    const handleDownload = (jobId: string) => {
        const baseUrl = localStorage.getItem('ai_cctv_api_url_v3') || 'http://localhost:5000';
        window.open(`${baseUrl.replace(/['"]/g, '')}/api/compression/download/${jobId}`, '_blank');
    };

    const presets = [
        { name: 'Fast', icon: Zap, desc: 'Quick, larger output' },
        { name: 'Balanced', icon: HardDrive, desc: 'Good balance' },
        { name: 'Maximum', icon: Clock, desc: 'Best compression' },
    ];

    return (
        <div className="min-h-screen">
            <Header title="Compression" subtitle="Video compression" />

            <div className="p-4 md:p-6 space-y-6">
                {/* Upload */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Upload Video</CardTitle></CardHeader>
                    <CardContent>
                        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />
                        <div onClick={() => fileInputRef.current?.click()} className={cn('border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer transition-colors hover:border-primary/50', isUploading && 'pointer-events-none opacity-50')}>
                            {isUploading ? <><Loader2 className="h-12 w-12 mx-auto mb-4 text-primary animate-spin" /><p className="text-lg font-medium">Uploading...</p></> : <><FileVideo className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><p className="text-lg font-medium">Drop video or click</p><p className="text-sm text-muted-foreground mt-2">MP4, AVI, MOV, MKV</p></>}
                        </div>
                    </CardContent>
                </Card>

                {/* Presets */}
                <div>
                    <h3 className="text-lg font-semibold mb-4">Presets</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {presets.map((p, i) => (
                            <Card key={i} hover className={cn('cursor-pointer', i === 1 && 'ring-2 ring-primary')}>
                                <CardContent className="p-6 text-center">
                                    <p.icon className="h-8 w-8 mx-auto mb-3 text-primary" />
                                    <p className="font-medium">{p.name}</p>
                                    <p className="text-sm text-muted-foreground">{p.desc}</p>
                                    {i === 1 && <Badge className="mt-2">Recommended</Badge>}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>

                {/* Jobs */}
                {jobs.length > 0 && (
                    <Card>
                        <CardHeader><CardTitle>Queue</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {jobs.map((job) => (
                                <div key={job.id} className="flex items-center gap-4 p-4 rounded-lg bg-muted/30">
                                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                                        {job.status === 'done' ? <CheckCircle className="h-6 w-6 text-success" /> : job.status === 'error' ? <Film className="h-6 w-6 text-destructive" /> : <Loader2 className="h-6 w-6 text-primary animate-spin" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1"><p className="font-medium truncate">Job {job.id.slice(0, 8)}</p><Badge variant={job.status === 'done' ? 'success' : job.status === 'error' ? 'destructive' : 'secondary'}>{job.status}</Badge></div>
                                        {job.status === 'processing' && <div className="w-full h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all duration-300" style={{ width: `${job.progress}%` }} /></div>}
                                        {job.status === 'done' && job.originalSize && job.compressedSize && <p className="text-sm text-muted-foreground">{formatFileSize(job.originalSize)} → {formatFileSize(job.compressedSize)} <span className="text-success ml-2">({Math.round((1 - job.compressedSize / job.originalSize) * 100)}% smaller)</span></p>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {job.status === 'done' && <Button size="icon-sm" variant="secondary" onClick={() => handleDownload(job.id)}><Download className="h-4 w-4" /></Button>}
                                        <Button size="icon-sm" variant="ghost" onClick={() => setJobs(prev => prev.filter(j => j.id !== job.id))}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
