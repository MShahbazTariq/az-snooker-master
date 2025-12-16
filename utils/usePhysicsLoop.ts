import { useEffect, useRef } from 'react';

export function usePhysicsLoop(step: (dtMs: number) => void, running: boolean) {
  const rafId = useRef<number | null>(null);
  const last = useRef<number>(0);
  const acc = useRef<number>(0);

  const FIXED_DT = 1000 / 120;     // 8.333 ms
  const MAX_FRAME_DT = 1000 / 15;  // cap at ~66 ms

  const tick = (t: number) => {
    if (!running) return;
    if (last.current === 0) last.current = t;
    let frameDt = t - last.current;
    last.current = t;

    if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT;
    acc.current += frameDt;

    while (acc.current >= FIXED_DT) {
      step(FIXED_DT);
      acc.current -= FIXED_DT;
    }

    rafId.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (running && rafId.current == null) {
      last.current = 0;
      acc.current = 0;
      rafId.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafId.current != null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [running]);
}
