export function vncWindowExtra(windowId?: string | null) {
  return windowId && windowId !== 'main' ? windowId : null;
}
