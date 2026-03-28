import { createContext, useContext } from 'react';

export interface LogEntry {
  id: number;
  ts: string;          // HH:MM:SS.mmm
  direction: 'send' | 'recv';
  device?: string;
  message: string;
}

interface DebugCtx {
  log: (direction: 'send' | 'recv', message: string, device?: string) => void;
}

export const DebugContext = createContext<DebugCtx>({ log: () => {} });
export const useDebug = () => useContext(DebugContext);
