import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Video, BarChart3, Package, Settings } from 'lucide-react';

const mobileNav = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Detection', href: '/live', icon: Video },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Inventory', href: '/inventory', icon: Package },
    { name: 'Settings', href: '/settings', icon: Settings },
];

export function MobileNav() {
    const location = useLocation();

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border md:hidden glass">
            <div className="flex items-center justify-around py-2">
                {mobileNav.map((item) => {
                    const isActive = item.href === '/' ? location.pathname === '/' : location.pathname.startsWith(item.href);
                    return (
                        <Link
                            key={item.name}
                            to={item.href}
                            className={cn(
                                'flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors',
                                isActive ? 'text-primary' : 'text-muted-foreground'
                            )}
                        >
                            <item.icon className={cn('h-5 w-5', isActive && 'text-primary')} />
                            <span className="text-xs">{item.name}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
