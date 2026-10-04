import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalytics, useDetections } from '@/api/hooks/useDetections';
import { formatRelativeTime, formatConfidence, cn } from '@/lib/utils';
import { ArrowDownLeft, ArrowUpRight, TrendingUp, Clock, BarChart3 } from 'lucide-react';

export default function Analytics() {
    const { data: analytics, isLoading: analyticsLoading } = useAnalytics();
    const { data: detections, isLoading: detectionsLoading } = useDetections(50);

    const statsCards = [
        { title: 'Today IN', value: analytics?.daily?.total_in ?? 0, icon: ArrowDownLeft, color: 'text-success', bg: 'bg-success/10', variant: 'success' as const },
        { title: 'Today OUT', value: analytics?.daily?.total_out ?? 0, icon: ArrowUpRight, color: 'text-destructive', bg: 'bg-destructive/10', variant: 'destructive' as const },
        { title: 'Net Change', value: (analytics?.daily?.total_in ?? 0) - (analytics?.daily?.total_out ?? 0), icon: TrendingUp, color: 'text-primary', bg: 'bg-primary/10', variant: 'default' as const },
        { title: 'Peak Hour', value: analytics?.hourly ? `${analytics.hourly.reduce((max, h) => (h.in_count + h.out_count) > max.total ? { hour: h.hour, total: h.in_count + h.out_count } : max, { hour: 0, total: 0 }).hour}:00` : 'N/A', icon: Clock, color: 'text-warning', bg: 'bg-warning/10', variant: 'warning' as const, isString: true },
    ];

    return (
        <div className="min-h-screen">
            <Header title="Analytics" subtitle="Detection trends and performance" />

            <div className="p-4 md:p-6 space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                    {statsCards.map((stat, i) => (
                        <Card key={i}>
                            <CardContent className="p-4 md:p-6">
                                {analyticsLoading ? <Skeleton className="h-24 w-full" /> : (
                                    <>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', stat.bg)}>
                                                <stat.icon className={cn('h-5 w-5', stat.color)} />
                                            </div>
                                            <Badge variant={stat.variant}>Today</Badge>
                                        </div>
                                        <div className="text-2xl md:text-3xl font-bold">{stat.isString ? stat.value : (stat.value as number).toLocaleString()}</div>
                                        <p className="text-sm text-muted-foreground">{stat.title}</p>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Hourly Chart */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Hourly Activity</CardTitle></CardHeader>
                    <CardContent>
                        {analyticsLoading ? <Skeleton className="h-[200px] w-full" /> : analytics?.hourly ? (
                            <div className="relative h-[200px]">
                                <div className="absolute left-0 top-0 bottom-8 w-8 flex flex-col justify-between text-xs text-muted-foreground">
                                    <span>{Math.max(...analytics.hourly.map((h) => h.in_count + h.out_count))}</span>
                                    <span>0</span>
                                </div>
                                <div className="absolute left-10 right-0 top-0 bottom-0 flex items-end gap-1 pb-8">
                                    {analytics.hourly.map((hour) => {
                                        const total = hour.in_count + hour.out_count;
                                        const maxTotal = Math.max(...analytics.hourly.map((h) => h.in_count + h.out_count), 1);
                                        const heightPercent = (total / maxTotal) * 100;
                                        const inPercent = total > 0 ? (hour.in_count / total) * 100 : 0;
                                        return (
                                            <div key={hour.hour} className="flex-1 flex flex-col items-center gap-1">
                                                <div className="w-full rounded-t-sm relative overflow-hidden transition-all hover:opacity-80" style={{ height: `${heightPercent}%`, minHeight: '4px' }}>
                                                    <div className="absolute bottom-0 w-full bg-success" style={{ height: `${inPercent}%` }} />
                                                    <div className="absolute top-0 w-full bg-destructive" style={{ height: `${100 - inPercent}%` }} />
                                                </div>
                                                <span className="text-xs text-muted-foreground">{hour.hour}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="absolute right-0 top-0 flex items-center gap-4 text-xs">
                                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-success" /> IN</div>
                                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-destructive" /> OUT</div>
                                </div>
                            </div>
                        ) : <div className="h-[200px] flex items-center justify-center text-muted-foreground">No data</div>}
                    </CardContent>
                </Card>

                {/* Detection History */}
                <Card>
                    <CardHeader><CardTitle>Detection History</CardTitle></CardHeader>
                    <CardContent>
                        {detectionsLoading ? (
                            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
                        ) : detections?.length ? (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-border">
                                            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase">Direction</th>
                                            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase">Product</th>
                                            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase">Confidence</th>
                                            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase">Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detections.map((d, i) => (
                                            <tr key={d.id || i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                                <td className="py-3 px-4"><Badge variant={d.direction === 'IN' ? 'success' : 'destructive'}>{d.direction}</Badge></td>
                                                <td className="py-3 px-4 font-medium">{d.label || d.product_type}</td>
                                                <td className="py-3 px-4 text-muted-foreground">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                                                            <div className={cn('h-full rounded-full', d.confidence > 0.8 ? 'bg-success' : d.confidence > 0.5 ? 'bg-warning' : 'bg-destructive')} style={{ width: `${d.confidence * 100}%` }} />
                                                        </div>
                                                        <span className="text-sm">{formatConfidence(d.confidence)}</span>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-sm text-muted-foreground">{formatRelativeTime(d.timestamp)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <div className="text-center py-8 text-muted-foreground">No detection history</div>}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
