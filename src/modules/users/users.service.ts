import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../prisma/prisma.service';

import { CreateUserDto } from './dto/create-user.dto';

import { UpdateUserDto } from './dto/update-user.dto';

function toPublicUser(user: any) {
  const {
    passwordHash: _passwordHash,
    twoFactorSecret: _twoFactorSecret,
    ...rest
  } = user;

  return rest;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) { }

  findAllForSelect() {
    return this.prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        role: true,
      },
    });
  }

  async findAllAdmin() {
    const users = await this.prisma.user.findMany({
      orderBy: { name: 'asc' },
    });

    return users.map(toPublicUser);
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
    });

    if (existing) {
      throw new ConflictException(
        'Un compte existe déjà avec cet email.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: dto.role,
        },
      });

      // Création du contrat uniquement si un type de contrat est fourni
      if (dto.typeContrat) {
        await tx.contratUtilisateur.create({
          data: {
            userId: newUser.id,
            type: dto.typeContrat,
            dateDebut: dto.dateDebutContrat
              ? new Date(dto.dateDebutContrat)
              : new Date(),
            dateFin: dto.dateFinContrat
              ? new Date(dto.dateFinContrat)
              : undefined,
            poste: dto.posteContrat,
            actif: true,
          },
        });
      }

      return newUser;
    });

    return toPublicUser(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        role: dto.role,
        active: dto.active,
      },
    });

    return toPublicUser(user);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        contrats: {
          orderBy: {
            dateDebut: 'desc',
          },
          include: {
            pieces: true,
          },
        },
        pieces: {
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            contrat: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(
        'Utilisateur introuvable.',
      );
    }

    return toPublicUser(user);
  }
}