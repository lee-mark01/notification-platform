import type { ValidationError } from '@nestjs/common';
import { toFieldErrors } from './validation.pipe';

describe('toFieldErrors', () => {
  it('flattens nested and array errors into dotted paths', () => {
    const errors: ValidationError[] = [
      { property: 'channel', constraints: { isIn: 'channel must be one of' } },
      {
        property: 'recipient',
        children: [
          {
            property: 'email',
            constraints: { isEmail: 'email must be an email' },
          },
        ],
      },
      {
        property: 'items',
        children: [
          {
            property: '0',
            children: [
              {
                property: 'name',
                constraints: {
                  isString: 'name must be a string',
                  isNotEmpty: 'name should not be empty',
                },
              },
            ],
          },
        ],
      },
    ];

    expect(toFieldErrors(errors)).toEqual([
      { field: 'channel', message: 'channel must be one of' },
      { field: 'recipient.email', message: 'email must be an email' },
      { field: 'items.0.name', message: 'name must be a string' },
      { field: 'items.0.name', message: 'name should not be empty' },
    ]);
  });
});
