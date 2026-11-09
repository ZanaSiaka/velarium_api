import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  const findUnique = jest.fn();
  const signAsync = jest.fn();

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: { user: { findUnique } } },
        { provide: JwtService, useValue: { signAsync } },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  it('resolves the service with isolated Prisma and JWT dependencies', () => {
    expect(service).toBeDefined();
  });

  it.each([null, { active: false }])('rejects login for an absent or inactive user %p', async (user) => {
    findUnique.mockResolvedValue(user);
    await expect(service.login({ email: 'user@example.com', password: 'password' })).rejects.toThrow(UnauthorizedException);
    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'user@example.com' } });
    expect(signAsync).not.toHaveBeenCalled();
  });
});
