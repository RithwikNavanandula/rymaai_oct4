import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ColorTheme =
    | 'default'
    | 'industrial-security'
    | 'modern-saas'
    | 'corporate-enterprise'
    | 'futuristic-tech'
    | 'soft-friendly'
    | 'midnight-ocean';

export const themeLabels: Record<ColorTheme, string> = {
    'default': 'Default (Purple)',
    'industrial-security': 'Industrial Security',
    'modern-saas': 'Modern SaaS',
    'corporate-enterprise': 'Corporate Enterprise',
    'futuristic-tech': 'Futuristic Tech',
    'soft-friendly': 'Soft & Friendly',
    'midnight-ocean': 'Midnight Ocean',
};

export const themeDescriptions: Record<ColorTheme, string> = {
    'default': 'Purple accents, dark professional',
    'industrial-security': 'Red alerts, surveillance focused',
    'modern-saas': 'Minimal black & white, blue accents',
    'corporate-enterprise': 'Professional blue, enterprise look',
    'futuristic-tech': 'Cyan neon, cyberpunk aesthetic',
    'soft-friendly': 'Orange, warm & rounded',
    'midnight-ocean': 'Teal gradients, calm & elegant',
};

interface SettingsState {
    // API
    apiUrl: string;
    setApiUrl: (url: string) => void;

    // Color Theme
    colorTheme: ColorTheme;
    setColorTheme: (theme: ColorTheme) => void;

    // Sidebar
    sidebarCollapsed: boolean;
    sidebarOpen: boolean;
    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;

    // Detection
    confidenceThreshold: number;
    setConfidenceThreshold: (threshold: number) => void;
    targetFps: number;
    setTargetFps: (fps: number) => void;

    // Preferences
    showFpsCounter: boolean;
    setShowFpsCounter: (show: boolean) => void;
    autoRefreshInterval: number;
    setAutoRefreshInterval: (interval: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            // API
            apiUrl: 'http://localhost:5000',
            setApiUrl: (url) => set({ apiUrl: url }),

            // Color Theme
            colorTheme: 'default',
            setColorTheme: (theme) => set({ colorTheme: theme }),

            // Sidebar
            sidebarCollapsed: false,
            sidebarOpen: false,
            toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
            setSidebarOpen: (open) => set({ sidebarOpen: open }),

            // Detection
            confidenceThreshold: 0.5,
            setConfidenceThreshold: (threshold) => set({ confidenceThreshold: threshold }),
            targetFps: 2,
            setTargetFps: (fps) => set({ targetFps: fps }),

            // Preferences
            showFpsCounter: true,
            setShowFpsCounter: (show) => set({ showFpsCounter: show }),
            autoRefreshInterval: 5,
            setAutoRefreshInterval: (interval) => set({ autoRefreshInterval: interval }),
        }),
        {
            name: 'ai-cctv-v3-settings',
        }
    )
);
