import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/lib/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    Clock, Play, StopCircle, RefreshCw, Loader2,
    Users, CalendarClock, Activity, Plus
} from 'lucide-react';

interface Shift {
    id: string;
    name: string;
    operator_name: string;
    started_at: string;
    ended_at: string | null;
    notes: string;
    detection_count?: number;
}

function formatDuration(start: string, end: string | null): string {
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    const diff = Math.floor((e - s) / 60000);
    if (diff < 60) return `${diff}m`;
    return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

function formatTime(ts: string): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Shifts() {
    const qc = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [newForm, setNewForm] = useState({ name: '', operator_name: '', notes: '' });

    const { data: shiftsData, isLoading } = useQuery({
        queryKey: ['shifts'],
        queryFn: () => apiClient.get<{ shifts: Shift[] }>('/api/shifts').then(r => r.data),
        refetchInterval: 10000,
    });

    const { data: activeData } = useQuery({
        queryKey: ['shifts', 'active'],
        queryFn: () => apiClient.get<{ shift: Shift | null }>('/api/shifts/active').then(r => r.data),
        refetchInterval: 5000,
    });

    const startShift = useMutation({
        mutationFn: () => apiClient.post('/api/shifts/start', newForm),
        onSuccess: () => {
            toast.success('Shift started');
            setShowCreate(false);
            setNewForm({ name: '', operator_name: '', notes: '' });
            qc.invalidateQueries({ queryKey: ['shifts'] });
        },
        onError: () => toast.error('Failed to start shift'),
    });

    const endShift = useMutation({
        mutationFn: () => apiClient.post('/api/shifts/end', {}),
        onSuccess: () => {
            toast.success('Shift ended');
            qc.invalidateQueries({ queryKey: ['shifts'] });
        },
        onError: () => toast.error('Failed to end shift'),
    });

    const shifts = shiftsData?.shifts ?? [];
    const active = activeData?.shift ?? null;

    return (
        <div className="min-h-screen">
            <Header
                title="Shifts"
                subtitle="Track operator shifts and production periods"
                actions={
                    <div className="flex items-center gap-2">
                        {active
                            ? <Button variant="destructive" onClick={() => endShift.mutate()} disabled={endShift.isPending}>
                                {endShift.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <StopCircle className="h-4 w-4 mr-1" />}
                                End Shift
                              </Button>
                            : <Button onClick={() => setShowCreate(true)}>
                                <Play className="h-4 w-4 mr-1" /> Start Shift
                              </Button>
                        }
                    </div>
                }
            />

            <div className="p-4 md:p-6 space-y-6">
                {/* Active shift banner */}
                {active && (
                    <Card className="border-primary/50 bg-primary/5 ring-1 ring-primary/30">
                        <CardContent className="p-5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <div className="w-3 h-3 rounded-full bg-success" />
                                        <div className="absolute inset-0 rounded-full bg-success animate-ping opacity-40" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-lg">{active.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            Started {formatTime(active.started_at)} · Running for {formatDuration(active.started_at, null)}
                                            {active.operator_name && ` · ${active.operator_name}`}
                                        </p>
                                    </div>
                                </div>
                                <Badge variant="success" pulse>ACTIVE</Badge>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                        { label: 'Total Shifts', value: shifts.length, icon: CalendarClock, color: 'text-primary' },
                        { label: 'Total Detections', value: shifts.reduce((a, s) => a + (s.detection_count ?? 0), 0), icon: Activity, color: 'text-success' },
                        { label: 'Operators', value: new Set(shifts.map(s => s.operator_name).filter(Boolean)).size, icon: Users, color: 'text-warning' },
                    ].map(s => (
                        <Card key={s.label}>
                            <CardContent className="p-4 flex items-center gap-3">
                                <div className={cn('p-2 rounded-lg bg-muted', s.color)}>
                                    <s.icon className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold">{s.value}</p>
                                    <p className="text-xs text-muted-foreground">{s.label}</p>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Shifts list */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" /> Shift History
                        </CardTitle>
                        <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['shifts'] })}>
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : shifts.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                                <p>No shifts recorded yet</p>
                                <Button className="mt-3" onClick={() => setShowCreate(true)}>
                                    <Plus className="h-4 w-4 mr-1" /> Start First Shift
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {shifts.map(shift => (
                                    <div key={shift.id}
                                        className={cn('flex items-center justify-between p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors',
                                            !shift.ended_at && 'ring-1 ring-primary/30 bg-primary/5')}>
                                        <div className="flex items-center gap-3">
                                            <div className={cn('w-2 h-2 rounded-full', shift.ended_at ? 'bg-muted-foreground' : 'bg-success animate-pulse')} />
                                            <div>
                                                <p className="font-medium">{shift.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatTime(shift.started_at)}
                                                    {shift.ended_at ? ` → ${formatTime(shift.ended_at)}` : ' → Now'}
                                                    {shift.operator_name && ` · ${shift.operator_name}`}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 text-right">
                                            <div>
                                                <p className="text-sm font-mono">{formatDuration(shift.started_at, shift.ended_at)}</p>
                                                <p className="text-xs text-muted-foreground">{shift.detection_count ?? 0} detections</p>
                                            </div>
                                            <Badge variant={shift.ended_at ? 'secondary' : 'success'}>
                                                {shift.ended_at ? 'Ended' : 'Active'}
                                            </Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Create shift modal */}
            {showCreate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <Card className="w-full max-w-md mx-4">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Play className="h-5 w-5 text-primary" /> Start New Shift
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Shift Name</label>
                                <Input placeholder="e.g. Morning Shift" value={newForm.name}
                                    onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Operator Name</label>
                                <Input placeholder="Supervisor name" value={newForm.operator_name}
                                    onChange={e => setNewForm(f => ({ ...f, operator_name: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                                <Input placeholder="Optional" value={newForm.notes}
                                    onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} />
                            </div>
                            <div className="flex gap-2 justify-end pt-2">
                                <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                                <Button onClick={() => startShift.mutate()} disabled={startShift.isPending}>
                                    {startShift.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Start Shift
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
