import type { INestApplication } from '@nestjs/common';
import { ProblemDetailsFilter } from './common/problem/problem-details.filter';
import { createValidationPipe } from './common/validation/validation.pipe';

// Global wiring shared by main.ts and E2E tests. Tests build the app without
// main.ts, so anything registered only there would be missing under test.
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());
}
