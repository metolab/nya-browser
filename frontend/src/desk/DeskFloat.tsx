import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDeskDrag } from './useDeskDrag';

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export default function DeskFloat({
  title,
  subtitle,
  onClose,
  children,
  className,
  bodyClassName,
}: Props) {
  const drag = useDeskDrag('top-left');

  return (
    <div
      ref={drag.ref}
      className={cn(
        'fixed z-40 flex w-72 flex-col overflow-hidden rounded-xl border bg-card/95 shadow-lg backdrop-blur-md',
        drag.dragging && 'z-50',
        className,
      )}
      style={drag.style}
      onPointerMove={drag.move}
      onPointerUp={drag.end}
      onPointerCancel={drag.end}
    >
      <div
        className={cn(
          'flex cursor-grab items-center gap-2 border-b px-2 py-1.5 select-none touch-none',
          drag.dragging && 'cursor-grabbing',
        )}
        onPointerDown={drag.start}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{title}</div>
          {subtitle ? (
            <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="关闭"
          className="cursor-pointer"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className={cn('min-h-0 p-2', bodyClassName)}>{children}</div>
    </div>
  );
}
