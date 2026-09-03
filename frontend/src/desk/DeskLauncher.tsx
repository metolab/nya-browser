import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CircleStopIcon,
  ClipboardIcon,
  FolderIcon,
  HouseIcon,
  KeyRoundIcon,
  LogOutIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  StickyNoteIcon,
} from 'lucide-react';
import { useDeskDrag } from './useDeskDrag';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ChangePasswordDialog from '@/components/ChangePasswordDialog';
import { cn } from '@/lib/utils';

const BADGE_KEY = 'nya.desk.badge';
const COLLAPSED = 42;
const POPUP_H = 340;

type Dir = 'left' | 'right';
type PopupSide = 'top' | 'bottom';

type Props = {
  username: string;
  isAdmin: boolean;
  hasSession: boolean;
  canNotepad: boolean;
  sessionName?: string;
  sizeLabel?: string;
  onAdmin: () => void;
  onLogout: () => void;
  onNotepad: () => void;
  onClipboard: () => void;
  onFiles: () => void;
  onDisplay: () => void;
  onEnd: () => void;
  onLeave: () => void;
};

function loadBadgePos() {
  try {
    const raw = localStorage.getItem(BADGE_KEY);
    if (!raw) return { x: 12, y: 12 };
    const data = JSON.parse(raw) as { x?: unknown; y?: unknown };
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 12, y: 12 };
    return { x, y };
  } catch {
    return { x: 12, y: 12 };
  }
}

function layoutFromPos(left: number, bottom: number, menuW: number): { dir: Dir; popupSide: PopupSide } {
  const spaceRight = window.innerWidth - left - COLLAPSED;
  const spaceLeft = left;
  let dir: Dir;
  if (spaceRight >= menuW) dir = 'right';
  else if (spaceLeft >= menuW) dir = 'left';
  else dir = spaceRight >= spaceLeft ? 'right' : 'left';

  const top = window.innerHeight - bottom - COLLAPSED;
  const spaceAbove = top;
  const spaceBelow = bottom;
  const popupSide: PopupSide =
    spaceAbove >= POPUP_H || spaceAbove >= spaceBelow ? 'top' : 'bottom';
  return { dir, popupSide };
}

export default function DeskLauncher({
  username,
  isAdmin,
  hasSession,
  canNotepad,
  sessionName,
  sizeLabel,
  onAdmin,
  onLogout,
  onNotepad,
  onClipboard,
  onFiles,
  onDisplay,
  onEnd,
  onLeave,
}: Props) {
  const [hover, setHover] = useState(false);
  const [control, setControl] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [dir, setDir] = useState<Dir>('right');
  const [popupSide, setPopupSide] = useState<PopupSide>('top');
  const leaveTimer = useRef(0);
  const menuLock = useRef(false);
  const drag = useDeskDrag('bottom-left', loadBadgePos());

  const left = drag.pos?.x ?? 12;
  const bottom = drag.pos?.y ?? 12;
  const expanded = Boolean((hover || control) && !drag.dragging);
  menuLock.current = control;

  const menuW = canNotepad ? 420 : 340;
  const dockLeft = dir === 'left';

  useEffect(() => {
    if (!drag.pos) return;
    try {
      localStorage.setItem(BADGE_KEY, JSON.stringify(drag.pos));
    } catch {
      /* quota / private mode */
    }
  }, [drag.pos]);

  const refreshLayout = () => {
    if (menuLock.current) return;
    const next = layoutFromPos(left, bottom, menuW);
    setDir(next.dir);
    setPopupSide(next.popupSide);
  };

  useEffect(() => {
    if (drag.dragging) return;
    refreshLayout();
  }, [left, bottom, menuW, drag.dragging]);

  const onEnter = () => {
    window.clearTimeout(leaveTimer.current);
    refreshLayout();
    setHover(true);
  };

  const onLeaveHover = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHover(false), 200);
  };

  const onPillPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, a, [data-slot="dropdown-menu-content"]')) return;
    setControl(false);
    setHover(false);
    drag.start(event);
  };

  const onPillPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.end(event);
    const el = drag.ref.current;
    const node = document.elementFromPoint(event.clientX, event.clientY);
    const over = Boolean(el && node && el.contains(node));
    setHover(over);
    if (over) refreshLayout();
  };

  const mark = (
    <span
      className={cn(
        'flex size-8 shrink-0 cursor-grab items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm select-none touch-none',
        drag.dragging && 'cursor-grabbing',
      )}
    >
      N
    </span>
  );

  const menu = (
    <div className="flex items-center gap-0.5 whitespace-nowrap">
      {canNotepad ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasSession}
          onClick={() => {
            setControl(false);
            onNotepad();
          }}
        >
          <StickyNoteIcon />
          Notepad
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={!hasSession}
        onClick={() => {
          setControl(false);
          onEnd();
        }}
      >
        <CircleStopIcon />
        结束会话
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!hasSession}
        onClick={() => {
          setControl(false);
          onLeave();
        }}
      >
        <HouseIcon />
        退出会话
      </Button>
      <DropdownMenu modal={false} open={control} onOpenChange={setControl}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <MoreHorizontalIcon />
            更多
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={popupSide}
          align={dir === 'left' ? 'end' : 'start'}
          className="z-[80] min-w-44"
          onMouseEnter={onEnter}
          onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SlidersHorizontalIcon />
              会话控制
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="z-[80] min-w-44"
              onMouseEnter={onEnter}
              onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
            >
              {hasSession ? (
                <DropdownMenuLabel className="max-w-52 font-normal">
                  <div className="truncate text-foreground">{sessionName}</div>
                  {sizeLabel ? <div className="truncate">{sizeLabel}</div> : null}
                </DropdownMenuLabel>
              ) : (
                <DropdownMenuLabel>未打开会话</DropdownMenuLabel>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!hasSession}
                onSelect={(event: Event) => {
                  event.preventDefault();
                  setControl(false);
                  onDisplay();
                }}
              >
                <MonitorIcon />
                显示设置
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!hasSession}
                onSelect={(event: Event) => {
                  event.preventDefault();
                  setControl(false);
                  onClipboard();
                }}
              >
                <ClipboardIcon />
                剪贴板
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!hasSession}
                onSelect={(event: Event) => {
                  event.preventDefault();
                  setControl(false);
                  onFiles();
                }}
              >
                <FolderIcon />
                文件管理
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="max-w-52 font-normal">
            <div className="truncate text-foreground">{username}</div>
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(event: Event) => {
              event.preventDefault();
              setControl(false);
              setPasswordOpen(true);
            }}
          >
            <KeyRoundIcon />
            修改密码
          </DropdownMenuItem>
          {isAdmin ? (
            <DropdownMenuItem
              onSelect={(event: Event) => {
                event.preventDefault();
                setControl(false);
                onAdmin();
              }}
            >
              <SettingsIcon />
              管理
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={(event: Event) => {
              event.preventDefault();
              setControl(false);
              onLogout();
            }}
          >
            <LogOutIcon />
            登出
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const menuSlot = (
    <div
      className={cn(
        'grid min-w-0 transition-[grid-template-columns] duration-200 ease-out',
        expanded ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]',
      )}
    >
      <div className={cn('min-w-0 overflow-hidden', !expanded && 'pointer-events-none')}>{menu}</div>
    </div>
  );

  return (
    <>
      <div
        ref={drag.ref}
        className={cn(
          'brand pointer-events-auto fixed z-40 flex items-center rounded-full border border-border bg-background/90 p-1 text-foreground shadow-lg backdrop-blur-md',
          'opacity-80 transition-[opacity,gap] duration-200 ease-out hover:opacity-100',
          expanded ? 'gap-0.5 opacity-100' : 'gap-0',
          drag.dragging && 'z-50 opacity-100',
          expanded && 'opacity-100',
        )}
        style={{
          bottom,
          ...(dockLeft
            ? { left: 'auto', right: Math.max(8, window.innerWidth - left - COLLAPSED), top: 'auto' }
            : { left, right: 'auto', top: 'auto' }),
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeaveHover}
        onPointerDown={onPillPointerDown}
        onPointerMove={drag.move}
        onPointerUp={onPillPointerUp}
        onPointerCancel={drag.end}
      >
        {dockLeft ? (
          <>
            {menuSlot}
            {mark}
          </>
        ) : (
          <>
            {mark}
            {menuSlot}
          </>
        )}
      </div>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}
