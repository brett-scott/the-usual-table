import { useRef, useState } from 'react';

export interface TableActions<A> {
  busy: boolean;
  error: string;
  send(action: A): Promise<void>;
}

export function useTableActions<A extends { type: string }>(client: { send(action: A): Promise<void> }, onLeave: (endSession?: boolean) => void) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ source: 'table' | 'start'; message: string } | null>(null);

  async function send(action: A, source: 'table' | 'start' = 'table') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await client.send(action);
      if (action.type === 'Leave') onLeave(true);
    } catch (problem) {
      setFailure({ source, message: problem instanceof Error ? problem.message : 'Your action could not be completed.' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return {
    send,
    busy,
    error: failure?.source === 'table' ? failure.message : '',
    startError: failure?.source === 'start' ? failure.message : '',
  };
}
