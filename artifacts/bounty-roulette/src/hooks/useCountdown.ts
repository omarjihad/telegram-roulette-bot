import { useEffect, useState } from 'react';

export function useCountdown(targetDate: string | Date | null): { label: string; isReady: boolean } {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!targetDate) return { label: '00:00:00', isReady: true };

  const target = new Date(targetDate).getTime();
  const diff = target - now;

  if (diff <= 0) return { label: '00:00:00', isReady: true };

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  const pad = (n: number) => String(n).padStart(2, '0');
  return { label: `${pad(h)}:${pad(m)}:${pad(s)}`, isReady: false };
}
