import { Navigate } from 'react-router-dom';
import { storage } from '@/lib/utils';

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const token = storage.get<string | null>('auth_token', null);
    if (!token) {
        return <Navigate to="/login" replace />;
    }
    return <>{children}</>;
}
