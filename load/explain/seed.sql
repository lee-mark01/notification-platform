-- 1,000,000 notifications over the 90 days before 2026-10-10 00:00 UTC,
-- deterministic so every run sees the same data. Shapes the real mix:
-- two thirds email, one fifth marketing, mostly SENT/DELIVERED with a few
-- percent of failures, push rows owned by 10,000 users.
SET SESSION cte_max_recursion_depth = 100000;

INSERT INTO api_client (name) VALUES ('explain-a'), ('explain-b');

INSERT INTO template (`key`, channel, subject, html_body, text_body, title, body, data, required_variables, version) VALUES
  ('email-verification', 'email', 'Code {{n}}', '<p>{{n}}</p>', '{{n}}', NULL, NULL, NULL, '["n"]', 1),
  ('weekly-digest', 'email', 'Digest {{n}}', '<p>{{n}}</p>', NULL, NULL, NULL, NULL, '["n"]', 1),
  ('chat-new-message', 'push', NULL, NULL, NULL, '{{n}}', '{{n}}', NULL, '["n"]', 1);

INSERT INTO app_user (email, marketing_opt_in)
WITH RECURSIVE u(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM u WHERE i < 10000)
SELECT CONCAT('user', i, '@example.com'), i % 2 FROM u;

-- 0..999,999 from six copies of a digit table (a TEMPORARY table cannot
-- be opened twice in one query).
CREATE TABLE digit (d INT PRIMARY KEY);
INSERT INTO digit VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9);

INSERT INTO notification (
  client_id, user_id, template_id, template_version, channel, category,
  status, recipient_email, variables, rendered_title, rendered_body,
  attempt_count, last_error_code, sent_at, read_at, created_at, updated_at
)
SELECT
  1 + (n % 2),
  IF(n % 3 = 0, 1 + (n * 7) % 10000, NULL),
  IF(n % 3 = 0, 3, IF(n % 5 = 0, 2, 1)),
  1,
  IF(n % 3 = 0, 'push', 'email'),
  IF(n % 5 = 0, 'marketing', 'transactional'),
  CASE
    WHEN r < 20 THEN 'FAILED'
    WHEN r < 25 THEN 'DEAD'
    WHEN r < 35 THEN 'BOUNCED'
    WHEN r < 37 THEN 'COMPLAINED'
    WHEN r < 47 THEN 'SUPPRESSED'
    WHEN r < 52 THEN 'QUEUED'
    WHEN r < 600 THEN 'SENT'
    ELSE 'DELIVERED'
  END,
  IF(n % 3 = 0, NULL, CONCAT('r', n % 50000, '@example.com')),
  JSON_OBJECT('n', n),
  CONCAT('Title ', n),
  CONCAT('<p>Body ', n, '</p>'),
  1,
  IF(r < 25, 'PROVIDER_5XX', NULL),
  IF(r >= 25 AND r < 47, NULL, created),
  IF(r >= 52 AND (n * 13) % 10 < 4, created + INTERVAL 1 HOUR, NULL),
  created,
  created
FROM (
  SELECT
    n,
    (n * 31) % 1000 AS r,
    TIMESTAMP('2026-10-10 00:00:00') - INTERVAL ((n * 7919) % 7776000) SECOND AS created
  FROM (
    SELECT a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + f.d * 100000 AS n
    FROM digit a, digit b, digit c, digit d, digit e, digit f
  ) nums
) rows_;

DROP TABLE digit;
ANALYZE TABLE notification;
