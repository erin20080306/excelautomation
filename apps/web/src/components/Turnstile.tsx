import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: { render(element: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void };
  }
}

const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export function Turnstile({ onToken }: { onToken(token: string): void }) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) {
      if (!import.meta.env.PROD) onToken('development-bypass');
      return;
    }
    let widgetId: string | undefined;
    const render = () => {
      if (!target.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(target.current, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken('') });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-excelmaster-turnstile]');
    if (existing) { existing.addEventListener('load', render); render(); }
    else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true; script.defer = true; script.dataset.excelmasterTurnstile = 'true'; script.addEventListener('load', render); document.head.appendChild(script);
    }
    return () => { if (widgetId && window.turnstile) window.turnstile.remove(widgetId); };
  }, [onToken]);
  if (!siteKey && import.meta.env.PROD) return <Notice />;
  return <div ref={target} className="min-h-16" />;
}

function Notice() {
  return <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">公開註冊暫停：平台尚未設定 Turnstile Site Key。</div>;
}
