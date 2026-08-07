import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

/**
 * Catch-all filter so nothing internal reaches the client.
 *
 * Without this, a Prisma unique-constraint violation surfaces as a raw 500 that
 * includes the failing SQL and column names. Known Prisma codes are mapped to
 * the HTTP status they actually mean; everything unrecognised becomes a generic
 * 500 and is logged server-side with its stack.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, error } = this.resolve(exception);

    const body: ErrorBody = {
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    // 5xx means we broke something — log the stack. 4xx is the caller's problem,
    // so a one-line warn is enough and keeps logs readable.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} → ${status}: ${JSON.stringify(message)}`,
      );
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
  } {
    // Nest's own exceptions (including ValidationPipe's 400s) already carry the
    // right status and a message array — pass them through untouched.
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ??
            exception.message);
      return {
        status: exception.getStatus(),
        message,
        error: exception.name,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Invalid data shape for this operation',
        error: 'PrismaValidationError',
      };
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Database unavailable',
        error: 'DatabaseUnavailable',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'InternalServerError',
    };
  }

  private resolvePrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    error: string;
  } {
    const target = (e.meta?.target as string[] | string | undefined) ?? [];
    const fields = Array.isArray(target) ? target.join(', ') : String(target);

    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: fields
            ? `A record with this ${fields} already exists`
            : 'A record with these values already exists',
          error: 'UniqueConstraintViolation',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Referenced record does not exist',
          error: 'ForeignKeyConstraintViolation',
        };
      case 'P2014':
        return {
          status: HttpStatus.CONFLICT,
          message: 'Cannot delete — other records still reference this one',
          error: 'RelationViolation',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          error: 'NotFound',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          error: `PrismaError_${e.code}`,
        };
    }
  }
}
