| 쿼리                          | 전 (ms) | 후 (ms) | 전: 접근 방식                                                               | 후: 접근 방식                               |
| ----------------------------- | ------- | ------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| 발송 이력 7일, 필터 없음      | 347     | 0.31    | ix_notification_created_channel, 77,825행 hash join, DISTINCT 임시 테이블   | ix_notification_created_at, 51행 reverse    |
| 발송 이력 7일, email + FAILED | 1186    | 7.4     | ix_notification_status_updated_at, 20,000행 hash join, DISTINCT 임시 테이블 | ix_notification_created_at, 3,732행 reverse |
| 발송 이력, 사용자 1명 30일    | 0.16    | 0.10    | ix_notification_user_created, 11행 hash join, DISTINCT 임시 테이블          | ix_notification_user_created, 11행 reverse  |
| 통계 요약 7일                 | 136     | 56.2    | ix_notification_created_channel, 77,825행                                   | ix_notification_stats, 77,825행 covering    |
| 템플릿별 읽음률 7일           | 4290    | 49.8    | fk_notification_template, 999,999행 template부터 nested loop                | ix_notification_stats, 77,825행 covering    |
