// Test container images, in one place so every suite pulls the same ones.
// CI logs in to Docker Hub before E2E (anonymous pulls from shared runner IPs
// hit the rate limit).
export const MYSQL_IMAGE = 'mysql:8.4';
export const REDIS_IMAGE = 'redis:7.4-alpine';
