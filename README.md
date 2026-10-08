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

E2E 테스트는 Testcontainers로 MySQL 컨테이너를 띄워 실행합니다. 테스트 파일은 순차 실행(`--runInBand`)되고, 데이터를 쓰는 테스트는 `beforeEach`에서 `resetDatabase()`로 마이그레이션 기록을 제외한 모든 테이블을 비웁니다. 마이그레이션 테스트는 별도 데이터베이스를 사용합니다.

마이그레이션 테스트는 모든 마이그레이션을 실행한 뒤 엔티티와 DB 스키마의 차이가 없는지 확인합니다. 엔티티만 수정하고 마이그레이션을 만들지 않으면 CI가 실패합니다.
