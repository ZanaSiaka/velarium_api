import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import PDFDocument from 'pdfkit';

import {
    PrismaService,
} from '../../prisma/prisma.service';

function num(
    value: unknown,
): number {
    return Number(value);
}

function formatMoney(
    value: number,
): string {
    return `${new Intl.NumberFormat(
        'fr-FR',
        {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        },
    ).format(value)} FCFA`;
}

function formatDate(
    value: Date | string,
): string {
    return new Intl.DateTimeFormat(
        'fr-FR',
        {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        },
    ).format(
        new Date(value),
    );
}

function escapeHtml(
    value:
        | string
        | null
        | undefined,
): string {
    if (!value) {
        return '';
    }

    return value
        .replace(
            /&/g,
            '&amp;',
        )
        .replace(
            /</g,
            '&lt;',
        )
        .replace(
            />/g,
            '&gt;',
        )
        .replace(
            /"/g,
            '&quot;',
        )
        .replace(
            /'/g,
            '&#039;',
        );
}

@Injectable()
export class RecusService {
    constructor(
        private readonly prisma:
            PrismaService,
    ) { }

    // ============================================================
    // INCLUDE COMMUN
    // ============================================================

    private readonly include = {
        dossier: {
            include: {
                client: {
                    select: {
                        id: true,
                        nom: true,
                        type: true,
                        email: true,
                        telephone: true,
                        adresse: true,
                    },
                },
            },
        },

        mouvementFinance: {
            include: {
                caisse: {
                    select: {
                        id: true,
                        nom: true,
                        type: true,
                        institution: true,
                        identifiant: true,
                        titulaire: true,
                        devise: true,
                    },
                },
            },
        },

        createdBy: {
            select: {
                id: true,
                name: true,
                email: true,
            },
        },
    } as const;

    // ============================================================
    // SERIALISATION
    // ============================================================

    private serialize(
        recu: any,
    ) {
        return {
            ...recu,

            montant:
                num(
                    recu.montant,
                ),

            mouvementFinance:
                recu.mouvementFinance
                    ? {
                        ...recu
                            .mouvementFinance,

                        montant:
                            num(
                                recu
                                    .mouvementFinance
                                    .montant,
                            ),
                    }
                    : null,
        };
    }

    // ============================================================
    // LISTE
    // ============================================================

    async findAll(
        dossierId?: string,
    ) {
        const recus =
            await this.prisma
                .recuEncaissement
                .findMany({
                    where:
                        dossierId
                            ? {
                                dossierId,
                            }
                            : undefined,

                    orderBy: {
                        dateEmission:
                            'desc',
                    },

                    include:
                        this.include,
                });

        return recus.map(
            (recu) =>
                this.serialize(
                    recu,
                ),
        );
    }

    // ============================================================
    // DETAIL
    // ============================================================

    async findOne(
        id: string,
    ) {
        const recu =
            await this.prisma
                .recuEncaissement
                .findUnique({
                    where: {
                        id,
                    },

                    include:
                        this.include,
                });

        if (!recu) {
            throw new NotFoundException(
                'Reçu introuvable.',
            );
        }

        return this.serialize(
            recu,
        );
    }

    // ============================================================
    // NOM DU TYPE
    // ============================================================

    private getTypeLabel(
        type: string,
    ): string {
        switch (type) {
            case 'FRAIS_OUVERTURE_DOSSIER':
                return "Frais d'ouverture de dossier";

            case 'PROVISION':
                return 'Provision';

            default:
                return type;
        }
    }

    // ============================================================
    // NOM DU MOYEN DE PAIEMENT
    // ============================================================

    private getMoyenPaiementLabel(
        moyen: string,
    ): string {
        switch (moyen) {
            case 'VIREMENT':
                return 'Virement';

            case 'CHEQUE':
                return 'Chèque';

            case 'ORANGE_MONEY':
                return 'Orange Money';

            case 'WAVE':
                return 'Wave';

            case 'MTN_MONEY':
                return 'MTN Money';

            case 'MOOV_MONEY':
                return 'Moov Money';

            case 'PAIEMENT_CARTE':
                return 'Paiement par carte';

            case 'ESPECES':
                return 'Espèces';

            case 'CARTE':
                return 'Carte';

            case 'MOBILE_MONEY':
                return 'Mobile Money';

            default:
                return moyen;
        }
    }

    // ============================================================
    // GENERATION PDF
    // ============================================================

    async generatePdf(
        id: string,
    ): Promise<{
        buffer: Buffer;
        filename: string;
    }> {
        const recu =
            await this.findOne(
                id,
            );

        const buffer =
            await new Promise<Buffer>(
                (
                    resolve,
                    reject,
                ) => {
                    const doc =
                        new PDFDocument({
                            size: 'A4',

                            margins: {
                                top: 50,
                                bottom: 50,
                                left: 55,
                                right: 55,
                            },
                        });

                    const chunks:
                        Buffer[] = [];

                    doc.on(
                        'data',
                        (
                            chunk: Buffer,
                        ) => {
                            chunks.push(
                                chunk,
                            );
                        },
                    );

                    doc.on(
                        'end',
                        () => {
                            resolve(
                                Buffer.concat(
                                    chunks,
                                ),
                            );
                        },
                    );

                    doc.on(
                        'error',
                        reject,
                    );

                    // ======================================================
                    // ENTETE
                    // ======================================================

                    doc
                        .fontSize(20)
                        .font(
                            'Helvetica-Bold',
                        )
                        .text(
                            "REÇU D'ENCAISSEMENT",
                            {
                                align:
                                    'center',
                            },
                        );

                    doc.moveDown(
                        0.5,
                    );

                    doc
                        .fontSize(11)
                        .font(
                            'Helvetica',
                        )
                        .text(
                            `N° ${recu.numero}`,
                            {
                                align:
                                    'center',
                            },
                        );

                    doc.moveDown(
                        2,
                    );

                    // ======================================================
                    // INFORMATIONS GENERALES
                    // ======================================================

                    const labelWidth =
                        180;

                    const addRow = (
                        label: string,
                        value:
                            | string
                            | number
                            | null
                            | undefined,
                    ) => {
                        const y =
                            doc.y;

                        doc
                            .font(
                                'Helvetica-Bold',
                            )
                            .fontSize(
                                10,
                            )
                            .text(
                                label,
                                55,
                                y,
                                {
                                    width:
                                        labelWidth,
                                },
                            );

                        doc
                            .font(
                                'Helvetica',
                            )
                            .fontSize(
                                10,
                            )
                            .text(
                                value ===
                                    null ||
                                    value ===
                                    undefined ||
                                    value ===
                                    ''
                                    ? '-'
                                    : String(
                                        value,
                                    ),
                                235,
                                y,
                                {
                                    width:
                                        305,
                                },
                            );

                        doc.moveDown(
                            0.85,
                        );
                    };

                    addRow(
                        'Date :',
                        formatDate(
                            recu
                                .dateEmission,
                        ),
                    );

                    addRow(
                        'Reçu de :',
                        recu.recuDe,
                    );

                    addRow(
                        'Client :',
                        recu.dossier
                            ?.client
                            ?.nom,
                    );

                    addRow(
                        'Dossier :',
                        recu.dossier
                            ?.reference,
                    );

                    addRow(
                        'Nature :',
                        this.getTypeLabel(
                            recu.type,
                        ),
                    );

                    addRow(
                        'Objet :',
                        recu.objet,
                    );

                    doc.moveDown(
                        1,
                    );

                    // ======================================================
                    // MONTANT
                    // ======================================================

                    doc
                        .font(
                            'Helvetica-Bold',
                        )
                        .fontSize(
                            16,
                        )
                        .text(
                            formatMoney(
                                recu.montant,
                            ),
                            {
                                align:
                                    'center',
                            },
                        );

                    doc.moveDown(
                        1.5,
                    );

                    // ======================================================
                    // PAIEMENT
                    // ======================================================

                    addRow(
                        'Compte :',
                        recu
                            .compteLibelle,
                    );

                    addRow(
                        'Moyen de paiement :',
                        this.getMoyenPaiementLabel(
                            recu
                                .moyenPaiement,
                        ),
                    );

                    addRow(
                        'Référence :',
                        recu
                            .referencePaiement,
                    );

                    if (
                        recu.note
                    ) {
                        addRow(
                            'Note :',
                            recu.note,
                        );
                    }

                    doc.moveDown(
                        2,
                    );

                    // ======================================================
                    // EMETTEUR
                    // ======================================================

                    doc
                        .fontSize(
                            9,
                        )
                        .font(
                            'Helvetica',
                        )
                        .text(
                            `Reçu émis par : ${recu.createdBy?.name ?? '-'}`,
                        );

                    doc.moveDown(
                        0.5,
                    );

                    doc.text(
                        `Compte d'encaissement : ${recu.mouvementFinance?.caisse?.nom ?? recu.compteLibelle}`,
                    );

                    doc.moveDown(
                        3,
                    );

                    doc
                        .font(
                            'Helvetica-Bold',
                        )
                        .fontSize(
                            10,
                        )
                        .text(
                            'Signature / Cachet',
                            {
                                align:
                                    'right',
                            },
                        );

                    doc.end();
                },
            );

        return {
            buffer,

            filename:
                `${recu.numero}.pdf`,
        };
    }

    // ============================================================
    // VERSION IMPRIMABLE HTML
    // ============================================================

    async generatePrintHtml(
        id: string,
    ): Promise<string> {
        const recu =
            await this.findOne(
                id,
            );

        const moyenPaiement =
            this.getMoyenPaiementLabel(
                recu.moyenPaiement,
            );

        const type =
            this.getTypeLabel(
                recu.type,
            );

        return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>
    ${escapeHtml(recu.numero)}
  </title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 40px;
      font-family:
        Arial,
        Helvetica,
        sans-serif;
      color: #111827;
      background: #f3f4f6;
    }

    .receipt {
      width: 100%;
      max-width: 800px;
      min-height: 700px;
      margin: 0 auto;
      padding: 50px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
    }

    .header {
      text-align: center;
      margin-bottom: 45px;
    }

    .header h1 {
      margin: 0 0 10px;
      font-size: 28px;
      letter-spacing: .5px;
    }

    .number {
      color: #4b5563;
      font-size: 15px;
    }

    .section {
      margin-top: 30px;
    }

    .row {
      display: grid;
      grid-template-columns:
        220px
        1fr;
      gap: 20px;
      padding: 10px 0;
      border-bottom: 1px solid #f3f4f6;
    }

    .label {
      font-weight: 700;
    }

    .amount {
      margin: 40px 0;
      padding: 25px;
      text-align: center;
      font-size: 32px;
      font-weight: 700;
      border: 2px solid #111827;
    }

    .footer {
      display: flex;
      justify-content: space-between;
      gap: 30px;
      margin-top: 70px;
      font-size: 14px;
    }

    .signature {
      min-width: 220px;
      text-align: center;
    }

    .print-button {
      display: block;
      width: fit-content;
      margin: 25px auto 0;
      padding: 12px 18px;
      border: none;
      border-radius: 6px;
      background: #111827;
      color: white;
      cursor: pointer;
      font-size: 14px;
    }

    @media print {
      body {
        padding: 0;
        background: white;
      }

      .receipt {
        border: none;
        max-width: none;
        min-height: auto;
      }

      .print-button {
        display: none;
      }
    }
  </style>
</head>

<body>

  <div class="receipt">

    <div class="header">
      <h1>REÇU D'ENCAISSEMENT</h1>

      <div class="number">
        N° ${escapeHtml(recu.numero)}
      </div>
    </div>

    <div class="section">

      <div class="row">
        <div class="label">
          Date
        </div>

        <div>
          ${escapeHtml(formatDate(recu.dateEmission))}
        </div>
      </div>

      <div class="row">
        <div class="label">
          Reçu de
        </div>

        <div>
          ${escapeHtml(recu.recuDe)}
        </div>
      </div>

      <div class="row">
        <div class="label">
          Client
        </div>

        <div>
          ${escapeHtml(recu.dossier?.client?.nom)}
        </div>
      </div>

      <div class="row">
        <div class="label">
          Dossier
        </div>

        <div>
          ${escapeHtml(recu.dossier?.reference)}
        </div>
      </div>

      <div class="row">
        <div class="label">
          Nature
        </div>

        <div>
          ${escapeHtml(type)}
        </div>
      </div>

      <div class="row">
        <div class="label">
          Objet
        </div>

        <div>
          ${escapeHtml(recu.objet)}
        </div>
      </div>

    </div>

    <div class="amount">
      ${escapeHtml(formatMoney(recu.montant))}
    </div>

    <div class="section">

      <div class="row">
        <div class="label">
          Compte d'encaissement
        </div>

        <div>
          ${escapeHtml(recu.compteLibelle)}
        </div>
      </div>

      <div class="row">
        <div class="label">
          Moyen de paiement
        </div>

        <div>
          ${escapeHtml(moyenPaiement)}
        </div>
      </div>

      <div class="row">
        <div class="label">
          Référence
        </div>

        <div>
          ${recu.referencePaiement
                ? escapeHtml(
                    recu.referencePaiement,
                )
                : '-'
            }
        </div>
      </div>

      ${recu.note
                ? `
            <div class="row">
              <div class="label">
                Note
              </div>

              <div>
                ${escapeHtml(recu.note)}
              </div>
            </div>
          `
                : ''
            }

    </div>

    <div class="footer">

      <div>
        <strong>
          Émis par
        </strong>

        <br>

        ${escapeHtml(recu.createdBy?.name)}
      </div>

      <div class="signature">
        <strong>
          Signature / Cachet
        </strong>
      </div>

    </div>

  </div>

  <button
    class="print-button"
    onclick="window.print()"
  >
    Imprimer le reçu
  </button>

</body>
</html>
    `;
    }
}