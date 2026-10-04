import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useDetectionStore } from '@/stores/useDetectionStore';
import {
    LayoutDashboard, Video, BarChart3, Package, Users, Scan, Truck, Film, Settings,
    ChevronLeft, ChevronRight, Circle, X, ClipboardList, Clock, FileText
} from 'lucide-react';

const navigation = [
    { name: 'Dashboard',      href: '/',           icon: LayoutDashboard },
    { name: 'Live Detection', href: '/live',        icon: Video },
    { name: 'Analytics',      href: '/analytics',   icon: BarChart3 },
    { name: 'Inventory',      href: '/inventory',   icon: Package },
    { name: 'Faces',          href: '/faces',       icon: Users },
    { name: 'Label Scanner',  href: '/scanner',     icon: Scan },
    { name: 'Trucks',         href: '/trucks',      icon: Truck },
    { name: 'Compression',    href: '/compression', icon: Film },
];

const scmNavigation = [
    { name: 'Loading Jobs',   href: '/jobs',        icon: ClipboardList },
    { name: 'Shifts',         href: '/shifts',      icon: Clock },
    { name: 'Reports',        href: '/reports',     icon: FileText },
    { name: 'Model Evaluator', href: '/eval',       icon: FileText },
];


const bottomNavigation = [
    { name: 'Settings',       href: '/settings',    icon: Settings },
];

export function Sidebar() {
    const location = useLocation();
    const { sidebarCollapsed, sidebarOpen, toggleSidebar, setSidebarOpen } = useSettingsStore();
    const { isConnected, camera } = useDetectionStore();

    return (
        <>
            {/* Mobile Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                'fixed left-0 top-0 z-50 h-screen bg-card border-r border-border flex flex-col transition-all duration-300',
                // Desktop
                'hidden md:flex',
                sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64',
            )}>
                <SidebarContent
                    collapsed={sidebarCollapsed}
                    onToggle={toggleSidebar}
                    location={location.pathname}
                    isConnected={isConnected}
                    isStreaming={camera.isStreaming}
                />
            </aside>

            {/* Mobile Drawer */}
            <aside className={cn(
                'fixed left-0 top-0 z-50 h-screen w-64 bg-card border-r border-border flex flex-col transition-transform duration-300 md:hidden',
                sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            )}>
                <SidebarContent
                    collapsed={false}
                    onToggle={() => setSidebarOpen(false)}
                    location={location.pathname}
                    isConnected={isConnected}
                    isStreaming={camera.isStreaming}
                    isMobile
                />
            </aside>
        </>
    );
}

interface SidebarContentProps {
    collapsed: boolean;
    onToggle: () => void;
    location: string;
    isConnected: boolean;
    isStreaming: boolean;
    isMobile?: boolean;
}

function SidebarContent({ collapsed, onToggle, location, isConnected, isStreaming, isMobile }: SidebarContentProps) {
    return (
        <>
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-border shrink-0">
                {!collapsed && (
                    <Link to="/" className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
                            <Video className="h-5 w-5 text-white" />
                        </div>
                        <span className="font-bold text-lg gradient-text">AI CCTV</span>
                    </Link>
                )}
                <button onClick={onToggle} className="p-2 rounded-lg hover:bg-accent transition-colors">
                    {isMobile ? <X className="h-5 w-5" /> :
                        collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                {/* Main nav */}
                <ul className="space-y-1">
                    {navigation.map((item) => {
                        const isActive = item.href === '/' ? location === '/' : location.startsWith(item.href);
                        return (
                            <li key={item.name}>
                                <Link to={item.href}
                                    className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 hover:bg-accent',
                                        isActive && 'bg-primary text-primary-foreground shadow-md',
                                        collapsed && !isMobile && 'justify-center')}
                                    title={collapsed && !isMobile ? item.name : undefined}>
                                    <item.icon className="h-5 w-5 shrink-0" />
                                    {(!collapsed || isMobile) && <span className="truncate">{item.name}</span>}
                                </Link>
                            </li>
                        );
                    })}
                </ul>

                {/* SCM section divider */}
                {(!collapsed || isMobile) && (
                    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        Supply Chain
                    </p>
                )}
                {collapsed && !isMobile && <div className="my-2 border-t border-border/50" />}
                <ul className="space-y-1">
                    {scmNavigation.map((item) => {
                        const isActive = location.startsWith(item.href);
                        return (
                            <li key={item.name}>
                                <Link to={item.href}
                                    className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 hover:bg-accent',
                                        isActive && 'bg-primary text-primary-foreground shadow-md',
                                        collapsed && !isMobile && 'justify-center')}
                                    title={collapsed && !isMobile ? item.name : undefined}>
                                    <item.icon className="h-5 w-5 shrink-0" />
                                    {(!collapsed || isMobile) && <span className="truncate">{item.name}</span>}
                                </Link>
                            </li>
                        );
                    })}
                </ul>

                {/* Bottom: Settings */}
                <div className="border-t border-border/50 pt-2 mt-2">
                    {bottomNavigation.map((item) => {
                        const isActive = location.startsWith(item.href);
                        return (
                            <Link key={item.name} to={item.href}
                                className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 hover:bg-accent',
                                    isActive && 'bg-primary text-primary-foreground shadow-md',
                                    collapsed && !isMobile && 'justify-center')}
                                title={collapsed && !isMobile ? item.name : undefined}>
                                <item.icon className="h-5 w-5 shrink-0" />
                                {(!collapsed || isMobile) && <span className="truncate">{item.name}</span>}
                            </Link>
                        );
                    })}
                </div>
            </nav>

            {/* Status */}
            <div className="p-3 border-t border-border shrink-0">
                <div className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50',
                    collapsed && !isMobile && 'justify-center'
                )}>
                    <div className="relative">
                        <Circle className={cn('h-3 w-3 fill-current', isConnected ? 'text-success' : 'text-destructive')} />
                        {isStreaming && <span className="absolute inset-0 rounded-full animate-pulse bg-success opacity-50" />}
                    </div>
                    {(!collapsed || isMobile) && (
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{isConnected ? 'Connected' : 'Offline'}</p>
                            {isStreaming && <p className="text-xs text-success truncate">Streaming</p>}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
