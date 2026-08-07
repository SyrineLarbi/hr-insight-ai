import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditAction } from '@prisma/client';
import { AuditService } from './audit.service.js';

const ENTITY_TYPE_MAP: Record<string, string> = {
  users: 'USER',
  teams: 'TEAM',
  employees: 'EMPLOYEE',
  reports: 'REPORT',
  'audit-logs': 'AUDIT_LOG',
};

const METHOD_TO_ACTION: Record<string, AuditAction> = {
  POST: AuditAction.CREATE,
  PATCH: AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      user?: { id: string };
      ip: string;
      body: Record<string, unknown>;
    }>();

    const { method, url, user, ip, body } = req;

    if (!['POST', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    if (url.startsWith('/auth/')) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap(async (responseBody: Record<string, unknown> | null) => {
        try {
          if (!user?.id) return;

          const action = this.resolveAction(method, url);
          const entityType = this.resolveEntityType(url);
          const entityId = this.resolveEntityId(url, responseBody);

          await this.auditService.log({
            userId: user.id,
            action,
            entityType,
            entityId,
            ipAddress: ip,
            metadata: {
              url,
              method,
              durationMs: Date.now() - startTime,
              requestBody: this.sanitizeBody(body),
            },
          });
        } catch (err) {
          this.logger.error('Audit logging failed — original request was NOT affected', err);
        }
      }),
    );
  }

  private resolveAction(method: string, url: string): AuditAction {
    if (url.includes('/generate')) return AuditAction.GENERATE_REPORT;
    if (url.includes('/pdf')) return AuditAction.EXPORT_PDF;
    return METHOD_TO_ACTION[method] ?? AuditAction.CREATE;
  }

  private resolveEntityType(url: string): string {
    const cleanUrl = url.split('?')[0];
    const segments = cleanUrl.split('/').filter(Boolean);
    const first = segments[0] ?? '';
    return ENTITY_TYPE_MAP[first] ?? first.toUpperCase();
  }

  private resolveEntityId(
    url: string,
    body: Record<string, unknown> | null,
  ): string | null {
    if (typeof body?.id === 'string') return body.id;

    const nested = body?.user as Record<string, unknown> | undefined;
    if (typeof nested?.id === 'string') return nested.id;

    const uuidRegex =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = url.match(uuidRegex);
    return match ? match[0] : null;
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
    if (!body || typeof body !== 'object') return {};
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, passwordHash, ...safe } = body as Record<string, unknown>;
    return safe;
  }
}
