import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatRelativeTime, cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Truck, Plus, ArrowDownLeft, ArrowUpRight, RefreshCw, Trash2, Clock } from 'lucide-react';

interface TruckEntry { id: number; truck_number: string; direction: 'IN' | 'OUT'; timestamp: string; }

function useTrucks() {
    return useQuery({
        queryKey: ['trucks'],
        queryFn: async () => { const { data } = await apiClient.get<TruckEntry[]>('/api/trucks'); return data; },
        refetchInterval: 10000,
    });
}

function useCreateTruck() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (entry: { truck_number: string; direction: 'IN' | 'OUT' }) => { await apiClient.post('/api/trucks', entry); },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['trucks'] }); toast.success('Truck logged'); },
        onError: () => toast.error('Failed to log truck'),
    });
}

function useResetTrucks() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async () => { await apiClient.delete('/api/trucks/reset'); },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['trucks'] }); toast.success('Trucks reset'); },
        onError: () => toast.error('Failed to reset'),
    });
}

export default function Trucks() {
    const { data: trucks, isLoading, refetch, isRefetching } = useTrucks();
    const createTruck = useCreateTruck();
    const resetTrucks = useResetTrucks();

    const handleQuickAdd = (direction: 'IN' | 'OUT') => {
        createTruck.mutate({ truck_number: `TRK-${Date.now().toString().slice(-6)}`, direction });
    };

    const handleReset = () => {
        if (window.confirm('Reset all truck entries?')) resetTrucks.mutate();
    };

    const inCount = trucks?.filter(t => t.direction === 'IN').length ?? 0;
    const outCount = trucks?.filter(t => t.direction === 'OUT').length ?? 0;

    return (
        <div className="min-h-screen">
            <Header title="Trucks" subtitle="Track truck movements" actions={
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isRefetching}><RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} /></Button>
                    <Button variant="destructive" size="sm" onClick={handleReset} disabled={resetTrucks.isPending}><Trash2 className="h-4 w-4" /></Button>
                </div>
            } />

            <div className="p-4 md:p-6 space-y-6">
                {/* Quick Actions */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card hover className="cursor-pointer" onClick={() => handleQuickAdd('IN')}>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center"><ArrowDownLeft className="h-6 w-6 text-success" /></div>
                            <div className="flex-1"><p className="font-medium">Truck IN</p><p className="text-sm text-muted-foreground">Quick log</p></div>
                            <Plus className="h-5 w-5 text-muted-foreground" />
                        </CardContent>
                    </Card>
                    <Card hover className="cursor-pointer" onClick={() => handleQuickAdd('OUT')}>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center"><ArrowUpRight className="h-6 w-6 text-destructive" /></div>
                            <div className="flex-1"><p className="font-medium">Truck OUT</p><p className="text-sm text-muted-foreground">Quick log</p></div>
                            <Plus className="h-5 w-5 text-muted-foreground" />
                        </CardContent>
                    </Card>
                    <Card><CardContent className="p-6 flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center"><Truck className="h-6 w-6 text-success" /></div><div><p className="text-2xl font-bold">{inCount}</p><p className="text-sm text-muted-foreground">IN</p></div></CardContent></Card>
                    <Card><CardContent className="p-6 flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center"><Truck className="h-6 w-6 text-destructive" /></div><div><p className="text-2xl font-bold">{outCount}</p><p className="text-sm text-muted-foreground">OUT</p></div></CardContent></Card>
                </div>

                {/* Log */}
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Truck Log</CardTitle></CardHeader>
                    <CardContent>
                        {isLoading ? <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div> : trucks?.length ? (
                            <div className="space-y-2">
                                {trucks.map((truck) => (
                                    <div key={truck.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <Badge variant={truck.direction === 'IN' ? 'success' : 'destructive'}>{truck.direction}</Badge>
                                            <div><p className="font-medium">{truck.truck_number}</p><p className="text-sm text-muted-foreground">{formatRelativeTime(truck.timestamp)}</p></div>
                                        </div>
                                        <Truck className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-muted-foreground">
                                <Truck className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p className="text-lg font-medium">No truck entries</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
