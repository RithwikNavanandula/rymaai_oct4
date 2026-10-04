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
    Truck, Plus, Play, CheckCircle, XCircle, Clock, Package,
    ArrowUpRight, ArrowDownLeft, RefreshCw, Loader2, Target
} from 'lucide-react';

interface LoadingJob {
    id: string;
    bay_id: string | null;
    truck_plate: string;
    product_name: string;
    target_count: number;
    loaded_count: number;
    direction: string;
    status: 'pending' | 'active' | 'completed' | 'cancelled';
    operator_name: string;
    shift_id: string | null;
    notes: string;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
}

interface Bay { id: string; name: string; }

const statusConfig = {
    pending:   { label: 'Pending',   color: 'secondary', icon: Clock },
    active:    { label: 'Active',    color: 'warning',   icon: Play },
    completed: { label: 'Complete',  color: 'success',   icon: CheckCircle },
    cancelled: { label: 'Cancelled', color: 'destructive', icon: XCircle },
} as const;

function ProgressBar({ loaded, target }: { loaded: number; target: number }) {
    const pct = Math.min(100, Math.round((loaded / target) * 100));
    const color = pct >= 100 ? 'bg-success' : pct >= 80 ? 'bg-warning' : 'bg-primary';
    return (
        <div className="w-full">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{loaded} loaded</span>
                <span>{pct}%</span>
                <span>{target} target</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all duration-500', color)}
                    style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function CreateJobModal({ bays, onClose }: { bays: Bay[]; onClose: () => void }) {
    const qc = useQueryClient();
    const [form, setForm] = useState({
        truck_plate: '', product_name: 'Sugar Bag', target_count: '',
        direction: 'OUT', bay_id: '', operator_name: '', notes: '',
    });

    const create = useMutation({
        mutationFn: () => apiClient.post('/api/jobs', {
            ...form, target_count: parseInt(form.target_count),
            bay_id: form.bay_id || null,
        }),
        onSuccess: () => {
            toast.success('Loading job created');
            qc.invalidateQueries({ queryKey: ['jobs'] });
            onClose();
        },
        onError: () => toast.error('Failed to create job'),
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <Card className="w-full max-w-lg mx-4">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Plus className="h-5 w-5 text-primary" /> New Loading Job
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Truck Plate *</label>
                            <Input placeholder="KA-01-1234" value={form.truck_plate}
                                onChange={e => setForm(f => ({ ...f, truck_plate: e.target.value.toUpperCase() }))} />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Target Count *</label>
                            <Input type="number" placeholder="500" value={form.target_count}
                                onChange={e => setForm(f => ({ ...f, target_count: e.target.value }))} />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Product</label>
                            <Input value={form.product_name}
                                onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Direction</label>
                            <select value={form.direction}
                                onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}
                                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                                <option value="OUT">OUT (Loading onto truck)</option>
                                <option value="IN">IN (Unloading from truck)</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Bay</label>
                            <select value={form.bay_id}
                                onChange={e => setForm(f => ({ ...f, bay_id: e.target.value }))}
                                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                                <option value="">— None —</option>
                                {bays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Operator</label>
                            <Input placeholder="Name" value={form.operator_name}
                                onChange={e => setForm(f => ({ ...f, operator_name: e.target.value }))} />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                        <Input placeholder="Optional notes" value={form.notes}
                            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                        <Button variant="secondary" onClick={onClose}>Cancel</Button>
                        <Button onClick={() => create.mutate()} disabled={!form.truck_plate || !form.target_count || create.isPending}>
                            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Create Job
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default function Jobs() {
    const qc = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [statusFilter, setStatusFilter] = useState('');

    const { data: jobsData, isLoading } = useQuery({
        queryKey: ['jobs', statusFilter],
        queryFn: () => apiClient.get<{ jobs: LoadingJob[] }>(`/api/jobs${statusFilter ? `?status=${statusFilter}` : ''}`).then(r => r.data),
        refetchInterval: 5000,
    });

    const { data: baysData } = useQuery({
        queryKey: ['bays'],
        queryFn: () => apiClient.get<{ bays: Bay[] }>('/api/bays').then(r => r.data),
    });

    const startJob = useMutation({
        mutationFn: (id: string) => apiClient.post(`/api/jobs/${id}/start`),
        onSuccess: () => { toast.success('Job started'); qc.invalidateQueries({ queryKey: ['jobs'] }); },
        onError: () => toast.error('Failed to start job'),
    });

    const completeJob = useMutation({
        mutationFn: (id: string) => apiClient.patch(`/api/jobs/${id}/complete`),
        onSuccess: () => { toast.success('Job marked complete'); qc.invalidateQueries({ queryKey: ['jobs'] }); },
        onError: () => toast.error('Failed to complete job'),
    });

    const cancelJob = useMutation({
        mutationFn: (id: string) => apiClient.patch(`/api/jobs/${id}/cancel`),
        onSuccess: () => { toast.success('Job cancelled'); qc.invalidateQueries({ queryKey: ['jobs'] }); },
    });

    const jobs = jobsData?.jobs ?? [];
    const bays = baysData?.bays ?? [];
    const activeCount = jobs.filter(j => j.status === 'active').length;
    const completedToday = jobs.filter(j => j.status === 'completed').length;

    return (
        <div className="min-h-screen">
            <Header
                title="Loading Jobs"
                subtitle="Work orders for truck loading / unloading"
                actions={
                    <div className="flex items-center gap-2">
                        {activeCount > 0 && (
                            <Badge variant="warning" pulse>{activeCount} Active</Badge>
                        )}
                        <Button onClick={() => setShowCreate(true)}>
                            <Plus className="h-4 w-4 mr-1" /> New Job
                        </Button>
                    </div>
                }
            />

            <div className="p-4 md:p-6 space-y-6">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                        { label: 'Total Jobs', value: jobs.length, icon: Package, color: 'text-primary' },
                        { label: 'Active Now', value: activeCount, icon: Play, color: 'text-warning' },
                        { label: 'Completed Today', value: completedToday, icon: CheckCircle, color: 'text-success' },
                        { label: 'Pending', value: jobs.filter(j => j.status === 'pending').length, icon: Clock, color: 'text-muted-foreground' },
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

                {/* Filter tabs */}
                <div className="flex items-center gap-2 p-1 bg-muted rounded-lg w-fit">
                    {[{ v: '', l: 'All' }, { v: 'active', l: 'Active' }, { v: 'pending', l: 'Pending' },
                      { v: 'completed', l: 'Completed' }, { v: 'cancelled', l: 'Cancelled' }].map(tab => (
                        <button key={tab.v}
                            onClick={() => setStatusFilter(tab.v)}
                            className={cn('px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                                statusFilter === tab.v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                            {tab.l}
                        </button>
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['jobs'] })}>
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* Jobs list */}
                {isLoading ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                ) : jobs.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
                            <Truck className="h-16 w-16 mb-4 opacity-30" />
                            <p className="text-lg font-medium">No loading jobs found</p>
                            <p className="text-sm mt-1">Create a new job to start tracking</p>
                            <Button className="mt-4" onClick={() => setShowCreate(true)}>
                                <Plus className="h-4 w-4 mr-1" /> Create Job
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {jobs.map(job => {
                            const cfg = statusConfig[job.status] ?? statusConfig.pending;
                            const StatusIcon = cfg.icon;
                            return (
                                <Card key={job.id} className={cn('transition-all', job.status === 'active' && 'ring-1 ring-primary/50')}>
                                    <CardContent className="p-5">
                                        <div className="flex items-start justify-between gap-4 mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    'p-2.5 rounded-xl',
                                                    job.direction === 'OUT' ? 'bg-destructive/10' : 'bg-success/10'
                                                )}>
                                                    {job.direction === 'OUT'
                                                        ? <ArrowUpRight className="h-5 w-5 text-destructive" />
                                                        : <ArrowDownLeft className="h-5 w-5 text-success" />}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-lg">{job.truck_plate}</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        {job.product_name} · {job.direction}
                                                        {job.operator_name && ` · ${job.operator_name}`}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant={cfg.color as any}>
                                                    <StatusIcon className="h-3 w-3 mr-1" />
                                                    {cfg.label}
                                                </Badge>
                                            </div>
                                        </div>

                                        <div className="mb-4">
                                            <ProgressBar loaded={job.loaded_count} target={job.target_count} />
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                <Target className="h-3.5 w-3.5" />
                                                <span>{job.loaded_count} / {job.target_count} bags</span>
                                            </div>
                                            <div className="flex gap-2">
                                                {job.status === 'pending' && (
                                                    <Button size="sm" onClick={() => startJob.mutate(job.id)}
                                                        disabled={startJob.isPending}>
                                                        <Play className="h-3.5 w-3.5 mr-1" /> Start
                                                    </Button>
                                                )}
                                                {job.status === 'active' && (
                                                    <Button size="sm" variant="secondary"
                                                        onClick={() => completeJob.mutate(job.id)}
                                                        disabled={completeJob.isPending}>
                                                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Complete
                                                    </Button>
                                                )}
                                                {(job.status === 'pending' || job.status === 'active') && (
                                                    <Button size="sm" variant="destructive"
                                                        onClick={() => cancelJob.mutate(job.id)}>
                                                        <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            {showCreate && <CreateJobModal bays={bays} onClose={() => setShowCreate(false)} />}
        </div>
    );
}
