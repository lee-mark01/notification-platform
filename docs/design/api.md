# API 명세 (초안)

Phase 2~6에서 구현할 API의 계약이다. 이미 구현한 것은 표시했다. 에러는 모두 [RFC 9457 Problem Details](../../README.md#에러-응답)이고(헬스체크 제외), 상태 전이는 [상태 머신](state-machine.md), 데이터는 [ERD](erd.md)를 따른다.

## 인증

| 대상                                                 | 방식                                                                                                | 실패 | 구현                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---- | ------------------------ |
| 발송 API (`/notifications`, `/notification-batches`) | `X-API-Key` 헤더 → SHA-256 해시로 `api_client` 조회                                                 | 401  | Phase 2                  |
| 사용자 API (`/me/*`, `/devices`)                     | `Authorization: Bearer <JWT>` (HS256, `sub` = 사용자 id). 토큰은 별도 인증 서비스가 발급한다고 가정 | 401  | Phase 2·4                |
| 관리자 API (`/admin/*`)                              | `X-Admin-Key` 헤더, 상수 시간 비교                                                                  | 401  | 구현됨 (템플릿·DLQ·통계) |
| 웹훅 (`/webhooks/ses`)                               | SNS 메시지 서명 검증                                                                                | 403  | Phase 4                  |
| 헬스체크                                             | 없음                                                                                                | —    | 구현됨                   |

- 401 응답은 `about:blank`와 `WWW-Authenticate` 헤더를 쓴다.
- 클라이언트·사용자는 자기 리소스만 볼 수 있다. 남의 리소스는 존재를 숨기기 위해 403이 아니라 404로 응답한다.

## 멱등성 (`Idempotency-Key`)

`POST /notifications`, `POST /notification-batches`는 `Idempotency-Key` 헤더가 필수다. 규칙은 [상태 머신 — 멱등 키](state-machine.md#멱등-키)와 같다.

| 상황                      | 응답                                               |
| ------------------------- | -------------------------------------------------- |
| 헤더 없음                 | 400 `idempotency-key-missing`                      |
| 처음 보는 키              | 정상 처리                                          |
| 같은 키·같은 본문, 완료됨 | 저장된 응답을 그대로 + `Idempotent-Replayed: true` |
| 같은 키·다른 본문         | 422 `idempotency-key-reused`                       |
| 같은 키, 아직 처리 중     | 409 `idempotency-key-in-progress` + `Retry-After`  |

- 키는 1~255자, 클라이언트별로 유일하다. 24시간 보관한다.
- "같은 본문"은 JSON 키를 정렬한 정규화 본문의 SHA-256으로 비교한다.

## 발송 API

### `POST /notifications` — 단건 발송 접수 (Phase 2)

요청:

```http
POST /notifications
X-API-Key: <key>
Idempotency-Key: 2f1c0c9e-...
Content-Type: application/json

{
  "channel": "email",
  "category": "transactional",
  "templateKey": "email-verification",
  "recipient": { "userId": 42 },
  "variables": { "code": "381920" }
}
```

| 필드        | 규칙                                                                                 |
| ----------- | ------------------------------------------------------------------------------------ |
| channel     | `email` / `push`, 템플릿 채널과 같아야 함                                            |
| category    | `transactional` / `marketing`                                                        |
| templateKey | 삭제되지 않은 템플릿                                                                 |
| recipient   | email: `userId` 또는 `email` 중 하나 이상(둘 다면 `email` 우선). push: `userId` 필수 |
| variables   | 템플릿 `requiredVariables`를 모두 포함                                               |

응답:

```http
202 Accepted
Location: /notifications/1024

{ "id": 1024 }
```

- 202인 이유: 발송은 큐 뒤 Worker가 비동기로 한다. 응답은 "접수했다"는 뜻이다.
- 본문은 `id`만 담는다. 같은 키로 재요청하면 원래 응답과 같아야 하는데, 상태는 접수 뒤 계속 바뀌므로 응답에 넣지 않고 `GET /notifications/{id}`로 조회한다.
- 커밋 후 트랜잭션 밖에서 채널 × 유형에 맞는 큐에 등록하고 `QUEUED`로 바꾼다. Redis에 등록하지 못하면(1초 제한) 알림은 `PENDING`으로 남고 응답은 그대로 202다. 남은 건은 Sweeper가 다시 등록한다([ADR-0003](../adr/0003-sweeper-over-outbox.md)).
- 접수 시 템플릿을 렌더링해 저장한다. 이후 템플릿이 바뀌어도 이 알림의 내용은 바뀌지 않는다.
- 접수가 실패하면(400·422) 멱등 키를 저장하지 않는다. 요청을 고쳐 같은 키로 다시 보낼 수 있다.

실패:

| 상태 | type                          | 경우                                            |
| ---- | ----------------------------- | ----------------------------------------------- |
| 400  | `validation-failed`           | 필드 형식 오류                                  |
| 400  | `idempotency-key-missing`     | 헤더 없음                                       |
| 401  | `about:blank`                 | API 키 없음·불일치                              |
| 409  | `idempotency-key-in-progress` | 같은 키 처리 중                                 |
| 422  | `idempotency-key-reused`      | 같은 키, 다른 본문                              |
| 422  | `template-unusable`           | 템플릿 없음·삭제됨, 채널 불일치, 필수 변수 누락 |
| 422  | `recipient-unusable`          | `userId`의 사용자가 없음                        |

`template-unusable`을 400이 아니라 422로 둔 이유: 요청 형식은 맞지만 서버 상태(템플릿) 기준으로 처리할 수 없는 경우라서다. 세부 원인은 `errors`에 담는다.

### `GET /notifications/{id}` — 단건 상태 조회 (Phase 2)

요청한 클라이언트의 알림만 조회한다.

```json
{
  "id": 1024,
  "channel": "email",
  "category": "transactional",
  "status": "SENT",
  "templateKey": "email-verification",
  "attempts": [
    {
      "attemptNo": 1,
      "outcome": "TRANSIENT_ERROR",
      "errorCode": "PROVIDER_5XX",
      "durationMs": 120,
      "startedAt": "..."
    },
    {
      "attemptNo": 2,
      "outcome": "SUCCESS",
      "durationMs": 95,
      "startedAt": "..."
    }
  ],
  "createdAt": "...",
  "sentAt": "...",
  "deliveredAt": null,
  "readAt": null
}
```

실패: 401, 404 `resource-not-found`.

### `POST /notification-batches` — 대량 발송 접수 (구현됨)

```json
{
  "channel": "email",
  "category": "marketing",
  "templateKey": "weekly-digest",
  "recipients": [
    { "userId": 1, "variables": { "name": "A" } },
    { "email": "b@example.com", "variables": { "name": "B" } }
  ]
}
```

- `Idempotency-Key` 필수. 수신자 1~10,000명. 수신자 규칙은 단건과 같다(푸시는 `userId` 필수, 이메일은 `email` 또는 `userId`).
- 전부 아니면 전무: 수신자 하나라도 쓸 수 없으면 아무것도 접수하지 않는다. 키 하나가 항상 배치 하나 전체를 뜻하게 하기 위해서다. 오류는 `recipients[3].userId`처럼 위치로 알려 주고 최대 100개까지 담는다.
- 응답 202 `{ "batchId": 7, "totalCount": 2 }` + `Location: /notification-batches/7`. 큐 등록은 응답 뒤에 진행되므로 진행 상황은 GET으로 본다.
- 실패: 400 `validation-failed`(수신자 수, 수신자 형식), 422 `template-unusable`(템플릿 없음·채널 불일치), 422 `recipient-unusable`(없는 사용자, 필수 변수 누락, 제목 길이 초과), 409·422 멱등 키.

### `GET /notification-batches/{id}` — 배치 진행 상황 (구현됨)

```json
{
  "id": 7,
  "status": "ENQUEUED",
  "channel": "email",
  "category": "marketing",
  "totalCount": 10000,
  "byStatus": { "SENT": 9800, "QUEUED": 150, "FAILED": 50 },
  "createdAt": "..."
}
```

- `status`는 큐 등록 진행이다. 발송 결과는 `byStatus`(알림 상태별 건수, 0건인 상태는 생략)로 본다.
- 실패: 401, 404 `resource-not-found`(다른 클라이언트의 배치 포함).

## 사용자 API

### `POST /devices` — FCM 토큰 등록 (구현됨)

```json
{ "token": "fcm-registration-token", "platform": "web" }
```

- 새 토큰이면 201, 이미 있으면 소유자·`last_seen_at`을 갱신하고 200 (upsert). 비활성 토큰을 다시 등록하면 활성화한다.
- 응답: `{ "id": 12, "platform": "web", "active": true, "lastSeenAt": "..." }` (토큰은 돌려주지 않는다)
- 토큰은 사람이 아니라 브라우저를 가리킨다. 다른 사용자가 같은 브라우저에서 등록하면 토큰이 그 사용자로 옮겨 간다.
- JWT는 HS256만 받고 `exp`가 반드시 있어야 하며 `sub`는 존재하는 사용자 id여야 한다. 로컬·데모용 발급: `npm run user:token -- <email>`
- 실패: 400, 401 (`WWW-Authenticate: Bearer`).

### `GET /me/notifications` — 내 알림함 (구현됨)

쿼리: `limit`(1~100, 기본 20), `cursor`, `unread`(`true`면 안읽음만).

```json
{
  "items": [
    {
      "id": 1024,
      "channel": "push",
      "title": "새 메시지",
      "body": "...",
      "readAt": null,
      "createdAt": "..."
    }
  ],
  "nextCursor": "eyJjIjoi..."
}
```

- 최신순. 커서는 `(created_at, id)`를 담은 불투명 값이다(동시각 정렬을 id로 보장).
- 본문은 `rendered_title`, `rendered_body`(발송 당시 내용)를 보여준다.
- 알림함에는 실제로 발송된 알림(`SENT`, `DELIVERED`)만 보인다. 수신거부로 막혔거나 아직 큐에 있는 알림은 사용자에게 간 적이 없기 때문이다. 읽음 처리 대상도 같다.

### `GET /me/notifications/unread-count` (구현됨)

`{ "count": 3 }`

### `PATCH /me/notifications/{id}/read`, `PATCH /me/notifications/{id}/unread` (구현됨)

- 응답 200 `{ "id": 1024, "readAt": "..." }` (`unread`면 `readAt: null`).
- 멱등: 이미 읽은 알림에 `read`를 다시 보내도 200이고 `readAt`은 처음 값 그대로다(장애 시나리오 12).
- 남의 알림이면 404.

### `POST /me/notifications/read-all` (구현됨)

`{ "updated": 3 }` — 안읽음만 갱신한 개수.

### `PUT /me/marketing-consent` (구현됨)

```json
{ "optIn": false }
```

- 응답 200 `{ "optIn": false, "updatedAt": "..." }`. 같은 값으로 다시 보내도 결과가 같다(값이 바뀔 때만 UPDATE하므로 동의 시각·`updatedAt`도 그대로).
- 동의는 발송 직전에 확인한다. 접수 뒤에 철회하면 아직 안 보낸 마케팅 알림은 `SUPPRESSED`가 된다.
- PLAN 초안의 `POST·DELETE /me/subscriptions/marketing` 대신, 원하는 최종 상태를 보내는 `PUT` 하나로 정했다. 동의·철회가 한 리소스의 두 값이라 멱등한 `PUT`이 더 자연스럽다.

## 웹훅

### `POST /webhooks/ses` (구현됨)

- SNS는 본문을 `Content-Type: text/plain`으로 보낸다. 이 경로만 원문 텍스트로 받아 JSON으로 파싱한다.
- 처리 순서: 서명 검증(인증서 URL이 `sns.<region>.amazonaws.com` 도메인인지 포함) → `Type`별 처리.
  - `SubscriptionConfirmation`: 설정한 토픽 ARN일 때만 `SubscribeURL`을 호출해 구독 확인.
  - `Notification`: `webhook_event`에 저장(MessageId 유니크) → 이벤트 반영.
- 응답: 성공·중복 모두 200(SNS가 재전송하지 않게). 서명 실패·다른 토픽·SNS가 아닌 인증서 주소 403(`webhook-rejected`), SNS 메시지 형식이 아니면 400.
- 서명 문자열은 AWS 문서의 필드 순서(Notification: Message, MessageId, Subject, Timestamp, TopicArn, Type)로 만들고 SignatureVersion 1은 SHA1, 2는 SHA256으로 검증한다. 인증서는 URL별로 캐시한다.
- 토픽은 `SNS_TOPIC_ARN`과 일치해야 한다. 설정이 없으면 모든 메시지를 거부한다.

## 관리자 API

| 메서드·경로                              | 용도                                                                                                                                                                                                         | 구현    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `POST/GET/PATCH/DELETE /admin/templates` | 템플릿 CRUD (ETag·If-Match)                                                                                                                                                                                  | 구현됨  |
| `POST /admin/templates/{id}/preview`     | `{ variables }` → 접수와 같은 규칙으로 렌더링한 결과(채널별 필드). 누락 변수·긴 제목은 422 `template-unusable`                                                                                               | 구현됨  |
| `GET /admin/notifications`               | 발송 이력 검색: `from`·`to`(기본 최근 7일, 최대 92일), `channel`, `category`, `status`(쉼표로 여러 개), `clientId`, `userId`, `email`(정확히 일치), `templateKey`, `limit`(1~100, 기본 50), `cursor`. 최신순 | 구현됨  |
| `GET /admin/suppressions`                | 수신거부 목록 (`email`, `reason`, `active` 필터, 최신순 커서)                                                                                                                                                | 구현됨  |
| `POST /admin/suppressions`               | 관리자 등록 `{ email, note }` → 201(새로 또는 해제 후 다시 차단), 이미 차단이면 200(기존 사유 유지)                                                                                                          | 구현됨  |
| `DELETE /admin/suppressions/{email}`     | 해제(`released_at` 기록, 행은 남김) → 204, 차단 중이 아니면 404                                                                                                                                              | 구현됨  |
| `GET /admin/stats/summary`               | `from`, `to`, `groupBy=channel,category` → 상태별 건수, 성공률, 읽음률                                                                                                                                       | Phase 6 |
| `GET /admin/stats/read-rates`            | `from`, `to`(기본 최근 7일, 최대 92일) → 템플릿·채널별 발송 수, 읽음 수, 읽음률. 이메일은 Open 이벤트 기준이라 근사치                                                                                        | 구현됨  |
| `GET /admin/dlq`                         | DEAD 알림 목록 (커서, 오래된 순)                                                                                                                                                                             | 구현됨  |
| `POST /admin/dlq/redrive`                | `{ "notificationIds": [..] }`(1~100개) → 각 알림 T8(DEAD → QUEUED) 후 재등록. 응답 `{ "redriven": n, "skipped": [..] }`                                                                                      | 구현됨  |
| `GET /admin/queues/metrics`              | 큐별 waiting·active·delayed·failed, DLQ 건수                                                                                                                                                                 | Phase 7 |

- 목록은 모두 커서 페이지네이션(`{ items, nextCursor }`).
- redrive는 이미 DEAD가 아닌 알림을 건너뛰고(`skipped`), 같은 요청을 반복해도 안전하다.

## 헬스체크 (구현됨)

| 경로                | 응답                                                     |
| ------------------- | -------------------------------------------------------- |
| `GET /health/live`  | 200                                                      |
| `GET /health/ready` | MySQL·Redis 정상 200 / 하나라도 실패 503 (Terminus 형식) |

## 추가한 problem type

| type                           | status | 의미                                                |
| ------------------------------ | ------ | --------------------------------------------------- |
| `/problems/template-unusable`  | 422    | 템플릿이 없거나 삭제됨, 채널 불일치, 필수 변수 누락 |
| `/problems/recipient-unusable` | 422    | 수신자를 확인할 수 없음 (없는 사용자)               |
