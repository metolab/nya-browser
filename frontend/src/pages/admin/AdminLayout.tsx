import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  ActivityIcon,
  CloudIcon,
  GlobeIcon,
  LaptopIcon,
  LogOutIcon,
  MonitorIcon,
  PanelsTopLeftIcon,
  ScrollTextIcon,
  UsersIcon,
} from 'lucide-react';
import { useAuth } from '../../auth';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const items = [
  { key: '/admin/sessions', icon: LaptopIcon, label: '会话' },
  { key: '/admin/live', icon: MonitorIcon, label: '在线' },
  { key: '/admin/users', icon: UsersIcon, label: '用户' },
  { key: '/admin/proxies', icon: GlobeIcon, label: '代理' },
  { key: '/admin/audit', icon: ScrollTextIcon, label: '审计' },
  { key: '/admin/monitor', icon: ActivityIcon, label: '监控' },
  { key: '/admin/backups', icon: CloudIcon, label: '备份' },
];

export default function AdminLayout() {
  const loc = useLocation();
  const { user } = useAuth();

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <Link to="/" className="flex items-center gap-2.5 px-4 py-4">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
            N
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">Nya</div>
            <div className="text-xs text-muted-foreground">管理控制台</div>
          </div>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 px-2.5 py-1">
          {items.map((it) => {
            const active = loc.pathname === it.key;
            const Icon = it.icon;
            return (
              <Link
                key={it.key}
                to={it.key}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {it.label}
              </Link>
            );
          })}
        </nav>
        <Separator />
        <div className="flex flex-col gap-1 p-3">
          <div className="truncate px-2 text-xs text-muted-foreground">{user.username}</div>
          <Button variant="ghost" size="sm" className="justify-start" asChild>
            <Link to="/">
              <PanelsTopLeftIcon />
              返回桌面
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => void api.logout().then(() => window.location.reload())}
          >
            <LogOutIcon />
            退出
          </Button>
        </div>
      </aside>
      <main className="relative min-w-0 flex-1">
        <div className="absolute inset-0 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
