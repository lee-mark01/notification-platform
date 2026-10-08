import type { FieldError } from './problem.exception';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Response body defined by RFC 9457, plus the `errors` extension member. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: FieldError[];
}
