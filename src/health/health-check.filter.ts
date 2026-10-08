import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';

// Health checks keep Terminus' own body on 503 (which dependency is down)
// instead of the RFC 9457 format, matching what probes and operators expect.
// Scoped to the health controller, so it takes precedence over the global
// ProblemDetailsFilter only there.
@Catch(ServiceUnavailableException)
export class HealthCheckFilter implements ExceptionFilter {
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}
