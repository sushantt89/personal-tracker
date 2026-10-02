import { useEffect, useState } from 'react';

/** "Add to Home Screen" support. Android/desktop Chrome and Edge offer a real install prompt; iPhone/iPad need the Share menu. */
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
export const isIos = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** Call once, as early as possible: the browser only fires the install event once per page load. */
export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; installedNow = true; notify(); });
  if ('serviceWorker' in navigator) {
    // Registered after load so it never slows the first paint
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
  }
}

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const installed = installedNow || isStandalone();
  return {
    installed,
    /** The browser will show its own install dialog */
    canPrompt: !installed && !!deferred,
    /** iPhone/iPad: has to be done by hand from the Share menu */
    iosManual: !installed && isIos(),
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      notify();
      return outcome === 'accepted';
    },
  };
}
