import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/apiClient';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    FileText, Download, Calendar, ArrowDownLeft, ArrowUpRight,
    Package, Truck, Clock, Loader2, FileSpreadsheet
} from 'lucide-react';

interface ReportData {
    date: string;
    totals: { total: number; total_in: number; total_out: number };
    jobs: Array<{ truck_plate: string; product_name: string; target_count: number; loaded_count: number; status: string; operator_name: string }>;
    shifts: Array<{ name: string; operator_name: string; started_at: string; ended_at: string | null }>;
}

function today() { return new Date().toISOString().split('T')[0]; }

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: React.ElementType; color: string }) {
    return (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/30">
            <div className={cn('p-2.5 rounded-lg bg-muted', color)}>
                <Icon className="h-5 w-5" />
            </div>
            <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
            </div>
        </div>
    );
}

export default function Reports() {
    const [date, setDate] = useState(today());

    const { data, isLoading, refetch } = useQuery<ReportData>({
        queryKey: ['report', date],
        queryFn: () => apiClient.get<ReportData>(`/api/reports/daily?date=${date}`).then(r => r.data),
    });

    const downloadFile = async (format: 'pdf' | 'excel') => {
        const token = localStorage.getItem('auth_token');
        const ext = format === 'pdf' ? 'pdf' : 'xlsx';
        const endpoint = format === 'pdf' ? 'pdf' : 'excel';
        try {
            const res = await fetch(`/api/reports/${endpoint}?date=${date}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Download failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `report_${date}.${ext}`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`${format.toUpperCase()} downloaded`);
        } catch {
            toast.error('Download failed');
        }
    };

    const totals = data?.totals;
    const jobs = data?.jobs ?? [];
    const shifts = data?.shifts ?? [];

    return (
        <div className="min-h-screen">
            <Header
                title="Reports"
                subtitle="Daily summaries — download as PDF or Excel"
                actions={
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={() => downloadFile('excel')} disabled={isLoading || !data}>
                            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
                        </Button>
                        <Button onClick={() => downloadFile('pdf')} disabled={isLoading || !data}>
                            <FileText className="h-4 w-4 mr-1" /> PDF
                        </Button>
                    </div>
                }
            />

            <div className="p-4 md:p-6 space-y-6">
                {/* Date picker */}
                <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                        <Calendar className="h-5 w-5 text-muted-foreground" />
                        <input
                            type="date"
                            value={date}
                            max={today()}
                            onChange={e => setDate(e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm w-44"
                        />
                        <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isLoading}>
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
                        </Button>
                        <span className="text-sm text-muted-foreground">Showing report for {date}</span>
                    </CardContent>
                </Card>

                {isLoading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                    </div>
                ) : data ? (
                    <>
                        {/* Summary */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <StatCard label="Total Detections" value={totals?.total ?? 0} icon={Package} color="text-primary" />
                            <StatCard label="Bags IN" value={totals?.total_in ?? 0} icon={ArrowDownLeft} color="text-success" />
                            <StatCard label="Bags OUT" value={totals?.total_out ?? 0} icon={ArrowUpRight} color="text-destructive" />
                            <StatCard label="Loading Jobs" value={jobs.length} icon={Truck} color="text-warning" />
                        </div>

                        {/* Loading Jobs table */}
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Truck className="h-4 w-4" /> Loading Jobs ({jobs.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {jobs.length === 0 ? (
                                    <p className="text-center py-8 text-muted-foreground text-sm">No jobs on this date</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-border">
                                                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Truck</th>
                                                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Product</th>
                                                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Target</th>
                                                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Loaded</th>
                                                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Status</th>
                                                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Operator</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {jobs.map((j, i) => (
                                                    <tr key={i} className={cn('border-b border-border/50', i % 2 === 1 && 'bg-muted/20')}>
                                                        <td className="py-2.5 px-3 font-mono font-bold">{j.truck_plate}</td>
                                                        <td className="py-2.5 px-3">{j.product_name}</td>
                                                        <td className="py-2.5 px-3 text-right">{j.target_count}</td>
                                                        <td className={cn('py-2.5 px-3 text-right font-medium',
                                                            j.loaded_count >= j.target_count ? 'text-success' : 'text-warning')}>
                                                            {j.loaded_count}
                                                        </td>
                                                        <td className="py-2.5 px-3">
                                                            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                                                                j.status === 'completed' ? 'bg-success/20 text-success' :
                                                                j.status === 'active' ? 'bg-warning/20 text-warning' :
                                                                'bg-muted text-muted-foreground')}>
                                                                {j.status}
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 px-3 text-muted-foreground">{j.operator_name || '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Shifts table */}
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Clock className="h-4 w-4" /> Shifts ({shifts.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {shifts.length === 0 ? (
                                    <p className="text-center py-8 text-muted-foreground text-sm">No shifts on this date</p>
                                ) : (
                                    <div className="space-y-2">
                                        {shifts.map((s, i) => (
                                            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                                                <div>
                                                    <p className="font-medium">{s.name}</p>
                                                    <p className="text-xs text-muted-foreground">{s.operator_name || 'No operator'}</p>
                                                </div>
                                                <div className="text-right text-sm text-muted-foreground">
                                                    <p>{new Date(s.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                                    <p>{s.ended_at ? new Date(s.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active'}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Download buttons */}
                        <div className="flex gap-3">
                            <Button className="flex-1" onClick={() => downloadFile('pdf')}>
                                <Download className="h-4 w-4 mr-2" /> Download PDF Report
                            </Button>
                            <Button variant="secondary" className="flex-1" onClick={() => downloadFile('excel')}>
                                <FileSpreadsheet className="h-4 w-4 mr-2" /> Download Excel Report
                            </Button>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}
