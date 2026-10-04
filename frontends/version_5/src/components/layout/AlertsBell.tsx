import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { Bell, X, CheckCheck, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface Alert {
    id: string;
    type: string;
    message: string;
    severity: 'info' | 'warning' | 'error';
    is_read: number;
    created_at: string;
}

function useAlerts() {
    return useQuery({
        queryKey: ['alerts'],
        queryFn: async () => {
            const { data } = await apiClient.get<Alert[]>('/api/alerts?limit=30');
            return data;
        },
        refetchInterval: 30000,
    });
}

const severityIcon = {
    info: <Info className="h-4 w-4 text-primary" />,
    warning: <AlertTriangle className="h-4 w-4 text-warning" />,
    error: <AlertCircle className="h-4 w-4 text-destructive" />,
};

const severityColors = {
    info: 'border-l-primary',
    warning: 'border-l-warning',
    error: 'border-l-destructive',
};

export function AlertsBell() {
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();
    const { data: alerts = [] } = useAlerts();

    const unread = alerts.filter(a => !a.is_read).length;

    const markAll = useMutation({
        mutationFn: () => apiClient.post('/api/alerts/read-all'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['alerts'] });
            toast.success('All alerts marked as read');
        },
    });

    const markOne = useMutation({
        mutationFn: (id: string) => apiClient.post(`/api/alerts/${id}/read`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    });

    return (
        <div className="relative">
            {/* Bell button */}
            <button
                onClick={() => setOpen(!open)}
                className="relative p-2 rounded-lg hover:bg-muted/50 transition-colors"
                title="Alerts"
            >
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1 animate-pulse">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {/* Panel */}
            {open && (
                <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

                    {/* Dropdown */}
                    <div className="absolute right-0 top-11 w-96 max-h-[480px] rounded-xl border border-border bg-card shadow-2xl z-50 flex flex-col overflow-hidden animate-fade-in">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <div className="flex items-center gap-2">
                                <Bell className="h-4 w-4 text-primary" />
                                <span className="font-semibold">Alerts</span>
                                {unread > 0 && <Badge variant="destructive" className="text-xs">{unread} new</Badge>}
                            </div>
                            <div className="flex items-center gap-1">
                                {unread > 0 && (
                                    <Button size="sm" variant="ghost" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
                                        <CheckCheck className="h-4 w-4 mr-1" /> Mark all read
                                    </Button>
                                )}
                                <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-muted transition-colors">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        {/* List */}
                        <div className="overflow-y-auto flex-1">
                            {alerts.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                    <Bell className="h-10 w-10 mb-3 opacity-30" />
                                    <p className="text-sm">No alerts</p>
                                </div>
                            ) : (
                                alerts.map(alert => (
                                    <div
                                        key={alert.id}
                                        onClick={() => !alert.is_read && markOne.mutate(alert.id)}
                                        className={cn(
                                            'flex gap-3 p-4 border-b border-border/50 border-l-2 cursor-pointer transition-colors',
                                            !alert.is_read ? 'bg-muted/30 hover:bg-muted/50' : 'opacity-60 hover:bg-muted/20',
                                            severityColors[alert.severity] || 'border-l-muted'
                                        )}
                                    >
                                        <div className="mt-0.5 shrink-0">
                                            {severityIcon[alert.severity] || severityIcon.info}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={cn('text-sm', !alert.is_read && 'font-medium')}>{alert.message}</p>
                                            <p className="text-xs text-muted-foreground mt-1">{formatRelativeTime(alert.created_at)}</p>
                                        </div>
                                        {!alert.is_read && (
                                            <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
