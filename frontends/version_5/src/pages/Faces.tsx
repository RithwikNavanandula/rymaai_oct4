import { useState, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';
import { Users, UserPlus, Camera, Search, RefreshCw, Trash2, X, Upload, Loader2 } from 'lucide-react';

interface Face { id: number; name: string; created_at: string; }

function useFaces() {
    return useQuery({
        queryKey: ['faces'],
        queryFn: async () => { const { data } = await apiClient.get<Face[]>('/api/faces'); return data; },
    });
}

export default function Faces() {
    const { data: faces, isLoading, refetch, isRefetching } = useFaces();
    const queryClient = useQueryClient();

    // Modal state
    const [showRegister, setShowRegister] = useState(false);
    const [showWebcam, setShowWebcam] = useState(false);
    const [name, setName] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const registerMutation = useMutation({
        mutationFn: async () => {
            await apiClient.post('/api/faces', { name });
        },
        onSuccess: () => {
            toast.success(`Face "${name}" registered`);
            setShowRegister(false);
            setName('');
            setImageFile(null);
            queryClient.invalidateQueries({ queryKey: ['faces'] });
        },
        onError: () => toast.error('Failed to register face'),
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => { await apiClient.delete(`/api/faces/${id}`); },
        onSuccess: () => {
            toast.success('Face removed');
            queryClient.invalidateQueries({ queryKey: ['faces'] });
        },
        onError: () => toast.error('Failed to delete face'),
    });

    return (
        <div className="min-h-screen">
            <Header title="Faces" subtitle="Face recognition management" actions={
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                        <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button onClick={() => setShowRegister(true)}><UserPlus className="h-4 w-4" /> Register</Button>
                </div>
            } />

            <div className="p-4 md:p-6 space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card><CardContent className="p-6 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><Users className="h-6 w-6 text-primary" /></div>
                        <div><p className="text-2xl font-bold">{faces?.length ?? 0}</p><p className="text-sm text-muted-foreground">Registered</p></div>
                    </CardContent></Card>
                    <Card hover className="cursor-pointer" onClick={() => setShowWebcam(true)}><CardContent className="p-6 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center"><Camera className="h-6 w-6 text-success" /></div>
                        <div><p className="font-medium">Capture Face</p><p className="text-sm text-muted-foreground">Use webcam</p></div>
                    </CardContent></Card>
                    <Card hover className="cursor-pointer"><CardContent className="p-6 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center"><Search className="h-6 w-6 text-warning" /></div>
                        <div><p className="font-medium">Search Face</p><p className="text-sm text-muted-foreground">Find person</p></div>
                    </CardContent></Card>
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
                                    <Card key={face.id} className="overflow-hidden group relative">
                                        <div className="aspect-square bg-muted flex items-center justify-center">
                                            <Users className="h-12 w-12 text-muted-foreground" />
                                        </div>
                                        <CardContent className="p-3">
                                            <p className="font-medium text-sm truncate">{face.name}</p>
                                            <p className="text-xs text-muted-foreground">{formatRelativeTime(face.created_at)}</p>
                                        </CardContent>
                                        <button
                                            onClick={() => deleteMutation.mutate(face.id)}
                                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-destructive/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </Card>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-muted-foreground">
                                <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p className="text-lg font-medium">No faces registered</p>
                                <p className="text-sm mt-1">Click Register to add a person</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Register Modal */}
            {showRegister && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <Card className="w-full max-w-md">
                        <CardHeader className="flex flex-row items-center justify-between pb-4">
                            <CardTitle>Register Face</CardTitle>
                            <button onClick={() => setShowRegister(false)} className="p-1 rounded hover:bg-muted transition-colors">
                                <X className="h-5 w-5" />
                            </button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Name *</label>
                                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Enter person's name" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Photo (optional)</label>
                                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => setImageFile(e.target.files?.[0] ?? null)} />
                                <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                                    {imageFile ? (
                                        <p className="text-sm font-medium">{imageFile.name}</p>
                                    ) : (
                                        <><Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" /><p className="text-sm text-muted-foreground">Click to upload face image</p></>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <Button variant="secondary" className="flex-1" onClick={() => setShowRegister(false)}>Cancel</Button>
                                <Button className="flex-1" disabled={!name.trim() || registerMutation.isPending} onClick={() => registerMutation.mutate()}>
                                    {registerMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : 'Register'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Webcam Notice Modal */}
            {showWebcam && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <Card className="w-full max-w-sm">
                        <CardHeader className="flex flex-row items-center justify-between pb-4">
                            <CardTitle>Webcam Capture</CardTitle>
                            <button onClick={() => setShowWebcam(false)} className="p-1 rounded hover:bg-muted"><X className="h-5 w-5" /></button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                                <Camera className="h-12 w-12 text-muted-foreground opacity-50" />
                            </div>
                            <p className="text-sm text-muted-foreground text-center">Webcam live capture coming soon. Use file upload for now.</p>
                            <Button className="w-full" onClick={() => { setShowWebcam(false); setShowRegister(true); }}>
                                <Upload className="h-4 w-4" /> Upload Image Instead
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
