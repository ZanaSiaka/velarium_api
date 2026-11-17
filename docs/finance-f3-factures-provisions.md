# F3 — Factures, paiements, provisions et restes à payer

## État et limites de validation

Implémentation des corrections établies, sans régularisation des données réelles. Les contrôles TypeScript backend de production, TypeScript frontend et git diff --check ont réussi lors des vérifications F3 ; les dernières vérifications sont reprises dans le compte rendu de fin d'intervention. Aucun Jest ni autre suite automatisée, parcours authentifié, création financière ou scénario concurrent réel n'a été exécuté. La recette ci-dessous est préparée, pas déclarée réussie.

Deux inspections PostgreSQL anonymisées ont utilisé BEGIN TRANSACTION READ ONLY, SET LOCAL statement_timeout et ROLLBACK. Aucun montant, statut, rattachement, compte FCFA, objet Prisma ou fichier de migration n'a été modifié en base. Aucun accès R2, installation npm, commit ou push. Les développements locaux précédents ont été conservés.

## A — Audit des modèles et circuits

Modèles examinés : Facture, LigneFacture, Paiement, Provision, ImputationProvision, FraisOuvertureDossier, RecuEncaissement, MouvementFinance, ConventionHonoraires et Caisse.

- La facture conserve ses montants HT/TVA/TTC et ses lignes en Decimal. Ni Facture, ni Paiement ni Provision ne stockent une devise propre ; les nouveaux encaissements sont XOF et la devise des mouvements vient du compte.
- Paiement et Provision ont chacun une relation unique facultative vers MouvementFinance. L'unicité n'empêche pas à elle seule qu'un mouvement soit lié à deux modèles métier différents.
- Provision.factureId est une ancienne association, sans champ définissant le montant effectivement affecté. ImputationProvision contient le montant et une unicité provision/facture.
- Les reçus sont uniques par numéro et mouvement. Leur enum couvre provisions et frais d'ouverture, pas les paiements directs de facture.
- ConventionHonoraires existe, zéro enregistrement dans le relevé, sans circuit opérationnel utilisé pour ce calcul. Aucun développement de cette fonctionnalité.
- Aucun endpoint de modification de facture émise, d'avoir ou d'annulation n'a été trouvé dans le contrôleur Factures ; aucun nouveau circuit de ce type n'est créé. BROUILLON existe mais les créations du circuit actuel produisent une facture émise.
- Aucun modèle de remise n'a été trouvé dans les lignes inspectées ; pas de remise introduite.

Divergences initiales : Factures additionnait en Number paiements, imputations et totalité des provisions historiques ; Provisions et Dossier utilisaient d'autres lectures ; le reste Dossier pouvait compenser une facture surpayée avec une autre ; le livre Client soustrayait même les provisions non imputées de la dette. Le frontend recalculait des totaux, transformait des valeurs absentes en zéro et masquait les centimes. L'aperçu de facture ignorait les frais historiques ajoutés automatiquement.

## B — Données réellement inspectées

| Contrôle anonymisé | Nombre |
| --- | ---: |
| Factures | 18 |
| Factures dont HT diffère de la somme des lignes ou TTC de HT + TVA | 0 |
| Lignes dont le montant diffère du produit quantité/prix ramené à la précision stockée | 0 |
| Dépassements TTC selon l'ancienne addition arithmétique incluant les associations historiques intégrales | 2 |
| Écarts de statut selon cette ancienne addition | 2 |
| Factures BROUILLON | 0 |
| Provisions | 14 |
| Provisions à rattachement historique | 4 |
| Provisions à rattachement historique ET imputation explicite | 0 |
| Imputations explicites | 1 |
| Provisions dont les imputations explicites dépassent le montant initial | 0 |
| Paiements sans mouvement | 8 |
| Provisions sans mouvement | 11 |
| Frais PAYE sans mouvement | 2 |
| Mouvements liés à plusieurs opérations parmi paiement/provision/frais | 0 |
| Imputations entre dossiers différents | 0 |
| Références facture/reçu ne respectant pas les formes FACT/REC examinées | 0 |
| Paiements/provisions liés à un mouvement de montant, type ou dossier incohérent | 0 / 0 |
| Reçus dont montant ou dossier diffère du mouvement | 0 |
| Paiements/provisions liés à un compte non XOF | 0 / 0 |
| TVA non reconstituable depuis les seules lignes typées HONORAIRES et le taux stocké | 11 |

Ces compteurs peuvent se recouper. Les deux dépassements et écarts de statut ne constituent pas à eux seuls des trop-perçus confirmés : l'ancienne addition supposait intégrales les affectations historiques. Les 11 écarts de reconstitution TVA peuvent relever du typage historique des lignes ou de règles anciennes ; ils ne sont pas assimilés automatiquement à des erreurs fiscales. Les totaux stockés sont conservés et ces cas sont signalés.

L'absence de mouvement n'est pas déclarée erreur comptable. Elle empêche cependant le code de démontrer l'encaissement/sa devise avec les seules relations disponibles. Aucune écriture manquante n'est fabriquée.

## C — Source commune et formules

Nouveau helper common/finance/billing.ts. financial-read.ts conserve ses primitives Decimal, mais ne traite plus un simple factureId historique comme une affectation intégrale démontrée.

Pour une facture sans ambiguïté :

- Montant réglé reconnu = paiements directs reconnus + imputations explicites reconnues.
- Reste dû = maximum(TTC stocké - montant réglé reconnu, 0).
- Excédent = maximum(montant réglé reconnu - TTC stocké, 0), présenté séparément sans crédit ni remboursement automatique.
- Reste global Dossier/Client = somme des restes positifs individuels des factures émises, sans compensation d'excédent entre factures.
- Excédent global = somme des excédents individuels, sans affectation à une autre facture.
- Provision disponible = montant initial - imputations explicites reconnues. Une surimputation produit un avertissement et une indisponibilité, pas un zéro masquant le problème.
- Encaissements = paiements + provisions reçues, chaque opération une fois. Ni reçu, ni imputation, ni mouvement déjà représenté par son opération métier ne s'ajoute une deuxième fois.
- Les dépenses de dossier ne modifient ni ces dettes ni les provisions disponibles.

La reconnaissance d'un encaissement vérifie le mouvement ENTREE, sa source métier attendue, son montant, son dossier, sa devise XOF et l'absence de plusieurs liens métier simultanés lorsqu'ils sont projetés. Une relation manquante ou incohérente produit null et un avertissement, pas un montant zéro. Les montants enregistrés restent visibles dans les lignes d'historique, distincts des agrégats reconnus.

Les cinq cas de provision sont distingués : non affectée ; rattachement historique seul ; imputations explicites seules ; coexistence historique/explicite ; incohérence ou montant non déterminable. Dans les cas historiques non démontrables, les montants imputé/disponible sont indisponibles. Aucune migration automatique vers ImputationProvision.

Les factures brouillon restent consultables mais sont exclues des créances exigibles et des nouveaux règlements. Le total des brouillons est séparé. Le périmètre du livre est HORS_BROUILLONS.

La même lecture est utilisée par FacturesService, les validations de règlements/imputations, le livre Dossier, les impayés du dashboard et le seul livre financier Client. Le CRUD et les permissions Client ne sont pas modifiés. Les alias historiques sont conservés : totalProvisions d'une facture désigne les provisions appliquées ; celui du livre Client désigne les provisions reçues. Les montants exacts nommés permettent de lever cette ambiguïté.

## D — Création et aperçu des factures

Calcul définitif côté serveur en Prisma.Decimal. Quantités/prix validés à deux décimales et dans les capacités Prisma ; quantité positive, prix non négatif. Le montant de chaque ligne est ramené aux deux décimales du stockage existant, puis le HT est la somme de ces lignes persistables. Le calcul de TVA existant sur les seuls honoraires reste au taux CABINET_INFO, actuellement 18 %, à la précision du centime avec la même convention positive half-up que l'ancien Math.round. Les frais ajoutés restent hors TVA. Aucune nouvelle règle fiscale, taxe ou remise.

Les factures historiques ne sont jamais réécrites pour se conformer à ces calculs. La lecture compare lignes, HT, TVA/TTC stockés et signale les divergences ; les écarts de reconstitution fiscale restent à qualifier. Le TTC stocké reste la référence du document émis.

Nouvelle route protégée POST /api/factures/preview : mêmes DTO et calcul que la création, lecture seule, sans numéro, facture, paiement, reçu ni mouvement créé. Le formulaire appelle cet aperçu avec debounce, affiche les montants renvoyés et les frais automatiquement inclus, distingue chargement/erreur/indisponibilité et ne recalcule plus sa propre TVA à 18 %. La création revalide le tout sous transaction, notamment si les frais ont été facturés entre l'aperçu et la validation.

Le backend refuse des frais à facturer dont les liens d'encaissement sont ambigus plutôt que d'effacer leur mouvement. Les frais PAYE sont exclus de l'ajout automatique ; les frais A_PAYER/A_FACTURER non encore liés sont ajoutés une seule fois et rattachés à la nouvelle facture. Le verrou du dossier sérialise cet usage des frais, sans modification des frais au stade de l'aperçu.

La facture à TTC nul conserve le comportement de création existant ; sa qualification métier est signalée comme à confirmer. Aucun paiement positif n'est autorisé sur un reste nul et aucun statut PAYEE n'est déduit automatiquement de ce seul cas à la lecture.

## E — Règlements, imputations et statuts

Paiement direct : montant positif exact, facture existante et non brouillon, lecture reconnue exploitable, compte actif XOF, moyen autorisé, date valide et montant inférieur ou égal au reste dû. Une seule entrée MouvementFinance et un seul Paiement liés, avec facture et audit dans la même transaction. Aucune génération de reçu direct ajoutée.

Provision : circuit d'encaissement/mouvement/reçu existant conservé, montants Decimal et numérotation commune. Le reçu ne s'ajoute pas aux encaissements. Les listes exposent la lecture d'affectation et un indicateur d'encaissement confirmé ; un disponible arithmétique ne vaut pas à lui seul preuve d'encaissement.

Imputation : existence, même dossier/client selon les relations actuelles, encaissement XOF cohérent, provision sans ambiguïté, disponible et reste de facture suffisants. Une seule imputation par couple provision/facture, comme avant. Pas de mouvement ni de reçu. Les frais facturés peuvent devenir PAYE lors d'une nouvelle imputation soldant la facture ; date de règlement = date d'affectation, sans prétendre à un nouvel encaissement physique.

Suppression d'imputation : endpoint, permissions et suppression existants conservés. Elle utilise les mêmes verrous et la lecture commune. Le statut de facture n'est recalculé que si sa lecture est fiable. Aucun remboursement ni contrepassation inventé. Un statut historique de frais PAYE n'est pas inversé sur la seule absence de mouvement ; les éventuelles incohérences de frais après retrait nécessitent une qualification métier, pas une réécriture spéculative. La traçabilité complète de ces suppressions reste pour F5.

Règle validée par le cabinet pendant l'intervention : PAYEE si intégralement réglée ; sinon EN_RETARD si l'échéance est passée, même en présence d'un règlement partiel ; sinon PARTIELLEMENT_PAYEE si un règlement reconnu existe ; sinon ENVOYEE. L'échéance du jour reste inclusive selon la convention UTC des formulaires. Les lectures exposent statutCalcule séparément du statut stocké et ne mettent rien à jour. Les nouveaux règlements/imputations appliquent cette priorité.

Les frais encaissés par une facture ne s'ajoutent pas à nouveau au total global d'encaissements, déjà porté par ses paiements ou par les provisions reçues. Les frais historiques PAYE sans mouvement démontrable restent signalés, sans création de trésorerie. La création P0 du dossier avec encaissement obligatoire reste conservée.

## F — Transactions et numérotation

Ordre des verrous : comptes de trésorerie F2.2, puis facture, puis provision. Paiement : compte puis facture. Imputation et retrait : facture puis provision, sans acquisition ultérieure de compte. Deux factures différentes peuvent ainsi attendre la même provision sans verrouiller ensuite la facture de l'autre opération. Les identifiants d'une même catégorie sont ordonnés, valeurs SQL liées via Prisma.sql.

Les transactions Serializable et retries bornés F2.2 sont réutilisés. Le contrôle des disponibles et l'écriture sont atomiques. Un paiement depuis un autre compte ne contourne plus le verrou de facture. Les nouvelles opérations ne peuvent pas dépasser le reste ou le disponible selon la lecture commune. Les conflits et doublons sont gérés par les validations, verrous, unicités et retries ; ils ne sont pas masqués comme des réussites.

Numérotation FACT et REC : formats conservés FACT-année-001 et REC-année-0001. Allocation depuis le plus grand suffixe existant, sans réutilisation issue d'un simple comptage après suppression. Verrou advisory transactionnel annuel partagé : namespace FACT 726510 ; REC 726511. Aucun nouvel objet SQL/table/séquence ni migration. Les lecteurs de numéros ne reçoivent pas de données financières complètes.

Le compteur REC est partagé entre provisions et création des dossiers. Il est acquis après le compte pour ces producteurs ; FACT est acquis dans le seul circuit de création de facture, avant le verrou de dossier, sans verrou de trésorerie ensuite. Les garanties uniques existantes sont conservées, et les collisions de création peuvent être réessayées de façon bornée. Aucune référence historique n'est renumérotée.

Les anciennes instances ou scripts n'utilisant pas ces verrous restent une limite : déployer les producteurs ensemble. Les scénarios concurrents n'ont pas été exécutés. L'idempotence HTTP globale des paiements/provisions/factures n'est pas ajoutée ; elle reste pour F5. L'unicité d'une référence n'empêche pas deux saisies métier distinctes après une réponse réseau incertaine. L'idempotence F2.1 et la modale de dépense restent inchangées.

## G — Contrats et fichiers

Montants stockés : champs numériques de compatibilité conservés, avec champs Exact. Montants dérivés : number ou null pour les anciens champs, et chaînes exactes/null dans montants. Les avertissements et l'autorisation de règlement viennent du serveur. Les cartes/détails/listes n'inventent plus un total ou un solde par repli sur zéro. Les montants de reçus et du livre des paiements disposent d'une représentation exacte additive.

Backend :

- src/common/finance/billing.ts (nouveau)
- src/common/finance/financial-read.ts
- src/common/finance/treasury.ts (comparaison strictement supérieure à zéro explicite)
- src/modules/factures/factures.service.ts
- src/modules/factures/factures.controller.ts
- src/modules/factures/dto/create-facture.dto.ts
- src/modules/factures/dto/create-paiement.dto.ts
- src/modules/provisions/provisions.service.ts
- src/modules/provisions/dto/create-provision.dto.ts
- src/modules/provisions/dto/create-imputation-provision.dto.ts
- src/modules/dossiers/dossiers.service.ts (lecture des lignes et compteur REC partagé)
- src/modules/dossiers/dossier-finance-read.ts
- src/modules/dashboard/dashboard.service.ts (lecture commune des impayés)
- src/modules/clients/clients.service.ts (livre financier seulement)
- src/modules/paiements/paiements.service.ts (montantExact)
- src/modules/recus/recus.service.ts (montantExact)
- docs/finance-f3-factures-provisions.md

Frontend :

- src/app/(layout-pages)/honoraires/actions.ts
- src/app/(layout-pages)/honoraires/FactureForm.tsx
- src/app/(layout-pages)/honoraires/InvoiceCard.tsx
- src/app/(layout-pages)/honoraires/columns.tsx
- src/app/(layout-pages)/honoraires/[id]/page.tsx
- src/app/(layout-pages)/honoraires/PaiementForm.tsx
- src/app/(layout-pages)/honoraires/ProvisionForm.tsx
- src/app/(layout-pages)/honoraires/ProvisionImputationDialog.tsx
- src/app/(layout-pages)/dossiers/[id]/DossierSecondarySections.tsx (éligibilité minimale des factures)
- src/app/(layout-pages)/dossiers/[id]/LivrePaiements.tsx (libellé hors brouillons)
- src/app/(layout-pages)/clients/actions.ts (contrat du livre financier seulement)

Les contrôles d'accès Finance/D2 existants protègent aussi le nouvel aperçu. Aucun nouveau rôle, aucune modification d'authentification ou de permission. Pas de refonte des six onglets Dossier, pas de modification de la modale F2.1. Les écritures frontend ont vérifié les empreintes avant application ; les diffs Git complets incluent les phases locales antérieures.

## H — Décisions et suites

Restent à valider : montant réellement affecté des quatre provisions historiques ; preuve et devise des opérations sans mouvement ; qualification des deux dépassements arithmétiques et écarts de statut ; typage/base fiscale des 11 reconstitutions TVA divergentes ; qualification des factures à TTC nul ; éventuelles incohérences de frais après suppression d'une imputation. Aucun de ces points n'est régularisé automatiquement.

Options de régularisation, après validation et sauvegarde vérifiée : maintenir l'indisponibilité ; rattacher une écriture existante prouvée ; migrer une affectation historique vers des imputations d'un montant effectivement documenté. Si aucune écriture ou preuve exploitable n'existe, définir une attestation/régularisation traçable avant tout changement de modèle ou mouvement. Ne pas utiliser un champ note comme autorisation implicite et ne pas fabriquer un encaissement pour rendre une ligne disponible. Aucun script de migration de données créé.

F4 : consolidation complète de la fiche Dossier et des informations de lecture. F5 : audit des corrections/suppressions, éventuelles contrepassations validées et idempotence HTTP globale. Un reçu de paiement direct nécessiterait une décision métier et probablement une valeur d'enum dédiée ; aucune migration correspondante n'est préparée ou exécutée. ConventionHonoraires, avoirs, crédits et remboursements restent hors périmètre.

## I — Recette isolée préparée, non exécutée

Utiliser des utilisateurs AVOCAT/COMPTABLE actifs et une base de test isolée. Ne pas créer les données suivantes sur la base du cabinet.

1. Facture dont le TTC est 500000 : payer 100000. Attendu : réglé 100000, reste 400000, une entrée, un paiement. Préparer un TTC de 500000, pas une base HT de 500000 à laquelle la TVA s'ajouterait.
2. Encaisser provision 200000 puis imputer 150000 : facture réglée 250000, reste 250000, provision disponible 50000 ; encaissements paiements/provisions 300000, aucune entrée ni reçu lors de l'imputation. Les frais d'ouverture restent un poste séparé du total global.
3. Dépense Dossier 25000 : une sortie et baisse du compte choisi ; reste de facture et provision disponible inchangés.
4. Deux paiements simultanés sur la même facture depuis deux comptes : pas de sur-règlement ; conflit/refus exploitable si le second montant dépasse le nouveau reste.
5. Deux imputations simultanées sur une provision vers des factures distinctes : pas de double consommation ; test du couple provision/facture répété.
6. Paiement et imputation simultanés sur une facture : même contrôle du reste après sérialisation, aucun dépassement.
7. Provision de test avec factureId et imputation explicite : montants reconnus indisponibles, avertissement, pas de double somme ni conversion automatique.
8. Facture A TTC100000, encaissements cohérents120000 ; facture B TTC200000, encaissements50000 : excédent A20000 distinct, reste B150000, reste global150000, aucun crédit automatique.
9. Frais PAYE déjà encaissés : aucun ajout automatique à une facture. Frais anciens à facturer non encore liés : ligne visible dans l'aperçu et incluse une seule fois à la création, hors TVA selon la règle conservée.
10. Créations concurrentes de factures, provisions et dossiers : références uniques aux formats conservés, rollback/retry borné, aucun reçu ou mouvement partiel. Vérifier aussi les conflits après trous historiques de numérotation.
11. Facture échue partielle : priorité EN_RETARD selon validation du cabinet ; lecture seule ne modifie aucun statut stocké. Brouillon : pas de règlement/imputation, pas de créance exigible.
12. Réseau lent/erreur aperçu : chargement puis indisponibilité explicites, champs conservés, pas de zéro fictif ; totaux et ligne de frais identiques entre aperçu backend et création finale revalidée.
13. Historique sans mouvement/devise ou incohérent : montants enregistrés visibles, agrégats concernés null, nouvelles affectations risquées refusées. Comparer Factures, Provisions, Dossier, livre Client et dashboard.
14. Vérifier rôles non habilités/inactifs, refus du nouvel aperçu, absence de fuite de données, protections F2.2 et modale F2.1 inchangées. Vérifier le reçu de provision/frais existant, sans attendre un reçu direct non implémenté.

Les suites automatisées n'ont pas été lancées. Leurs mocks/attendus pourront nécessiter une adaptation aux nouvelles lectures null et aux verrous/advisory locks lors d'une campagne autorisée ; aucun résultat P0/P1/P2 de cette intervention n'est inventé.

## Vérifications finales observées

| Commande / contrôle | Résultat |
| --- | --- |
| Backend : node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false | exit 0 |
| Frontend : node node_modules/typescript/bin/tsc --noEmit --incremental false | exit 0 |
| git diff --check backend | exit 0, avertissements LF/CRLF seulement |
| git diff --check frontend | exit 0, avertissements LF/CRLF seulement |
| Prisma, generated, package.json et package-lock.json | Aucun changement de cette intervention |
| Recette authentifiée et concurrence réelle | Non exécutées |

Des erreurs intermédiaires de typage sur les moyens de paiement et les valeurs null de la modale d'imputation ont été corrigées sans any, cast de contournement ni zéro de substitution. La lecture des historiques demeure conservatrice : certaines nouvelles opérations sont volontairement refusées tant que les affectations/encaissements concernés ne peuvent pas être démontrés.
