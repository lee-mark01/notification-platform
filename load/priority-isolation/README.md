# 우선순위 격리 실험 (장애 시나리오 13)

마케팅 1만 건이 큐에 밀려 있을 때, 그 뒤에 들어온 인증 메일이 얼마나 기다리는지를 큐 분리 전후로 잰다.

## 조건

- 전용 Docker 스택(`np-exp`, `chaos/compose.yml` + `compose.yml`). 개발 스택과 DB·Redis를 공유하지 않는다.
- 이메일 한도 초당 100건(`EMAIL_RATE_PER_SEC=100`), FakeProvider 지연 50ms. 병목이 Provider가 아니라 한도가 되게 해 두 구성의 차이가 큐 순서에서만 나오게 했다.
- 마케팅 동의한 사용자 1만 명에게 배치 1건(`POST /notification-batches`). 큐 등록이 끝나면 인증 메일(거래성)을 1초에 1건씩 40건 접수한다.
- 측정값: 인증 메일마다 `sentAt − createdAt`(접수 → 발송), 마케팅 1만 건이 모두 `SENT`가 될 때까지 걸린 시간.

| 구성                                   | 큐                                       | 한도                     |
| -------------------------------------- | ---------------------------------------- | ------------------------ |
| split (현재 구조)                      | `email-transactional`, `email-marketing` | 거래성 30/s, 마케팅 70/s |
| single (비교용 `QUEUE_ROUTING=single`) | 모든 알림이 한 큐(FIFO)                  | 100/s                    |

두 구성 모두 합계 한도는 같다. 다른 것은 인증 메일이 마케팅 뒤에 줄을 서느냐뿐이다.

## 실행

```bash
bash load/priority-isolation/run.sh          # split, single 순서로 각각 새 스택에서 (약 10분)
node load/priority-isolation/graph.mjs       # results/*.json → docs/images/p5-priority-isolation.svg, results/summary.md
```

## 결과

[results/summary.md](results/summary.md)와 그래프를 본다.

![큐 분리 전후 인증 메일 대기 시간](../../docs/images/p5-priority-isolation.svg)

## 해석과 한계

- 분리의 비용은 마케팅 쪽이다. 거래성 몫(30%)이 비어 있어도 마케팅은 70/s까지만 쓴다. 그래서 마케팅 소진 시간은 split이 더 길다. 이 트레이드오프는 [ADR-0005](../../docs/adr/0005-job-retention-and-rate-limits.md)에 있다.
- FakeProvider라 실제 SES 지연·스로틀링은 없다. 같은 한도 아래에서 "줄 서는 순서"의 효과만 본 실험이다.
- 단일 큐에서 BullMQ `priority` 옵션을 쓰는 방법도 있다. 마케팅에 낮은 우선순위를 주면 인증 메일이 대기 중인 마케팅보다 먼저 꺼내진다. 다만 한도와 동시 처리 슬롯을 한 큐가 함께 쓰므로 거래성 처리량을 따로 보장하지는 못하고, 우선순위 job은 정렬된 집합에 들어가 추가 비용이 든다. 이 실험의 비교 대상은 아니다.
