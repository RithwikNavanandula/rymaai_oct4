import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/apiClient';
import { useQuery } from '@tanstack/react-query';
import { formatRelativeTime } from '@/lib/utils';
import { Scan, Camera, QrCode, FileText, Clock, RefreshCw } from 'lucide-react';

interface ScanEntry {
    id: number;
    batch_number: string;
    product_name: string;
    mfg_date: string;
    exp_date: string;
    location: string;
    created_at: string;
}

function useScans() {
    return useQuery({
        queryKey: ['scans'],
        queryFn: async () => {
            const { data } = await apiClient.get<ScanEntry[]>('/api/scans');
            return data;
        },
    });
}

export default function Scanner() {
    const { data: scans, isLoading, refetch, isRefetching } = useScans();

    return (
        <div className="min-h-screen">
            <Header title="Label Scanner" subtitle="Product OCR & barcodes" actions={
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isRefetching}><RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} /></Button>
                    <Button><Camera className="h-4 w-4" /> Start</Button>
                </div>
            } />

            <div className="p-4 md:p-6 space-y-6">
                {/* Quick Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card hover className="cursor-pointer"><CardContent className="p-6 flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><Camera className="h-6 w-6 text-primary" /></div><div><p className="font-medium">Capture Label</p><p className="text-sm text-muted-foreground">Camera OCR</p></div></CardContent></Card>
                    <Card hover className="cursor-pointer"><CardContent className="p-6 flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center"><QrCode className="h-6 w-6 text-success" /></div><div><p className="font-medium">Scan Barcode</p><p className="text-sm text-muted-foreground">QR & Barcodes</p></div></CardContent></Card>
                    <Card hover className="cursor-pointer"><CardContent className="p-6 flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center"><FileText className="h-6 w-6 text-warning" /></div><div><p className="font-medium">Manual Entry</p><p className="text-sm text-muted-foreground">Enter details</p></div></CardContent></Card>
                </div>

                {/* History */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Scan History</CardTitle></CardHeader>
                    <CardContent>
                        {isLoading ? <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div> : scans?.length ? (
                            <div className="space-y-3">
                                {scans.map((scan) => (
                                    <Card key={scan.id} className="bg-muted/30">
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between">
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2"><Badge>{scan.batch_number}</Badge><span className="font-medium">{scan.product_name}</span></div>
                                                    <div className="flex gap-4 text-sm text-muted-foreground"><span>Mfg: {scan.mfg_date}</span><span>Exp: {scan.exp_date}</span></div>
                                                    <p className="text-sm text-muted-foreground">📍 {scan.location}</p>
                                                </div>
                                                <span className="text-xs text-muted-foreground">{formatRelativeTime(scan.created_at)}</span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-muted-foreground">
                                <Scan className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p className="text-lg font-medium">No scans yet</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
