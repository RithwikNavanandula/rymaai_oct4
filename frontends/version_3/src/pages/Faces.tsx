import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/apiClient';
import { useQuery } from '@tanstack/react-query';
import { formatRelativeTime } from '@/lib/utils';
import { Users, UserPlus, Camera, Search, RefreshCw } from 'lucide-react';

interface Face {
    id: number;
    name: string;
    created_at: string;
}

function useFaces() {
    return useQuery({
        queryKey: ['faces'],
        queryFn: async () => {
            const { data } = await apiClient.get<Face[]>('/api/faces');
            return data;
        },
    });
}

export default function Faces() {
    const { data: faces, isLoading, refetch, isRefetching } = useFaces();

    return (
        <div className="min-h-screen">
            <Header title="Faces" subtitle="Face recognition management" actions={
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                        <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button><UserPlus className="h-4 w-4" /> Register</Button>
                </div>
            } />

            <div className="p-4 md:p-6 space-y-6">
                {/* Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card><CardContent className="p-6 flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><Users className="h-6 w-6 text-primary" /></div><div><p className="text-2xl font-bold">{faces?.length ?? 0}</p><p className="text-sm text-muted-foreground">Registered</p></div></CardContent></Card>
                    <Card hover className="cursor-pointer"><CardContent className="p-6 flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center"><Camera className="h-6 w-6 text-success" /></div><div><p className="font-medium">Capture Face</p><p className="text-sm text-muted-foreground">Use webcam</p></div></CardContent></Card>
                    <Card hover className="cursor-pointer"><CardContent className="p-6 flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center"><Search className="h-6 w-6 text-warning" /></div><div><p className="font-medium">Search Face</p><p className="text-sm text-muted-foreground">Find person</p></div></CardContent></Card>
                </div>

                {/* Gallery */}
                <Card>
                    <CardHeader><CardTitle>Registered Faces</CardTitle></CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {[...Array(10)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
                            </div>
                        ) : faces?.length ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {faces.map((face) => (
                                    <Card key={face.id} hover className="cursor-pointer overflow-hidden">
                                        <div className="aspect-square bg-muted flex items-center justify-center"><Users className="h-12 w-12 text-muted-foreground" /></div>
                                        <CardContent className="p-3"><p className="font-medium text-sm truncate">{face.name}</p><p className="text-xs text-muted-foreground">{formatRelativeTime(face.created_at)}</p></CardContent>
                                    </Card>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-muted-foreground">
                                <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p className="text-lg font-medium">No faces registered</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
