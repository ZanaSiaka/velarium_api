# F2.2 — Comptes, soldes, devises et transferts

## État de validation

Corrections indépendantes des données historiques implémentées. TypeScript de production backend et TypeScript frontend réussis ; git diff --check réussi dans les deux dépôts (avertissements LF/CRLF uniquement).

Inspection PostgreSQL exécutée exclusivement avec BEGIN TRANSACTION READ ONLY, timeout local et ROLLBACK. Aucune création de compte ou mouvement, aucune modification PostgreSQL/R2, normalisation, migration, génération Prisma, installation npm, suite automatisée, commit ou push. Aucun parcours authentifié ni scénario réel de concurrence exécuté. La sécurité concurrente décrite ci-dessous est une propriété de conception et une vérification statique, pas une recette réelle réussie.

## A — Audit avant modification

| Chemin | Écriture affectant la trésorerie | Protection précédente |
| --- | --- | --- |
| FinanceService.createCaisse | Solde initial d'un nouveau compte | Création puis audit séparé |
| FinanceService.updateCaisse/deleteCaisse | Solde initial, devise/type, activation ou suppression | Lectures/contrôles puis mutations sans verrou commun |
| FinanceService.createMouvement | ENTREE, SORTIE et TRANSFERT | Transaction D3 pour les seules sorties liées au dossier |
| FinanceService.createDossierExpense | SORTIE de dossier | Serializable, solde Decimal, idempotence et audit transactionnel |
| FacturesService.addPaiement | ENTREE de paiement | Transaction sans isolation explicite ni verrou de compte |
| ProvisionsService.create | ENTREE de provision | Transaction sans isolation explicite ni verrou de compte |
| DossiersService.create | ENTREE des frais d'ouverture | Serializable et retries existants, sans verrou de compte partagé |

Aucun endpoint applicatif de modification/suppression d'un MouvementFinance n'a été trouvé. PaiementsService et RecusService lisent les mouvements ; FinanceAttachmentsService ne modifie que leurs justificatifs. Les imputations et la création de factures ne produisent pas de mouvement et ne modifient pas le solde du compte. Les scripts finance-history-dry-run sont des outils de lecture produisant des rapports locaux ; ils n'ont pas été exécutés.

Les méthodes findCaisses/findCaisse, le dashboard Finance et le dashboard général recalculaient séparément le solde à partir d'historiques chargés et de conversions Number. F2.1 avait un calcul Decimal distinct pour les seules dépenses. financial-read.ts et dossier-finance-read.ts traitent les lectures de facturation/provisions, pas le solde de compte ; ils sont conservés sans modification.

Risques initiaux : sorties/transferts concurrents, modification ou désactivation d'un compte pendant un encaissement, changement de devise/type réinterprétant l'historique, contrôle de découvert en flottants, transferts interdevises acceptables par le code, totaux globaux mélangeant FCFA/XOF.

## B — Devises et données réellement lues

La base inspectée contient sept comptes : quatre XOF et trois FCFA. Le seul champ devise des modèles financiers interrogés est Caisse.devise : MouvementFinance, Facture, Paiement, Provision, FraisOuvertureDossier et RecuEncaissement n'en possèdent pas.

| Compte historique (identifiant technique) | Type | Actif | Mouvements source | Mouvements destination |
| --- | --- | --- | ---: | ---: |
| cmtvjdgb30000rouofzqhyknr | BANCAIRE | Non | 5 | 0 |
| cmtvjey4g0002rouonigy4kr9 | MOBILE_MONEY | Oui | 0 | 2 |
| cmtvjr2ck0006rouo5clxdy14 | MOBILE_MONEY | Oui | 2 | 1 |

Trois transferts existent, tous entre comptes FCFA. Aucun transfert interdevise n'a été trouvé dans ce relevé. Ces comptes historiques concernent sept mouvements source au total ; les trois transferts cités figurent dans ce périmètre. Les références bancaires, téléphones, titulaires et informations de connexion ne sont pas exposés dans ce rapport.

Le contexte ivoirien suggère le franc CFA BCEAO, mais ni le libellé FCFA ni les seuls liens de mouvements ne constituent la preuve que chaque compte est XOF. Aucune assimilation automatique à XOF ou XAF n'est effectuée.

### Corrections indépendantes réalisées

- Nouveau compte : XOF par défaut. Si un code est fourni, format de trois lettres majuscules après trim ; FCFA est refusé comme nouveau code. Le format n'est pas un nouveau référentiel exhaustif des devises ISO.
- Nouveau mouvement manuel : le compte doit porter un code canonique de trois lettres déjà enregistré sous cette forme. Un compte historique FCFA reste refusé jusqu'à validation de sa normalisation.
- Dépense Dossier et encaissements métier : contrôles XOF conservés.
- Transfert : deux comptes de même code exact ; XOF et XAF ne sont jamais assimilés. Aucune conversion.
- Les lectures historiques restent disponibles avec leur libellé enregistré. Les totaux sont regroupés séparément par devise ; aucune somme FCFA/XOF n'est affichée comme total unique.

### Normalisation proposée — non exécutée, validation requise

Portée minimale envisageable : trois lignes de Caisse, colonne devise, FCFA vers XOF, uniquement pour les trois identifiants ci-dessus après confirmation individuelle par le cabinet. Aucun montant, identifiant, relation ou mouvement à modifier ; aucune migration Prisma nécessaire pour ce changement de données.

Conditions préalables : preuve de la monnaie de chaque compte (documents/opérateur et confirmation métier), confirmation du périmètre des transferts et absence de XAF, validation explicite, inventaire actualisé immédiatement avant intervention. Si un seul compte est douteux, l'exclure et réévaluer les transferts qui le concernent.

Sauvegarde : vérifier effectivement un point de restauration Neon ou une branche de sauvegarde et sa procédure de restauration ; aucun n'est présumé disponible. Conserver en plus un export sécurisé des lignes ciblées avec devise originale, horodatages et références, ainsi qu'un relevé exact des soldes/mouvements/transferts avant intervention. Ne pas afficher les secrets de connexion.

Procédure future : suspendre les écritures applicatives concernées, ouvrir une transaction contrôlée, verrouiller les comptes, revérifier les identifiants/anciennes valeurs/nombres de lignes, appliquer uniquement la normalisation explicitement validée et journaliser l'intervention sans mouvement artificiel. Abandonner si le périmètre diffère. Comparer avant/après : mêmes identifiants, mouvements, montants, soldes numériques et liens ; seuls le code approuvé et la traçabilité administrative peuvent changer. Vérifier ensuite le sélecteur XOF et les totaux, puis réouvrir les écritures.

Retour arrière : ROLLBACK avant commit. Après commit et avant toute nouvelle opération, restauration ciblée des anciennes devises à partir de l'export, après nouvelle validation. Après reprise d'activité, ne pas remettre aveuglément FCFA : les nouvelles écritures héritent aussi de la devise du compte ; analyser ou restaurer sur une branche isolée pour éviter une nouvelle réinterprétation. Ne supprimer aucune opération récente.

## C — Calcul commun des soldes

Nouveau helper src/common/finance/treasury.ts, réutilisable avec Prisma.TransactionClient.

readTreasuryAccounts effectue trois lectures : comptes, agrégats source groupés par compte/type, agrégats destination. Il ne charge pas l'historique complet pour calculer le solde. Des Map évitent une recherche de chaque compte pour chaque ligne agrégée. Les index caisseId/caisseDestinationId existants sont conservés ; aucun index ou migration ajouté. Performance réelle et plans SQL restent à mesurer sur l'environnement de recette.

Formule inchangée, calculée en Decimal : solde initial + ENTREE + TRANSFERT entrants - SORTIE - TRANSFERT sortants. Les comptes sans mouvement donnent un vrai zéro pour les flux. Une valeur non finie provoque un refus explicite de lecture/validation, jamais un faux zéro.

Réutilisation : listes/détails de comptes, contrôle de toutes les sorties et transferts manuels, dépenses de dossier, modification/désactivation/suppression, dashboard Finance et solde du dashboard général. Les lectures liste/détail/dashboard Finance utilisent RepeatableRead pour un instantané cohérent. Le détail charge encore les mouvements puisqu'il doit les afficher, mais ne les additionne plus en JavaScript.

Les calculs et comparaisons sont Decimal ; les conversions Number restent à la frontière de sérialisation pour compatibilité. Les champs additifs soldeExact, soldeInitialExact, totalEntreesExact, totalSortiesExact fournissent des chaînes à deux décimales aux interfaces. Les écrans de trésorerie utilisent ces chaînes ; aucun arrondi silencieux des montants n'est introduit. La précision Decimal(15,2) est vérifiée pour les mouvements manuels et soldes initiaux.

## D — Affichages et contrats

Dashboard Finance : les anciens soldeGlobal/totalEntrees/totalSorties sont number ou null, accompagnés de champs Exact, deviseGlobale et totauxParDevise. Si plusieurs devises, ou un libellé historique non canonique, existent dans ce périmètre, les totaux globaux sont null et l'interface affiche les sous-totaux exacts par devise. Les transferts sont exclus des recettes/dépenses globales, mais inclus dans les flux du compte individuel et dans son solde.

Dashboard général : les protections et périodes UTC F1 restent inchangées. Son solde utilise le helper commun, sans filtre de période. Ses flux mensuels utilisent Decimal et les mêmes lignes que les cartes. Le périmètre commun de flux n'est affiché que si sa devise est homogène et confirmée ; les encaissements historiques sans mouvement rendent ce périmètre indisponible, sans les supprimer ni leur attribuer une devise. Les séries concernées restent null, sans faux zéros. Le détail par devise reste consultable dans Finance.

Les cartes utilisent deviseSolde/deviseFlux au lieu de forcer FCFA sur une devise différente. Les totaux de l'en-tête du graphique viennent du serveur et ne sont plus recalculés par addition flottante côté navigateur. Les calculs des impayés, factures et provisions restent hors de cette correction et conservent leurs limites historiques documentées pour F3.

## E — Transactions, transferts et protection de l'historique

Toutes les voies applicatives identifiées qui écrivent un mouvement verrouillent désormais la ligne Caisse concernée avant la lecture de son état. Le verrou SELECT ... FOR UPDATE utilise des paramètres liés via Prisma.sql/Prisma.join, sans SQL construit à partir des valeurs utilisateur. Pour les transferts, les deux comptes sont verrouillés dans l'ordre stable ORDER BY id, indépendamment du sens du transfert.

| Chemin | Stratégie après F2.2 |
| --- | --- |
| Entrées/sorties/transferts manuels | Serializable, verrous sur un ou deux comptes, contrôle Decimal et mouvement/audit dans la transaction |
| Dépenses de dossier | Même stratégie et idempotence F2.1 conservée, compte explicitement choisi |
| Paiements de facture | Wrapper Serializable commun et verrou du compte avant les lectures ; règles/montants/statuts métier conservés |
| Provisions encaissées | Même adaptation minimale ; provision/mouvement/reçu restent atomiques |
| Frais d'ouverture | Transaction Serializable Dossier existante conservée, verrou avant lecture du compte ; logique de numérotation conservée |
| Modification/désactivation/suppression compte | Serializable, même verrou et relecture exacte sous verrou ; audit transactionnel |
| Nouveau compte et solde initial | Création et audit atomiques ; compte nouveau non accessible à une autre transaction avant commit |

Les retries sont bornés à trois tentatives pour les conflits P2034, ainsi que les codes PostgreSQL 40001/40P01 remontés par un verrou brut sous P2010. Le traitement Dossier partage cette détection mais conserve sa gestion existante des collisions de numérotation. Le retry de P2002 n'est activé par le helper commun que pour le chemin idempotent D3/F2.1, comme précédemment. Pas de retry infini ni de nouvelle numérotation.

Les transactions échouées sont annulées avant retry. Après épuisement d'un conflit reconnu : 409 avec invitation à vérifier les opérations avant nouvelle tentative. Une erreur réseau ou un timeout ambigu ne déclenche pas un retry aveugle de toute requête HTTP.

Transfert : source/destination existantes, actives, distinctes, mêmes devises, montant positif dans la précision autorisée, date valide, source métier TRANSFERT et permissions existantes. Une seule ligne MouvementFinance représente simultanément le débit et le crédit. Aucun compte de solde stocké à synchroniser, aucune entrée/sortie miroir.

Historique : solde initial, type et devise sont immuables dès qu'un mouvement source ou destination existe. Un PATCH renvoyant exactement la même valeur historique de devise reste un no-op autorisé. Les champs facultatifs non envoyés restent conservés. Désactivation : solde projeté exactement nul selon la règle existante. Suppression : solde nul et aucun historique. Une opération concurrente participe au même verrou et relit le compte ; aucune cascade de suppression de mouvements n'est ajoutée.

La stratégie couvre tous les producteurs applicatifs trouvés par l'audit, mais n'est pas une contrainte SQL contre un script externe, une ancienne instance de l'API ou une future écriture qui ignorerait le helper. Déployer les producteurs ensemble et ne pas conserver une ancienne instance écrivant sans ces garanties. Les scénarios concurrents doivent encore être exécutés avant déclaration de validation globale.

## F — Préservation F2.1 et limites F3/F5

MouvementDialog, DossierExpenses, le DTO et l'endpoint minimal comptes-depenses ne sont pas modifiés dans F2.2. Cinq champs, six catégories, aucun solde ni compte présélectionné, sélection active/XOF, moyen facultatif, un seul mouvement, permissions, avertissement de double saisie, rejeu et journalisation transactionnelle restent conservés. Les actions F2.1 ont été comparées à leur version avant F2.2 : inchangées.

L'idempotence technique n'est pas une détection des doubles saisies métier. Aucun blocage par montant/date/catégorie n'est ajouté. Les mouvements manuels hors Dossier et autres encaissements ne reçoivent pas de nouvelle clé HTTP d'idempotence ; la protection anti-rejeu globale et l'audit exhaustif restent pour F5. Les collisions de numéros entre opérations sur des comptes différents et la réconciliation des provisions historiques restent pour F3, sans changement de numérotation dans cette phase.

Certains journaux métier historiques restent écrits après le commit par leurs services ; F2.2 n'a pas refondu leur cycle métier. L'atomicité de leur mouvement avec le paiement/provision/reçu est conservée. Les calculs de facturation/provisions en Number, la TVA, les statuts, reçus et imputations ne sont pas refondus.

## G — Fichiers modifiés par F2.2

Backend :

- src/common/finance/treasury.ts (nouveau)
- src/modules/finance/finance.service.ts
- src/modules/dashboard/dashboard.service.ts
- src/modules/factures/factures.service.ts (transaction du paiement uniquement)
- src/modules/provisions/provisions.service.ts (transaction d'encaissement uniquement)
- src/modules/dossiers/dossiers.service.ts (verrou de compte et reconnaissance des conflits)
- docs/finance-f2.2-tresorerie.md

Frontend :

- src/app/(layout-pages)/finance/actions.ts
- src/app/(layout-pages)/finance/FinanceDashboard.tsx
- src/app/(layout-pages)/finance/EditCaisseDialog.tsx
- src/app/(layout-pages)/finance/caisses/[id]/CaisseDetail.tsx
- src/components/finance/CaisseCard.tsx
- src/app/(layout-pages)/dashboard/actions.ts
- src/app/(layout-pages)/dashboard/AnalyticsDashboard.tsx
- src/app/(layout-pages)/dashboard/ClientStatsCards.tsx
- src/app/(layout-pages)/dashboard/revenue-chart-card.tsx

Les modifications locales des phases précédentes ont été inspectées et conservées ; le diff Git global ne représente pas uniquement F2.2. Les écritures frontend ont vérifié les empreintes des fichiers avant application. Aucun changement Prisma/package/npm/permission ou de module hors périmètre.

## H — Vérifications et recette restante

Réalisé : TypeScript backend production (`node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false`), TypeScript frontend (`node node_modules/typescript/bin/tsc --noEmit --incremental false`), git diff --check dans les deux dépôts, tous réussis. Une erreur intermédiaire de typage du reduce sur une liste conditionnelle a été corrigée explicitement sans any ni affaiblissement des types.

Inspection statique : producteurs et scripts, verrous ordonnés, état des comptes sous verrou, agrégations exactes, exclusion des transferts, absence d'écriture miroir, retries bornés, immuabilité historique, séparation des devises, permissions F1/F2.1 et absence de modification de la modale. L'inspection réelle PostgreSQL porte uniquement sur les devises/comptes/relations décrits en B.

Recette préparée, NON exécutée : sur une base isolée avec AVOCAT et COMPTABLE actifs, créer plusieurs comptes de chaque type ; effectuer entrée/sortie/dépense ; tester transfert banque vers caisse et entre caisses ; vérifier les soldes exacts avant/après, trésorerie inchangée par transfert et absence d'impact sur les dettes clients. Vérifier refus pour compte inactif/inexistant, même compte, devises différentes (notamment XOF/XAF et FCFA/XOF), précision excessive, date invalide et solde insuffisant.

En concurrence réelle, lancer simultanément deux sorties, dépense 70000 et transfert 60000 sur 100000 disponibles, deux transferts opposés, encaissement/désactivation, dépense/suppression et modification du solde initial/nouvelle écriture. Vérifier sérialisation ou refus exploitable, aucune écriture partielle, solde non consommé deux fois, aucun deadlock non géré et mêmes soldes dans liste/détail/dashboards. Rejouer la même dépense avec sa clé puis avec un compte/montant différent : un mouvement puis 409, sans doublon.

Vérifier les limites de période F1, valeurs null distinctes de zéro, totaux par devise, protection de type/devise/solde initial avec historique, suppression sans historique/solde, modale F2.1 et rôles non habilités. Les tests automatisés n'ont pas été lancés conformément à la demande ; leurs mocks de transactions peuvent nécessiter une adaptation aux nouveaux appels groupBy/$queryRaw lors d'une future campagne autorisée.

Avant normalisation FCFA : validation métier individuelle et preuve de restauration nécessaires. Avant clôture de la fiabilisation concurrente : recette authentifiée et simultanéité réelle sur environnement isolé nécessaires. Aucune de ces validations n'est présumée acquise.
