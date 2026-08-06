import { IsNotEmpty } from 'class-validator';

export class Enable2faDto {
  @IsNotEmpty()
  code: string;
}
