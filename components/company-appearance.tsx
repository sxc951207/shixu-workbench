'use client';
import React, {createContext, useContext, useEffect, useLayoutEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';

type CompanyTheme = 'light' | 'dark';
const STORAGE_KEY = 'shixu-company-theme';
const AppearanceContext = createContext<{theme: CompanyTheme; toggle: () => void} | null>(null);

export function CompanyAppearance({children}: {children: React.ReactNode}) {
  const [theme, setTheme] = useState<CompanyTheme>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setTheme(event.newValue === 'dark' ? 'dark' : 'light');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-company-theme');
    return () => {
      if (previous === null) root.removeAttribute('data-company-theme');
      else root.setAttribute('data-company-theme', previous);
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-company-theme', theme);
    const chrome = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousColor = chrome?.content;
    if (chrome) chrome.content = theme === 'dark' ? '#101a29' : '#f4f7fa';
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Storage can be blocked. */ }
    return () => { if (chrome && previousColor !== undefined) chrome.content = previousColor; };
  }, [theme]);
  return <AppearanceContext.Provider value={{theme, toggle: () => setTheme(value => value === 'light' ? 'dark' : 'light')}}>{children}</AppearanceContext.Provider>;
}

export function useCompanyTheme() {
  return useContext(AppearanceContext)?.theme ?? 'light';
}

export function CompanyThemeToggle() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) return null;
  const dark = appearance.theme === 'dark';
  return <button type="button" className="co-theme-toggle co-icon" aria-label={dark ? '切换浅色主题' : '切换深色主题'} title={dark ? '切换浅色主题' : '切换深色主题'} onClick={appearance.toggle}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
}
