import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from './problem-details';
import { ABOUT_BLANK, ProblemTypes } from './problem-types';
import { ProblemException } from './problem.exception';

// Converts every exception into an RFC 9457 response, so clients see one
// error format regardless of where the error came from.
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const problem = this.toProblem(exception);
    // Path only: query strings may carry values that should not be echoed.
    problem.instance = request.originalUrl.split('?')[0];

    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${problem.instance} -> ${problem.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (exception instanceof ProblemException) {
      response.set(exception.headers);
    }
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) {
      return {
        type: exception.problem.type,
        title: exception.problem.title,
        status: exception.problem.status,
        ...(exception.detail && { detail: exception.detail }),
        ...exception.extensions,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const detail = this.detailOf(exception);
      return {
        type: ABOUT_BLANK,
        title: STATUS_CODES[status] ?? 'Error',
        status,
        ...(detail && { detail }),
      };
    }

    // Unknown errors may carry internal details, so only a generic body is
    // returned; the stack trace goes to the log.
    const { type, title } = ProblemTypes.INTERNAL_ERROR;
    return { type, title, status: HttpStatus.INTERNAL_SERVER_ERROR };
  }

  private detailOf(exception: HttpException): string | undefined {
    if (exception.getStatus() >= 500) return undefined;

    const body = exception.getResponse();
    if (typeof body === 'string') return body;

    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join('; ');
    return undefined;
  }
}
