import { HttpStatus } from '@nestjs/common';

export interface ProblemType {
  /** RFC 9457 `type`: a URI reference identifying the problem kind. */
  readonly type: string;
  readonly title: string;
  readonly status: HttpStatus;
}

// Catalog of problem types the API returns. Clients branch on `type`, not on
// `title` or `detail`. Relative URIs are valid RFC 9457 type references.
// Once published, a type URI must not change meaning.
export const ProblemTypes = {
  VALIDATION_FAILED: {
    type: '/problems/validation-failed',
    title: 'Request validation failed',
    status: HttpStatus.BAD_REQUEST,
  },
  RESOURCE_NOT_FOUND: {
    type: '/problems/resource-not-found',
    title: 'Resource not found',
    status: HttpStatus.NOT_FOUND,
  },
  IDEMPOTENCY_KEY_MISSING: {
    type: '/problems/idempotency-key-missing',
    title: 'Idempotency-Key header is required',
    status: HttpStatus.BAD_REQUEST,
  },
  IDEMPOTENCY_KEY_IN_PROGRESS: {
    type: '/problems/idempotency-key-in-progress',
    title: 'A request with this Idempotency-Key is still being processed',
    status: HttpStatus.CONFLICT,
  },
  IDEMPOTENCY_KEY_REUSED: {
    type: '/problems/idempotency-key-reused',
    title: 'Idempotency-Key was already used with a different request body',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  TEMPLATE_KEY_CONFLICT: {
    type: '/problems/template-key-conflict',
    title: 'A template with this key already exists',
    status: HttpStatus.CONFLICT,
  },
  TEMPLATE_UNUSABLE: {
    type: '/problems/template-unusable',
    title: 'The template cannot be used for this request',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  PRECONDITION_FAILED: {
    type: '/problems/precondition-failed',
    title: 'The resource was modified; If-Match does not match its ETag',
    status: HttpStatus.PRECONDITION_FAILED,
  },
  PRECONDITION_REQUIRED: {
    type: '/problems/precondition-required',
    title: 'If-Match header is required for this request',
    status: HttpStatus.PRECONDITION_REQUIRED,
  },
  INTERNAL_ERROR: {
    type: '/problems/internal-error',
    title: 'Internal server error',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  },
} as const satisfies Record<string, ProblemType>;

/** RFC 9457 default for errors with no meaning beyond the HTTP status. */
export const ABOUT_BLANK = 'about:blank';
