import 'dotenv/config';
import { PrismaClient, ClientType, DossierStatut } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SEED_PASSWORD = 'Velarium2026!';

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const avocat = await prisma.user.upsert({
    where: { email: 'contact@cabinet-bahleroux.ci' },
    update: {},
    create: {
      name: 'Me Bah-Leroux',
      email: 'contact@cabinet-bahleroux.ci',
      passwordHash,
      role: 'AVOCAT',
    },
  });

  const client1 = await prisma.client.upsert({
    where: { id: 'seed-client-kouassi' },
    update: {},
    create: {
      id: 'seed-client-kouassi',
      type: ClientType.PARTICULIER,
      nom: 'Kouassi Yao',
      email: 'kouassi.yao@example.ci',
      telephone: '+225 07 00 00 00 00',
      adresse: 'Cocody, Abidjan',
    },
  });

  const client2 = await prisma.client.upsert({
    where: { id: 'seed-client-ivoire-trading' },
    update: {},
    create: {
      id: 'seed-client-ivoire-trading',
      type: ClientType.ENTREPRISE,
      nom: 'Sté Ivoire Trading',
      email: 'contact@ivoiretrading.ci',
      telephone: '+225 27 22 00 00 00',
      adresse: 'Plateau, Abidjan',
    },
  });

  await prisma.dossier.upsert({
    where: { reference: '2026-001' },
    update: {},
    create: {
      reference: '2026-001',
      type: 'Recouvrement',
      statut: DossierStatut.EN_COURS,
      clientId: client1.id,
      avocatResponsableId: avocat.id,
      juridiction: "Tribunal de commerce d'Abidjan",
      partieAdverse: 'Sté Ivoire Trading',
    },
  });

  await prisma.dossier.upsert({
    where: { reference: '2026-002' },
    update: {},
    create: {
      reference: '2026-002',
      type: 'Droit des affaires / OHADA',
      statut: DossierStatut.EN_ATTENTE,
      clientId: client2.id,
      avocatResponsableId: avocat.id,
      juridiction: "Tribunal de commerce d'Abidjan",
    },
  });

  console.log('Seed terminé.');
  console.log(`Compte de test : ${avocat.email} / ${SEED_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
