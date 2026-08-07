import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

/**
 * The point of this filter is that nothing internal reaches the client. The
 * Prisma cases are the ones that used to leak: a P2002 surfaced as a raw 500
 * carrying the failing column names.
 */
describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let status: jest.Mock;
  let json: jest.Mock;
  let host: any;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // Silence the intentional error logging this filter does.
    jest.spyOn(filter['logger'], 'error').mockImplementation();
    jest.spyOn(filter['logger'], 'warn').mockImplementation();

    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });

    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/employees', method: 'POST' }),
      }),
    };
  });

  const body = () => json.mock.calls[0][0];

  const prismaError = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('db failed', {
      code,
      clientVersion: '7.4.1',
      meta,
    });

  describe('Nest exceptions pass through unchanged', () => {
    it('keeps a 404 as a 404', () => {
      filter.catch(new NotFoundException('Employee not found'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(body().message).toBe('Employee not found');
    });

    it('keeps a 403 as a 403', () => {
      filter.catch(new ForbiddenException('No access'), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    });

    it('preserves the ValidationPipe message array', () => {
      // The frontend joins this array to show per-field errors.
      filter.catch(
        new BadRequestException(['salary must be a number', 'name is required']),
        host,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(body().message).toEqual([
        'salary must be a number',
        'name is required',
      ]);
    });
  });

  describe('Prisma errors map to the status they actually mean', () => {
    it('P2002 unique violation becomes 409, not 500', () => {
      filter.catch(prismaError('P2002', { target: ['email'] }), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(body().message).toContain('email');
    });

    it('P2002 names the field without leaking the driver message', () => {
      filter.catch(prismaError('P2002', { target: ['email'] }), host);

      // The `error` field carries our own label, so only the client-facing
      // message is checked for leakage.
      expect(body().message).not.toContain('db failed');
      expect(body().message).not.toMatch(/INSERT|SELECT|UPDATE|prisma/i);
    });

    it('P2002 falls back to a generic message when no target is reported', () => {
      filter.catch(prismaError('P2002'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(body().message).toBe('A record with these values already exists');
    });

    it('P2003 foreign key violation becomes 400', () => {
      filter.catch(prismaError('P2003'), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it('P2014 relation violation becomes 409', () => {
      filter.catch(prismaError('P2014'), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(body().message).toContain('still reference');
    });

    it('P2025 missing record becomes 404', () => {
      filter.catch(prismaError('P2025'), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it('an unmapped Prisma code becomes a generic 500', () => {
      filter.catch(prismaError('P9999'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body().message).toBe('Database error');
    });

    it('an unreachable database becomes 503', () => {
      filter.catch(
        new Prisma.PrismaClientInitializationError('no connection', '7.4.1'),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('unknown errors', () => {
    it('become a generic 500 with no internal detail', () => {
      filter.catch(new Error('secret internal detail'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body().message).toBe('Internal server error');
      expect(JSON.stringify(body())).not.toContain('secret internal detail');
    });

    it('log the stack server-side so the detail is not simply lost', () => {
      filter.catch(new Error('secret internal detail'), host);
      expect(filter['logger'].error).toHaveBeenCalled();
    });

    it('handle a thrown non-Error without crashing the filter', () => {
      expect(() => filter.catch('just a string', host)).not.toThrow();
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('response envelope', () => {
    it('always carries statusCode, path, and timestamp', () => {
      filter.catch(new NotFoundException('nope'), host);

      expect(body()).toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        path: '/employees',
      });
      expect(Date.parse(body().timestamp)).not.toBeNaN();
    });
  });
});
