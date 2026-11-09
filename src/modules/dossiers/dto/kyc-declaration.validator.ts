import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

export function hasKycDeclaration(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

@ValidatorConstraint({ name: 'kycDeclaration', async: false })
export class KycDeclarationValidator implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as { kycSoupcon?: boolean };
    return dto.kycSoupcon === true
      ? hasKycDeclaration(value)
      : value == null || typeof value === 'string';
  }

  defaultMessage(): string {
    return 'La déclaration du soupçon est obligatoire et doit être non vide lorsque le soupçon est actif.';
  }
}
