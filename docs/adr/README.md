# Architecture Decision Records

되돌리기 어렵거나 면접에서 "왜?"를 물을 결정을 기록한다. 형식: 상황 / 선택지 / 결정 / 결과 / 이 결정이 바뀌는 조건.

| 번호                                               | 결정                                | 상태 |
| -------------------------------------------------- | ----------------------------------- | ---- |
| [0001](0001-queue-routing.md)                      | 큐를 채널 × 유형으로 분리           | 채택 |
| [0002](0002-delivery-guarantee-and-idempotency.md) | at-least-once와 멱등성 3계층        | 채택 |
| [0003](0003-sweeper-over-outbox.md)                | Outbox 대신 커밋 후 등록 + Sweeper  | 채택 |
| [0004](0004-typeorm-over-prisma.md)                | ORM으로 TypeORM 사용                | 채택 |
| [0005](0005-job-retention-and-rate-limits.md)      | job 보존 정책과 큐별 발송 속도 제한 | 채택 |
