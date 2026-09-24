/**
 * VELARIUM — AUDIT HISTORIQUE FINANCE V3 (DRY-RUN)
 *
 * Lecture seule : aucune écriture PostgreSQL.
 *
 * V3 :
 * - utilise PrismaPg comme PrismaService ;
 * - inclut AUSSI les comptes désactivés comme candidats historiques ;
 * - ajoute createdAt pour aider à repérer les vrais doublons ;
 * - affiche le numéro de facture des provisions legacy ;
 * - ne choisit jamais automatiquement un compte ;
 * - exclut toujours les frais d'ouverture de la migration automatique.
 */

import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'

import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
    throw new Error(
        'DATABASE_URL est absente. Vérifie le fichier .env du backend.',
    )
}

const adapter = new PrismaPg({
    connectionString,
})

const prisma = new PrismaClient({
    adapter,
})

const num = (value: unknown) => Number(value ?? 0)

function arg(name: string) {
    const prefix = `--${name}=`
    const value = process.argv.find((v) => v.startsWith(prefix))
    return value ? value.slice(prefix.length) : undefined
}

function startDate(value?: string) {
    if (!value) return undefined

    const date = new Date(`${value}T00:00:00.000Z`)

    if (Number.isNaN(date.getTime())) {
        throw new Error(`--from invalide : ${value}`)
    }

    return date
}

function endDate(value?: string) {
    if (!value) return undefined

    const date = new Date(`${value}T23:59:59.999Z`)

    if (Number.isNaN(date.getTime())) {
        throw new Error(`--to invalide : ${value}`)
    }

    return date
}

function normalize(value?: string | null) {
    return (
        value
            ?.trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\s-]+/g, '_') ?? ''
    )
}

function normalizeMoyen(value?: string | null) {
    const v = normalize(value)

    const aliases: Record<string, string> = {
        ESPECE: 'ESPECES',
        CASH: 'ESPECES',
        CHEQUES: 'CHEQUE',
        VIREMENTS: 'VIREMENT',
        ORANGE: 'ORANGE_MONEY',
        ORANGEMONEY: 'ORANGE_MONEY',
        MTN: 'MTN_MONEY',
        MTNMONEY: 'MTN_MONEY',
        MOOV: 'MOOV_MONEY',
        MOOVMONEY: 'MOOV_MONEY',
        CARTE_BANCAIRE: 'PAIEMENT_CARTE',
        CB: 'PAIEMENT_CARTE',
    }

    return aliases[v] ?? v
}

function day(value: Date) {
    return value.toISOString().slice(0, 10)
}

type Account = {
    id: string
    nom: string
    type: string
    institution: string | null
    active: boolean
    moyensOperation: string[]
    createdAt: Date
}

function candidates(
    moyenPaiement: string | null,
    accounts: Account[],
) {
    const moyen = normalizeMoyen(moyenPaiement)

    const mobile = new Set([
        'WAVE',
        'ORANGE_MONEY',
        'MTN_MONEY',
        'MOOV_MONEY',
        'MOBILE_MONEY',
    ])

    const bank = new Set([
        'VIREMENT',
        'CHEQUE',
    ])

    const card = new Set([
        'PAIEMENT_CARTE',
        'CARTE',
    ])

    if (!moyen) {
        return []
    }

    return accounts
        // IMPORTANT V3 :
        // on n'exclut PAS les comptes désactivés.
        // Un compte désactivé aujourd'hui peut avoir été utilisé historiquement.
        .map((account) => {
            const allowed = account.moyensOperation.map(normalizeMoyen)

            const searchable = normalize(
                [account.nom, account.institution]
                    .filter(Boolean)
                    .join(' '),
            )

            let score = 0
            const reasons: string[] = []

            if (allowed.includes(moyen)) {
                score += 100
                reasons.push('moyen explicitement autorisé')
            }

            if (
                bank.has(moyen) &&
                (account.type === 'BANCAIRE' || account.type === 'EPARGNE')
            ) {
                score += 70
                reasons.push('type bancaire compatible')
            }

            if (moyen === 'ESPECES' && account.type === 'ESPECES') {
                score += 100
                reasons.push('compte espèces')
            }

            if (card.has(moyen) && account.type === 'CARTE_BANCAIRE') {
                score += 80
                reasons.push('compte carte compatible')
            }

            if (mobile.has(moyen) && account.type === 'MOBILE_MONEY') {
                score += 45
                reasons.push('compte mobile money')

                if (allowed.includes('MOBILE_MONEY')) {
                    score += 15
                    reasons.push('legacy MOBILE_MONEY configuré')
                }

                const brand = moyen.replace(/_MONEY$/, '')

                if (brand !== 'MOBILE' && searchable.includes(brand)) {
                    score += 60
                    reasons.push(`nom du compte correspond à ${brand}`)
                }
            }

            return {
                caisseId: account.id,
                nom: account.nom,
                type: account.type,
                active: account.active,
                createdAt: account.createdAt.toISOString(),
                moyensOperation: account.moyensOperation,
                score,
                raison:
                    reasons.join(' ; ') ||
                    'aucune correspondance automatique',
            }
        })
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
}

async function main() {
    const from = startDate(arg('from'))
    const to = endDate(arg('to'))

    if (from && to && from > to) {
        throw new Error('--from doit être antérieur ou égal à --to.')
    }

    const dateWhere =
        from || to
            ? {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
            }
            : undefined

    const [accounts, payments, provisions, openingFees] =
        await Promise.all([
            prisma.caisse.findMany({
                orderBy: {
                    createdAt: 'asc',
                },
                select: {
                    id: true,
                    nom: true,
                    type: true,
                    institution: true,
                    active: true,
                    moyensOperation: true,
                    createdAt: true,
                },
            }),

            prisma.paiement.findMany({
                where: {
                    mouvementFinanceId: null,
                    ...(dateWhere ? { datePaiement: dateWhere } : {}),
                },
                orderBy: [
                    { datePaiement: 'asc' },
                    { createdAt: 'asc' },
                ],
                select: {
                    id: true,
                    montant: true,
                    datePaiement: true,
                    createdAt: true,
                    moyenPaiement: true,
                    facture: {
                        select: {
                            numero: true,
                            dossier: {
                                select: {
                                    reference: true,
                                },
                            },
                        },
                    },
                },
            }),

            prisma.provision.findMany({
                where: {
                    mouvementFinanceId: null,
                    ...(dateWhere ? { datePaiement: dateWhere } : {}),
                },
                orderBy: [
                    { datePaiement: 'asc' },
                    { createdAt: 'asc' },
                ],
                select: {
                    id: true,
                    montant: true,
                    datePaiement: true,
                    createdAt: true,
                    moyenPaiement: true,
                    factureId: true,
                    facture: {
                        select: {
                            numero: true,
                        },
                    },
                    dossier: {
                        select: {
                            reference: true,
                        },
                    },
                },
            }),

            prisma.fraisOuvertureDossier.findMany({
                where: {
                    statut: 'PAYE',
                    mouvementFinanceId: null,
                    ...(dateWhere ? { datePaiement: dateWhere } : {}),
                },
                orderBy: [
                    { datePaiement: 'asc' },
                    { createdAt: 'asc' },
                ],
                select: {
                    id: true,
                    montant: true,
                    datePaiement: true,
                    createdAt: true,
                    factureId: true,
                    facture: {
                        select: {
                            numero: true,
                        },
                    },
                    dossier: {
                        select: {
                            reference: true,
                        },
                    },
                },
            }),
        ])

    console.log('\n===== COMPTES HISTORIQUES POSSIBLES =====')

    console.table(
        accounts.map((a) => ({
            id: a.id,
            nom: a.nom,
            type: a.type,
            active: a.active,
            createdAt: a.createdAt,
            moyens: a.moyensOperation.join(', '),
        })),
    )

    const baseItems = [
        ...payments.map((p) => ({
            kind: 'PAIEMENT' as const,
            id: p.id,
            date: p.datePaiement,
            createdAt: p.createdAt,
            montant: num(p.montant),
            dossier: p.facture.dossier.reference,
            facture: p.facture.numero,
            factureId: null as string | null,
            moyenPaiement: p.moyenPaiement,
        })),

        ...provisions.map((p) => ({
            kind: 'PROVISION' as const,
            id: p.id,
            date: p.datePaiement,
            createdAt: p.createdAt,
            montant: num(p.montant),
            dossier: p.dossier.reference,
            facture: p.facture?.numero ?? null,
            factureId: p.factureId,
            moyenPaiement: p.moyenPaiement,
        })),
    ]

    const groups = new Map<string, typeof baseItems>()

    for (const item of baseItems) {
        const identity =
            item.kind === 'PAIEMENT'
                ? item.facture
                : item.dossier

        const key = [
            item.kind,
            identity ?? 'SANS_REFERENCE',
            day(item.date),
            item.montant,
        ].join('|')

        const group = groups.get(key) ?? []
        group.push(item)
        groups.set(key, group)
    }

    const duplicateKeys = new Set(
        Array.from(groups.entries())
            .filter(([, rows]) => rows.length > 1)
            .map(([key]) => key),
    )

    const items = baseItems.map((item) => {
        const identity =
            item.kind === 'PAIEMENT'
                ? item.facture
                : item.dossier

        const duplicateGroup = [
            item.kind,
            identity ?? 'SANS_REFERENCE',
            day(item.date),
            item.montant,
        ].join('|')

        return {
            ...item,
            date: item.date.toISOString(),
            createdAt: item.createdAt.toISOString(),
            duplicateGroup:
                duplicateKeys.has(duplicateGroup)
                    ? duplicateGroup
                    : null,
            candidates: candidates(
                item.moyenPaiement,
                accounts as Account[],
            ),
            selectedCaisseId: '',
            migrate: false,
            reviewStatus: 'A_VALIDER',
            reviewNote: '',
        }
    })

    const totalPayments = payments.reduce(
        (sum, p) => sum + num(p.montant),
        0,
    )

    const totalProvisions = provisions.reduce(
        (sum, p) => sum + num(p.montant),
        0,
    )

    const totalOpeningFees = openingFees.reduce(
        (sum, f) => sum + num(f.montant),
        0,
    )

    console.log('\n===== RÉSUMÉ V3 =====')

    console.log({
        paiementsSansMouvement: payments.length,
        montantPaiements: totalPayments,
        provisionsSansMouvement: provisions.length,
        montantProvisions: totalProvisions,
        totalPotentiel: totalPayments + totalProvisions,
        fraisOuvertureExclus: openingFees.length,
        montantFraisOuvertureExclus: totalOpeningFees,
        groupesSuspects: duplicateKeys.size,
    })

    console.log('\n===== OPÉRATIONS =====')

    console.table(
        items.map((item) => ({
            type: item.kind,
            id: item.id,
            date: item.date.slice(0, 10),
            createdAt: item.createdAt,
            montant: item.montant,
            dossier: item.dossier,
            facture: item.facture,
            moyen: item.moyenPaiement,
            suspect: Boolean(item.duplicateGroup),
            candidats: item.candidates
                .slice(0, 4)
                .map(
                    (c) =>
                        `${c.nom} [${c.active ? 'actif' : 'désactivé'}] (${c.score})`,
                )
                .join(' | '),
        })),
    )

    if (duplicateKeys.size > 0) {
        console.log('\n===== GROUPES SUSPECTS =====')

        for (const key of duplicateKeys) {
            console.log(`\n${key}`)

            console.table(
                (groups.get(key) ?? []).map((item) => ({
                    id: item.id,
                    type: item.kind,
                    date: item.date,
                    createdAt: item.createdAt,
                    montant: item.montant,
                    dossier: item.dossier,
                    facture: item.facture,
                    factureId: item.factureId,
                    moyen: item.moyenPaiement,
                })),
            )
        }
    }

    const plan = {
        generatedAt: new Date().toISOString(),
        version: 3,
        dryRun: true,
        period: {
            from: from?.toISOString() ?? null,
            to: to?.toISOString() ?? null,
        },
        warning:
            'AUCUNE MIGRATION. Les comptes désactivés sont volontairement inclus comme candidats historiques. Chaque opération doit être validée manuellement.',
        migrationUserId: '',
        totals: {
            payments: totalPayments,
            provisions: totalProvisions,
            potentialMigrationTotal:
                totalPayments + totalProvisions,
            excludedOpeningFees: totalOpeningFees,
        },
        accounts: accounts.map((a) => ({
            id: a.id,
            nom: a.nom,
            type: a.type,
            active: a.active,
            createdAt: a.createdAt.toISOString(),
            moyensOperation: a.moyensOperation,
        })),
        items,
        excludedOpeningFees: openingFees.map((f) => ({
            id: f.id,
            dossier: f.dossier.reference,
            factureId: f.factureId,
            facture: f.facture?.numero ?? null,
            date: f.datePaiement?.toISOString() ?? null,
            createdAt: f.createdAt.toISOString(),
            montant: num(f.montant),
            migrate: false,
            reviewStatus: 'EXCLU_PAR_SECURITE',
            reviewNote:
                'Vérifier si le paiement de facture porte déjà cet encaissement.',
        })),
    }

    const output = path.resolve(
        process.cwd(),
        'finance-migration-plan-v3.json',
    )

    fs.writeFileSync(
        output,
        JSON.stringify(plan, null, 2),
        'utf8',
    )

    console.log(`\nPlan V3 généré : ${output}`)
    console.log('AUCUNE DONNÉE POSTGRESQL N’A ÉTÉ MODIFIÉE.\n')
}

main()
    .catch((error) => {
        console.error('\nDRY-RUN V3 ÉCHOUÉ :', error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
