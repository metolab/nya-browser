import { UserPublic } from '@nya/shared';
import { createContext, useContext } from 'react';

export const AuthContext = createContext<{
  user: UserPublic;
  refresh: () => Promise<void>;
} | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('auth');
  return ctx;
}
