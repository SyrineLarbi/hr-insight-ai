import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import {
  connectReportsSocket,
  type ProgressEvent,
  type ReportCompleteEvent,
  type ReportErrorEvent,
} from '@/lib/ws';

export type GenerationState =
  | { status: 'idle' }
  | { status: 'generating'; progress: ProgressEvent }
  | { status: 'complete'; reportId: string }
  | { status: 'error'; reportId: string; message: string };

/**
 * React hook that opens a WebSocket connection to /ws/reports and
 * exposes the live generation state for the current user.
 *
 * The hook maintains a single socket for the lifetime of the component.
 * Call `start()` before POST /reports/generate to flip into "generating"
 * state; events from the server then advance the state to complete/error.
 */
export function useReportProgress() {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<GenerationState>({ status: 'idle' });

  useEffect(() => {
    const socket = connectReportsSocket();
    if (!socket) return;

    socketRef.current = socket;

    socket.on('progress', (event: ProgressEvent) => {
      setState({ status: 'generating', progress: event });
    });

    socket.on('report:complete', (event: ReportCompleteEvent) => {
      setState({ status: 'complete', reportId: event.reportId });
    });

    socket.on('report:error', (event: ReportErrorEvent) => {
      setState({
        status: 'error',
        reportId: event.reportId,
        message: event.message,
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    setState({
      status: 'generating',
      progress: {
        reportId: 'pending',
        step: 0,
        totalSteps: 6,
        percentage: 0,
        message: 'Starting...',
      },
    });
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return { state, start, reset };
}
