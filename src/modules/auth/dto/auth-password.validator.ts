import { registerDecorator } from 'class-validator';

// New bcrypt secrets must not be silently truncated at 72 UTF-8 bytes.
export function BcryptPassword() {
  return (target: object, propertyName: string) => registerDecorator({
    name: 'bcryptPassword', target: target.constructor, propertyName,
    options: { message: 'Le nouveau mot de passe ne doit pas dépasser 72 octets UTF-8.' },
    validator: { validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72 },
  });
}
