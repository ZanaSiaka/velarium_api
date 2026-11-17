import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthRateLimit, AuthRateLimitGuard } from './auth-rate-limit.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Enable2faDto } from './dto/enable-2fa.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ action: 'login', windowMs: 300_000, ip: 30, identity: 10 })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('forgot-password')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ action: 'forgot', windowMs: 900_000, ip: 10, identity: 3 })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('reset-password')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ action: 'reset', windowMs: 900_000, ip: 20, identity: 5 })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.me(user.id);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('change-password')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ action: 'change', windowMs: 300_000, ip: 30, identity: 5 })
  changePassword(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  @ApiBearerAuth()
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.setupTwoFactor(user.id);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('2fa/enable')
  enableTwoFactor(@CurrentUser() user: CurrentUserPayload, @Body() dto: Enable2faDto) {
    return this.authService.enableTwoFactor(user.id, dto);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('2fa/disable')
  disableTwoFactor(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.disableTwoFactor(user.id);
  }
}
