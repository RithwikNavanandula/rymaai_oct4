import { useLayoutEffect } from 'react';
import { useSettingsStore, type ColorTheme } from '@/stores/useSettingsStore';

// Theme CSS imports - these are loaded dynamically
const themeImports: Record<ColorTheme, () => Promise<unknown>> = {
    'default': () => Promise.resolve(),
    'industrial-security': () => import('@/styles/themes/industrial-security.css'),
    'modern-saas': () => import('@/styles/themes/modern-saas.css'),
    'corporate-enterprise': () => import('@/styles/themes/corporate-enterprise.css'),
    'futuristic-tech': () => import('@/styles/themes/futuristic-tech.css'),
    'soft-friendly': () => import('@/styles/themes/soft-friendly.css'),
    'midnight-ocean': () => import('@/styles/themes/midnight-ocean.css'),
};

let currentThemeStylesheet: HTMLStyleElement | null = null;

export function useTheme() {
    const { colorTheme, setColorTheme } = useSettingsStore();

    useLayoutEffect(() => {
        // Set data attribute on document for CSS targeting
        document.documentElement.setAttribute('data-theme', colorTheme);

        // Load theme CSS dynamically
        if (colorTheme !== 'default') {
            themeImports[colorTheme]().catch(console.error);
        }

        return () => {
            // Cleanup on theme change
            if (currentThemeStylesheet) {
                currentThemeStylesheet.remove();
                currentThemeStylesheet = null;
            }
        };
    }, [colorTheme]);

    return {
        colorTheme,
        setColorTheme,
    };
}
