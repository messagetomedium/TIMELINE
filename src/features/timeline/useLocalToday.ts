import { useEffect, useState } from 'react';
import { dateOnly } from '../../domain';

function localToday() {
  const now = new Date();
  return dateOnly(`${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
}

export function useLocalToday() {
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      setToday(localToday());
      clearTimeout(timer);
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(update, next.getTime() - now.getTime() + 100);
    };
    const visibility = () => { if (document.visibilityState === 'visible') update(); };
    timer = setTimeout(update, 0);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', visibility);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return today;
}
