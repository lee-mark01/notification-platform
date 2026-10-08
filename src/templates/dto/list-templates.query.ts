import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TemplateChannel } from '../template.entity';

export class ListTemplatesQuery {
  @ApiPropertyOptional({ enum: TemplateChannel })
  @IsOptional()
  @IsEnum(TemplateChannel)
  channel?: TemplateChannel;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  // Query values are strings; implicit conversion is off, so convert here.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
