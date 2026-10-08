# notification-platform

[![CI](https://github.com/lee-mark01/notification-platform/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lee-mark01/notification-platform/actions/workflows/ci.yml)

이메일(AWS SES)과 푸시(FCM)를 하나의 인터페이스로 발송하는 알림 플랫폼입니다.
재시도, Dead Letter Queue, 멱등성, 웹훅 기반 상태 추적을 갖추는 것을 목표로 합니다.

> 개발 진행 중입니다.

## 기술 스택

- Node.js, TypeScript, NestJS
- MySQL 8, TypeORM
- BullMQ, Redis
- AWS SES, SNS, Firebase Cloud Messaging
- Jest, Testcontainers, k6
- Docker Compose, GitHub Actions

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
| `/problems/precondition-failed`         | 412              | `If-Match`가 현재 `ETag`와 다름 (그사이 수정됨)                           |
| `/problems/precondition-required`       | 428              | `If-Match` 헤더가 필요한 요청에 없음                                      |
| `/problems/internal-error`              | 500              | 서버 내부 오류. 상세 내용은 응답하지 않고 로그에만 남김                   |
| `about:blank`                           | 상태 코드 그대로 | HTTP 상태 외에 추가 의미가 없는 오류 (예: 없는 경로 404, 잘못된 JSON 400) |

`instance`에는 쿼리 문자열을 제외한 요청 경로가 들어갑니다. 한 번 공개한 `type` URI의 의미는 바꾸지 않습니다.

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
