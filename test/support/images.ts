// Docker's official images, pulled from their ECR Public mirror: CI runners
// share IPs and hit Docker Hub's anonymous pull limit. Same images.
export const MYSQL_IMAGE = 'public.ecr.aws/docker/library/mysql:8.4';
export const REDIS_IMAGE = 'public.ecr.aws/docker/library/redis:7.4-alpine';
