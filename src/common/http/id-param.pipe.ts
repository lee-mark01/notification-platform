import { ParseIntPipe } from '@nestjs/common';
import { ProblemTypes } from '../problem/problem-types';
import { ProblemException } from '../problem/problem.exception';

/** Parses an integer route id, failing with a validation-failed problem. */
export function idParamPipe(): ParseIntPipe {
  return new ParseIntPipe({
    exceptionFactory: () =>
      new ProblemException(ProblemTypes.VALIDATION_FAILED, undefined, {
        errors: [{ field: 'id', message: 'id must be an integer' }],
      }),
  });
}
