import axios, { type AxiosInstance, type AxiosError } from 'axios';
import { storage } from '@/lib/utils';
import { toast } from 'sonner';

const API_URL_KEY = 'ai_cctv_api_url_v3';
const DEFAULT_API_URL = 'http://localhost:5000';

export function getApiUrl(): string {
    let url = storage.get(API_URL_KEY, DEFAULT_API_URL);
    // Clean up URL - remove quotes and trailing slashes
    url = url.replace(/['"]/g, '').replace(/\/+$/, '');
    return url;
}

export function setApiUrl(url: string): void {
    // Clean URL before storing
    const cleanUrl = url.replace(/['"]/g, '').replace(/\/+$/, '').trim();
    storage.set(API_URL_KEY, cleanUrl);
}

function createApiClient(): AxiosInstance {
    const client = axios.create({
        timeout: 30000,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            'User-Agent': 'AI-CCTV-Frontend/3.0',
        },
    });

    // Request interceptor
    client.interceptors.request.use(
        (config) => {
            config.baseURL = getApiUrl();

            const token = storage.get<string | null>('auth_token', null);
            if (token) {
                config.headers['Authorization'] = `Bearer ${token}`;
            }

            return config;
        },
        (error) => Promise.reject(error)
    );

    // Response interceptor with error handling
    client.interceptors.response.use(
        (response) => response,
        (error: AxiosError<{ error?: string }>) => {
            const status = error.response?.status;
            const message = error.response?.data?.error || error.message;

            if (status === 401) {
                storage.remove('auth_token');
                toast.error('Session expired. Please login again.');
            } else if (status === 500) {
                toast.error('Server error. Please try again.');
            } else if (status === 504) {
                toast.error('Backend timeout. Colab may be sleeping.');
            } else if (!error.response) {
                toast.error('Network error. Check your connection.');
            }

            return Promise.reject(error);
        }
    );

    return client;
}

export const apiClient = createApiClient();
