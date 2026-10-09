# 운영 가이드

장애나 문의가 생겼을 때 따라 할 절차. 관리자 API는 모두 `X-Admin-Key` 헤더가 필요하다. 아래 예시는 `ADMIN`과 `API`를 셸 변수로 둔다.

```bash
API=https://notifications.example.com
ADMIN="X-Admin-Key: <관리자 키>"
```

기준은 언제나 DB다. Redis(BullMQ)의 job은 "지금 처리할 일 목록"일 뿐이고, 알림의 상태와 이력은 `notification`·`delivery_attempt` 테이블에 있다. 그래서 job을 손으로 고치지 않고, 아래 API로 DB 상태를 바꾼다.

## 1. 지금 상태 보기

| 보고 싶은 것                            | 방법                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 큐에 쌓인 양, 처리 중, 재시도 대기, DLQ | `GET /admin/queues/metrics` 또는 Bull Board `/admin/queues/board`(읽기 전용, 브라우저는 Basic 인증에 관리자 키) |
| 기간·채널·유형별 상태와 성공률·읽음률   | `GET /admin/stats/summary?groupBy=channel,category`                                                             |
| 특정 알림들                             | `GET /admin/notifications?status=FAILED,DEAD&templateKey=...` (최근 7일 기본, 최대 92일)                        |
| 알림 한 건의 시도 기록                  | `GET /notifications/{id}` (발송 API 키로)                                                                       |

```bash
curl -s "$API/admin/queues/metrics" -H "$ADMIN"
curl -s "$API/admin/stats/summary?groupBy=channel" -H "$ADMIN"
```

## 2. DLQ에 쌓인 알림 다시 보내기

일시 오류로 재시도를 모두 쓴 알림은 `DEAD`가 되고 DLQ에 들어간다. 대부분 Provider 쪽 문제(계정 정지, 장시간 장애, 한도 초과)다.

1. 원인 확인: `GET /admin/dlq`의 `lastErrorCode`. 같은 코드가 몰려 있으면 그 원인을 먼저 고친다(예: SES 계정 상태, 키 만료). 원인이 남아 있으면 다시 보내도 다시 `DEAD`가 된다.
2. 다시 보내기: 한 번에 100건까지.

   ```bash
   curl -s "$API/admin/dlq?limit=100" -H "$ADMIN"
   curl -s -X POST "$API/admin/dlq/redrive" -H "$ADMIN" -H 'Content-Type: application/json' \
     -d '{"notificationIds":[1024,1025]}'
   ```

3. 결과: `redriven`은 다시 큐에 넣은 수, `skipped`는 이미 `DEAD`가 아니었던 id. 같은 요청을 두 번 보내도 한 번만 다시 보낸다.
4. 시도 번호는 이어진다(처음부터 다시 세지 않음). 시도 기록이 지워지지 않게 하려는 것이다.

## 3. 반송·신고가 갑자기 늘 때

SES는 반송률·신고율이 일정 수준을 넘으면 계정을 검토하거나 발송을 멈춘다. 발송 인프라 전체를 지키는 일이라 가장 먼저 대응한다.

1. 규모 확인: `GET /admin/stats/summary?groupBy=channel,category`에서 `BOUNCED`·`COMPLAINED` 비율.
2. 범위 좁히기: `GET /admin/notifications?status=BOUNCED,COMPLAINED&channel=email`로 어느 템플릿·클라이언트·배치인지 본다(`templateKey`, `clientId`, `batchId`).
3. 이미 막혀 있는 것: 영구 반송과 신고는 웹훅을 받는 즉시 수신거부에 들어가, 같은 주소로는 다시 보내지 않는다. `GET /admin/suppressions?reason=HARD_BOUNCE`로 확인한다.
4. 원인이 특정 목록(오래된 주소록)이면 그 클라이언트에 발송 중단을 요청한다. 큐를 일시 정지하는 관리자 API와 API 키 폐기 명령은 아직 없다(남은 과제). 급하면 DB에서 그 클라이언트의 `api_client.api_key_hash`를 다른 값으로 바꿔 새 요청을 막는다. 이미 큐에 들어간 알림은 그대로 나간다.

## 4. Redis가 죽었을 때

- 접수는 계속된다. `POST /notifications`는 알림을 DB에 저장하고 202를 돌려준다. 큐 등록만 실패해 알림은 `PENDING`으로 남는다(유실 없음, 장애 시나리오 2).
- `/health/ready`는 503이 된다(로드밸런서가 새 인스턴스로 보내지 않게). `/health/live`는 200이라 재시작되지 않는다.
- 복구 뒤 할 일은 없다. Sweeper가 30초마다 1분 넘게 `PENDING`인 알림을 다시 넣고, 등록이 멈춘 대량 발송 배치는 이어서 등록한다.
- 확인: 복구 후 몇 분 안에 `GET /admin/stats/summary`의 `PENDING`이 0으로 줄어야 한다.
- Redis 데이터까지 잃었다면(AOF 없음, 새 인스턴스): `QUEUED`·`RETRYING`·`SENDING`으로 10분 넘게 머문 알림도 Sweeper가 다시 넣는다.

## 5. Worker를 늘릴 때

- 같은 이미지를 `WORKERS_ENABLED=true`로 하나 더 띄운다. API 전용 인스턴스는 `false`.
- 큐별 발송 한도(`EMAIL_RATE_PER_SEC` 등)는 Redis에 있어 모든 Worker가 나눠 쓴다. Worker를 늘려도 SES 한도를 넘지 않는다.
- DB 커넥션: 인스턴스마다 `DB_POOL_SIZE`(기본 30)개를 연다. `인스턴스 수 × 풀 < MySQL max_connections`(기본 151)인지 확인한다. 풀은 그 프로세스가 동시에 처리하는 job 수(송신 큐 concurrency 합, 기본 30) 이상이어야 한다. 작으면 job이 커넥션을 기다려 처리량이 떨어진다([측정](../load/perf/README.md)).
- 처리량이 늘지 않으면 먼저 발송 한도와 Provider 지연을 본다. 한도에 막혀 있으면 Worker를 늘려도 소용없다.

## 6. Worker를 내릴 때(배포)

- `SIGTERM`을 보낸다. 처리 중인 job을 끝내고 결과를 기록한 뒤 종료한다(장애 시나리오 7). 종료 유예 시간은 30초 이상으로 둔다.
- 강제 종료(`kill -9`)되면 그 job은 lease(60초)가 끝난 뒤 다른 Worker가 이어받는다. 그 사이 발송이 끝났는데 기록 전이었다면 한 번 더 갈 수 있다. 이 구간은 막을 수 없어 정의하고 측정했다([ADR-0002](adr/0002-delivery-guarantee-and-idempotency.md)).

## 7. "메일이 안 왔어요" 한 건 추적

1. 요청한 서비스의 `X-Request-Id`(우리 응답 헤더에도 있음)나 알림 id를 받는다.
2. 로그에서 `correlationId`(요청 ID) 또는 `notificationId`로 검색한다. API의 요청 줄과 Worker의 처리 줄이 같은 값으로 이어진다.
3. `GET /notifications/{id}`로 상태와 시도 기록을 본다.
   - `SUPPRESSED`: 수신거부 또는 마케팅 미동의. `GET /admin/suppressions?email=...`
   - `FAILED`: 영구 오류(잘못된 주소 등). `lastErrorCode` 확인
   - `SENT`인데 못 받음: SES는 받았다. `DELIVERED`·`BOUNCED` 웹훅이 오는지 보고, 스팸함을 확인하게 한다
4. 수신거부가 잘못 걸렸으면 `DELETE /admin/suppressions/{email}`로 해제한다. 기록은 남는다.
