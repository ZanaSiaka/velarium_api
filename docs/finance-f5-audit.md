# F5 — Traçabilité, audit et décisions avant recette

Date : 17 novembre 2026. Statut : corrections techniques réalisées ; recette authentifiée non exécutée ; décisions métier et persistance d'idempotence générale en attente. Les modifications locales F1–F4 préexistantes sont conservées. Aucune migration créée/appliquée, aucun mouvement réel créé, aucune donnée historique modifiée.

## A. Audit initial

Sources examinées : schéma Prisma (MouvementFinance, Caisse, Facture/LigneFacture, Paiement, Provision, ImputationProvision, FraisOuvertureDossier, RecuEncaissement, PieceJointeFinance, ActivityLog), FinanceService/Controller/Attachments/PermissionService, FacturesService/Controller, ProvisionsService/Controller, PaiementsService/Controller, RecusController, DossiersService/Controller, ActivityLogService, S3Service, DocumentsService D2, UserPiecesService pour le risque de signature indirecte, DashboardService, helpers billing/financial-read/treasury, actions Finance et FinanceAttachmentsDialog, modale MouvementDialog F2.1, documentation F3/F4 et scripts historiques dry-run.

Les scripts historiques proposent des comptes candidats et utilisent des sommes numériques approximatives. Ils ne sont pas utilisés pour F5 : ils ne constituent ni une preuve d'affectation ni une base suffisante pour créer des écritures. Le nouveau script d'audit réutilise les lecteurs Decimal F3 et impose READ ONLY dans PostgreSQL.

### Mécanismes disponibles

| Objet | Traçabilité existante | Limite initiale |
| --- | --- | --- |
| MouvementFinance | userId, createdAt, date métier, montant Decimal, source/catégorie, références, compte(s), dossier, relations inverses | devise portée par compte ; journal numérique sans chaîne exacte |
| Facture | numéro unique, lignes, dates, dossier/client ; auteur dans ActivityLog | pas d'auteur dédié dans Facture ; journal fiscal non exact |
| Paiement | date, createdAt, montant, lien unique mouvement, facture | auteur/devise via mouvement ; historique sans mouvement incomplet |
| Provision | dates, montant, lien unique mouvement, dossier | auteur/devise via mouvement ; journal d'encaissement manquant |
| ImputationProvision | auteur, date, facture/provision, unicité du couple | retrait physique existant sans trace de l'auteur du retrait |
| FraisOuvertureDossier | dossier unique, montant, statut, liens uniques facture/mouvement | journal Dossier après transaction, pas de trace financière dédiée atomique |
| RecuEncaissement | numéro unique REC, auteur, dates, mouvement unique, compte libellé et montant | pas de preuve autonome que les historiques sans mouvement sont impayés |
| PieceJointeFinance | uploader/date, mouvement, clé unique | métadonnées déclaratives, taille optionnelle, absence de confirmation signée/HEAD |
| ActivityLog | auteur, horodatage, type/id/dossier et JSON ; écriture possible dans transaction | journal applicatif non inviolable face à un administrateur SQL ; pas de consultation financière détaillée spécialisée |

### Immutabilité

Aucune route de modification/suppression des mouvements, paiements ou factures n'a été identifiée dans les contrôleurs examinés. PaiementsController ne propose que la lecture. Les comptes ne peuvent plus réécrire leur devise/solde initial/type avec historique selon F2.2 ; suppression d'un compte avec historique refusée. Ces protections applicatives ne sont pas des triggers SQL d'immutabilité.

Le retrait d'imputation `DELETE /api/provisions/:id/imputations/:imputationId` existe : suppression de l'imputation et recalcul du statut de facture sous verrous. F5 conserve ce comportement F3, mais enregistre transactionnellement la suppression et son auteur. Le motif obligatoire et la substitution par une contrepassation exigent une décision métier : non ajoutés implicitement. Aucun nouvel endpoint d'annulation ni catégorie comptable créé.

Les cascades Prisma peuvent supprimer des descendants lors d'une suppression directe d'un parent en SQL. Aucun verrouillage d'administration SQL ou migration de FK n'est ajouté. Les justificatifs restent supprimables selon les permissions existantes : conservation obligatoire/rétention nécessitent validation.

## B. Corrections de traçabilité

- FinanceService : journal du mouvement enrichi de montant exact, devise et date métier ; même transaction que le mouvement.
- FacturesService : montants HT/TVA/TTC exacts dans le journal de création ; devise/date métier dans le journal de paiement. Les anciens champs de journal restent présents.
- ProvisionsService : journal transactionnel d'encaissement avec mouvement/reçu/compte/devise/montant exact ; journal d'imputation sans nouvel encaissement ; avant suppression, conservation atomique de l'imputation originale (auteur/date/montant/liens), auteur du retrait et statuts de facture avant/après. L'auteur est transmis par le contrôleur authentifié et requis par le service de retrait.
- DossiersService : trace financière des frais d'ouverture dans la transaction dossier/mouvement/frais/reçu, sans modifier le journal métier Dossier existant ni ses lecteurs.
- ActivityLogService : exclusion des entités/actions financières du journal générique pour les rôles dépourvus de `canViewAudit`, en réutilisant FinancePermissionService. Métadonnées brutes toujours absentes de cette projection. Historique Dossier AVOCAT et KYC inchangés.
- Justificatifs : enregistrement et trace de dépôt atomiques ; intention de suppression persistée avant tout appel R2, afin de conserver la trace d'une tentative même en cas d'échec/crash.

Les traces ne recalculent pas les montants métier et ne remplacent pas les liens existants. Aucun backfill des journaux anciens. Les auteurs historiques absents restent inconnus. Une trace de suppression demandée ne signifie pas que la suppression R2/SQL a réussi.

## C. Idempotence HTTP

| Endpoint créateur | Couverture actuelle | Protection distincte à ne pas confondre avec l'idempotence |
| --- | --- | --- |
| POST /finance/dossiers/:dossierId/depenses | Oui, clé UUIDv4 obligatoire | ID mouvement `dossier-expense-<clé>` persistant |
| POST /finance/mouvements, y compris transferts | Non | Serializable, verrous comptes, contrôle de solde |
| POST /factures | Non | numéro FACT unique et verrou annuel/dossier |
| POST /factures/:id/paiements | Non | verrou compte puis facture, refus du dépassement |
| POST /provisions | Non | reçu REC unique, transaction atomique |
| POST /provisions/:id/imputations | Pas de rejeu HTTP conservé | couple provision/facture unique, verrous, disponible/solde |
| POST /dossiers, frais d'ouverture inclus | Non | atomicité dossier/mouvement/frais/reçu ; référence Dossier distincte de FACT/REC |
| POST /finance/caisses | Non | transaction de création uniquement |
| POST .../pieces-jointes | Anti-rejeu, pas rejeu du résultat | confirmation signée, storageKey unique, répétition => 409 |
| POST /factures/preview et presign justificatif | Sans écriture comptable | preview sans écriture ; presign ne crée pas de pièce ni de mouvement |

### Dépense D3/F2.1 réutilisée sans modification

La clé est unique au niveau de l'installation indépendante du cabinet, et non par utilisateur : une collision avec un autre auteur/dossier produit 409, sans retourner son résultat. Le contenu comparé est dossier, auteur, type SORTIE, compte, catégorie, montant Decimal, motif trim et date métier. Même clé/contenu => même `{id}`, sans seconde trace ou écriture. Permissions et utilisateur actif sont contrôlés avant le rejeu. La reconfiguration ultérieure du compte ne recrée pas la dépense originale.

Résultat et identité sont conservés par le mouvement, sans expiration applicative. P2002/P2034/SQLSTATE 40001/40P01 sont repris dans la transaction bornée F2.2 ; le résultat incertain final est un conflit explicite. La modale conserve la clé et le formulaire après résultat incertain tant que son instance reste montée. Elle n'offre pas de reprise persistante après rechargement complet du navigateur ; pas de garantie pour une nouvelle clé. Les doublons humains restent possibles et parfois légitimes.

### Proposition à valider, aucune modification Prisma

Un registre durable dédié est nécessaire pour généraliser correctement le contrat aux paiements, provisions, transferts et créations de dossier, sans détourner les références métier ou ActivityLog en registre de verrouillage.

Schéma minimal proposé (documentation uniquement) :

```prisma
model FinancialRequest {
  id            String   @id @default(cuid())
  cabinetScope  String
  userId        String
  operation     String
  requestKey    String
  requestHash   String
  resourceIds   Json
  response      Json?
  responseCode  Int
  createdAt     DateTime @default(now())
  expiresAt     DateTime
  @@unique([cabinetScope, userId, operation, requestKey])
  @@index([expiresAt])
}
```

À préciser après validation : relation vers User et politique de conservation du compte/scope. CabinetScope est configuré côté serveur pour cette installation indépendante, jamais fourni comme autorité par le navigateur ; aucune nouvelle organisation ni rôle requis.

Stratégie proposée :

1. Vérifier acteur actif et permissions actuelles avant lecture/rejeu ; borner la clé ; déterminer opération et ressource cible côté serveur.
2. Canonicaliser les champs métier validés (Decimal exact, date, cible, compte, moyen, référence, notes). Distinguer champ absent, null et valeur. Une date par défaut omise reste un marqueur canonique, puis sa valeur effective est conservée avec le premier résultat, sans recalcul au rejeu.
3. Hash SHA-256 canonique ; même scope/auteur/opération/clé avec hash différent => 409. Pas d'égalité fondée sur montant/date seuls.
4. Réserver la clé dans la même transaction Serializable que les écritures et le résultat ; conserver l'ordre de verrous comptes/factures/provisions et FACT/REC. Une tentative concurrente attend ou reçoit un conflit explicite ; après commit le rejeu rend le résultat validé.
5. Rollback => aucune opération ni réservation validée. Timeout réseau après commit => résultat récupérable. Ne pas mémoriser une panne transactionnelle comme succès.
6. Conserver une réponse minimale autorisée, sans URLs signées ni secrets ; rejouer son statut HTTP et ses identifiants/montants exacts. Les URLs de lecture privées sont redemandées avec les permissions actuelles.
7. Proposition de rétention à discuter : réponse pendant 30 jours, puis tombstone clé/hash/identifiants empêchant un rejeu tardif en nouvelle opération ; pas de purge automatique avant décision du cabinet. Durée et comportement après expiration font partie du contrat à valider.

Ce registre et sa migration ne sont ni créés ni appliqués. Un cache mémoire, un bouton désactivé, un verrou annuel ou une simple recherche de même montant ne constituent pas une alternative durable.

## D. Justificatifs privés

Formats inchangés : PDF, JPEG, PNG, WebP ; 1 octet à 10 Mio. Réutilisation de S3Service et des primitives D2, sans nouveau stockage. Relations inchangées : PieceJointeFinance appartient à un MouvementFinance ; paiements, provisions, frais et transferts passent par ce mouvement. Une imputation sans encaissement nouveau n'a pas de nouveau mouvement à créer pour y attacher artificiellement une pièce.

Contrat sécurisé : presign exige taille et acteur authentifié ; réponse additive `{uploadUrl, storageKey, uploadToken, headers}`. Confirmation du dépôt exige `uploadToken`, type et taille correspondant au fichier préparé. HMAC séparé de D2, expiration cinq minutes, lié à l'auteur, mouvement, clé, nom, taille et MIME. Le PUT signe longueur/type/If-None-Match et interdit l'écrasement de la clé. HEAD R2 vérifie présence/taille/MIME avant insertion. Clé d'une autre opération ou jeton altéré/autre auteur => refus ; doublon confirmé/concurrent => 409.

Le frontend réutilise FinanceAttachmentsDialog et transmet le jeton ainsi que les en-têtes renvoyés ; aucune refonte de la modale F2.1. Les anciens écrans ouverts doivent être rechargés après déploiement ; les confirmations sans jeton sont désormais refusées.

Lecture et suppression exigent une clé confinée au mouvement. Les signatures de lecture privées expirent en cinq minutes et portent no-store, nom encodé et type imposé. Les relais génériques S3 ne peuvent plus signer ou supprimer une clé `finance/` : cela ferme la possibilité de détourner une pièce utilisateur à clé déclarative pour demander une signature financière. Les fichiers utilisateurs ordinaires et sanctions ne changent pas de politique.

Permissions effectives conservées : AVOCAT et COMPTABLE selon FinancePermissionService (les anciens commentaires « comptable uniquement » étaient inexacts). Pas de rôle ajouté. JWT vérifie les comptes actifs ; l'ajout vérifie aussi l'acteur persistant. Les réponses de lecture des pièces ont Cache-Control private/no-store.

Limites : MIME et taille HEAD ne sont pas une analyse de signature binaire/antivirus. Aucune garantie de versioning/rétention immuable du bucket n'est présumée. R2 et PostgreSQL ne partagent pas une transaction : un PUT réussi non confirmé peut rester orphelin ; une suppression R2 suivie d'un échec SQL laisse une métadonnée sans fichier, avec intention journalisée. Aucun nettoyage automatique ou suppression réelle effectué. La configuration CORS R2 doit autoriser les en-têtes Content-Type/If-None-Match et le PUT, à vérifier en recette isolée. La présence d'un bucket privé doit être prouvée en console, pas déduite du code.

## E. Historique actualisé en READ ONLY

Commande exécutée : `node node_modules/tsx/dist/cli.mjs scripts/finance-f5-audit.ts`. Transaction PostgreSQL RepeatableRead avec `SET TRANSACTION READ ONLY` avant les SELECT et contrôle `SHOW transaction_read_only = on`. Aucune donnée écrite ; export local exclusif sans écrasement. Pas d'appel aux services métier, pas de tests automatisés.

Volumes observés : 20 factures, 16 provisions, 10 paiements, 15 lignes de frais, 7 comptes, 23 mouvements.

| Constat | Nombre | Qualification |
| --- | ---: | --- |
| Paiements sans mouvement | 8 | lien absent confirmé ; donnée incomplète, encaissement réel inconnu |
| Paiement lié non réconcilié | 1 | ambiguïté montant/type/source/devise à vérifier |
| Provisions sans mouvement | 11 | donnée incomplète, pas preuve d'impayé |
| Provisions liées historiquement à factureId | 4 | montant affecté non démontré |
| Provisions à lecture d'imputation ambiguë | 4 | chevauche les 4 précédentes, ne pas additionner les catégories |
| Frais PAYE sans mouvement direct | 2 | à qualifier selon justificatifs et éventuel règlement via facture |
| Dépassements arithmétiques non réconciliés | 2 | pas un excédent de trésorerie confirmé |
| TVA non reconstituable depuis les types de lignes | 11 | décision/qualification fiscale, aucune erreur fiscale affirmée |
| Statuts stockés différents de la lecture F3 | 7 | passage du temps possible ; aucune correction automatique |
| Comptes historiques FCFA | 3 | décision de normalisation requise |
| Mouvement partagé entre plusieurs origines métier | 0 | aucun trouvé dans ce périmètre |
| Groupes de mouvements similaires | 0 | aucun trouvé par l'heuristique décrite dans le script |
| Excédent reconnu par F3 / divergence montants-lignes / imputation hors dossier | 0 | aucun trouvé, pas certification exhaustive de la comptabilité |

Registre confidentiel local : `.temp/finance-f5-anomalies-1794910708043.json`. Il est pseudonymisé, pas irréversiblement anonymisé : identifiants techniques nécessaires conservés, aucun nom/client, coordonnée, référence métier, URL, clé R2 ou secret. Ne pas publier ni committer. Aucun endpoint d'anomalies exposé.

L'audit produit des compteurs par qualification ; les constats peuvent se chevaucher. Deux opérations égales en montant/date/compte peuvent être légitimes. Le script avertit seulement et ne choisit aucun compte, ne fusionne ni ne supprime rien. Les 2 frais ne sont pas déclarés impayés. Le script sait classer une situation historique via facture réconciliée comme valide ; cela ne généralise pas cette qualification aux autres cas.

### Procédure de régularisation proposée — non exécutée

1. Ouvrir un dossier de contrôle interne à accès Finance habilité ; conserver identifiants et état exact avant intervention, snapshot daté des soldes et pièces privées. Décision du cabinet documentée, auteur/date/motif et visa indépendant recommandé (séparation d'approbation à valider, sans nouveau rôle).
2. Collecter reçu original, relevé bancaire/caisse/mobile, preuve de dépôt, facture, date de valeur et auteur ; vérifier compte et devise réellement utilisés, historique des désactivations. Ne jamais déduire le compte du seul moyen de paiement.
3. Chercher toutes les opérations, références, reçus, clés de pièces et affectations liées. Un mouvement existant correspondant peut nécessiter un rattachement plutôt qu'une nouvelle entrée ; vérifier unicité inverse, montant, source, dossier, devise et allocations. Similitude seule insuffisante.
4. Déterminer explicitement l'effet financier attendu. Une ancienne entrée déjà comprise dans le solde initial ne doit pas être ajoutée une deuxième fois. Séparer absence de trace, absence réelle de paiement et provision non imputée. Ne pas convertir FCFA/XOF implicitement.
5. Présenter un plan unitaire au cabinet : avant/après prévu par compte, facture, provision et reçu, pièces probantes, risques de doublon et stratégie autorisée. Toute modification de trésorerie historique exige accord explicite. Une contrepassation doit définir sens, devise, source, lien à l'original et impacts fiscaux avant tout développement.
6. Reproduire d'abord sur une copie isolée restaurable. Vérifier sauvegarde/point de restauration réellement disponible, pas supposé ; fixer fenêtre et responsables. Aucun script dry-run existant ne doit être transformé automatiquement en exécuteur.
7. Après autorisation d'une correction précise : transaction bornée, relecture et verrous actuels, contrôle que l'état approuvé n'a pas changé, clé anti-double-exécution et journal de décision dans la transaction. Le mécanisme concret reste à concevoir/valider selon le cas, sans exécuteur général F5.
8. Recontrôler soldes et leurs écarts attendus, facture/provision/reçu, fiche Dossier, Finance et Dashboard en tenant compte de leurs périmètres ; archiver preuves avant/après. Nouvelle erreur => nouvelle décision traçable, pas de suppression silencieuse.

## F. Recette et cohérence des écrans

Plan détaillé : `docs/finance-f5-recette.md`. Scénarios exécutés : aucun scénario authentifié, aucune concurrence réelle, aucun upload/suppression R2, aucune création de donnée fictive ou réelle. Seul l'audit PostgreSQL READ ONLY décrit ci-dessus est exécuté.

L'isolation Neon, la branche, les comptes de test, le bucket R2 de test et la restauration ne sont pas démontrés dans cette intervention. Le plan reste préparé sans exécution tant que ces preuves et l'autorisation de recettes sur l'environnement dédié ne sont pas réunies.

Finance/Dossier partagent les lecteurs F3/F4 pour les factures et provisions. Les soldes viennent des mouvements et du solde initial, pas des paiements historiques sans mouvement. Le Dashboard conserve une couche de compatibilité historique, une fenêtre temporelle sur les flux et un encours facture global ; ses lectures legacy sans devise entraînent une indisponibilité du total de flux. Il ne faut donc pas forcer l'égalité entre le Dashboard, un dossier et le solde des comptes. F5 ne change pas ces règles ni leurs formules.

Limite F4 conservée : livre et dépenses sont chargés séparément ; pas d'instantané commun sous concurrence, ni transaction longue pour l'affichage. L'audit ponctuel utilise son propre instantané en lecture seule, sans modifier la stratégie de l'application.

## G. Vérifications techniques

Résultats des contrôles finaux :

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| TypeScript backend production | `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false` | Réussi, code 0 |
| TypeScript frontend | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Réussi, code 0 |
| Diff backend | `git diff --check` | Réussi, code 0 |
| Diff frontend | `git diff --check` | Réussi, code 0 |

Git signale uniquement des avertissements LF/CRLF sur des fichiers du travail local. L'audit READ ONLY a également émis des avertissements du pilote PostgreSQL sur l'évolution future de sslmode et les requêtes parallèles sur une connexion ; aucune désactivation TLS ou mise à jour de dépendance effectuée. Aucune suite Jest ou automatisée autorisée/lancée. Une compilation réussie n'atteste ni la compatibilité CORS R2 réelle, ni les courses réseau, ni l'absence de régression fonctionnelle.

### Fichiers de cette intervention F5

Backend modifié : `src/common/s3/s3.service.ts`, `src/modules/activity-log/activity-log.service.ts`, `src/modules/dossiers/dossiers.service.ts`, `src/modules/factures/factures.service.ts`, `src/modules/provisions/provisions.controller.ts`, `src/modules/provisions/provisions.service.ts`, `src/modules/finance/finance.controller.ts`, `src/modules/finance/finance.service.ts`, `src/modules/finance/finance-attachments.service.ts`, `src/modules/finance/dto/create-finance-attachment.dto.ts`, `src/modules/finance/dto/presign-finance-attachment.dto.ts`.

Backend créé : `src/modules/finance/finance-upload.ts`, `scripts/finance-f5-audit.ts`, `docs/finance-f5-audit.md`, `docs/finance-f5-recette.md`. Export confidentiel local ignoré par Git dans `.temp`, sans publication API.

Frontend modifié uniquement : `src/app/(layout-pages)/finance/actions.ts`, `src/components/finance/FinanceAttachmentsDialog.tsx`. Leurs empreintes ont été vérifiées avant écriture pour préserver les modifications préexistantes. Aucun changement de MouvementDialog (modale F2.1), des composants F4 ou du formulaire Finance général dans F5.

Les verrous F2.2 (comptes triés, contrôles de soldes, Serializable et retry borné), F3 (facture puis provision, numérotation FACT/REC sous verrous consultatifs), règles de paiement et imputations restent inchangés. Les journaux nouveaux font partie de leurs transactions : un échec de journal entraîne le rollback métier associé.

## H. Décisions attendues

1. Valider ou ajuster FinancialRequest, périmètre des clés, rétention et rejeu expiré, puis autoriser une migration additive séparée. Pas d'idempotence générale présentée comme acquise.
2. Valider motif obligatoire et traitement du retrait d'imputation, éventuelle contrepassation et conservation des justificatifs. En attendant, comportement existant conservé avec traces supplémentaires.
3. Qualifier individuellement les anomalies et autoriser chaque correction historique affectant la trésorerie. Aucune sélection automatique de compte.
4. Décider d'une normalisation FCFA/XOF et d'un contrôle des soldes initiaux, hors de cette intervention.
5. Fournir un environnement Neon/R2 réellement isolé et une restauration démontrée avant recette. F5 ne peut pas être déclaré fonctionnellement validé avant cette étape.
