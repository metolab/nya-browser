import type { SessionPassword } from '@nya/shared';
import { chromeProfileDir, sessionDir } from '../store.js';
import {
  listProfilePasswords,
  overlayFilePath,
  writePasswordOverlayFile,
} from './chromePasswords.js';

export {
  listProfilePasswords,
  mergePasswordLists,
  normalizeSessionPasswords,
  overlayFilePath,
  readChromeProfilePasswords,
  readPasswordOverlayFile,
  writePasswordOverlayFile,
} from './chromePasswords.js';

function overlayPath(sessionId: string) {
  return overlayFilePath(sessionDir(sessionId));
}

export function listSessionPasswords(sessionId: string): SessionPassword[] {
  return listProfilePasswords(chromeProfileDir(sessionId), overlayPath(sessionId));
}

export function snapshotSessionPasswords(sessionId: string): SessionPassword[] {
  return writePasswordOverlayFile(overlayPath(sessionId), listSessionPasswords(sessionId));
}

export function writePasswordOverlay(sessionId: string, entries: SessionPassword[]) {
  return writePasswordOverlayFile(overlayPath(sessionId), entries);
}
