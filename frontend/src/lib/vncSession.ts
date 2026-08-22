import RFB from '@novnc/novnc';

// Visible canvas shows only a settled framebuffer. Same-size remote
// resizes never recreate the Chrome window. Click slop is swallowed so
// scaleViewport does not turn a click into a remote drag; a button-up is
// always sent on blur / pointerup so a lost VNC mouseup cannot pin Chrome.

type Sock = object;

type DisplayHandle = {
  width: number;
  height: number;
  pending: () => boolean;
  flip: (fromQueue?: boolean) => void;
  autoscale: (w: number, h: number) => void;
  absX?: (x: number) => number;
  absY?: (y: number) => number;
  _damage: (x: number, y: number, w: number, h: number) => void;
  _backbuffer?: HTMLCanvasElement;
  _damageBounds?: { left: number; top: number; right: number; bottom: number };
  _renderQ?: unknown[];
  _flushPromise?: Promise<void> | null;
  _flushResolve?: (() => void) | null;
};

type RfbHandle = RFB & {
  _sock?: Sock;
  _fbWidth?: number;
  _fbHeight?: number;
  _display?: DisplayHandle;
  _eventHandlers?: { handleResize: () => void };
  _flushing?: boolean;
  _mouseButtonMask?: number;
  _mousePos?: { x: number; y: number };
  _mouseMoveTimer?: number | null;
  _accumulatedWheelDeltaX?: number;
  _accumulatedWheelDeltaY?: number;
  _handleMouseButton?: (x: number, y: number, bmask: number) => void;
  _handleMouseMove?: (x: number, y: number) => void;
};

const CLICK_SLOP_PX = 12;

type Messages = {
  fbUpdateRequest?: (
    sock: Sock,
    incremental: boolean,
    x?: number,
    y?: number,
    w?: number,
    h?: number,
  ) => void;
  pointerEvent?: (sock: Sock, x: number, y: number, mask: number) => void;
};

type Tier = {
  quality: number;
  compression: number;
};

export type FrameSample = {
  luma: number;
  variance: number;
  width: number;
  height: number;
  settled: boolean;
};

const TIERS = {
  lan: { quality: 8, compression: 0 },
  wan: { quality: 6, compression: 3 },
  slow: { quality: 4, compression: 6 },
} as const;

type TierName = keyof typeof TIERS;

const TIER_RANK: Record<TierName, number> = { lan: 0, wan: 1, slow: 2 };
const UPGRADE_HOLD_MS = 2000;
const SAMPLE_W = 48;
const SAMPLE_H = 27;

function rfbMessages(): Messages | null {
  return (RFB as typeof RFB & { messages?: Messages }).messages || null;
}

function connectionHint(): { downlink?: number; rtt?: number } {
  const conn = (navigator as Navigator & { connection?: { downlink?: number; rtt?: number } })
    .connection;
  return { downlink: conn?.downlink, rtt: conn?.rtt };
}

function pickTier(bufferedAmount: number, current: TierName): TierName {
  if (bufferedAmount > 512 * 1024) return 'slow';
  if (bufferedAmount > 96 * 1024) return 'wan';
  const { downlink, rtt } = connectionHint();
  if (typeof downlink === 'number' && downlink > 0 && downlink < 2) return 'slow';
  if (typeof rtt === 'number' && rtt > 200) return 'slow';
  if (typeof downlink === 'number' && downlink > 0 && downlink < 5) return 'wan';
  if (typeof rtt === 'number' && rtt > 80) return 'wan';
  if (current !== 'lan' && bufferedAmount > 24 * 1024) return current;
  return 'lan';
}

export function isDocumentVisible() {
  return document.visibilityState === 'visible';
}

let debugCached: boolean | null = null;
let debugCheckedAt = 0;

export function vncDebugEnabled() {
  const now = performance.now();
  if (debugCached !== null && now - debugCheckedAt < 2000) return debugCached;
  debugCheckedAt = now;
  try {
    debugCached = window.localStorage.getItem('nyaVncDebug') === '1';
  } catch {
    debugCached = false;
  }
  return debugCached;
}

const lastLogAt = new Map<string, number>();
let lastAnyLogAt = 0;

export function vncLog(event: string, data?: Record<string, unknown>) {
  if (!vncDebugEnabled()) return;
  const now = performance.now();
  const prevSame = lastLogAt.get(event);
  const sameDt = prevSame != null ? Math.round(now - prevSame) : 0;
  if (event === 'flip' && prevSame != null && sameDt < 400 && data?.settled !== false) return;
  const dt = lastAnyLogAt ? Math.round(now - lastAnyLogAt) : 0;
  lastAnyLogAt = now;
  lastLogAt.set(event, now);
  console.info('[nya-vnc]', event, {
    t: new Date().toISOString(),
    dt,
    sameDt,
    ...(data || {}),
  });
}

/** E2E and nyaVncDebug inspect live RFB sockets via window.__nyaVncSockets. */
export function trackVncSocket(ws: WebSocket) {
  const bag = window as Window & { __nyaVncSockets?: WebSocket[] };
  bag.__nyaVncSockets = (bag.__nyaVncSockets || []).filter((s) => s.readyState === WebSocket.OPEN);
  bag.__nyaVncSockets.push(ws);
}

let tlsHushed = false;

export function hushNovncTlsWarning() {
  if (tlsHushed) return;
  tlsHushed = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (args.some((a) => String(a).includes('secure context (TLS)'))) return;
    orig(...args);
  };
}

export function withVncCanvasHints<T>(fn: () => T): T {
  const proto = HTMLCanvasElement.prototype;
  const orig = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement, type: string, attrs?: CanvasRenderingContext2DSettings) {
    if (type === '2d') {
      attrs = {
        alpha: false,
        ...attrs,
        desynchronized: false,
      };
    }
    return orig.call(this, type, attrs);
  } as typeof orig;
  try {
    return fn();
  } finally {
    proto.getContext = orig;
  }
}

let sampleCtx: CanvasRenderingContext2D | null = null;

function sampleContext() {
  if (sampleCtx) return sampleCtx;
  const tmp = document.createElement('canvas');
  tmp.width = SAMPLE_W;
  tmp.height = SAMPLE_H;
  sampleCtx = tmp.getContext('2d', { alpha: false, willReadFrequently: true });
  return sampleCtx;
}

export function sampleDisplay(display: DisplayHandle | undefined): FrameSample {
  const width = display?.width || 0;
  const height = display?.height || 0;
  const src = display?._backbuffer;
  if (!src || width < 8 || height < 8) {
    return { luma: 0, variance: 0, width, height, settled: false };
  }
  const ctx = sampleContext();
  if (!ctx) return { luma: 0, variance: 0, width, height, settled: false };
  ctx.drawImage(src, 0, 0, SAMPLE_W, SAMPLE_H);
  const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += luma;
    sum2 += luma * luma;
    n += 1;
  }
  const mean = sum / n;
  const variance = sum2 / n - mean * mean;
  const settled = mean >= 18 && variance >= 40;
  return { luma: mean, variance, width, height, settled };
}

function dirtySize(display: DisplayHandle) {
  const bounds = display._damageBounds;
  if (!bounds) return { dirtyW: display.width, dirtyH: display.height };
  return {
    dirtyW: Math.max(0, bounds.right - bounds.left),
    dirtyH: Math.max(0, bounds.bottom - bounds.top),
  };
}

export function holdCanvas(host: HTMLElement, source: HTMLCanvasElement) {
  if (source.width < 2 || source.height < 2) {
    vncLog('hold', { result: 'skip', width: source.width, height: source.height });
    return false;
  }
  let hold = host.querySelector('canvas.vnc-hold') as HTMLCanvasElement | null;
  if (!hold) {
    hold = document.createElement('canvas');
    hold.className = 'vnc-hold';
    host.appendChild(hold);
  }
  hold.width = source.width;
  hold.height = source.height;
  hold.style.width = source.style.width || `${source.width}px`;
  hold.style.height = source.style.height || `${source.height}px`;
  hold.getContext('2d', { alpha: false })?.drawImage(source, 0, 0);
  vncLog('hold', { result: 'copied', width: source.width, height: source.height });
  return true;
}

export function clearHold(host: HTMLElement) {
  host.querySelector('canvas.vnc-hold')?.remove();
}

export function hasHold(host: HTMLElement) {
  return Boolean(host.querySelector('canvas.vnc-hold'));
}

export class VncSession {
  readonly rfb: RfbHandle;
  private readonly ws: WebSocket;
  private readonly wrap: () => HTMLElement | null;
  private disposed = false;
  private visible = isDocumentVisible();
  private tierName: TierName = 'lan';
  private upgradeAt = 0;
  private origHandleResize: (() => void) | null = null;
  private origFlip: DisplayHandle['flip'] | null = null;
  private committed = false;
  private qualityTimer: number | null = null;
  private lastFlipAt = 0;
  private connectedAt = 0;
  private flipCount = 0;
  private stuckArmed = false;
  private readonly onBlur = () => this.releasePointer();
  private readonly onHidden = () => {
    if (document.visibilityState === 'hidden') this.releasePointer();
  };
  private clickAnchor: { x: number; y: number } | null = null;
  private origHandleMouseButton: RfbHandle['_handleMouseButton'] | null = null;
  private origHandleMouseMove: RfbHandle['_handleMouseMove'] | null = null;
  private readonly onPointerUp = (ev: PointerEvent) => {
    if (ev.buttons === 0) this.releasePointer();
  };

  constructor(
    rfb: RFB,
    ws: WebSocket,
    opts: {
      wrap: () => HTMLElement | null;
      onSettledFrame?: () => void;
    },
  ) {
    this.rfb = rfb as RfbHandle;
    this.ws = ws;
    this.wrap = opts.wrap;

    const display = this.rfb._display;
    if (display?.flip) {
      this.origFlip = display.flip.bind(display);
      display.flip = (fromQueue) => {
        if (display.pending() && !fromQueue) {
          this.origFlip?.(fromQueue);
          return;
        }
        this.origFlip?.(fromQueue);
        this.noteFlip();
        if (this.committed) {
          vncLog('flip', { kind: 'partial', committed: true, ...dirtySize(display) });
          return;
        }
        const sample = sampleDisplay(display);
        vncLog('flip', { kind: 'full', ...sample, committed: this.committed });
        if (!this.committed && sample.settled) {
          this.committed = true;
          opts.onSettledFrame?.();
        }
      };
    }

    const handlers = this.rfb._eventHandlers;
    if (handlers?.handleResize) {
      this.origHandleResize = handlers.handleResize;
      handlers.handleResize = () => {
        if (!this.visible || this.disposed) return;
        this.origHandleResize?.();
      };
    }

    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerUp, true);
    this.installClickSlop();
  }

  private installClickSlop() {
    const rfb = this.rfb;
    const origButton = rfb._handleMouseButton?.bind(rfb);
    const origMove = rfb._handleMouseMove?.bind(rfb);
    if (!origButton || !origMove) return;
    this.origHandleMouseButton = origButton;
    this.origHandleMouseMove = origMove;
    rfb._handleMouseButton = (x, y, bmask) => {
      const prev = rfb._mouseButtonMask || 0;
      const down = (bmask & 1) !== 0;
      const wasDown = (prev & 1) !== 0;
      if (down && !wasDown) {
        this.clickAnchor = { x, y };
        origButton(x, y, bmask);
        return;
      }
      if (!down && wasDown) {
        if (rfb._mouseMoveTimer != null) {
          window.clearTimeout(rfb._mouseMoveTimer);
          rfb._mouseMoveTimer = null;
        }
        const dest = this.clickAnchor || { x, y };
        this.clickAnchor = null;
        origButton(dest.x, dest.y, bmask);
        return;
      }
      origButton(x, y, bmask);
    };
    rfb._handleMouseMove = (x, y) => {
      const anchor = this.clickAnchor;
      if (anchor && ((rfb._mouseButtonMask || 0) & 1)) {
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        if (dx * dx + dy * dy < CLICK_SLOP_PX * CLICK_SLOP_PX) return;
        this.clickAnchor = null;
      }
      origMove(x, y);
    };
  }

  get hasCommitted() {
    return this.committed;
  }

  dispose() {
    if (this.disposed) return;
    this.releasePointer();
    this.disposed = true;
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onHidden);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerUp, true);
    if (this.qualityTimer !== null) window.clearInterval(this.qualityTimer);
    if (this.origHandleResize && this.rfb._eventHandlers) {
      this.rfb._eventHandlers.handleResize = this.origHandleResize;
    }
    if (this.origFlip && this.rfb._display) {
      this.rfb._display.flip = this.origFlip;
    }
    if (this.origHandleMouseButton) {
      this.rfb._handleMouseButton = this.origHandleMouseButton;
    }
    if (this.origHandleMouseMove) {
      this.rfb._handleMouseMove = this.origHandleMouseMove;
    }
  }

  onConnected() {
    if (this.disposed) return;
    this.connectedAt = performance.now();
    this.stuckArmed = false;
    this.applyTier(true);
    if (this.qualityTimer === null) {
      this.qualityTimer = window.setInterval(() => {
        this.applyTier(false);
        const now = performance.now();
        const idleMs = this.lastFlipAt ? now - this.lastFlipAt : now - this.connectedAt;
        const queued = Boolean(this.rfb._display?.pending());
        vncLog('tick', {
          committed: this.committed,
          flips: this.flipCount,
          msSinceFlip: this.lastFlipAt ? Math.round(now - this.lastFlipAt) : null,
          bufferedAmount: this.ws.bufferedAmount,
          readyState: this.ws.readyState,
          flushing: Boolean(this.rfb._flushing),
          queued,
        });
        if (!this.visible || this.ws.readyState !== WebSocket.OPEN) return;
        if (queued && idleMs > 1000) this.unstickDisplay();
        if (idleMs > 8000 && !this.stuckArmed) {
          this.stuckArmed = true;
          vncLog('stuck', { idleMs, bufferedAmount: this.ws.bufferedAmount });
          this.ws.close();
        }
      }, 1000);
    }
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.releasePointer();
      return;
    }
    this.releasePointer();
    this.restoreSurface();
    this.requestKeyframe();
  }

  autoscale() {
    if (this.disposed || !this.visible) return;
    const wrap = this.wrap();
    const display = this.rfb._display;
    if (!wrap || !display?.autoscale) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 40 || h < 40) return;
    display.autoscale(w, h);
  }

  restoreSurface() {
    if (this.disposed) return;
    const display = this.rfb._display;
    if (display && display.width > 0 && display.height > 0 && this.origFlip) {
      const sample = sampleDisplay(display);
      if (sample.settled) {
        display._damage(0, 0, display.width, display.height);
        this.origFlip();
      }
    }
    this.origHandleResize?.();
  }

  releasePointer() {
    if (this.disposed) return;
    const rfb = this.rfb;
    if (rfb._mouseMoveTimer != null) {
      window.clearTimeout(rfb._mouseMoveTimer);
      rfb._mouseMoveTimer = null;
    }
    const dest = this.clickAnchor || rfb._mousePos || { x: 0, y: 0 };
    const hadPointer = Boolean(this.clickAnchor) || (rfb._mouseButtonMask || 0) !== 0;
    this.clickAnchor = null;
    rfb._mouseButtonMask = 0;
    rfb._accumulatedWheelDeltaX = 0;
    rfb._accumulatedWheelDeltaY = 0;
    const messages = rfbMessages();
    const sock = rfb._sock;
    if (!messages?.pointerEvent || !sock) return;
    const display = rfb._display;
    const x = display?.absX ? display.absX(dest.x) : dest.x;
    const y = display?.absY ? display.absY(dest.y) : dest.y;
    messages.pointerEvent(sock, x, y, 0);
    if (hadPointer) vncLog('pointer-up', { x, y });
  }

  requestKeyframe() {
    if (this.disposed || !this.visible) return;
    const messages = rfbMessages();
    const sock = this.rfb._sock;
    const w = this.rfb._fbWidth || 0;
    const h = this.rfb._fbHeight || 0;
    if (!messages?.fbUpdateRequest || !sock || w < 1 || h < 1) return;
    messages.fbUpdateRequest(sock, false, 0, 0, w, h);
  }

  private unstickDisplay() {
    const display = this.rfb._display;
    if (!display) return;
    if (display._renderQ) display._renderQ.length = 0;
    if (display._flushResolve) {
      display._flushResolve();
      display._flushPromise = null;
      display._flushResolve = null;
    }
    this.rfb._flushing = false;
    vncLog('unstick', { flips: this.flipCount });
  }

  private noteFlip() {
    this.lastFlipAt = performance.now();
    this.flipCount += 1;
  }

  private applyTier(force: boolean) {
    if (this.disposed) return;
    const raw = pickTier(this.ws.bufferedAmount, this.tierName);
    let next = raw;
    if (TIER_RANK[raw] < TIER_RANK[this.tierName]) {
      if (!force) {
        if (this.upgradeAt === 0) this.upgradeAt = performance.now();
        if (performance.now() - this.upgradeAt < UPGRADE_HOLD_MS) next = this.tierName;
      }
    } else {
      this.upgradeAt = 0;
    }
    if (!force && next === this.tierName) return;
    this.tierName = next;
    const tier: Tier = TIERS[this.tierName];
    this.rfb.qualityLevel = tier.quality;
    this.rfb.compressionLevel = tier.compression;
  }
}

export function attachVncSession(
  rfb: RFB,
  ws: WebSocket,
  opts: {
    wrap: () => HTMLElement | null;
    onSettledFrame?: () => void;
  },
) {
  return new VncSession(rfb, ws, opts);
}
