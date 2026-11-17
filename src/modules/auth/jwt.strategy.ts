import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { validCredentialTag } from './auth-credentials';

export type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  credentialTag?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: JwtPayload) {
    if (typeof payload.sub !== 'string' || !payload.sub) throw new UnauthorizedException('Session invalide.');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, active: true, passwordHash: true },
    });

    if (!user || !user.active || !validCredentialTag(payload.credentialTag, user)) {
      throw new UnauthorizedException(
        'Session expirée ou compte inactif.',
      );
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}
