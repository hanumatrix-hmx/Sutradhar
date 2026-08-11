/**
 * @file packages/frontend/src/app/router.tsx
 * @description Client-side router supporting /, /session/:id, /sessions, /downloads, /settings, /showcase.
 *
 * Phase 0 fix: the route is synced to `window.location.hash`, so deep links
 * (`#/session/xyz`), refresh, and browser back/forward all work without any
 * server-side rewrite support. The hash is the single external source of
 * truth; `navigate` writes to it and `hashchange` reads back from it.
 */

import React, { useState, useEffect, useCallback } from 'react';

export type RoutePath = '/' | '/sessions' | '/downloads' | '/settings' | '/showcase' | string;

export interface RouterContextValue {
  currentPath: string;
  navigate: (path: string) => void;
}

function readHashPath(): string {
  if (typeof window === 'undefined') return '/';
  const raw = window.location.hash.replace(/^#/, '');
  return raw.startsWith('/') ? raw : '/';
}

export const RouterContext = React.createContext<RouterContextValue>({
  currentPath: '/',
  navigate: () => {},
});

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentPath, setCurrentPath] = useState<string>(readHashPath);

  // Back/forward and external hash edits flow into React state.
  useEffect(() => {
    const onHashChange = () => setCurrentPath(readHashPath());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((path: string) => {
    setCurrentPath(path);
    if (readHashPath() !== path) {
      window.location.hash = path; // pushes a real history entry
    }
  }, []);

  return (
    <RouterContext.Provider value={{ currentPath, navigate }}>
      {children}
    </RouterContext.Provider>
  );
};

export const useRouter = (): RouterContextValue => {
  return React.useContext(RouterContext);
};
