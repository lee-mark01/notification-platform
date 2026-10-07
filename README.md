# notification-platform

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
