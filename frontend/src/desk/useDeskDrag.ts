import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

type Anchor = 'top-left' | 'bottom-left';

type Pos = { x: number; y: number };

function clamp(pos: Pos, size: { w: number; h: number }): Pos {
  const maxX = Math.max(8, window.innerWidth - size.w - 8);
  const maxY = Math.max(8, window.innerHeight - size.h - 8);
  return {
    x: Math.min(maxX, Math.max(8, pos.x)),
    y: Math.min(maxY, Math.max(8, pos.y)),
  };
}

export function useDeskDrag(anchor: Anchor, initial?: Pos | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(initial ?? null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const readOrigin = () => {
    const el = ref.current;
    if (!el) return { x: 8, y: 8 };
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left,
      y: anchor === 'bottom-left' ? window.innerHeight - rect.bottom : rect.top,
    };
  };

  const apply = useCallback((next: Pos) => {
    const el = ref.current;
    const size = { w: Math.min(el?.offsetWidth || 40, 40), h: Math.min(el?.offsetHeight || 40, 40) };
    setPos(clamp(next, size));
  }, []);

  const start = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    const origin = posRef.current ?? readOrigin();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: origin.x,
      origY: origin.y,
    };
    apply(origin);
    el.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  };

  const move = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    apply({
      x: drag.origX + dx,
      y: anchor === 'bottom-left' ? drag.origY - dy : drag.origY + dy,
    });
  };

  const end = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      ref.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  const style: CSSProperties | undefined = pos
    ? anchor === 'bottom-left'
      ? { left: pos.x, bottom: pos.y, right: 'auto', top: 'auto' }
      : { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : undefined;

  return { ref, style, pos, dragging, start, move, end };
}
