import { useState, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
    Camera, Video, Search, X, Loader2, User,
    Pause, MoreVertical, WifiOff,
    Maximize2, Volume2, Pencil, Trash2
} from 'lucide-react';

// Mock camera data
const MOCK_CAMERAS = [
    { id: 1, name: 'Main Entrance', location: 'Building A', status: 'online', ip: '192.168.1.101', fps: 30 },
    { id: 2, name: 'Warehouse Gate', location: 'Loading Dock', status: 'online', ip: '192.168.1.102', fps: 25 },
    { id: 3, name: 'Parking Lot A', location: 'Outdoor', status: 'online', ip: '192.168.1.103', fps: 30 },
    { id: 4, name: 'Server Room', location: 'Building B', status: 'offline', ip: '192.168.1.104', fps: 0 },
    { id: 5, name: 'Reception', location: 'Building A', status: 'online', ip: '192.168.1.105', fps: 30 },
    { id: 6, name: 'Back Exit', location: 'Building A', status: 'online', ip: '192.168.1.106', fps: 25 },
];

interface CameraData {
    id: number;
    name: string;
    location: string;
    status: string;
    ip: string;
    fps: number;
}

interface SearchResult {
    cameraId: number;
    cameraName: string;
    timestamp: string;
    confidence: number;
    thumbnail?: string;
}

export default function Cameras() {
    const [cameras, setCameras] = useState<CameraData[]>(MOCK_CAMERAS);
    const [selectedCamera, setSelectedCamera] = useState<number | null>(null);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const [searchImage, setSearchImage] = useState<string | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Dropdown & Edit state
    const [openDropdown, setOpenDropdown] = useState<number | null>(null);
    const [editingCamera, setEditingCamera] = useState<CameraData | null>(null);
    const [editName, setEditName] = useState('');
    const [editLocation, setEditLocation] = useState('');

    const handleSearchClick = () => {
        setShowSearchModal(true);
        setSearchImage(null);
        setSearchResults([]);
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            setSearchImage(event.target?.result as string);
        };
        reader.readAsDataURL(file);
    };

    const handleStartSearch = async () => {
        if (!searchImage) {
            toast.error('Please upload an image first');
            return;
        }

        setIsSearching(true);

        // Simulate face search across cameras
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Mock results
        const mockResults: SearchResult[] = [
            { cameraId: 1, cameraName: 'Main Entrance', timestamp: '2026-01-26 11:45:23', confidence: 94.5 },
            { cameraId: 2, cameraName: 'Warehouse Gate', timestamp: '2026-01-26 11:32:15', confidence: 87.2 },
            { cameraId: 5, cameraName: 'Reception', timestamp: '2026-01-26 10:58:42', confidence: 91.8 },
        ];

        setSearchResults(mockResults);
        setIsSearching(false);
        toast.success(`Found ${mockResults.length} matches across cameras`);
    };

    const handleEditCamera = (camera: CameraData) => {
        setEditingCamera(camera);
        setEditName(camera.name);
        setEditLocation(camera.location);
        setOpenDropdown(null);
    };

    const handleSaveEdit = () => {
        if (!editingCamera) return;
        setCameras(cameras.map(c =>
            c.id === editingCamera.id
                ? { ...c, name: editName, location: editLocation }
                : c
        ));
        toast.success(`Camera "${editName}" updated`);
        setEditingCamera(null);
    };

    const handleDeleteCamera = (camera: CameraData) => {
        setCameras(cameras.filter(c => c.id !== camera.id));
        toast.success(`Camera "${camera.name}" deleted`);
        setOpenDropdown(null);
    };

    const onlineCount = cameras.filter(c => c.status === 'online').length;

    return (
        <div className="min-h-screen">
            <Header title="Cameras" subtitle="Live Camera Feeds & Face Search" />

            <div className="p-4 md:p-6 space-y-6">
                {/* Stats Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-success animate-pulse" />
                            <span className="text-sm">{onlineCount} Online</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-muted" />
                            <span className="text-sm text-muted-foreground">{cameras.length - onlineCount} Offline</span>
                        </div>
                    </div>

                    <Button onClick={handleSearchClick} className="gap-2">
                        <Search className="h-4 w-4" />
                        Search Faces
                    </Button>
                </div>

                {/* Camera Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {cameras.map((camera) => (
                        <Card
                            key={camera.id}
                            className={`overflow-hidden cursor-pointer transition-all ${selectedCamera === camera.id ? 'ring-2 ring-primary' : ''
                                } ${camera.status === 'offline' ? 'opacity-60' : ''}`}
                            onClick={() => setSelectedCamera(camera.id)}
                        >
                            {/* Video Feed Placeholder */}
                            <div className="relative aspect-video bg-black">
                                {camera.status === 'online' ? (
                                    <>
                                        {/* Simulated video feed */}
                                        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center">
                                            <Video className="h-12 w-12 text-muted-foreground/30" />
                                        </div>

                                        {/* Live indicator */}
                                        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-red-500/90 rounded text-xs text-white font-medium">
                                            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                            LIVE
                                        </div>

                                        {/* FPS */}
                                        <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 rounded text-xs text-white">
                                            {camera.fps} FPS
                                        </div>

                                        {/* Controls overlay */}
                                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 hover:opacity-100 transition-opacity">
                                            <div className="flex items-center justify-between">
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-white hover:bg-white/20">
                                                        <Pause className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-white hover:bg-white/20">
                                                        <Volume2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-white hover:bg-white/20">
                                                    <Maximize2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                        <WifiOff className="h-10 w-10" />
                                        <span className="text-sm">Camera Offline</span>
                                    </div>
                                )}
                            </div>

                            {/* Camera Info */}
                            <CardContent className="p-3">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h3 className="font-medium flex items-center gap-2">
                                            {camera.name}
                                            <Badge variant={camera.status === 'online' ? 'success' : 'secondary'} className="text-[10px]">
                                                {camera.status}
                                            </Badge>
                                        </h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">{camera.location}</p>
                                        <p className="text-xs text-muted-foreground font-mono">{camera.ip}</p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 relative"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenDropdown(openDropdown === camera.id ? null : camera.id);
                                        }}
                                    >
                                        <MoreVertical className="h-4 w-4" />
                                    </Button>

                                    {/* Dropdown Menu */}
                                    {openDropdown === camera.id && (
                                        <div className="absolute right-0 top-full mt-1 z-20 bg-card border rounded-lg shadow-lg py-1 min-w-[140px]">
                                            <button
                                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEditCamera(camera);
                                                }}
                                            >
                                                <Pencil className="h-4 w-4" />
                                                Edit Camera
                                            </button>
                                            <button
                                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-destructive"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteCamera(camera);
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                Delete Camera
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>

            {/* Face Search Modal */}
            {showSearchModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <Card className="w-full max-w-lg mx-4 max-h-[90vh] overflow-auto">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="flex items-center gap-2">
                                <Search className="h-5 w-5" />
                                Search Faces Across Cameras
                            </CardTitle>
                            <Button variant="ghost" size="sm" onClick={() => setShowSearchModal(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Upload Area */}
                            <div
                                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageUpload}
                                    className="hidden"
                                />

                                {searchImage ? (
                                    <div className="space-y-3">
                                        <img
                                            src={searchImage}
                                            alt="Search face"
                                            className="w-32 h-32 object-cover rounded-full mx-auto border-4 border-primary/20"
                                        />
                                        <p className="text-sm text-muted-foreground">Click to change image</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                                            <User className="h-8 w-8 text-muted-foreground" />
                                        </div>
                                        <p className="font-medium">Upload a face image</p>
                                        <p className="text-sm text-muted-foreground">Click or drag an image to search</p>
                                    </div>
                                )}
                            </div>

                            {/* Search Button */}
                            <Button
                                className="w-full gap-2"
                                onClick={handleStartSearch}
                                disabled={!searchImage || isSearching}
                            >
                                {isSearching ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Searching {cameras.filter(c => c.status === 'online').length} cameras...
                                    </>
                                ) : (
                                    <>
                                        <Search className="h-4 w-4" />
                                        Search All Cameras
                                    </>
                                )}
                            </Button>

                            {/* Search Results */}
                            {searchResults.length > 0 && (
                                <div className="space-y-3">
                                    <h3 className="font-medium text-sm">
                                        Found {searchResults.length} matches
                                    </h3>
                                    <div className="space-y-2 max-h-60 overflow-auto">
                                        {searchResults.map((result, i) => (
                                            <div
                                                key={i}
                                                className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                                                onClick={() => {
                                                    setSelectedCamera(result.cameraId);
                                                    setShowSearchModal(false);
                                                    toast.success(`Switched to ${result.cameraName}`);
                                                }}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                                        <Camera className="h-5 w-5 text-primary" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-sm">{result.cameraName}</p>
                                                        <p className="text-xs text-muted-foreground">{result.timestamp}</p>
                                                    </div>
                                                </div>
                                                <Badge variant="success">
                                                    {result.confidence.toFixed(1)}% match
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Edit Camera Modal */}
            {editingCamera && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <Card className="w-full max-w-md mx-4">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="flex items-center gap-2">
                                <Pencil className="h-5 w-5" />
                                Edit Camera
                            </CardTitle>
                            <Button variant="ghost" size="sm" onClick={() => setEditingCamera(null)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Camera Name</label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="w-full px-3 py-2 bg-muted border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Camera name"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Location</label>
                                <input
                                    type="text"
                                    value={editLocation}
                                    onChange={(e) => setEditLocation(e.target.value)}
                                    className="w-full px-3 py-2 bg-muted border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Location"
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <Button variant="outline" className="flex-1" onClick={() => setEditingCamera(null)}>
                                    Cancel
                                </Button>
                                <Button className="flex-1" onClick={handleSaveEdit}>
                                    Save Changes
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
