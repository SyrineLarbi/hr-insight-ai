# Phase 6 - Step 2: WebSocket Gateway (Real-Time Progress)

## Why Are We Doing This?

Report generation is a multi-step pipeline that takes 10–30 seconds:
1. Fetch employees from DB (~200ms)
2. Call AI service for predictions (~2–5s)
3. Call LLM for executive summary (~5–15s)
4. Call LLM for action plan (~5–15s)
5. Save everything to DB (~500ms)

Without real-time feedback, the user stares at a spinner for 30 seconds with no idea if the system is working, stuck, or failed. That's a terrible experience.

**WebSocket** provides a persistent, bidirectional connection between the frontend and backend. As each pipeline step completes, the backend pushes a progress event to the user's browser — instantly. The frontend renders this as a step-by-step progress bar:

```
[✓] Fetching team data         10%  ████░░░░░░
[✓] Running predictions         25%  █████████░░░░░░
[→] Generating executive summary 50%  ████████████████░░░░░░
[ ] Creating action plan         —
[ ] Saving results               —
```

### Why WebSocket instead of polling?

| Approach | How it works | Latency | Overhead |
|----------|-------------|---------|----------|
| **Polling** | Frontend asks "are you done?" every 2s | 0–2s delay | Many unnecessary HTTP requests |
| **Long polling** | Frontend waits for server response | Near-instant | One request at a time, reconnect overhead |
| **SSE** | Server pushes text events (one-way) | Near-instant | Simple, but one-way only |
| **WebSocket** | Full duplex persistent connection | Instant | Low, one connection for everything |

WebSocket wins because:
- We need server→client push (progress events)
- NestJS has first-class WebSocket support (`@nestjs/websockets` + `@nestjs/platform-socket.io`)
- Socket.io (the underlying library) handles reconnection, fallback to polling, and room-based broadcasting
- The same connection can be reused later for other real-time features

---

## What We're Building

```
backend/src/
  reports/
    reports.gateway.ts         ← WebSocket gateway with JWT auth + progress emission
```

The gateway is part of the `ReportsModule` (which we build in Step 3). In this step we create just the gateway file and explain how it works.

---

## The Steps

### Step A: Create the WebSocket gateway

Create `backend/src/reports/reports.gateway.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Progress event emitted during report generation.
 *
 * The frontend listens for these on the 'progress' channel
 * and renders them as a step-by-step progress indicator.
 */
export interface ProgressEvent {
  /** Which report is being generated */
  reportId: string;
  /** Current step number (1-based) */
  step: number;
  /** Total number of steps */
  totalSteps: number;
  /** Completion percentage (0–100) */
  percentage: number;
  /** Human-readable status message */
  message: string;
}

/**
 * WebSocket gateway for real-time report generation progress.
 *
 * Architecture:
 * 1. Client connects with JWT token in handshake auth
 * 2. Gateway verifies the JWT and extracts userId
 * 3. Client is joined to a room named `user:{userId}`
 * 4. During report generation, ReportsService calls emitProgress()
 * 5. Progress events are sent ONLY to the requesting user's room
 *
 * Why rooms instead of broadcasting?
 * - User A generating a report shouldn't see User B's progress
 * - Rooms are socket.io's built-in way to scope messages
 * - `server.to('user:abc123').emit(...)` sends only to that user
 */
@WebSocketGateway({
  namespace: '/ws/reports',
  cors: {
    origin: '*', // Restrict in production
  },
})
export class ReportsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ReportsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private jwtService: JwtService) {}

  /**
   * Called when a client connects.
   *
   * The client must provide a JWT token via:
   * - socket.io auth: `io('/ws/reports', { auth: { token: 'xxx' } })`
   * - OR header: `Authorization: Bearer xxx`
   *
   * If the token is missing or invalid, the client is disconnected.
   */
  handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token — disconnecting`);
        client.disconnect();
        return;
      }

      // Verify the JWT (same secret as HTTP auth)
      const payload = this.jwtService.verify(token);

      // Store userId on the socket for later use
      client.data.userId = payload.sub;
      client.data.email = payload.email;
      client.data.role = payload.role;

      // Join a room scoped to this user
      client.join(`user:${payload.sub}`);

      this.logger.log(
        `Client connected: ${payload.email} (${client.id}) → room user:${payload.sub}`,
      );
    } catch (error) {
      this.logger.warn(
        `Client ${client.id} failed JWT verification: ${error.message} — disconnecting`,
      );
      client.disconnect();
    }
  }

  /**
   * Called when a client disconnects (tab close, network loss, etc.).
   * Socket.io automatically removes the client from all rooms.
   */
  handleDisconnect(client: Socket) {
    this.logger.log(
      `Client disconnected: ${client.data?.email || 'unknown'} (${client.id})`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API — called by ReportsService during pipeline execution
  // ─────────────────────────────────────────────────────────────────

  /**
   * Emit a progress event to a specific user.
   *
   * Usage in ReportsService:
   *   this.gateway.emitProgress(userId, {
   *     reportId: report.id,
   *     step: 2,
   *     totalSteps: 6,
   *     percentage: 25,
   *     message: 'Running predictions...',
   *   });
   */
  emitProgress(userId: string, event: ProgressEvent): void {
    this.server.to(`user:${userId}`).emit('progress', event);
    this.logger.debug(
      `Progress → user:${userId} | ${event.percentage}% | ${event.message}`,
    );
  }

  /**
   * Emit a completion event when the report is fully generated.
   * Includes the report ID so the frontend can navigate to it.
   */
  emitComplete(userId: string, reportId: string): void {
    this.server.to(`user:${userId}`).emit('report:complete', { reportId });
    this.logger.log(`Report complete → user:${userId} | reportId: ${reportId}`);
  }

  /**
   * Emit an error event if report generation fails mid-pipeline.
   * The frontend should display an error message and allow retry.
   */
  emitError(userId: string, reportId: string, message: string): void {
    this.server
      .to(`user:${userId}`)
      .emit('report:error', { reportId, message });
    this.logger.error(`Report error → user:${userId} | ${message}`);
  }
}
```

**Why verify JWT in `handleConnection` and not use a guard?**

NestJS WebSocket guards work on message handlers (`@SubscribeMessage`), not on connection. Since we don't have client→server messages (the client only listens, it doesn't send), the only authentication point is the connection handshake. We verify the JWT there and reject unauthorized connections immediately.

**Why `client.data` for storing user info?**

Socket.io's `Socket.data` is a built-in property bag that persists for the lifetime of the connection. It's the standard way to attach request-scoped metadata (like user identity) to a socket without external state.

**Why the `debug` log level for progress events?**

During a single report generation, 6 progress events fire in ~20 seconds. With `log` level, this would flood the console. `debug` keeps them available for troubleshooting but quiet in normal operation.

---

### Step B: How the frontend will connect (reference)

This is a preview — the actual frontend implementation happens in Phase 7. But understanding the client side helps you verify the gateway works.

```typescript
// Frontend (Phase 7) — React hook preview
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/ws/reports', {
  auth: { token: localStorage.getItem('jwt') },
});

socket.on('progress', (event) => {
  console.log(`${event.percentage}% — ${event.message}`);
  // Update progress bar UI
});

socket.on('report:complete', ({ reportId }) => {
  // Navigate to the report page
  router.push(`/reports/${reportId}`);
});

socket.on('report:error', ({ message }) => {
  // Show error notification
  notification.error({ message: 'Report generation failed', description: message });
});
```

---

### Step C: Test the WebSocket gateway

The gateway will be registered as part of ReportsModule in Step 3. For now, you can verify the file is syntactically correct:

```bash
cd /home/syrine/hr-insight-ai/backend
npx tsc --noEmit src/reports/reports.gateway.ts 2>&1 || echo "Note: Module resolution errors are expected before Step 3 wires everything up"
```

A full integration test happens in Step 5 (Phase 6 Verification) once everything is connected.

**Quick manual test with wscat (after Step 3):**

```bash
# Install wscat globally (one-time)
npm install -g wscat

# Connect with JWT token
wscat -c "ws://localhost:3000/ws/reports" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"

# If connection succeeds, you'll see:
# Connected (press CTRL+C to quit)
# Then trigger a report generation from another terminal to see progress events
```

---

## How to Verify It Worked

The gateway is fully verified in Step 5 (Phase 6 Verification) as part of the end-to-end pipeline. At this step, verify:

| Check | Expected |
|-------|----------|
| `reports.gateway.ts` compiles without syntax errors | ✅ |
| File exports `ReportsGateway` and `ProgressEvent` interface | ✅ |
| JWT verification logic handles missing/invalid tokens | ✅ |
| Room naming follows `user:{userId}` convention | ✅ |
| Three emission methods: `emitProgress`, `emitComplete`, `emitError` | ✅ |

---

## Checklist (confirm before Step 3)

- [ ] `backend/src/reports/reports.gateway.ts` created with:
  - `ProgressEvent` interface (reportId, step, totalSteps, percentage, message)
  - `handleConnection()` with JWT verification from handshake
  - `handleDisconnect()` with cleanup logging
  - `emitProgress()` — sends progress to user's room
  - `emitComplete()` — signals report is ready
  - `emitError()` — signals pipeline failure
  - Room-based scoping (`user:{userId}`)
- [ ] File compiles without syntax errors
- [ ] You understand the data flow: ReportsService calls gateway methods → gateway emits to user's room → frontend listens

---

Once confirmed, move to **Step 3: Reports Module** — the orchestration pipeline that ties everything together (DB, AI service, LLM, WebSocket, risk snapshots).
