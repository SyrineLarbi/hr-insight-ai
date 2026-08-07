import { io, type Socket } from 'socket.io-client';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010';

export interface ProgressEvent {
  reportId: string;
  step: number;
  totalSteps: number;
  percentage: number;
  message: string;
}

export interface ReportCompleteEvent {
  reportId: string;
}

export interface ReportErrorEvent {
  reportId: string;
  message: string;
}

/**
 * Connect to the /ws/reports namespace with the current JWT.
 * Returns a socket you must `disconnect()` when unmounting.
 */
export function connectReportsSocket(): Socket | null {
  if (typeof window === 'undefined') return null;

  const token = localStorage.getItem('access_token');
  if (!token) return null;

  const socket = io(`${API_URL}/ws/reports`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 3,
  });

  return socket;
}
