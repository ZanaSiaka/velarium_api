import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const login = jest.fn();

  beforeEach(async () => {
    login.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: { login } }],
    }).compile();
    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates login and returns the service response', async () => {
    const dto = { email: 'user@example.com', password: 'password' };
    const response = { accessToken: 'test-token' };
    login.mockResolvedValue(response);
    await expect(controller.login(dto)).resolves.toEqual(response);
    expect(login).toHaveBeenCalledWith(dto);
  });
});
