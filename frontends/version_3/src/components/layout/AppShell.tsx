import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/lib/utils';
import { Toaster } from 'sonner';

export function AppShell() {
    const { sidebarCollapsed } = useSettingsStore();

    return (
        <div className="min-h-screen bg-background">
            <Sidebar />

            <main className={cn(
                'min-h-screen transition-all duration-300 pb-16 md:pb-0',
                sidebarCollapsed ? 'md:pl-[72px]' : 'md:pl-64'
            )}>
                <Outlet />
            </main>

            <MobileNav />

            <Toaster
                position="top-right"
                toastOptions={{
                    style: {
                        background: 'var(--color-card)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-foreground)',
                    },
                }}
            />
        </div>
    );
}
