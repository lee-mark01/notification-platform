import { QueryFailedError } from 'typeorm';
import { ProblemException } from '../common/problem/problem.exception';
import { Template, TemplateChannel } from './template.entity';
import { TemplatesRepository } from './templates.repository';
import { TemplatesService } from './templates.service';

function emailTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 1,
    key: 'email-verification',
    channel: TemplateChannel.Email,
    subject: 'Verify',
    htmlBody: '<p>{{code}}</p>',
    textBody: null,
    title: null,
    body: null,
    data: null,
    requiredVariables: ['code'],
    version: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

async function problemOf(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProblemException);
  return (error as ProblemException).problem;
}

describe('TemplatesService', () => {
  let repo: jest.Mocked<
    Pick<
      TemplatesRepository,
      'insert' | 'findActiveById' | 'updateIfVersion' | 'softDeleteById'
    >
  >;
  let service: TemplatesService;

  beforeEach(() => {
    repo = {
      insert: jest.fn(),
      findActiveById: jest.fn(),
      updateIfVersion: jest.fn(),
      softDeleteById: jest.fn(),
    };
    service = new TemplatesService(repo as unknown as TemplatesRepository);
  });

  describe('create', () => {
    const dto = {
      key: 'email-verification',
      channel: TemplateChannel.Email,
      subject: 'Verify',
      htmlBody: '<p>hi</p>',
    };

    it('maps a duplicate-key error to template-key-conflict', async () => {
      repo.insert.mockRejectedValue(
        new QueryFailedError('INSERT', [], { code: 'ER_DUP_ENTRY' } as never),
      );

      const problem = await problemOf(service.create(dto));

      expect(problem.type).toBe('/problems/template-key-conflict');
      expect(problem.status).toBe(409);
    });

    it('rethrows other database errors unchanged', async () => {
      const failure = new Error('connection lost');
      repo.insert.mockRejectedValue(failure);

      await expect(service.create(dto)).rejects.toBe(failure);
    });

    it('rejects content of the wrong channel before touching the database', async () => {
      const problem = await problemOf(
        service.create({ ...dto, title: 'push only' }),
      );

      expect(problem.type).toBe('/problems/validation-failed');
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('requires If-Match (428)', async () => {
      const problem = await problemOf(
        service.update(1, undefined, { subject: 'x' }),
      );

      expect(problem.status).toBe(428);
      expect(repo.findActiveById).not.toHaveBeenCalled();
    });

    it('rejects a stale If-Match (412) without writing', async () => {
      repo.findActiveById.mockResolvedValue(emailTemplate({ version: 3 }));

      const problem = await problemOf(
        service.update(1, '"2"', { subject: 'x' }),
      );

      expect(problem.status).toBe(412);
      expect(repo.updateIfVersion).not.toHaveBeenCalled();
    });

    it('returns 412 when a concurrent write wins between read and update', async () => {
      repo.findActiveById.mockResolvedValue(emailTemplate({ version: 3 }));
      repo.updateIfVersion.mockResolvedValue(false);

      const problem = await problemOf(
        service.update(1, '"3"', { subject: 'x' }),
      );

      expect(problem.status).toBe(412);
      expect(repo.updateIfVersion).toHaveBeenCalledWith(1, 3, {
        subject: 'x',
      });
    });

    it('validates the merged content against the stored channel', async () => {
      repo.findActiveById.mockResolvedValue(emailTemplate());

      const problem = await problemOf(
        service.update(1, '"3"', { subject: null }),
      );

      expect(problem.type).toBe('/problems/validation-failed');
      expect(repo.updateIfVersion).not.toHaveBeenCalled();
    });
  });

  it('returns 404 when deleting a missing or already deleted template', async () => {
    repo.softDeleteById.mockResolvedValue(false);

    const problem = await problemOf(service.remove(1));

    expect(problem.type).toBe('/problems/resource-not-found');
  });
});
