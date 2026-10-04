import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/apiClient';
import { useQuery } from '@tanstack/react-query';
import { formatRelativeTime, cn } from '@/lib/utils';
import { Package, ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react';

interface InventoryItem {
    product_type: string;
    total_in: number;
    total_out: number;
    last_updated?: string;
}

function useInventory() {
    return useQuery({
        queryKey: ['inventory'],
        queryFn: async () => {
            const { data } = await apiClient.get<InventoryItem[]>('/api/inventory');
            return data;
        },
        refetchInterval: 10000,
    });
}

export default function Inventory() {
    const { data: inventory, isLoading, refetch, isRefetching } = useInventory();

    return (
        <div className="min-h-screen">
            <Header title="Inventory" subtitle="Track stock levels" actions={
                <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                    <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
                </Button>
            } />

            <div className="p-4 md:p-6 space-y-6">
                {/* Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><Package className="h-6 w-6 text-primary" /></div>
                            <div><p className="text-2xl font-bold">{inventory?.length ?? 0}</p><p className="text-sm text-muted-foreground">Products</p></div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center"><ArrowDownLeft className="h-6 w-6 text-success" /></div>
                            <div><p className="text-2xl font-bold">{inventory?.reduce((s, i) => s + i.total_in, 0) ?? 0}</p><p className="text-sm text-muted-foreground">Total IN</p></div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center"><ArrowUpRight className="h-6 w-6 text-destructive" /></div>
                            <div><p className="text-2xl font-bold">{inventory?.reduce((s, i) => s + i.total_out, 0) ?? 0}</p><p className="text-sm text-muted-foreground">Total OUT</p></div>
                        </CardContent>
                    </Card>
                </div>

                {/* Table */}
                <Card>
                    <CardHeader><CardTitle>Product Inventory</CardTitle></CardHeader>
                    <CardContent>
                        {isLoading ? <Skeleton className="h-[300px] w-full" /> : inventory?.length ? (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-border">
                                            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase">Product</th>
                                            <th className="text-center py-3 px-4 text-xs font-medium text-muted-foreground uppercase">IN</th>
                                            <th className="text-center py-3 px-4 text-xs font-medium text-muted-foreground uppercase">OUT</th>
                                            <th className="text-center py-3 px-4 text-xs font-medium text-muted-foreground uppercase">Net</th>
                                            <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground uppercase">Updated</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {inventory.map((item, i) => {
                                            const net = item.total_in - item.total_out;
                                            return (
                                                <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                                    <td className="py-4 px-4 font-medium">{item.product_type}</td>
                                                    <td className="py-4 px-4 text-center"><Badge variant="success">{item.total_in}</Badge></td>
                                                    <td className="py-4 px-4 text-center"><Badge variant="destructive">{item.total_out}</Badge></td>
                                                    <td className="py-4 px-4 text-center"><span className={cn('font-bold', net > 0 ? 'text-success' : net < 0 ? 'text-destructive' : '')}>{net > 0 ? '+' : ''}{net}</span></td>
                                                    <td className="py-4 px-4 text-right text-sm text-muted-foreground">{formatRelativeTime(item.last_updated)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-center py-12 text-muted-foreground">
                                <Package className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p className="text-lg font-medium">No inventory data</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
