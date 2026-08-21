import { useEffect } from 'react';

export const APP_NAME = 'Nya Browser';
export const MANAGEMENT_NAME = 'Nya Browser Management';

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function formatDeskTitle(sessionName?: string | null, tabTitle?: string | null) {
  if (!sessionName) return APP_NAME;
  const tab = String(tabTitle || '').trim();
  if (!tab || tab === sessionName) return `[${sessionName}] - ${APP_NAME}`;
  return `[${sessionName}] ${tab} - ${APP_NAME}`;
}

export function formatManagementTitle(page: string) {
  return `${page} - ${MANAGEMENT_NAME}`;
}
