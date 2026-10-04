import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useStats, useDetections } from '@/api/hooks/useDetections';
import { useDetectionStore } from '@/stores/useDetectionStore';
import { formatRelativeTime, formatConfidence, cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import {
    ArrowDownLeft, ArrowUpRight, Package, Activity, Video, Scan, BarChart3,
    ArrowRight, TrendingUp, TrendingDown
} from 'lucide-react';

export default function Dashboard() {
    const { isLoading: statsLoading } = useStats();
    const { data: detections, isLoading: detectionsLoading } = useDetections(10);
    const { stats, isConnected } = useDetectionStore();

    const statCards = [
        { title: 'Total IN', value: stats.totalIn, icon: ArrowDownLeft, color: 'text-success', bg: 'bg-success/10', trend: '+12%', up: true },
        { title: 'Total OUT', value: stats.totalOut, icon: ArrowUpRight, color: 'text-destructive', bg: 'bg-destructive/10', trend: '+8%', up: true },
        { title: 'Today', value: stats.todayIn + stats.todayOut, icon: Activity, color: 'text-primary', bg: 'bg-primary/10', trend: `${stats.todayIn} in, ${stats.todayOut} out` },
        { title: 'Sugar Bags', value: stats.sugarBagCount, icon: Package, color: 'text-warning', bg: 'bg-warning/10', trend: 'Current' },
    ];

    const quickActions = [
        { title: 'Start Detection', desc: 'Live camera detection', icon: Video, href: '/live', color: 'from-primary to-purple-500' },
        { title: 'Scan Label', desc: 'Product OCR', icon: Scan, href: '/scanner', color: 'from-success to-emerald-500' },
        { title: 'View Analytics', desc: 'Trends & insights', icon: BarChart3, href: '/analytics', color: 'from-warning to-orange-500' },
    ];

    return (
        <div className="min-h-screen">
            <Header title="Dashboard" subtitle="AI CCTV Command Center" />

            <div className="p-4 md:p-6 space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                    {statCards.map((stat, i) => (
                        <Card key={i} hover>
                            <CardContent className="p-4 md:p-6">
                                {statsLoading ? (
                                    <div className="space-y-3">
                                        <Skeleton className="h-10 w-10 rounded-lg" />
                                        <Skeleton className="h-8 w-16" />
                                        <Skeleton className="h-4 w-20" />
                                    </div>
                                ) : (
                                    <>
                                        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', stat.bg)}>
                                            <stat.icon className={cn('h-5 w-5', stat.color)} />
                                        </div>
                                        <div className="text-2xl md:text-3xl font-bold">{stat.value.toLocaleString()}</div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs md:text-sm text-muted-foreground">{stat.title}</span>
                                            {stat.up !== undefined && (
                                                <span className={cn('text-xs flex items-center gap-0.5', stat.up ? 'text-success' : 'text-destructive')}>
                                                    {stat.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                                    {stat.trend}
                                                </span>
                                            )}
                                            {stat.up === undefined && <span className="text-xs text-muted-foreground">{stat.trend}</span>}
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Recent Detections */}
                    <Card className="lg:col-span-2">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle>Recent Detections</CardTitle>
                            <Link to="/analytics">
                                <Button variant="ghost" size="sm">View All <ArrowRight className="h-4 w-4" /></Button>
                            </Link>
                        </CardHeader>
                        <CardContent>
                            {detectionsLoading ? (
                                <div className="space-y-2">
                                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                                </div>
                            ) : detections?.length ? (
                                <div className="space-y-2">
                                    {detections.map((d, i) => (
                                        <div key={d.id || i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors animate-fade-in">
                                            <div className="flex items-center gap-3">
                                                <Badge variant={d.direction === 'IN' ? 'success' : 'destructive'}>{d.direction}</Badge>
                                                <div>
                                                    <p className="font-medium text-sm">{d.label || d.product_type}</p>
                                                    <p className="text-xs text-muted-foreground">{formatRelativeTime(d.timestamp)}</p>
                                                </div>
                                            </div>
                                            <span className="text-sm text-muted-foreground">{formatConfidence(d.confidence)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                    <p>No recent detections</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Quick Actions */}
                    <div className="space-y-4">
                        <h3 className="font-semibold">Quick Actions</h3>
                        {quickActions.map((action, i) => (
                            <Link key={i} to={action.href}>
                                <Card hover className="mb-3">
                                    <CardContent className="p-4 flex items-center gap-4">
                                        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br text-white', action.color)}>
                                            <action.icon className="h-6 w-6" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-medium">{action.title}</p>
                                            <p className="text-sm text-muted-foreground">{action.desc}</p>
                                        </div>
                                        <ArrowRight className="h-5 w-5 text-muted-foreground" />
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}

                        {/* Connection Status */}
                        <Card className={cn('border-2', isConnected ? 'border-success/30' : 'border-destructive/30')}>
                            <CardContent className="p-4 flex items-center gap-3">
                                <div className={cn('w-3 h-3 rounded-full', isConnected ? 'bg-success animate-pulse' : 'bg-destructive')} />
                                <div>
                                    <p className="font-medium">{isConnected ? 'Backend Connected' : 'Backend Offline'}</p>
                                    <p className="text-xs text-muted-foreground">{isConnected ? 'All systems operational' : 'Check settings'}</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
