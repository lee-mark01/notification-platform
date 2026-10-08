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
npm ci && npm run start:dev
```

`docker compose up -d`는 MySQL과 Redis만 띄웁니다. 앱까지 컨테이너로 실행하려면 `docker compose --profile app up -d --build`를 사용합니다.

MySQL은 로컬에 설치된 MySQL과 충돌하지 않도록 호스트 포트 3307을 기본값으로 사용합니다.

## 테스트

```bash
npm test          # 단위 테스트
npm run test:e2e  # E2E 테스트
npm run lint
npm run typecheck
```
