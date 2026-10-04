import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/layout/AuthGuard';
import { useHealthCheck } from '@/api/hooks/useDetections';
import { Suspense, lazy, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from 'sonner';

// Lazy load pages
const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const LiveDetection = lazy(() => import('@/pages/LiveDetection'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const Inventory = lazy(() => import('@/pages/Inventory'));
const Faces = lazy(() => import('@/pages/Faces'));
const Scanner = lazy(() => import('@/pages/Scanner'));
const Trucks = lazy(() => import('@/pages/Trucks'));
const Compression = lazy(() => import('@/pages/Compression'));
const Settings = lazy(() => import('@/pages/Settings'));
const Jobs = lazy(() => import('@/pages/Jobs'));
const Shifts = lazy(() => import('@/pages/Shifts'));
const Reports = lazy(() => import('@/pages/Reports'));
const ModelEval = lazy(() => import('@/pages/ModelEval'));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

function PageLoader() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

function HealthChecker({ children }: { children: React.ReactNode }) {
  useHealthCheck();
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Suspense fallback={<PageLoader />}><Login /></Suspense>} />
      <Route path="/" element={<AuthGuard><AppShell /></AuthGuard>}>
        <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
        <Route path="live" element={<Suspense fallback={<PageLoader />}><LiveDetection /></Suspense>} />
        <Route path="analytics" element={<Suspense fallback={<PageLoader />}><Analytics /></Suspense>} />
        <Route path="inventory" element={<Suspense fallback={<PageLoader />}><Inventory /></Suspense>} />
        <Route path="faces" element={<Suspense fallback={<PageLoader />}><Faces /></Suspense>} />
        <Route path="scanner" element={<Suspense fallback={<PageLoader />}><Scanner /></Suspense>} />
        <Route path="trucks" element={<Suspense fallback={<PageLoader />}><Trucks /></Suspense>} />
        <Route path="compression" element={<Suspense fallback={<PageLoader />}><Compression /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
        <Route path="jobs" element={<Suspense fallback={<PageLoader />}><Jobs /></Suspense>} />
        <Route path="shifts" element={<Suspense fallback={<PageLoader />}><Shifts /></Suspense>} />
        <Route path="reports" element={<Suspense fallback={<PageLoader />}><Reports /></Suspense>} />
        <Route path="eval" element={<Suspense fallback={<PageLoader />}><ModelEval /></Suspense>} />

      </Route>
    </Routes>
  );
}

export default function App() {
  useEffect(() => { document.title = 'AI CCTV | Management Console'; }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <HealthChecker>
          <AppRoutes />
        </HealthChecker>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
