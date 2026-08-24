import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2Icon } from 'lucide-react';
import type { UserPublic } from '@nya/shared';
import { api } from './api/client';
import { getBasePath } from './basePath';
import { AuthContext } from './auth';
import LoginPage from './pages/LoginPage';
import DeskPage from './pages/DeskPage';
import AdminLayout from './pages/admin/AdminLayout';
import SessionsPage from './pages/admin/SessionsPage';
import LivePage from './pages/admin/LivePage';
import UsersPage from './pages/admin/UsersPage';
import ProxiesPage from './pages/admin/ProxiesPage';
import AuditPage from './pages/admin/AuditPage';
import MonitorPage from './pages/admin/MonitorPage';
import BackupsPage from './pages/admin/BackupsPage';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import './styles.css';

export default function App() {
  const [user, setUser] = useState<UserPublic | null | undefined>(undefined);

  const refresh = async () => {
    try {
      const me = await api.me();
      setUser(me.user);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <TooltipProvider>
      <div className="nya-app">
        {user === undefined ? (
          <div className="flex h-full items-center justify-center">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : user === null ? (
          <LoginPage onOk={() => void refresh()} />
        ) : (
          <AuthContext.Provider value={{ user, refresh }}>
            <BrowserRouter basename={getBasePath()}>
              <Routes>
                <Route path="/" element={<DeskPage />} />
                <Route
                  path="/admin"
                  element={user.role === 'admin' ? <AdminLayout /> : <Navigate to="/" replace />}
                >
                  <Route index element={<Navigate to="sessions" replace />} />
                  <Route path="sessions" element={<SessionsPage />} />
                  <Route path="live" element={<LivePage />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="proxies" element={<ProxiesPage />} />
                  <Route path="audit" element={<AuditPage />} />
                  <Route path="monitor" element={<MonitorPage />} />
                  <Route path="backups" element={<BackupsPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthContext.Provider>
        )}
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
