import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, randomBytes } from 'crypto';
import type { Request, Response } from 'express';

type Policy = { action: string; windowMs: number; ip: number; identity: number };
const KEY = 'auth-rate-limit-v1';
export const AuthRateLimit = (policy: Policy) => SetMetadata(KEY, policy);

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly secret = randomBytes(32);
  private readonly buckets = new Map<string, { count: number; expires: number }>();
  private readonly maxBuckets = 20_000;
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const policy = this.reflector.get<Policy>(KEY, context.getHandler());
    if (!policy) return true;
    const req = context.switchToHttp().getRequest<Request & { user?: { id?: string } }>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    // Only the direct TCP peer; never trust X-Forwarded-For/X-Real-IP here.
    const peer = req.socket?.remoteAddress || 'unknown-peer';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const identity = req.user?.id || (typeof body.email === 'string' ? body.email.slice(0, 254).trim().toLowerCase()
      : typeof body.token === 'string' ? body.token.slice(0, 256) : 'invalid-identity');
    const keys = [[peer, policy.ip, 'peer'], [identity, policy.identity, 'identity']] as const;
    // Bounded process-local storage, no PII in map keys. Expiry is absolute:
    // rejected requests cannot extend the window and permanently lock a user.
    if (this.buckets.size >= this.maxBuckets) {
      for (const [key, value] of this.buckets) if (value.expires <= now) this.buckets.delete(key);
    }
    const rows = keys.map(([value, limit, scope]) => {
      const key = createHmac('sha256', this.secret).update(JSON.stringify([policy.action, scope, value])).digest('hex');
      const previous = this.buckets.get(key);
      return { key, limit, bucket: previous && previous.expires > now ? previous : { count: 0, expires: now + policy.windowMs } };
    });
    const blocked = rows.find(row => row.bucket.count >= row.limit);
    if (blocked || this.buckets.size + rows.filter(row => !this.buckets.has(row.key)).length > this.maxBuckets) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil(((blocked?.bucket.expires ?? now + policy.windowMs) - now) / 1000))));
      throw new HttpException('Trop de tentatives. Réessayez ultérieurement.', HttpStatus.TOO_MANY_REQUESTS);
    }
    for (const row of rows) { row.bucket.count++; this.buckets.set(row.key, row.bucket); }
    return true;
  }
}
