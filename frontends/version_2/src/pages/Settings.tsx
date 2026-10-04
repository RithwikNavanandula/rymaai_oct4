import { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { useSettingsStore, themeLabels, themeDescriptions, type ColorTheme } from '@/stores/useSettingsStore';
import { useDetectionStore } from '@/stores/useDetectionStore';
import { useModels, useResetData } from '@/api/hooks/useDetections';
import { setApiUrl, getApiUrl } from '@/lib/apiClient';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Globe, Cpu, Palette, Sliders, RotateCcw, Save, Check, AlertTriangle, Gauge } from 'lucide-react';

const themeColors: Record<ColorTheme, { primary: string; bg: string }> = {
    'default': { primary: '#7c3aed', bg: '#0f0f12' },
    'industrial-security': { primary: '#ef4444', bg: '#0a0a0f' },
    'modern-saas': { primary: '#fafafa', bg: '#09090b' },
    'corporate-enterprise': { primary: '#3b82f6', bg: '#111827' },
    'futuristic-tech': { primary: '#22d3ee', bg: '#030712' },
    'soft-friendly': { primary: '#fb923c', bg: '#1c1917' },
    'midnight-ocean': { primary: '#14b8a6', bg: '#0a1628' },
};

export default function Settings() {
    const [apiUrlInput, setApiUrlInput] = useState(getApiUrl());
    const [isSaving, setIsSaving] = useState(false);

    const { colorTheme, setColorTheme, confidenceThreshold, setConfidenceThreshold, targetFps, setTargetFps, autoRefreshInterval, setAutoRefreshInterval, showFpsCounter, setShowFpsCounter } = useSettingsStore();
    const { isConnected } = useDetectionStore();
    const { data: models, refetch: refetchModels } = useModels();
    const resetData = useResetData();

    // Apply theme on change
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', colorTheme);

        // Dynamically import theme CSS
        if (colorTheme !== 'default') {
            import(`@/styles/themes/${colorTheme}.css`).catch(() => { });
        }
    }, [colorTheme]);

    const handleSaveApiUrl = async () => {
        setIsSaving(true);
        try {
            setApiUrl(apiUrlInput);
            await refetchModels();
            toast.success('API URL saved');
        } catch { toast.error('Failed to connect'); }
        finally { setIsSaving(false); }
    };

    const handleResetData = () => {
        if (window.confirm('Reset all detection data? This cannot be undone.')) resetData.mutate();
    };

    return (
        <div className="min-h-screen">
            <Header title="Settings" subtitle="Configure your AI CCTV system" />

            <div className="p-4 md:p-6 space-y-6 max-w-4xl">
                {/* API */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5 text-primary" /> API Configuration</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
                            <div className={cn('w-3 h-3 rounded-full', isConnected ? 'bg-success animate-pulse' : 'bg-destructive')} />
                            <span className="text-sm">{isConnected ? 'Connected' : 'Disconnected'}</span>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Input value={apiUrlInput} onChange={(e) => setApiUrlInput(e.target.value)} placeholder="http://localhost:5000" icon={<Globe className="h-4 w-4" />} className="flex-1" />
                            <Button onClick={handleSaveApiUrl} loading={isSaving}><Save className="h-4 w-4" /> Save</Button>
                        </div>
                        <p className="text-xs text-muted-foreground">For Ngrok: use https://abc123.ngrok.io</p>
                    </CardContent>
                </Card>

                {/* Models */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5 text-primary" /> AI Models</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                        {models?.available ? Object.entries(models.available).map(([name, info]) => (
                            <div key={name} className={cn('flex items-center justify-between p-3 rounded-lg bg-muted/30', name === models.active && 'ring-2 ring-primary')}>
                                <div className="flex items-center gap-3">
                                    <div className={cn('w-2 h-2 rounded-full', info.loaded ? 'bg-success' : 'bg-muted-foreground')} />
                                    <span className="font-medium">{name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {name === models.active && <Badge variant="success"><Check className="h-3 w-3 mr-1" />Active</Badge>}
                                    <Badge variant={info.loaded ? 'success' : 'secondary'}>{info.loaded ? 'Loaded' : 'Not Loaded'}</Badge>
                                </div>
                            </div>
                        )) : <p className="text-muted-foreground">No models available</p>}
                    </CardContent>
                </Card>

                {/* Theme Selection */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5 text-primary" /> Color Theme</CardTitle></CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {(Object.keys(themeLabels) as ColorTheme[]).map((theme) => (
                                <button
                                    key={theme}
                                    onClick={() => setColorTheme(theme)}
                                    className={cn(
                                        'relative p-4 rounded-xl border-2 text-left transition-all',
                                        colorTheme === theme
                                            ? 'border-primary ring-2 ring-primary/20'
                                            : 'border-border hover:border-muted-foreground/50'
                                    )}
                                >
                                    {/* Color Preview */}
                                    <div className="flex items-center gap-3 mb-2">
                                        <div
                                            className="w-8 h-8 rounded-lg border border-white/10"
                                            style={{
                                                backgroundColor: themeColors[theme].bg,
                                                boxShadow: `inset 0 0 0 3px ${themeColors[theme].primary}`
                                            }}
                                        />
                                        <div className="flex-1">
                                            <p className="font-medium text-sm">{themeLabels[theme]}</p>
                                            <p className="text-xs text-muted-foreground">{themeDescriptions[theme]}</p>
                                        </div>
                                    </div>

                                    {/* Selected indicator */}
                                    {colorTheme === theme && (
                                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                            <Check className="h-3 w-3 text-primary-foreground" />
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-4">Theme changes apply immediately. Some themes may require a page refresh for full effect.</p>
                    </CardContent>
                </Card>

                {/* Detection */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Sliders className="h-5 w-5 text-primary" /> Detection Settings</CardTitle></CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium">Confidence Threshold</label>
                                <span className="text-sm text-muted-foreground">{Math.round(confidenceThreshold * 100)}%</span>
                            </div>
                            <input type="range" min="0.1" max="0.9" step="0.1" value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))} className="w-full accent-primary" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2"><Gauge className="h-4 w-4" /> Target FPS</label>
                            <Select value={targetFps.toString()} onChange={(e) => setTargetFps(parseInt(e.target.value))}>
                                <option value="1">1 FPS</option>
                                <option value="2">2 FPS</option>
                                <option value="3">3 FPS</option>
                                <option value="5">5 FPS</option>
                            </Select>
                            <p className="text-xs text-muted-foreground">Lower FPS = less server load</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Auto-Refresh Interval</label>
                            <Select value={autoRefreshInterval.toString()} onChange={(e) => setAutoRefreshInterval(parseInt(e.target.value))}>
                                <option value="0">Off</option>
                                <option value="5">5 seconds</option>
                                <option value="10">10 seconds</option>
                                <option value="30">30 seconds</option>
                            </Select>
                        </div>
                        <div className="flex items-center justify-between">
                            <div><label className="text-sm font-medium">Show FPS Counter</label><p className="text-xs text-muted-foreground">Display performance metrics</p></div>
                            <button onClick={() => setShowFpsCounter(!showFpsCounter)} className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', showFpsCounter ? 'bg-primary' : 'bg-muted')}>
                                <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', showFpsCounter ? 'translate-x-6' : 'translate-x-1')} />
                            </button>
                        </div>
                    </CardContent>
                </Card>

                {/* Danger Zone */}
                <Card className="border-destructive/50">
                    <CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-5 w-5" /> Danger Zone</CardTitle></CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                            <div><p className="font-medium">Reset All Data</p><p className="text-sm text-muted-foreground">Clear all detection counts and history</p></div>
                            <Button variant="destructive" onClick={handleResetData} loading={resetData.isPending}><RotateCcw className="h-4 w-4" /> Reset</Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
