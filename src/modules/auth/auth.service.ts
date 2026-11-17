import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, User } from '../../../generated/prisma/client';
import { credentialTag, resetTokenFingerprint } from './auth-credentials';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Enable2faDto } from './dto/enable-2fa.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) { }

  async register(_dto: RegisterDto): Promise<never> {
    throw new ForbiddenException('L’inscription publique est fermée. Contactez le cabinet.');
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Same bcrypt work for an unknown email; no account-status disclosure.
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
    if (!user || !user.active || !valid) {
      throw new UnauthorizedException('Email ou mot de passe incorrect.');
    }

    return this.buildAuthResponse(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    return this.toPublicUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    const valid = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`);
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (!current?.active || current.passwordHash !== user.passwordHash) throw new UnauthorizedException('Les identifiants ont changé. Reconnectez-vous.');
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.passwordResetToken.updateMany({ where: { identifier: current.email, expires: { gt: new Date() } }, data: { expires: new Date() } });
    });

    return { success: true };
  }

  async forgotPassword(_dto: ForgotPasswordDto): Promise<never> {
    // No transport exists: no fake delivery, no unusable tokens, no DB lookup.
    throw new ServiceUnavailableException('La récupération par email est temporairement indisponible. Contactez le cabinet.');
  }

  async resetPassword(dto: ResetPasswordDto) {
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token: resetTokenFingerprint(dto.token) },
    });

    if (!resetToken || resetToken.expires <= new Date()) {
      throw new BadRequestException(
        'Ce lien de réinitialisation est invalide ou a expiré.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "email" = ${resetToken.identifier} FOR UPDATE`);
      const current = await tx.user.findUnique({ where: { email: resetToken.identifier } });
      const now = new Date();
      if (!current?.active) throw new BadRequestException('Ce lien de réinitialisation est invalide ou a expiré.');
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, token: resetTokenFingerprint(dto.token), expires: { gt: now } }, data: { expires: now },
      });
      if (consumed.count !== 1) throw new BadRequestException('Ce lien de réinitialisation est invalide ou a expiré.');
      await tx.user.update({ where: { id: current.id }, data: { passwordHash } });
      // Preserve historical rows; expire all remaining recovery capabilities.
      await tx.passwordResetToken.updateMany({ where: { identifier: current.email, expires: { gt: now } }, data: { expires: now } });
    });

    return { success: true };
  }

  // Génère un secret TOTP et un QR code à scanner dans une app
  // d'authentification (Google Authenticator, Authy...). Le secret est
  // stocké mais `twoFactorEnabled` reste false tant que /2fa/enable n'a pas
  // vérifié un premier code.
  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    const otpauth = authenticator.keyuri(user.email, 'Velarium', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    return { qrCodeDataUrl, secret };
  }

  async enableTwoFactor(userId: string, dto: Enable2faDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorSecret) {
      throw new BadRequestException('Aucune procédure de double authentification en cours.');
    }

    const valid = authenticator.verify({ token: dto.code, secret: user.twoFactorSecret });
    if (!valid) {
      throw new BadRequestException('Code invalide.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    return { success: true };
  }

  async disableTwoFactor(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });

    return { success: true };
  }

  private buildAuthResponse(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role, credentialTag: credentialTag(user) };

    return {
      accessToken: this.jwtService.sign(payload),
      user: this.toPublicUser(user),
    };
  }

  private toPublicUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      image: user.image,
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }
}
