import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { ProblemTypes } from '../problem/problem-types';
import {
  type FieldError,
  ProblemException,
} from '../problem/problem.exception';

// Flattens class-validator's nested error tree into one entry per failed
// constraint, with dotted paths such as "recipient.email" or "items.0.name".
export function toFieldErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    return [...own, ...toFieldErrors(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    // Drop properties without validation decorators, and reject the request
    // if any were sent, so typos and unsupported fields are not ignored.
    whitelist: true,
    forbidNonWhitelisted: true,
    // Give handlers DTO instances; string-to-number coercion stays explicit.
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) =>
      new ProblemException(
        ProblemTypes.VALIDATION_FAILED,
        'One or more fields are invalid.',
        { errors: toFieldErrors(errors) },
      ),
  });
}
