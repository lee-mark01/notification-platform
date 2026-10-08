import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from './problem-details';
import type { ProblemType } from './problem-types';

export class FieldErrorDto {
  @ApiProperty({ example: 'recipient.email' })
  field: string;

  @ApiProperty({ example: 'email must be an email' })
  message: string;
}

export class ProblemDetailsDto implements ProblemDetails {
  @ApiProperty({
    description: 'URI reference identifying the problem type.',
    example: '/problems/validation-failed',
  })
  type: string;

  @ApiProperty({ example: 'Request validation failed' })
  title: string;

  @ApiProperty({ example: 400 })
  status: number;

  @ApiPropertyOptional({ example: 'One or more fields are invalid.' })
  detail?: string;

  @ApiPropertyOptional({ example: '/notifications' })
  instance?: string;

  @ApiPropertyOptional({
    type: [FieldErrorDto],
    description: 'Present for validation-failed problems.',
  })
  errors?: FieldErrorDto[];
}

/** Documents an RFC 9457 error response for a given problem type. */
export function ApiProblemResponse(problem: ProblemType, description?: string) {
  return applyDecorators(
    ApiExtraModels(ProblemDetailsDto, FieldErrorDto),
    ApiResponse({
      status: problem.status,
      description: `${description ?? problem.title} (type: ${problem.type})`,
      content: {
        [PROBLEM_CONTENT_TYPE]: {
          schema: { $ref: getSchemaPath(ProblemDetailsDto) },
        },
      },
    }),
  );
}
