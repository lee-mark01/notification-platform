import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { etagFor } from '../common/http/etag';
import { ApiProblemResponse } from '../common/problem/problem-details.dto';
import { ProblemTypes } from '../common/problem/problem-types';
import { ProblemException } from '../common/problem/problem.exception';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ListTemplatesQuery } from './dto/list-templates.query';
import {
  TemplatePageResponse,
  TemplateResponse,
} from './dto/template.response';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { Template } from './template.entity';
import { TemplatesService } from './templates.service';

const idPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new ProblemException(ProblemTypes.VALIDATION_FAILED, undefined, {
      errors: [{ field: 'id', message: 'id must be an integer' }],
    }),
});

const ETAG_HEADER = {
  ETag: { description: 'Current version; send it back as If-Match.' },
};

// Admin guard arrives in Phase 6.
@ApiTags('admin: templates')
@Controller('admin/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a template' })
  @ApiCreatedResponse({
    type: TemplateResponse,
    headers: {
      ...ETAG_HEADER,
      Location: { description: 'URL of the new template.' },
    },
  })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  @ApiProblemResponse(ProblemTypes.TEMPLATE_KEY_CONFLICT)
  async create(
    @Body() dto: CreateTemplateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TemplateResponse> {
    const template = await this.templates.create(dto);
    res.location(`/admin/templates/${template.id}`);
    return this.withETag(res, template);
  }

  @Get()
  @ApiOperation({ summary: 'List templates, oldest first' })
  @ApiOkResponse({ type: TemplatePageResponse })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  async list(
    @Query() query: ListTemplatesQuery,
  ): Promise<TemplatePageResponse> {
    const page = await this.templates.list(query);
    return {
      items: page.items.map((t) => TemplateResponse.from(t)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a template' })
  @ApiOkResponse({ type: TemplateResponse, headers: ETAG_HEADER })
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  async get(
    @Param('id', idPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TemplateResponse> {
    return this.withETag(res, await this.templates.get(id));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update template content',
    description:
      'Requires If-Match with the ETag from GET. key and channel cannot change.',
  })
  @ApiHeader({ name: 'If-Match', required: true, example: '"1"' })
  @ApiOkResponse({ type: TemplateResponse, headers: ETAG_HEADER })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  @ApiProblemResponse(ProblemTypes.PRECONDITION_FAILED)
  @ApiProblemResponse(ProblemTypes.PRECONDITION_REQUIRED)
  async update(
    @Param('id', idPipe) id: number,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: UpdateTemplateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TemplateResponse> {
    return this.withETag(res, await this.templates.update(id, ifMatch, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a template; its key stays reserved' })
  @ApiNoContentResponse()
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  async remove(@Param('id', idPipe) id: number): Promise<void> {
    await this.templates.remove(id);
  }

  private withETag(res: Response, template: Template): TemplateResponse {
    res.setHeader('ETag', etagFor(template.version));
    return TemplateResponse.from(template);
  }
}
