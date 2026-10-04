import { useState, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/apiClient';
import { useQuery } from '@tanstack/react-query';
import { formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';
import { Scan, Camera, QrCode, FileText, Clock, RefreshCw, Upload, Loader2, X, CheckCircle, AlertCircle } from 'lucide-react';

interface ScanEntry { id: string; batch_number: string; product_name: string; mfg_date: string; exp_date: string; rack_no: string; shelf_no: string; direction: string; scanned_at: string; }
interface OcrResult { success: boolean; batch_no: string; mfg_date: string; expiry_date: string; flavour: string; raw_text: string; error?: string; }
interface BarcodeResult { barcodes: { data: string; type: string }[]; count: number; }

function useScans() {
    return useQuery({
        queryKey: ['scans'],
        queryFn: async () => { const { data } = await apiClient.get<ScanEntry[]>('/api/scans'); return data; },
    });
}

type ActivePanel = 'none' | 'ocr' | 'barcode' | 'manual';

export default function Scanner() {
    const { data: scans, isLoading, refetch, isRefetching } = useScans();
    const [activePanel, setActivePanel] = useState<ActivePanel>('none');

    // OCR state
    const [ocrLoading, setOcrLoading] = useState(false);
    const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
    const ocrFileRef = useRef<HTMLInputElement>(null);

    // Barcode state
    const [barcodeLoading, setBarcodeLoading] = useState(false);
    const [barcodeResult, setBarcodeResult] = useState<BarcodeResult | null>(null);
    const barcodeFileRef = useRef<HTMLInputElement>(null);

    // Manual entry state
    const [manual, setManual] = useState({ product_name: '', batch_number: '', mfg_date: '', exp_date: '', rack_no: '', shelf_no: '', direction: 'IN' });
    const [manualLoading, setManualLoading] = useState(false);

    const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        setOcrLoading(true); setOcrResult(null);
        const fd = new FormData(); fd.append('image', file);
        try {
            const { data } = await apiClient.post<OcrResult>('/api/ocr/scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            setOcrResult(data);
            if (data.success) toast.success('OCR scan complete'); else toast.error(data.error || 'OCR failed');
        } catch { toast.error('OCR request failed'); }
        finally { setOcrLoading(false); if (ocrFileRef.current) ocrFileRef.current.value = ''; }
    };

    const handleBarcodeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        setBarcodeLoading(true); setBarcodeResult(null);
        const fd = new FormData(); fd.append('image', file);
        try {
            const { data } = await apiClient.post<BarcodeResult>('/api/barcode/decode', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            setBarcodeResult(data);
            toast.success(`Found ${data.count} barcode(s)`);
        } catch { toast.error('Barcode decode failed'); }
        finally { setBarcodeLoading(false); if (barcodeFileRef.current) barcodeFileRef.current.value = ''; }
    };

    const handleManualSubmit = async () => {
        if (!manual.product_name && !manual.batch_number) { toast.error('Enter product name or batch number'); return; }
        setManualLoading(true);
        try {
            await apiClient.post('/api/scans', manual);
            toast.success('Scan entry saved');
            setManual({ product_name: '', batch_number: '', mfg_date: '', exp_date: '', rack_no: '', shelf_no: '', direction: 'IN' });
            setActivePanel('none');
            refetch();
        } catch { toast.error('Failed to save scan'); }
        finally { setManualLoading(false); }
    };

    return (
        <div className="min-h-screen">
            <Header title="Label Scanner" subtitle="Product OCR & barcodes" actions={
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isRefetching}><RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} /></Button>
                </div>
            } />

            <div className="p-4 md:p-6 space-y-6">
                {/* Action Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <input ref={ocrFileRef} type="file" accept="image/*" className="hidden" onChange={handleOcrUpload} />
                    <input ref={barcodeFileRef} type="file" accept="image/*" className="hidden" onChange={handleBarcodeUpload} />

                    <Card hover className={`cursor-pointer transition-all ${activePanel === 'ocr' ? 'ring-2 ring-primary' : ''}`} onClick={() => { setActivePanel(activePanel === 'ocr' ? 'none' : 'ocr'); ocrFileRef.current?.click(); }}>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                                {ocrLoading ? <Loader2 className="h-6 w-6 text-primary animate-spin" /> : <Camera className="h-6 w-6 text-primary" />}
                            </div>
                            <div><p className="font-medium">Capture Label</p><p className="text-sm text-muted-foreground">Camera OCR</p></div>
                        </CardContent>
                    </Card>

                    <Card hover className={`cursor-pointer transition-all ${activePanel === 'barcode' ? 'ring-2 ring-success' : ''}`} onClick={() => { setActivePanel(activePanel === 'barcode' ? 'none' : 'barcode'); barcodeFileRef.current?.click(); }}>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                                {barcodeLoading ? <Loader2 className="h-6 w-6 text-success animate-spin" /> : <QrCode className="h-6 w-6 text-success" />}
                            </div>
                            <div><p className="font-medium">Scan Barcode</p><p className="text-sm text-muted-foreground">QR & Barcodes</p></div>
                        </CardContent>
                    </Card>

                    <Card hover className={`cursor-pointer transition-all ${activePanel === 'manual' ? 'ring-2 ring-warning' : ''}`} onClick={() => setActivePanel(activePanel === 'manual' ? 'none' : 'manual')}>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center"><FileText className="h-6 w-6 text-warning" /></div>
                            <div><p className="font-medium">Manual Entry</p><p className="text-sm text-muted-foreground">Enter details</p></div>
                        </CardContent>
                    </Card>
                </div>

                {/* OCR Result */}
                {ocrResult && (
                    <Card className={ocrResult.success ? 'border-success/30' : 'border-destructive/30'}>
                        <CardHeader className="flex flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                {ocrResult.success ? <CheckCircle className="h-5 w-5 text-success" /> : <AlertCircle className="h-5 w-5 text-destructive" />}
                                OCR Result
                            </CardTitle>
                            <button onClick={() => setOcrResult(null)}><X className="h-4 w-4 text-muted-foreground" /></button>
                        </CardHeader>
                        <CardContent>
                            {ocrResult.success ? (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {[
                                        { label: 'Batch No', value: ocrResult.batch_no || '—' },
                                        { label: 'Mfg Date', value: ocrResult.mfg_date || '—' },
                                        { label: 'Expiry', value: ocrResult.expiry_date || '—' },
                                        { label: 'Flavour', value: ocrResult.flavour || '—' },
                                    ].map(({ label, value }) => (
                                        <div key={label} className="p-3 rounded-lg bg-muted/30">
                                            <p className="text-xs text-muted-foreground">{label}</p>
                                            <p className="font-medium text-sm mt-1">{value}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-destructive">{ocrResult.error}</p>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Barcode Result */}
                {barcodeResult && (
                    <Card className="border-success/30">
                        <CardHeader className="flex flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base"><QrCode className="h-5 w-5 text-success" /> Barcode Results ({barcodeResult.count})</CardTitle>
                            <button onClick={() => setBarcodeResult(null)}><X className="h-4 w-4 text-muted-foreground" /></button>
                        </CardHeader>
                        <CardContent>
                            {barcodeResult.count === 0 ? (
                                <p className="text-sm text-muted-foreground">No barcodes detected in image</p>
                            ) : (
                                <div className="space-y-2">
                                    {barcodeResult.barcodes.map((bc, i) => (
                                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                                            <span className="font-mono text-sm">{bc.data}</span>
                                            <Badge variant="secondary">{bc.type}</Badge>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Manual Entry Panel */}
                {activePanel === 'manual' && (
                    <Card className="border-warning/30">
                        <CardHeader className="flex flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-5 w-5 text-warning" /> Manual Scan Entry</CardTitle>
                            <button onClick={() => setActivePanel('none')}><X className="h-4 w-4 text-muted-foreground" /></button>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Product Name</label><Input value={manual.product_name} onChange={e => setManual(p => ({ ...p, product_name: e.target.value }))} placeholder="e.g. Sugar Bag" /></div>
                                <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Batch Number</label><Input value={manual.batch_number} onChange={e => setManual(p => ({ ...p, batch_number: e.target.value }))} placeholder="e.g. 25-8902-0014" /></div>
                                <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Mfg Date</label><Input type="date" value={manual.mfg_date} onChange={e => setManual(p => ({ ...p, mfg_date: e.target.value }))} /></div>
                                <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Expiry Date</label><Input type="date" value={manual.exp_date} onChange={e => setManual(p => ({ ...p, exp_date: e.target.value }))} /></div>
                                <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Rack No</label><Input value={manual.rack_no} onChange={e => setManual(p => ({ ...p, rack_no: e.target.value }))} placeholder="e.g. R-01" /></div>
                                <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Shelf No</label><Input value={manual.shelf_no} onChange={e => setManual(p => ({ ...p, shelf_no: e.target.value }))} placeholder="e.g. S-03" /></div>
                                <div className="space-y-1 sm:col-span-2"><label className="text-xs font-medium text-muted-foreground">Direction</label>
                                    <Select value={manual.direction} onChange={e => setManual(p => ({ ...p, direction: e.target.value }))}>
                                        <option value="IN">IN</option>
                                        <option value="OUT">OUT</option>
                                    </Select>
                                </div>
                            </div>
                            <Button className="w-full mt-4" onClick={handleManualSubmit} disabled={manualLoading}>
                                {manualLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><Upload className="h-4 w-4" /> Save Entry</>}
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* History */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Scan History</CardTitle></CardHeader>
                    <CardContent>
                        {isLoading ? <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
                            : scans?.length ? (
                                <div className="space-y-3">
                                    {scans.map((scan) => (
                                        <Card key={scan.id} className="bg-muted/30">
                                            <CardContent className="p-4">
                                                <div className="flex items-start justify-between">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant={scan.direction === 'IN' ? 'success' : 'destructive'}>{scan.direction}</Badge>
                                                            {scan.batch_number && <Badge variant="secondary">{scan.batch_number}</Badge>}
                                                            <span className="font-medium">{scan.product_name}</span>
                                                        </div>
                                                        <div className="flex gap-4 text-sm text-muted-foreground">
                                                            {scan.mfg_date && <span>Mfg: {scan.mfg_date}</span>}
                                                            {scan.exp_date && <span>Exp: {scan.exp_date}</span>}
                                                            {scan.rack_no && <span>📍 {scan.rack_no}/{scan.shelf_no}</span>}
                                                        </div>
                                                    </div>
                                                    <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(scan.scanned_at)}</span>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-muted-foreground">
                                    <Scan className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                    <p className="text-lg font-medium">No scans yet</p>
                                    <p className="text-sm">Use Capture Label, Scan Barcode, or Manual Entry above</p>
                                </div>
                            )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
