/// <reference types="vite/client" />

declare module '@novnc/novnc' {
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: {
        credentials?: { password?: string };
        shared?: boolean;
        wsProtocols?: string[];
      },
    );
    addEventListener(event: string, callback: (e: any) => void): void;
    removeEventListener(event: string, callback: (e: any) => void): void;
    disconnect(): void;
    sendCredentials(credentials: { password?: string }): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
    focus(): void;
    blur(): void;
    scaleViewport: boolean;
    resizeSession: boolean;
    clipViewport: boolean;
    qualityLevel: number;
    compressionLevel: number;
    viewOnly: boolean;
    focusOnClick: boolean;
    static messages: {
      fbUpdateRequest(
        sock: unknown,
        incremental: boolean,
        x?: number,
        y?: number,
        w?: number,
        h?: number,
      ): void;
      pointerEvent(sock: unknown, x: number, y: number, mask: number): void;
      enableContinuousUpdates(
        sock: unknown,
        enable: boolean,
        x: number,
        y: number,
        w: number,
        h: number,
      ): void;
    };
  }
}
