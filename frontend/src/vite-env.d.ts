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
    focus(): void;
    blur(): void;
    scaleViewport: boolean;
    resizeSession: boolean;
    clipViewport: boolean;
    qualityLevel: number;
    compressionLevel: number;
    viewOnly: boolean;
    focusOnClick: boolean;
  }
}
