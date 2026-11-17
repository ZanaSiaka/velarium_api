# F4 — Consolidation financière de la fiche Dossier

## A. Audit et périmètre

Intervention du 17 novembre 2026. Les dépôts contenaient déjà de nombreuses modifications D1–F3 ; celles-ci sont conservées. Le présent rapport distingue les adaptations F4 des travaux antérieurs.

La page Dossier conserve ses six onglets. `DossierSecondarySections` charge les rubriques secondaires ; `LivrePaiements` présente le livre consolidé ; `DossierExpenses`, `ProvisionForm`, `ProvisionImputationDialog` et `RecuActions` sont réutilisés. La branche Documents reste inchangée.

Avant F4, les factures étaient chargées une deuxième fois via la liste Honoraires alors que leurs montants provenaient du livre consolidé. Les paiements enregistrés ne portaient pas de qualification individuelle de confirmation, les frais ne précisaient pas leur rattachement à une facture, et la synthèse omettait les dépenses. Certains avertissements contenaient un identifiant technique de provision.

### Correspondance des indicateurs et sources

| Affichage | Source de vérité |
| --- | --- |
| Total facturé | `consolidation.montants.totalFacture`, somme Decimal des TTC éligibles hors BROUILLON |
| Réglé sur factures | `totalRegleFactures`, lectures communes `readInvoiceBalance` |
| Reste dû | `resteAPayer`, somme des restes facture par facture, sans compensation de trop-perçus |
| Encaissements réels | `totalEncaisseGlobal`, paiements et provisions reconnus, frais indépendants sans double comptage |
| Provisions disponibles | `totalProvisionsDisponibles`, `readProvisionBalance`, historique ambigu conservé indisponible |
| Dépenses | `listDossierExpenses(...).totauxParDevise`, agrégats Decimal de FinanceService, toutes périodes dans la synthèse |
| Lignes de facture | `consolidation.factures`, même helper F3 que Finance ; statut enregistré distinct du statut calculé |
| Provisions et affectations | `consolidation.provisions`, montants exacts, rattachements historiques distincts des imputations explicites |

Aucun calcul de dette ou de total monétaire n'est ajouté dans React. L'adaptateur du formulaire d'imputation convertit seulement les chaînes validées en nombres attendus par le formulaire existant ; sa borne en centimes utilise BigInt sans arrondi flottant.

## B. Modifications F4

Backend :

- `src/modules/dossiers/dossiers.service.ts` : réutilisation de `BILLING_CASH_INCLUDE` pour les trois origines de trésorerie. Même projection de reconnaissance que Finance, notamment liens inverses permettant de repérer un mouvement partagé. Aucun changement de transaction ou d'écriture.
- `src/modules/dossiers/dossier-finance-read.ts` : champs de présentation additifs, suppression des identifiants techniques des avertissements de provision, suppression d'une variable inutilisée. Formules F3 conservées.
- `docs/finance-f4-dossier.md` : rapport et recette à exécuter.

Frontend :

- `src/app/(layout-pages)/dossiers/[id]/DossierSecondarySections.tsx` : suppression de la requête redondante de factures, ordre synthèse/factures/encaissements/provisions/dépenses, utilisation de l'autorisation de règlement backend pour les choix d'imputation, confirmation d'encaissement requise pour proposer l'action sur une provision.
- `src/app/(layout-pages)/dossiers/[id]/LivrePaiements.tsx` : synthèse à six indicateurs avec dépenses par devise ; encaissements distingués ; frais liés à leur facture et états historiques explicites.
- `src/lib/dossier-finance.ts` : contrat consolidé enrichi, compatible avec les anciennes projections (champs nouveaux optionnels).

### Endpoints et contrat

- `GET /api/dossiers/:id/livre-paiements` : source consolidée unique pour factures/paiements/provisions/frais. Version 2 et anciens champs conservés.
- Ajouts : `factures[].reglementAutorise`, `avertissements` ; `paiements[].encaissementConfirme` ; `provisions[].encaissementConfirme` ; `fraisOuverture.facture`, `facturation` (`FACTURE`, `NON_FACTURE`, `A_VERIFIER`), `encaissement` (`DIRECT`, `VIA_FACTURE`, `NON_CONFIRME`, `A_VERIFIER`). Ces états décrivent une lecture et ne changent pas les statuts persistés.
- `GET /api/finance/mouvements?dossierId=...&type=SORTIE&avecTotaux=true` : dépenses, filtres et totaux par devise existants.
- Permissions, comptes de provisions, reçus et actions de création/imputation : endpoints existants conservés.
- Plus d'appel supplémentaire à la liste des factures dans cette rubrique.

## C. Règles financières préservées

Les brouillons restent visibles mais ne deviennent pas exigibles. Le total réglé et les encaissements mesurent des dimensions différentes : une provision peut rester non imputée. Une imputation n'est jamais présentée comme un nouvel encaissement. Les mouvements et leur opération métier ne sont pas additionnés.

Les dépenses ne sont déduites ni des honoraires, ni des provisions, ni du reste dû client. Les devises sont présentées séparément sans conversion FCFA/XOF. La synthèse des dépenses couvre toutes les périodes ; les filtres locaux du tableau ont leur propre périmètre.

Les frais facturés renvoient à la facture ; leur encaissement par facture n'est pas ajouté une deuxième fois. Les incohérences historiques restent à vérifier. Un montant enregistré peut être connu sans que son encaissement soit confirmé : l'interface distingue ces deux informations. Un montant inconnu reste indisponible, jamais remplacé par zéro.

Aucune règle fiscale, facture historique, imputation, numérotation FACT/REC, règle de découvert ou stratégie transactionnelle F2.2 n'est modifiée. Les avertissements F3 de TVA signalent une reconstitution incertaine et ne déclarent pas automatiquement une erreur fiscale.

## D. Confidentialité — contrôle statique

Le contrôleur du livre conserve l'authentification et `Cache-Control: private, no-store`. Le service exige `canViewFinance` avant toute lecture. FinanceService exige `canViewMouvements` pour les dépenses. Les capacités existantes autorisent AVOCAT et COMPTABLE ; l'authentification rejette les utilisateurs inactifs. Aucun rôle ajouté.

Le frontend charge les données financières après les capacités, les dépenses après `canViewMouvements`, les comptes de provision après `canViewCaisses` et `canCreateMouvement`. Les actions et reçus restent protégés par leurs contrôles serveur existants. Les projections générales `DOSSIER_PUBLIC_SELECT` et `DOSSIER_REFERENCE_SELECT` ne sont pas enrichies de KYC ou de relations financières.

Les états chargement, refus, ressource absente et erreur restent distincts. Les erreurs d'une rubrique n'effacent pas les autres données fiables ; une dépense indisponible ne produit pas un total nul. Le contrat ancien sans confirmation explicite n'ouvre pas de nouvelle possibilité d'imputation.

## E. Recette manuelle authentifiée à effectuer — non exécutée

Contrôles techniques : TypeScript backend de production (`node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false`) réussi ; TypeScript frontend (`node node_modules/typescript/bin/tsc --noEmit --incremental false`) réussi. `git diff --check` réussi dans les deux dépôts, avec avertissements Git LF/CRLF uniquement. Le premier lancement Node backend en sandbox avait rencontré EPERM ; le contrôle autorisé hors sandbox a réussi. Aucune suite automatisée lancée.

Exclusivement sur une base isolée, avec comptes de test et justificatifs privés de test. Aucune donnée métier réelle ne doit être modifiée.

1. AVOCAT et COMPTABLE actifs : comparer fiche Dossier, détail Finance, reçus et mouvements pour le même dossier. Autres rôles et inactifs : vérifier le refus par appel API direct, absence de montants dans les projections générales, absence de contenu privé en cache.
2. Facture émise, partiellement réglée et échue : TTC/réglé/reste identiques entre écrans, priorité EN_RETARD conservée. Brouillon visible mais exclu de la synthèse et des choix d'imputation.
3. Deux factures dont une surpayée : trop-perçu non compensé avec la seconde. Provision reçue non imputée : encaissements augmentés, reste dû inchangé.
4. Imputation autorisée : disponible et dette évoluent une fois, encaissements inchangés. Contrôler la concurrence et le rejet serveur d'une double imputation, sans compter un mouvement supplémentaire.
5. Paiement/provision/frais sans mouvement, rattachement historique, devise absente ou différente, mouvement partagé, TVA historique incertaine : vérifier avertissements et indisponibilités, aucune correction automatique.
6. Frais directs, intégrés dans une facture, à facturer et ambigus : vérifier référence, reçu privé, absence de double encaissement/charge et absence de seconde écriture.
7. Dépenses : bouton ouvre exactement la modale F2.1 à cinq champs et six catégories ; menu dynamique de noms de comptes sans solde et sans compte présélectionné. Enregistrer seulement une opération fictive isolée, comparer dossier/Finance/solde, dette client inchangée. Filtrer catégorie et période, contrôler les totaux séparés par devise et la synthèse toutes périodes.
8. Dossier vide, relation facultative, erreur réseau par rubrique, permission refusée, reçu indisponible : messages explicites, aucun zéro inventé, états responsive et focus de la modale.
9. Vérifier les cinq autres onglets, documents privés, KYC AVOCAT et historique sans exposition indirecte.

## F. Limites et statut

F4 ne régularise pas les écritures anciennes. Les paiements/provisions/frais sans preuve et les rattachements historiques restent à qualifier ; les anomalies fiscales requièrent une décision métier, hors F4. La lecture utilise plusieurs requêtes existantes : elle ne constitue pas un instantané transactionnel global entre livre et dépenses sous concurrence.

Aucune migration, écriture PostgreSQL/R2, normalisation monétaire, suite automatisée, commit ou push dans cette intervention. F5 non commencé. F4 ne sera fonctionnellement validé qu'après la recette authentifiée ci-dessus.
