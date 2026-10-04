import { useSettingsStore } from '@/stores/useSettingsStore';
import { useDetectionStore } from '@/stores/useDetectionStore';
import { AlertsBell } from '@/components/layout/AlertsBell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Menu, Activity, Wifi, WifiOff, ChevronRight, Home, LogOut } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { storage } from '@/lib/utils';

function useBreadcrumbs() {
    const location = useLocation();
    const pathnames = location.pathname.split('/').filter(Boolean);
    const breadcrumbs = [{ name: 'Home', href: '/' }];
    const labels: Record<string, string> = {
        live: 'Live Detection', analytics: 'Analytics', inventory: 'Inventory',
        faces: 'Faces', scanner: 'Label Scanner', trucks: 'Trucks',
        compression: 'Compression', settings: 'Settings',
    };
    pathnames.forEach((path, index) => {
        const href = `/${pathnames.slice(0, index + 1).join('/')}`;
        breadcrumbs.push({ name: labels[path] || path, href });
    });
    return breadcrumbs;
}

interface HeaderProps {
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
    const { setSidebarOpen } = useSettingsStore();
    const { isConnected, fps, latency, camera } = useDetectionStore();
    const breadcrumbs = useBreadcrumbs();
    const navigate = useNavigate();

    const handleLogout = () => {
        storage.remove('auth_token');
        storage.remove('auth_user');
        navigate('/login', { replace: true });
    };

    return (
        <header className="sticky top-0 z-30 bg-card/95 backdrop-blur-lg border-b border-border">
            <div className="flex items-center justify-between h-16 px-4 md:px-6">
                {/* Left */}
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setSidebarOpen(true)}>
                        <Menu className="h-5 w-5" />
                    </Button>
                    <div>
                        <nav className="hidden md:flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                            {breadcrumbs.map((crumb, index) => (
                                <div key={crumb.href} className="flex items-center gap-1">
                                    {index > 0 && <ChevronRight className="h-3 w-3" />}
                                    {index === breadcrumbs.length - 1 ? (
                                        <span className="text-foreground">{crumb.name}</span>
                                    ) : (
                                        <Link to={crumb.href} className="hover:text-foreground transition-colors">
                                            {index === 0 ? <Home className="h-3 w-3" /> : crumb.name}
                                        </Link>
                                    )}
                                </div>
                            ))}
                        </nav>
                        <h1 className="text-lg md:text-xl font-semibold">{title}</h1>
                        {subtitle && <p className="text-xs text-muted-foreground hidden md:block">{subtitle}</p>}
                    </div>
                </div>

                {/* Right */}
                <div className="flex items-center gap-2 md:gap-3">
                    {camera.isStreaming && (
                        <div className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-lg bg-muted/50 text-xs">
                            <div className="flex items-center gap-1.5">
                                <Activity className="h-3.5 w-3.5 text-success" />
                                <span className="font-mono">{fps} FPS</span>
                            </div>
                            <div className="w-px h-4 bg-border" />
                            <span className="text-muted-foreground">Latency: <span className="font-mono">{latency}ms</span></span>
                        </div>
                    )}

                    <Badge variant={isConnected ? 'success' : 'destructive'} className="gap-1">
                        {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        <span className="hidden sm:inline">{isConnected ? 'Online' : 'Offline'}</span>
                    </Badge>

                    {actions}

                    <AlertsBell />

                    <Button variant="ghost" size="icon-sm" onClick={handleLogout} title="Logout">
                        <LogOut className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </header>
    );
}
