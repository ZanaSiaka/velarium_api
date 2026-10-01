import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

async function main() {
    const databaseUrl = process.env.DATABASE_URL;
    const name = "admin";
    const email = "admin@velarium.fr";
    const password = "admin123@@/";

    if (!databaseUrl || !name || !email || !password) {
        throw new Error(
            'Renseignez DATABASE_URL, SEED_USER_NAME, SEED_USER_EMAIL et SEED_USER_PASSWORD.',
        );
    }

    const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
    });

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.upsert({
            where: { email },
            update: {
                active: true,
            },
            create: {
                name,
                email,
                passwordHash,
                role: 'AVOCAT',
                active: true,
            },
        });

        console.log(`Utilisateur initial prêt : ${user.email}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});