import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { parseFrontendOrigins } from '../common/cors-origins.js';

export interface ProgressEvent {
  reportId: string;
  step: number;
  totalSteps: number;
  percentage: number;
  message: string;
}

@WebSocketGateway({
  namespace: '/ws/reports',
  cors: {
    origin: parseFrontendOrigins(process.env.FRONTEND_ORIGIN),
    credentials: true,
  },
})
export class ReportsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ReportsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private jwtService: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const headerToken =
        typeof client.handshake.headers?.authorization === 'string'
          ? client.handshake.headers.authorization.split(' ')[1]
          : undefined;
      const token =
        (client.handshake.auth?.token as string | undefined) || headerToken;

      if (!token) {
        this.logger.warn(
          `Client ${client.id} connected without token — disconnecting`,
        );
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);

      client.data.userId = payload.sub;
      client.data.email = payload.email;
      client.data.role = payload.role;

      client.join(`user:${payload.sub}`);

      this.logger.log(
        `Client connected: ${payload.email} (${client.id}) → room user:${payload.sub}`,
      );
    } catch (error: any) {
      this.logger.warn(
        `Client ${client.id} failed JWT verification: ${error.message} — disconnecting`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(
      `Client disconnected: ${client.data?.email || 'unknown'} (${client.id})`,
    );
  }

  emitProgress(userId: string, event: ProgressEvent): void {
    this.server.to(`user:${userId}`).emit('progress', event);
    this.logger.debug(
      `Progress → user:${userId} | ${event.percentage}% | ${event.message}`,
    );
  }

  emitComplete(userId: string, reportId: string): void {
    this.server.to(`user:${userId}`).emit('report:complete', { reportId });
    this.logger.log(
      `Report complete → user:${userId} | reportId: ${reportId}`,
    );
  }

  emitError(userId: string, reportId: string, message: string): void {
    this.server
      .to(`user:${userId}`)
      .emit('report:error', { reportId, message });
    this.logger.error(`Report error → user:${userId} | ${message}`);
  }
}
