import { HttpException } from '@nestjs/common';
import type { ProblemType } from './problem-types';

export interface FieldError {
  field: string;
  message: string;
}

export interface ProblemExtensions {
  errors?: FieldError[];
}

// Thrown by application code to return a specific problem type. Extending
// HttpException keeps Nest's status handling for anything that inspects it.
export class ProblemException extends HttpException {
  constructor(
    readonly problem: ProblemType,
    readonly detail?: string,
    readonly extensions: ProblemExtensions = {},
  ) {
    super(detail ?? problem.title, problem.status);
  }
}
