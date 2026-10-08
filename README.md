# notification-platform

[![CI](https://github.com/lee-mark01/notification-platform/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lee-mark01/notification-platform/actions/workflows/ci.yml)

이메일(AWS SES)과 푸시(FCM)를 하나의 인터페이스로 발송하는 알림 플랫폼입니다.
재시도, Dead Letter Queue, 멱등성, 웹훅 기반 상태 추적을 갖추는 것을 목표로 합니다.

> 개발 진행 중입니다. 기반(Phase 0)과 설계(Phase 1)를 마쳤고, 다음은 큐와 Worker를 통한 실제 발송입니다.

## 기술 스택

- Node.js, TypeScript, NestJS
- MySQL 8, TypeORM
- BullMQ, Redis
- AWS SES, SNS, Firebase Cloud Messaging
- Jest, Testcontainers, k6
- Docker Compose, GitHub Actions

## 설계 문서

코드를 쓰기 전에 데이터 모델, 상태 전이, API 계약, 핵심 결정을 먼저 정했습니다. 장애 시나리오 13개가 각각 어떤 상태 전이와 데이터로 처리되는지는 상태 머신 문서에 정리했습니다.

| 문서                                      | 내용                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| [ERD](docs/design/erd.md)                 | 테이블·인덱스(각 인덱스가 어떤 조회를 위한 것인지), 대량 insert·통계·이력 보관에 대한 판단 |
| [상태 머신](docs/design/state-machine.md) | 알림 상태와 조건부 UPDATE 전이, 멱등 키 처리, 장애 시나리오 13개 매핑, 반례 검토로 고친 것 |
| [API 명세](docs/design/api.md)            | 인증, `Idempotency-Key` 규칙, 엔드포인트별 요청·응답·상태 코드·problem type                |
| [ADR](docs/adr/README.md)                 | 큐 분리, 전달 보장과 멱등성, Outbox 대신 Sweeper, TypeORM                                  |

## 실행

요구 사항: Node.js 24.15 이상 (`.nvmrc`), Docker

```bash
cp .env.example .env
docker compose up -d
npm ci && npm run migration:run && npm run start:dev
```

`docker compose up -d`는 MySQL과 Redis만 띄웁니다. 앱까지 컨테이너로 실행하려면 `docker compose --profile app up -d --build`를 사용합니다. 이때 `migrate` 서비스가 먼저 마이그레이션을 실행하고 종료하며, 성공해야 `app`이 시작됩니다.

MySQL은 로컬에 설치된 MySQL과 충돌하지 않도록 호스트 포트 3307을 기본값으로 사용합니다.

## API 문서

`SWAGGER_ENABLED=true`이면 Swagger UI(`/docs`)와 OpenAPI JSON(`/docs-json`)을 제공합니다. 기본값은 `false`이며, `.env.example`에서는 개발용으로 켜 둡니다.

![Swagger 문서: 헬스체크와 템플릿 관리 API, 에러 응답 스키마](docs/images/p0-swagger.png)

## 에러 응답

헬스체크를 제외한 모든 에러는 [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) 형식(`application/problem+json`)으로 응답합니다. 클라이언트는 `title`이나 `detail`이 아니라 `type`으로 오류를 구분합니다.

```json
{
  "type": "/problems/validation-failed",
  "title": "Request validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/notifications",
  "errors": [
    { "field": "recipient.email", "message": "email must be an email" }
  ]
}
```

| type                                    | status           | 의미                                                                      |
| --------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `/problems/validation-failed`           | 400              | 요청 검증 실패. `errors`에 필드별 오류                                    |
| `/problems/resource-not-found`          | 404              | 요청한 리소스가 없음                                                      |
| `/problems/idempotency-key-missing`     | 400              | `Idempotency-Key` 헤더 누락                                               |
| `/problems/idempotency-key-in-progress` | 409              | 같은 키의 요청이 아직 처리 중                                             |
| `/problems/idempotency-key-reused`      | 422              | 같은 키가 다른 요청 본문으로 재사용됨                                     |
| `/problems/template-key-conflict`       | 409              | 이미 사용 중인 템플릿 key (삭제된 템플릿 포함)                            |
| `/problems/template-unusable`           | 422              | 템플릿이 없거나 삭제됨, 채널 불일치, 필수 변수 누락                       |
| `/problems/recipient-unusable`          | 422              | 수신자를 확인할 수 없음 (없는 사용자)                                     |
| `/problems/precondition-failed`         | 412              | `If-Match`가 현재 `ETag`와 다름 (그사이 수정됨)                           |
| `/problems/precondition-required`       | 428              | `If-Match` 헤더가 필요한 요청에 없음                                      |
| `/problems/internal-error`              | 500              | 서버 내부 오류. 상세 내용은 응답하지 않고 로그에만 남김                   |
| `about:blank`                           | 상태 코드 그대로 | HTTP 상태 외에 추가 의미가 없는 오류 (예: 없는 경로 404, 잘못된 JSON 400) |

`instance`에는 쿼리 문자열을 제외한 요청 경로가 들어갑니다. 한 번 공개한 `type` URI의 의미는 바꾸지 않습니다.

아래는 실행 중인 API에 없는 템플릿(`GET /admin/templates/999`)을 요청한 실제 응답입니다. 본문은 RFC 9457 형식이고 `Content-Type`은 `application/problem+json`입니다.

![없는 템플릿 조회 시 404 Problem Details 응답과 응답 헤더](docs/images/p0-problem-details.png)

## 발송 API

내부 서비스는 `X-API-Key`로 인증하고 `POST /notifications`로 발송을 요청합니다. 모든 요청에 `Idempotency-Key`가 필요합니다.

```bash
npm run client:create -- my-service   # API 키 발급 (한 번만 표시)
```

| 상황                     | 응답                                                         |
| ------------------------ | ------------------------------------------------------------ |
| 접수                     | 202 `{ "id": ... }` + `Location` (발송은 큐 뒤에서 비동기로) |
| 같은 키·같은 본문 재요청 | 저장된 응답 그대로 + `Idempotent-Replayed: true`             |
| 같은 키·다른 본문        | 422 `idempotency-key-reused`                                 |
| 같은 키가 처리 중        | 409 `idempotency-key-in-progress` + `Retry-After`            |

- 접수 시점에 템플릿을 렌더링해 저장합니다. 이후 템플릿이 바뀌어도 이미 접수한 알림의 내용은 그대로입니다.
- 접수한 알림은 채널 × 유형별 큐 4개(`email-transactional` 등)에 `jobId = notification-{id}`로 등록됩니다. Redis가 내려가 있어도 접수는 202로 성공하고 알림은 `PENDING`으로 남습니다(E2E로 확인).
- 같은 키로 동시에 10건을 보내도 알림은 1건만 생깁니다(E2E로 확인).
- 상태는 `GET /notifications/{id}`로 조회합니다. 다른 클라이언트의 알림은 404입니다.
- 자세한 계약은 [API 명세](docs/design/api.md), 처리 방식은 [ADR-0002](docs/adr/0002-delivery-guarantee-and-idempotency.md).

아래는 실행 중인 API에 같은 `Idempotency-Key`로 요청을 다시 보낸 실제 응답입니다. 요청 화면의 API 키는 가렸습니다.

![같은 키·같은 본문 재요청: 202, Idempotent-Replayed: true, 같은 Location](docs/images/p2-idempotency-replay.png)

![같은 키·다른 본문: 422 idempotency-key-reused](docs/images/p2-idempotency-reused.png)

## 발송 처리 (Worker)

큐마다 BullMQ Worker가 job을 꺼내 발송합니다. 상태 전이는 모두 조건부 UPDATE 한 문장입니다([상태 머신](docs/design/state-machine.md)).

1. 점유: `PENDING·QUEUED·RETRYING → SENDING` (또는 lease가 만료된 `SENDING` 재점유), `lease_until = DB 시각 + 60초`
2. Provider 호출: DB 트랜잭션 밖에서
3. 결과 기록: 상태(`SENT`·`RETRYING`·`FAILED`)와 `delivery_attempt` 1행을 한 트랜잭션으로

- 같은 알림의 job이 두 번 실행돼도 발송은 한 번입니다. 이미 `SENT`면 건너뛰고, 다른 Worker가 lease를 잡고 있으면 Provider를 부르지 않고 job을 실패시킵니다(E2E로 확인).
- Provider는 공통 인터페이스 뒤에 있습니다(어댑터 패턴). 테스트는 결과·지연·실패율을 주입할 수 있는 `FakeProvider`를 씁니다. 채널별 Provider는 `EMAIL_PROVIDER`, `PUSH_PROVIDER`로 고릅니다.
- 실제 이메일은 `EMAIL_PROVIDER=ses`로 AWS SES v2(서울 리전, 샌드박스)를 통해 보냅니다. SES SDK의 자체 재시도는 끄고(`maxAttempts: 1`) 재시도는 큐가 맡습니다. 그래야 시도마다 `delivery_attempt`에 남고 백오프가 한곳에서 관리됩니다. 메일박스 시뮬레이터 주소로 보내 `SENT`와 SES `MessageId` 저장을 확인했습니다.
- SES 오류 분류: 스로틀링·한도·SES 내부 오류·네트워크 오류는 일시 오류, `MessageRejected`·`BadRequestException`(잘못된 주소, 샌드박스의 미인증 수신자)은 영구 오류입니다. 계정 정지·발송 일시 중지처럼 메시지 탓이 아닌 오류는 일시 오류로 분류해 DLQ에서 다시 보낼 수 있게 했습니다.
- `WORKERS_ENABLED=false`면 API만 띄웁니다.
- 재시도 횟수·백오프·DLQ·수신거부 검사는 Phase 3에서 추가합니다.

## 사용자 API

웹 푸시를 받을 브라우저는 `POST /devices`로 FCM 토큰을 등록합니다. 사용자는 `Authorization: Bearer <JWT>`(HS256, `sub` = 사용자 id)로 인증합니다. 실제 서비스에서는 별도 인증 서비스가 토큰을 발급한다고 가정하고, 로컬에서는 CLI로 발급합니다.

```bash
npm run user:token -- me@example.com   # 사용자를 찾거나 만들고 1시간짜리 토큰 출력
```

- 같은 토큰을 다시 등록하면 200으로 갱신(upsert)하고, 비활성화된 토큰은 다시 활성화합니다.
- 서명 알고리즘은 HS256으로 고정하고 `exp`가 없는 토큰은 거부합니다(`alg: none`, 만료, 다른 키 서명 등 E2E로 확인).

## 웹 푸시 (FCM)

`PUSH_PROVIDER=fcm`이면 Firebase Admin SDK로 사용자의 활성 토큰 전체에 한 번에 보냅니다(`sendEachForMulticast`).

- 토큰 하나라도 받았으면 성공으로 기록합니다. 부분 성공을 재시도하면 이미 받은 브라우저에 또 가기 때문입니다.
- FCM이 "등록되지 않은 토큰"이라고 답하면 그 토큰을 비활성화합니다. `invalid-argument`는 잘못된 토큰일 수도, 잘못된 메시지일 수도 있어서, 같은 메시지를 다른 토큰이 받았을 때만 토큰 문제로 보고 비활성화합니다(Firebase 토큰 관리 가이드).
- 활성 토큰이 없으면 재시도 없이 실패합니다.

### 데모 페이지로 직접 받아 보기

`web-push-demo/`는 Firebase JS SDK와 서비스 워커로 이 브라우저의 FCM 토큰을 받아 `POST /devices`로 등록하는 페이지입니다. `.env`에 Firebase 웹 앱 설정과 VAPID 공개 키를 넣은 뒤:

```bash
npm run demo:config                     # .env → web-push-demo/config.js (커밋하지 않음)
npm run demo:serve                      # http://localhost:8080
npm run user:token -- me@example.com    # 페이지에 붙여넣을 JWT
```

API는 `PUSH_PROVIDER=fcm`, `CORS_ORIGINS=http://localhost:8080`으로 띄웁니다. 페이지에서 알림을 허용해 등록한 뒤 `POST /notifications`로 그 사용자(`recipient.userId`)에게 push를 보내면 브라우저 알림이 뜹니다.

## 템플릿 API

관리용 템플릿 CRUD는 `/admin/templates`에 있습니다. 관리자 인증은 Phase 6에서 추가합니다.

| 메서드·경로                                     | 성공                        | 주요 실패                        |
| ----------------------------------------------- | --------------------------- | -------------------------------- |
| `POST /admin/templates`                         | 201 + `Location`, `ETag`    | 400, 409 `template-key-conflict` |
| `GET /admin/templates?channel=&limit=&cursor=`  | 200 `{ items, nextCursor }` | 400                              |
| `GET /admin/templates/{id}`                     | 200 + `ETag`                | 404                              |
| `PATCH /admin/templates/{id}` (`If-Match` 필수) | 200 + 새 `ETag`             | 400, 404, 412, 428               |
| `DELETE /admin/templates/{id}`                  | 204                         | 404                              |

- 템플릿은 채널(email, push) 하나에 속합니다. email은 `subject`·`htmlBody`가 필수(`textBody` 선택), push는 `title`·`body`가 필수(`data` 선택)이고, 다른 채널의 필드는 거부합니다. `key`와 `channel`은 바꿀 수 없습니다.
- 본문에는 `{{변수}}` 자리표시자만 쓸 수 있습니다(Handlebars의 블록·헬퍼·경로·`{{{원문}}}` 출력은 거부). 본문에 쓰인 변수와 `requiredVariables`가 정확히 같아야 하고, 이메일 HTML 본문에서만 값이 HTML 이스케이프됩니다. 푸시 `data`는 렌더링하지 않고 그대로 보냅니다.
- 수정은 낙관적 락입니다. 조회 응답의 `ETag`를 `If-Match`로 보내야 하고, 그사이 다른 수정이 있었으면 412(`precondition-failed`), `If-Match`가 없으면 428(`precondition-required`)입니다. `If-Match`는 강한 비교를 하므로 약한 ETag(`W/"..."`)는 일치하지 않습니다.
- ETag는 이 낙관적 락 용도로만 씁니다. Express가 모든 GET 응답에 붙이는 자동 ETag는 꺼 두었으므로, `If-None-Match`로 `304 Not Modified`를 받는 캐시 재검증은 지원하지 않습니다.
- 삭제는 soft delete입니다. 삭제된 템플릿의 `key`는 다시 쓸 수 없습니다(과거 발송 이력이 같은 key로 다른 내용을 가리키지 않도록).
- 목록은 id 순서의 커서 페이지네이션입니다. `nextCursor`는 불투명한 값으로 그대로 다음 요청에 전달합니다.
- CORS를 켤 때는 브라우저 클라이언트가 읽을 수 있도록 `exposedHeaders`에 `ETag`와 `Location`을 포함해야 합니다.

## 헬스체크

| 경로                | 확인 대상                      | 응답                                     |
| ------------------- | ------------------------------ | ---------------------------------------- |
| `GET /health/live`  | 없음 (프로세스가 응답하는지만) | 항상 200                                 |
| `GET /health/ready` | MySQL, Redis (각 1초 제한)     | 모두 정상이면 200, 하나라도 실패하면 503 |

liveness는 의존성을 확인하지 않습니다. DB 장애로 liveness가 실패하면 오케스트레이터가 모든 인스턴스를 재시작하지만, 재시작으로는 DB 장애가 해결되지 않습니다. 의존성 장애는 readiness 실패로 처리해 트래픽만 받지 않게 합니다. `docker compose --profile app`의 `app` 컨테이너 healthcheck도 readiness를 사용합니다.

헬스체크의 503 응답은 RFC 9457 형식의 예외로, 어떤 의존성이 실패했는지 보여주는 Terminus 형식을 그대로 사용합니다.

```json
{
  "status": "error",
  "info": { "database": { "status": "up" } },
  "error": { "redis": { "status": "down", "message": "..." } },
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "down", "message": "..." }
  }
}
```

## 데이터베이스 마이그레이션

스키마는 마이그레이션으로만 변경합니다. `synchronize`는 꺼져 있고, 앱은 기동할 때 마이그레이션을 실행하지 않습니다. 여러 인스턴스가 동시에 같은 마이그레이션을 실행하지 않도록 배포 단계에서 따로 실행합니다.

```bash
npm run migration:generate -- src/database/migrations/<Name>  # 엔티티 변경에서 생성
npm run migration:create -- src/database/migrations/<Name>    # 빈 마이그레이션
npm run migration:run
npm run migration:revert   # 마지막 1개 되돌리기
npm run migration:show
```

마이그레이션은 하나씩 별도 트랜잭션으로 실행됩니다. 단, MySQL은 DDL(`CREATE`, `ALTER`, `DROP`)을 실행하면 트랜잭션을 암묵적으로 커밋하므로, DDL이 중간에 실패하면 앞서 실행된 DDL은 롤백되지 않습니다. 그래서 마이그레이션은 작은 단위로 나눕니다.

## 테스트

```bash
npm test          # 단위 테스트
npm run test:e2e  # E2E 테스트 (Docker 필요)
npm run lint
npm run typecheck
```

E2E 테스트는 Testcontainers로 MySQL과 Redis 컨테이너를 띄워 실행합니다. 테스트 파일은 순차 실행(`--runInBand`)되고, 데이터를 쓰는 테스트는 `beforeEach`에서 `resetDatabase()`로 마이그레이션 기록을 제외한 모든 테이블을 비웁니다. 마이그레이션 테스트는 별도 데이터베이스를 사용합니다.

마이그레이션 테스트는 모든 마이그레이션을 실행한 뒤 엔티티와 DB 스키마의 차이가 없는지 확인합니다. 엔티티만 수정하고 마이그레이션을 만들지 않으면 CI가 실패합니다.

## 개발 방식

모든 변경은 이슈 → 브랜치 → PR → CI 통과 → 머지 순서로 진행합니다. `main`은 브랜치 보호로 직접 푸시를 막고, PR이 `check`(lint·타입 체크·포맷·단위/E2E 테스트·빌드)와 `gitleaks`(비밀값 유출 검사)를 모두 통과해야 머지할 수 있습니다. PR 설명에는 변경 이유와 테스트 근거를 적습니다.

![PR의 CI 실행 결과: check와 gitleaks 모두 성공](docs/images/p0-ci-checks.png)
