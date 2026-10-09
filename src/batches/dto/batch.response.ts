import { ApiProperty } from '@nestjs/swagger';
import { NotificationCategory } from '../../notifications/notification.enums';
import { TemplateChannel } from '../../templates/template.entity';
import { BatchStatus } from '../notification-batch.entity';

// 202 body. Like a single notification, only what never changes, so a
// replayed response equals the original.
export class AcceptedBatchResponse {
  @ApiProperty({ example: 7 })
  batchId: number;

  @ApiProperty({ example: 10000 })
  totalCount: number;
}

export class BatchResponse {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({
    enum: BatchStatus,
    description:
      'Progress of putting the notifications on the queue. ENQUEUED does not mean sent; see byStatus.',
  })
  status: BatchStatus;

  @ApiProperty({ enum: TemplateChannel })
  channel: TemplateChannel;

  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @ApiProperty({ example: 10000 })
  totalCount: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: { SENT: 9800, QUEUED: 150, FAILED: 50 },
    description:
      'Notification count per status; statuses with none are left out.',
  })
  byStatus: Record<string, number>;

  @ApiProperty()
  createdAt: Date;
}
