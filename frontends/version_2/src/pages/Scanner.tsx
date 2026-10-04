import { useState, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatRelativeTime } from '@/lib/utils';
import { Scan, Camera, QrCode, FileText, Clock, RefreshCw, Upload, X, Check, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ScanEntry {
    id: string;
    barcode: string;
    batch_number: string;
    product_name: string;
    mfg_date: string;
    exp_date: string;
    rack_no: string;
    shelf_no: string;
    scanned_at: string;
    direction: string;
}

// Rack options (1-10)
const RACK_OPTIONS = Array.from({ length: 10 }, (_, i) => `Rack ${i + 1}`);
// Shelf options (A-E)
const SHELF_OPTIONS = ['Shelf A', 'Shelf B', 'Shelf C', 'Shelf D', 'Shelf E'];

function useScans() {
    return useQuery({
        queryKey: ['scans'],
        queryFn: async () => {
            const { data } = await apiClient.get<ScanEntry[]>('/api/scans');
            return data;
        },
    });
}

export default function Scanner() {
    const queryClient = useQueryClient();
    const { data: scans, isLoading, refetch, isRefetching } = useScans();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // Modal states
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [showImageUpload, setShowImageUpload] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Form state for manual entry
    const [formData, setFormData] = useState({
        barcode: '',
        product_name: '',
        batch_number: '',
        mfg_date: '',
        exp_date: '',
        rack_no: '',
        shelf_no: '',
        direction: 'IN'
    });

    // Add scan mutation
    const addScanMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            const { data: result } = await apiClient.post('/api/scans', data);
            return result;
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['scans'] });
            setShowManualEntry(false);
            resetForm();

            if (result.is_expired) {
                toast.warning(`⚠️ Product expired ${Math.abs(result.days_until_expiry)} days ago!`);
            } else if (result.days_until_expiry !== null && result.days_until_expiry <= 30) {
                toast.warning(`⏰ Expires in ${result.days_until_expiry} days`);
            } else {
                toast.success('✅ Scan added successfully');
            }
        },
        onError: () => {
            toast.error('Failed to add scan');
        }
    });

    // Delete scan mutation
    const deleteScanMutation = useMutation({
        mutationFn: async (scanId: string) => {
            await apiClient.delete(`/api/scans/${scanId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['scans'] });
            toast.success('Scan deleted');
        }
    });

    const resetForm = () => {
        setFormData({ barcode: '', product_name: '', batch_number: '', mfg_date: '', exp_date: '', rack_no: '', shelf_no: '', direction: 'IN' });
        setPreviewImage(null);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.barcode.trim() && !formData.batch_number.trim()) {
            toast.error('Barcode or Batch Number is required');
            return;
        }
        addScanMutation.mutate(formData);
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Create image preview
        const imageUrl = URL.createObjectURL(file);
        setPreviewImage(imageUrl);

        setIsScanning(true);
        const formDataUpload = new FormData();
        formDataUpload.append('image', file);

        try {
            const { data } = await apiClient.post<{
                success: boolean;
                batch_no?: string;
                mfg_date?: string;
                expiry_date?: string;
                flavour?: string;
                raw_text?: string;
                error?: string;
            }>('/api/ocr/scan', formDataUpload, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            // Always open manual entry form after scan attempt
            setShowImageUpload(false);
            setShowManualEntry(true);

            if (data.success && (data.batch_no || data.mfg_date || data.expiry_date || data.flavour)) {
                // Auto-fill form with OCR results
                setFormData(prev => ({
                    ...prev,
                    batch_number: data.batch_no || prev.batch_number,
                    mfg_date: data.mfg_date || prev.mfg_date,
                    exp_date: data.expiry_date || prev.exp_date,
                    product_name: data.flavour || prev.product_name,
                    barcode: data.batch_no || prev.barcode
                }));
                toast.success('📸 Label scanned! Please verify the details.');
            } else if (data.raw_text) {
                // OCR worked but couldn't parse - show raw text
                toast.warning(`OCR found text but couldn't parse it. Please enter details manually.`);
                console.log('OCR Raw Text:', data.raw_text);
            } else {
                toast.error(data.error || 'Could not extract data. Please enter details manually.');
            }
        } catch (err) {
            console.error('OCR Error:', err);
            toast.error('OCR scan failed. Please use manual entry.');
            setShowImageUpload(false);
            setShowManualEntry(true);
        } finally {
            setIsScanning(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            if (cameraInputRef.current) cameraInputRef.current.value = '';
        }
    };

    const handleCameraCapture = () => {
        cameraInputRef.current?.click();
    };

    const isExpired = (expDate: string) => {
        if (!expDate) return false;
        // Handle DD/MM/YY format
        let date = new Date(expDate);
        if (isNaN(date.getTime()) && expDate.includes('/')) {
            const parts = expDate.split('/');
            if (parts.length === 3) {
                let year = parseInt(parts[2]);
                if (year < 100) year += 2000;
                date = new Date(year, parseInt(parts[1]) - 1, parseInt(parts[0]));
            }
        }
        return date < new Date();
    };

    const getDaysUntilExpiry = (expDate: string) => {
        if (!expDate) return null;
        let date = new Date(expDate);
        if (isNaN(date.getTime()) && expDate.includes('/')) {
            const parts = expDate.split('/');
            if (parts.length === 3) {
                let year = parseInt(parts[2]);
                if (year < 100) year += 2000;
                date = new Date(year, parseInt(parts[1]) - 1, parseInt(parts[0]));
            }
        }
        const days = Math.ceil((date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        return days;
    };

    return (
        <div className="min-h-screen">
            <Header title="Label Scanner" subtitle="Product OCR & barcodes" actions={
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                        <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button onClick={() => setShowManualEntry(true)}>
                        <FileText className="h-4 w-4 mr-1" /> Add Entry
                    </Button>
                </div>
            } />

            {/* Hidden camera input */}
            <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleImageUpload(e)}
            />

            <div className="p-4 md:p-6 space-y-6">
                {/* Quick Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card hover className="cursor-pointer" onClick={handleCameraCapture}>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                                <Camera className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <p className="font-medium">Capture Label</p>
                                <p className="text-sm text-muted-foreground">Camera OCR</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card hover className="cursor-pointer" onClick={() => setShowImageUpload(true)}>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                                <QrCode className="h-6 w-6 text-success" />
                            </div>
                            <div>
                                <p className="font-medium">Upload Image</p>
                                <p className="text-sm text-muted-foreground">OCR from file</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card hover className="cursor-pointer" onClick={() => setShowManualEntry(true)}>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                                <FileText className="h-6 w-6 text-warning" />
                            </div>
                            <div>
                                <p className="font-medium">Manual Entry</p>
                                <p className="text-sm text-muted-foreground">Enter details</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Manual Entry Modal */}
                {showManualEntry && (
                    <Card className="border-2 border-primary">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5" /> {formData.batch_number ? 'Verify Scanned Data' : 'Manual Entry'}
                            </CardTitle>
                            <Button variant="ghost" size="sm" onClick={() => { setShowManualEntry(false); resetForm(); }}>
                                <X className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {/* Image Preview */}
                            {previewImage && (
                                <div className="mb-4 flex items-start gap-4">
                                    <div className="relative">
                                        <img
                                            src={previewImage}
                                            alt="Scanned label"
                                            className="w-32 h-32 object-cover rounded-lg border-2 border-muted"
                                        />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full bg-destructive text-destructive-foreground"
                                            onClick={() => setPreviewImage(null)}
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        <p className="font-medium text-foreground">Scanned Image</p>
                                        <p>Verify the extracted details below</p>
                                    </div>
                                </div>
                            )}
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Barcode / ID</label>
                                        <Input
                                            placeholder="Enter barcode or product ID"
                                            value={formData.barcode}
                                            onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Batch Number *</label>
                                        <Input
                                            placeholder="e.g. 25-8902-0014"
                                            value={formData.batch_number}
                                            onChange={(e) => setFormData({ ...formData, batch_number: e.target.value })}
                                            className={formData.batch_number ? 'border-success' : ''}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Product Name (Flavour)</label>
                                        <Input
                                            placeholder="Product name / Flavour"
                                            value={formData.product_name}
                                            onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Manufacture Date</label>
                                        <Input
                                            placeholder="DD/MM/YY"
                                            value={formData.mfg_date}
                                            onChange={(e) => setFormData({ ...formData, mfg_date: e.target.value })}
                                            className={formData.mfg_date ? 'border-success' : ''}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Expiry Date</label>
                                        <Input
                                            placeholder="DD/MM/YY"
                                            value={formData.exp_date}
                                            onChange={(e) => setFormData({ ...formData, exp_date: e.target.value })}
                                            className={formData.exp_date ? 'border-success' : ''}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Direction</label>
                                        <Select
                                            value={formData.direction}
                                            onChange={(e) => setFormData({ ...formData, direction: e.target.value })}
                                        >
                                            <option value="IN">IN (Receiving)</option>
                                            <option value="OUT">OUT (Dispatching)</option>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Rack</label>
                                        <Select
                                            value={formData.rack_no}
                                            onChange={(e) => setFormData({ ...formData, rack_no: e.target.value })}
                                        >
                                            <option value="">Select Rack</option>
                                            {RACK_OPTIONS.map(rack => (
                                                <option key={rack} value={rack}>{rack}</option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Shelf</label>
                                        <Select
                                            value={formData.shelf_no}
                                            onChange={(e) => setFormData({ ...formData, shelf_no: e.target.value })}
                                        >
                                            <option value="">Select Shelf</option>
                                            {SHELF_OPTIONS.map(shelf => (
                                                <option key={shelf} value={shelf}>{shelf}</option>
                                            ))}
                                        </Select>
                                    </div>
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <Button type="submit" disabled={addScanMutation.isPending}>
                                        {addScanMutation.isPending ? 'Saving...' : <><Check className="h-4 w-4 mr-1" /> Save Entry</>}
                                    </Button>
                                    <Button type="button" variant="secondary" onClick={() => { setShowManualEntry(false); resetForm(); }}>
                                        Cancel
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                )}

                {/* Image Upload Modal */}
                {showImageUpload && (
                    <Card className="border-2 border-success">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="flex items-center gap-2">
                                <Upload className="h-5 w-5" /> Upload Label Image
                            </CardTitle>
                            <Button variant="ghost" size="sm" onClick={() => setShowImageUpload(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {isScanning ? (
                                <div className="text-center py-12">
                                    <Loader2 className="h-12 w-12 mx-auto mb-4 text-primary animate-spin" />
                                    <p className="text-lg font-medium">Scanning image...</p>
                                    <p className="text-sm text-muted-foreground mt-1">Extracting batch, dates, and product info</p>
                                </div>
                            ) : (
                                <div
                                    className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <QrCode className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                                    <p className="text-lg font-medium">Click to upload label image</p>
                                    <p className="text-sm text-muted-foreground mt-1">PNG, JPG up to 10MB</p>
                                    <p className="text-xs text-muted-foreground mt-2">We'll extract batch number, MFG & expiry dates automatically</p>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => handleImageUpload(e)}
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* History */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" /> Scan History
                            {scans && scans.length > 0 && (
                                <Badge variant="secondary">{scans.length}</Badge>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="space-y-3">
                                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
                            </div>
                        ) : scans?.length ? (
                            <div className="space-y-3">
                                {scans.map((scan) => {
                                    const expired = isExpired(scan.exp_date);
                                    const daysLeft = getDaysUntilExpiry(scan.exp_date);

                                    return (
                                        <Card key={scan.id} className={`${expired ? 'bg-destructive/10 border-destructive/30' : 'bg-muted/30'}`}>
                                            <CardContent className="p-4">
                                                <div className="flex items-start justify-between">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <Badge variant={scan.direction === 'IN' ? 'success' : 'destructive'}>
                                                                {scan.direction}
                                                            </Badge>
                                                            {scan.batch_number && <Badge variant="secondary">{scan.batch_number}</Badge>}
                                                            {scan.rack_no && <Badge variant="outline">{scan.rack_no}</Badge>}
                                                            {scan.shelf_no && <Badge variant="outline">{scan.shelf_no}</Badge>}
                                                            {expired && (
                                                                <Badge variant="destructive" className="flex items-center gap-1">
                                                                    <AlertTriangle className="h-3 w-3" /> Expired
                                                                </Badge>
                                                            )}
                                                            {!expired && daysLeft !== null && daysLeft <= 30 && daysLeft > 0 && (
                                                                <Badge variant="warning" className="flex items-center gap-1">
                                                                    <Clock className="h-3 w-3" /> {daysLeft} days left
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="font-medium">{scan.product_name || 'Unknown Product'}</p>
                                                        <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                                                            {scan.mfg_date && <span>Mfg: {scan.mfg_date}</span>}
                                                            {scan.exp_date && <span>Exp: {scan.exp_date}</span>}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-muted-foreground">{formatRelativeTime(scan.scanned_at)}</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => deleteScanMutation.mutate(scan.id)}
                                                            disabled={deleteScanMutation.isPending}
                                                        >
                                                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-muted-foreground">
                                <Scan className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p className="text-lg font-medium">No scans yet</p>
                                <p className="text-sm mt-1">Click "Capture Label" or "Manual Entry" to add your first scan</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
