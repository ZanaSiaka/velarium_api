# R1 — Préparation de la recette financière

Date : 17 novembre 2026. **Décision de départ : NE PAS COMMENCER la recette financière.** La disponibilité locale et les contrôles statiques sont satisfaisants, mais la restauration, le périmètre R2 et l'état actuel du schéma en base ne sont pas attestés.

R1 conserve la base Neon actuelle pour développement et recette, conformément à la décision du cabinet : elle contient uniquement des données de développement/test selon sa déclaration. Aucune nouvelle base ni branche n'est demandée ou créée. La future base principale sera distincte ; aucun transfert automatique des données fictives n'est autorisé.

Documents réutilisés : [audit F5](finance-f5-audit.md) et [recette F5](finance-f5-recette.md). Les scénarios C/D/F/P/R/I/S et leurs résultats attendus restent inchangés et **NON EXÉCUTÉS**. R1 remplace seulement l'ancien prérequis d'une nouvelle branche/base de test par l'usage contrôlé de la base actuelle. Les exigences de restauration, de maîtrise des intégrations et d'autorisation d'écriture restent obligatoires.

## A. Architecture et configuration actuelle

### Backend et frontend

- NestJS : `src/main.ts`, préfixe `/api`, port configuré correspondant à 2026, écoute `0.0.0.0`. Le service est joignable en local. Cette écoute ne constitue pas une isolation réseau ; vérifier pare-feu/exposition avant recette. CORS autorise les deux origines locales et une origine Vercel distante déjà présente ; aucune règle modifiée.
- Prisma : `prisma.config.ts` et `src/prisma/prisma.service.ts` utilisent `DATABASE_URL`. Client généré par `prisma-client` dans `generated/prisma`, adaptateur PrismaPg, provider PostgreSQL. `main.ts` et la CLI Prisma chargent dotenv. Une variable héritée du processus peut prendre priorité sur `.env` : la configuration sur disque n'est pas une preuve de l'environnement effectif du processus déjà lancé.
- Next.js App Router : `next.config.ts` minimal ; `postcss.config.js` utilise `@tailwindcss/postcss`. Scripts locaux `next dev`, `next build`, `next start`. Aucun serveur démarré, arrêté ou redémarré par R1 ; les deux services étaient déjà accessibles.
- `src/lib/api-client.ts` frontend fixe actuellement `http://localhost:2026/api`. `API_URL` dans `.env.local` correspond à cette cible lors du contrôle, mais **n'est pas la source utilisée par ce module**. Actions Finance, Auth Credentials, relais import et sanctions réutilisent ce client. Avant production, rendre cette cible configurable doit faire l'objet d'une intervention séparée ; R1 ne modifie aucun code.
- Auth : Nest JWT et vérification de l'utilisateur actif/son rôle persistant ; NextAuth Credentials délègue la connexion à `/auth/login` et transporte le token API dans la session. JWT valide sept jours selon AuthModule. Une compilation réussie ne valide pas les sessions ou les permissions en conditions authentifiées.
- Scripts backend : génération Prisma et compilation dans `build`, surveillance Nest avec mémoire Node 4 Go dans `start`/`dev`, seed utilisateur explicite disponible. Aucun script de démarrage/build ne doit être utilisé comme autorisation implicite d'un seed ; aucune génération, migration, seed ou installation npm exécutée pendant R1.

### Inventaire des variables — valeurs masquées

Fichiers détectés : backend `.env`, `.env.example` ; frontend `.env.local`. Aucun fichier d'environnement modifié. « Configuré » signifie valeur présente sur disque, pas service opérationnel ni secret de qualité démontrée.

| Projet/fichier | Variables | État / valeur |
| --- | --- | --- |
| API `.env` | DATABASE_URL, PORT, JWT_SECRET, WEB_URL | Configurées — `[MASQUÉ]` |
| API `.env` | S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY | Configurées — `[MASQUÉ]` |
| API `.env` | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, GOOGLE_CALENDAR_SCOPES, GOOGLE_PROJECT_ID | Configurées — `[MASQUÉ]` |
| API `.env` | GOOGLE_REDIRECT_URI, GOOGLE_TOKEN_ENCRYPTION_KEY, GOOGLE_OAUTH_STATE_SECRET | Absentes du fichier contrôlé ; attendues par le service Google |
| API `.env` | SANCTIONS_S3_BUCKET | Absent du fichier contrôlé ; stockage privé sanctions à vérifier séparément |
| API `.env.example` | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_TOKEN_ENCRYPTION_KEY, GOOGLE_OAUTH_STATE_SECRET, FRONTEND_URL | Exemples vides, pas une configuration effective |
| Front `.env.local` | API_URL, AUTH_SECRET, AUTH_URL | Configurées — `[MASQUÉ]` |
| API/front fichiers contrôlés | Variables SMTP | Non trouvées |

Contrôles locaux sans affichage des valeurs : JWT_SECRET et AUTH_SECRET distincts, chacun d'au moins 32 octets ; cela ne prouve ni leur entropie ni leur non-divulgation antérieure. WEB_URL local ; option TLS présente dans DATABASE_URL ; aucune désactivation TLS. Les variables absentes sur disque pourraient être fournies par un lanceur : leur absence effective à l'exécution n'est pas démontrée.

### Intégrations externes

Google Calendar est enregistré dans AppModule. Les noms attendus et présents diffèrent (`GOOGLE_CALLBACK_URL` vs `GOOGLE_REDIRECT_URI`) et les clés de chiffrement/état ne figurent pas dans `.env`. Ne pas connecter un calendrier réel ; vérifier les connexions déjà enregistrées avant les scénarios Dossier susceptibles d'impliquer événements/audiences. Aucun compte Google appelé/modifié.

Aucun transport SMTP n'a été trouvé dans les sources backend et les variables examinées. `AuthService.forgotPassword` persiste un token puis affiche le lien de réinitialisation dans les journaux, selon son comportement de développement actuel. Aucun appel de réinitialisation effectué ; les journaux doivent rester privés. L'absence de SMTP dans ces fichiers ne certifie pas l'absence d'intégration externe ailleurs dans un déploiement. Aucun e-mail envoyé.

## B. Neon : identité et preuves disponibles

La destination sur disque est un endpoint Neon. Pour la rapprocher de la console sans divulguer host, nom de base, utilisateur ni mot de passe, les empreintes suivantes sont les 16 premiers caractères du SHA-256 de la valeur indiquée (sans normalisation supplémentaire) :

| Élément masqué | Empreinte de rapprochement |
| --- | --- |
| Host de DATABASE_URL | `50801685ae112600` |
| Nom de base extrait de DATABASE_URL | `693fe5919fc229a2` |

Ces empreintes ne sont pas des identifiants de projet/branche Neon. L'endpoint ne permet pas, à lui seul, d'attester le nom humain de la branche, son statut root/child, le plan ou la fenêtre de restauration.

| Vérification | Résultat R1 |
| --- | --- |
| Décision d'usage test de la base actuelle | Confirmée par le cabinet dans la demande ; aucune base supplémentaire nécessaire |
| Endpoint Neon configuré | Vérifié statiquement et identifié par empreinte |
| Base réellement ouverte par le processus Nest existant | Non attestée par SQL pendant R1 ; éventuel environnement hérité non inspecté |
| Nom humain du projet/branche Neon | Non attesté ; rapprochement console nécessaire |
| Nom effectif de base / schéma courant / search_path | Non attestés par SQL ; Prisma n'explicite pas de schéma dans schema.prisma, ne pas en déduire le schéma réel |
| Migrations appliquées/échouées/en attente et checksums | Non actualisés pendant R1 |
| Colonnes/enums/contraintes réellement présents | Non actualisés ; TypeScript ne contrôle pas la base |
| Données fictives et utilisateurs disponibles aujourd'hui | Déclaration cabinet acceptée ; inventaire actuel non réalisé |

**Limitation explicite :** l'exécution du contrôle combiné PostgreSQL READ ONLY et métadonnées R2 a été refusée par l'utilisateur au niveau de l'autorisation d'outil. La commande n'a pas démarré. Aucune nouvelle lecture PostgreSQL/R2 n'a été tentée ensuite, via un autre script, outil ou console. Le script temporaire préparé a été retiré. Les seules lectures d'environnement ultérieures sont locales ; les requêtes HTTP locales sont non authentifiées, sans scénario financier.

Le dépôt contient **19 répertoires de migrations**, dont les ajouts client/contribuable, import, sanctions et `20261113000000_add_dossier_expense_categories`. Cette dernière contient uniquement trois `ALTER TYPE CategorieFinance ADD VALUE` pour RESTAURATION, COMMUNICATION et IMPRESSION_PHOTOCOPIE. Leur présence locale ne prouve pas leur application.

Le rapport F5 fournit une preuve antérieure de lecture seule sur la configuration alors utilisée : 20 factures, 16 provisions, 10 paiements, 15 lignes de frais, 7 comptes, 23 mouvements. Ce sont des observations **F5, non rafraîchies pendant R1**, pas un état de départ de recette. Les anomalies F5 restent inchangées ; aucun rattachement, solde, devise, statut ou TVA historique corrigé.

Pour lever le blocage : après nouvelle autorisation explicite de ces lectures, comparer `_prisma_migrations` aux fichiers locaux (finished/rolled_back/checksum), vérifier colonnes/enums et volumes dans une transaction READ ONLY, relever current_database/current_schema sans secret et faire confirmer le rattachement au projet/branche dans Neon. Aucun `migrate dev/deploy`, `db push/reset/seed` nécessaire pour cette vérification.

## C. Cloudflare R2

La configuration sur disque vise un endpoint Cloudflare R2. Valeurs réelles masquées :

| Élément | Empreinte SHA-256 tronquée |
| --- | --- |
| S3_BUCKET | `ab3c997ea5f2219d` |
| Host S3_ENDPOINT | `daceea6edb8b0b6f` |

S3Service utilise les accès configurés, région compatible R2, URLs signées de cinq minutes. Préfixes visibles dans le code : `dossiers/`, `finance/mouvements/`, pièces utilisateurs via leur module, `sanctions-private/` via stockage spécialisé. Le bucket sanctions est distinct dans le contrat du service et sa variable manque dans `.env` ; aucun repli vers un bucket financier n'est créé.

F5 réutilise PUT conditionnel signé (Content-Type, Content-Length, If-None-Match), jeton de confirmation lié à l'acteur/mouvement et HEAD de vérification taille/MIME. Lectures privées via endpoints autorisés ; signatures financières bloquées sur les chemins S3 génériques. FinancePermissionService reste la source des capacités AVOCAT/COMPTABLE. Aucune URL signée réelle générée dans R1.

**Non attestés :** existence/accessibilité actuelle du bucket, absence de fichiers réels, caractère privé (r2.dev, domaine personnalisé ou règle publique), droits effectifs du token, règles CORS, rétention/versioning et capacité de restauration des fichiers. L'utilisation de signatures dans le code n'apporte pas ces preuves. La lecture R2 prévue a été refusée ; aucune liste d'objets ni lecture de contenu effectuée.

Pré requis CORS à vérifier en console, sans changement R1 : origine exacte du frontend local utilisé, PUT et lectures nécessaires, en-têtes Content-Type/If-None-Match autorisés ; Content-Length est géré par le navigateur et doit correspondre à la signature. Si contrôle de taille/HEAD est impossible, ne pas affaiblir la confirmation F5 pour faire réussir la recette.

**Recette R2 bloquée.** Si le bucket est mixte/réel ou si son périmètre reste inconnu, demander une séparation de stockage approuvée : bucket de recette distinct ou stratégie d'isolation démontrée avec droits limités et sauvegarde. Aucun bucket ni règle CORS créé/modifié. Un préfixe seul ne prouve pas une isolation des accès.

## D. Sauvegarde et restauration

### Options documentées, disponibilité réelle inconnue

Neon documente la restauration à un point dans la fenêtre d'historique ; son applicabilité dépend notamment du type de branche et des possibilités du projet. Certains parcours conservent l'état précédent dans une branche de sauvegarde : leur utilisation demanderait une autorisation explicite, puisque R1 interdit la création automatique de branches. Aucun plan, fenêtre ou point restaurable de ce projet n'a été vérifié. Source : [Neon — Instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore).

Une archive logique `pg_dump`, restaurée par `pg_restore`, est une autre option documentée. Elle doit couvrir le schéma, les données et l'état des séquences, avec paramètres/propriétaires/droits pris en compte. Une simple liste d'archive ne prouve pas une restauration réussie. Source : [Neon — Backups with pg_dump](https://neon.com/docs/manage/backup-pg-dump).

`pg_dump`, `pg_restore` et `neonctl` n'ont pas été trouvés dans le PATH de cette session ; cela ne prouve pas leur absence totale du poste. Aucune installation, authentification console, sauvegarde ou restauration effectuée.

### Procédure proposée sur la base actuelle — à autoriser séparément

1. Faire confirmer projet, branche et endpoint par rapprochement des empreintes ; exclure toute future cible principale. Définir la fenêtre de recette et suspendre les écritures concurrentes de développement **après autorisation**, sans arrêter de processus dans R1.
2. Capturer un état T0 : heure UTC, version du code/diff local, versions des outils, schéma/migrations/checksums, volumes et empreintes des tables utiles, séquences, soldes exacts par compte/devise et relations financières. Conserver les données identifiantes dans un dossier privé chiffré, pas dans Git. Aucune correction des anomalies au T0.
3. Obtenir une preuve réelle de restauration : option Neon effectivement disponible et T0 dans sa fenêtre, ou archive logique complète chiffrée contrôlée. Préparer une connexion locale nommée sécurisée, sans mot de passe ou DATABASE_URL dans une commande publiée. Exemple documentaire de sauvegarde, **non exécuté et non prêt sans configuration de service préalable** : `pg_dump --dbname="service=velarium_recette" --format=custom --file="<dossier-prive>/velarium-avant-recette.dump"`. Aucun service de connexion n'a été créé.
4. Contrôler fin sans erreur, inventaire d'archive, checksum du fichier et accessibilité des clés de chiffrement. Définir la conservation, les droits d'accès et la destination exacts. Une exportation non restaurée n'est pas une garantie de reprise ; faire attester la procédure et ses limites avant d'autoriser les tests.
5. Choisir explicitement le retour à T0 **sur la base actuelle**, sans création d'une nouvelle base de test : restauration Neon disponible ou procédure logique approuvée. Une restauration logique sur une base remplie peut exiger des opérations destructives ; aucun `--clean`, DROP/TRUNCATE ou script de restauration n'est proposé comme commande immédiatement exécutable dans R1. Faire revoir le plan exact avant toute exécution.
6. Après recette autorisée, autoriser séparément la restauration, isoler les écrivains, confirmer une dernière fois la cible, exécuter le plan approuvé et conserver son journal. Ne pas réinitialiser manuellement des soldes ou supprimer des lignes QA en cascade pour simuler une restauration.
7. Refaire les mêmes contrôles T0 : migrations/schéma, comptes et soldes par devise, factures/paiements/provisions/imputations/frais/reçus, journaux, séquences et liens. Les numérotations et l'intégrité doivent correspondre au point restauré. Comparer aussi Finance/Dossier/Dashboard à périmètre égal.

PostgreSQL et R2 n'ont pas de restauration atomique commune : un dump SQL ne sauvegarde pas les objets. Définir un état documentaire T0, les pièces préexistantes à préserver et le traitement autorisé des seules pièces de recette. Sans isolation/retour R2 démontré, laisser les scénarios d'upload et de suppression bloqués même si PostgreSQL devient restaurable.

**Blocage global actuel : aucune sauvegarde ni capacité de restauration fiable attestée.** Les tests impliquant des écritures doivent attendre.

## E. Utilisateurs de recette

Les rôles nécessaires existent dans Prisma. FinancePermissionService autorise actuellement AVOCAT/COMPTABLE ; le JWT rejette les comptes inactifs. `POST /api/users` et `PATCH /api/users/:id` sont réservés à AVOCAT ; les mots de passe sont hashés par UsersService. La disponibilité de comptes dédiés n'est pas vérifiée en base pendant R1.

Instructions à exécuter ultérieurement, uniquement après restauration validée et autorisation de création :

| Compte fictif | Rôle / état | Préparation |
| --- | --- | --- |
| QA-F5-AVOCAT | AVOCAT actif | Créer avec adresse fictive unique et mot de passe dédié, sans contrat ni intégration réelle |
| QA-F5-COMPTABLE | COMPTABLE actif | Même procédure, vérifier accès selon capacités existantes |
| QA-F5-NON-FINANCE | JURISTE actif, par exemple | Vérifier refus financier côté API, pas seulement navigation cachée |
| QA-F5-INACTIF | JURISTE inactif | Créer un nouveau compte dédié puis mettre **uniquement cet ID** à active=false via PATCH autorisé |

Utiliser des adresses fictives du domaine réservé `.invalid`, identifiants uniques et mots de passe forts non réutilisés, transmis hors journaux/rapport. CreateUserDto requiert au moins huit caractères ; ne pas confondre ce minimum avec une recommandation de robustesse. Aucun compte actuel modifié ou désactivé, aucun mot de passe changé/réinitialisé et aucun utilisateur créé. Ne pas utiliser `forgotPassword` pour cette préparation.

## F. Prérequis des scénarios F5

Les statuts ci-dessous concernent la préparation, jamais la réussite. Plusieurs blocages peuvent se cumuler ; le blocage restauration s'applique à **toutes les écritures**, même si le code et les routes existent.

| Famille / scénarios conservés | État technique et classification | Actions avant exécution |
| --- | --- | --- |
| Contrôles locaux préalables (hors scénarios métier) | PRÊT TECHNIQUEMENT : services locaux accessibles, connexion/CSS répondent ; contrôles R1 effectués | Ce constat ne valide aucune opération financière |
| C01–C10 — comptes, entrées/sorties/transferts/soldes | BLOQUÉ PAR RESTAURATION + BLOQUÉ PAR DONNÉES DE TEST ; schéma effectif à confirmer | T0/restauration, comptes fictifs X1/X2/X0/XI/EUR, utilisateurs, devises/moyens contrôlés |
| D01–D05 — ouverture et dépenses, modale F2.1 | BLOQUÉ PAR RESTAURATION + BLOQUÉ PAR DONNÉES DE TEST | Vérifier enum catégories en base ; client/dossier dédiés, comptes sans historique réel à réutiliser |
| F01–F09 — factures, preview, paiements/restes/reçus | BLOQUÉ PAR RESTAURATION + BLOQUÉ PAR DONNÉES DE TEST ; cas historiques particuliers : BLOQUÉ PAR DÉCISION MÉTIER | Ne pas modifier les factures actuelles pour fabriquer les cas ; constituer un jeu approuvé séparé |
| P01–P08 — provisions/imputations/retrait/rollback | BLOQUÉ PAR RESTAURATION + BLOQUÉ PAR DONNÉES DE TEST | Plan d'opérations fictives, ne pas traiter les anciennes provisions ; retrait existant traçable à distinguer d'une nouvelle contrepassation |
| R01–R07 — concurrence réelle | BLOQUÉ PAR RESTAURATION + BLOQUÉ PAR DONNÉES DE TEST | Sessions indépendantes, barrière de départ et preuves des deux requêtes ; aucun test simultané R1 |
| I01–I06 — idempotence dépense | Code PRÊT TECHNIQUEMENT, exécution BLOQUÉE PAR RESTAURATION + DONNÉES DE TEST | Clés fixes et contenu canonique, compte/dossier dédiés, reprise sans changer de clé |
| I07 — autres endpoints sans registre | BLOQUÉ PAR DÉCISION MÉTIER pour toute garantie d'idempotence générale | FinancialRequest reste une proposition F5 ; aucun modèle/migration créé. Un constat de lacune n'est pas un succès d'idempotence |
| S01–S06, S10–S11 — pièces privées, upload/rejeu/suppression | BLOQUÉ PAR CONFIGURATION + RESTAURATION + DONNÉES DE TEST | Périmètre test du bucket, confidentialité, CORS, droits et retour documentaire attestés ; fichiers fictifs uniquement |
| S07–S09 — rôles, inactifs, appels directs, confidentialité | Routes/contrôles présents ; BLOQUÉ PAR DONNÉES DE TEST et prérequis de restauration pour préparer les comptes | Ne pas tester sur les utilisateurs actuels ; aucun accès authentifié réalisé |
| S12–S13 — cohérence écrans/Dashboard | BLOQUÉ PAR DONNÉES DE TEST + RESTAURATION | Opérations fictives identifiées ; comparer périodes/devises identiques, préserver indisponibilités historiques |

### Cartographie statique des routes et services

Toutes les routes ci-dessous sont préfixées `/api`. Présence dans le code vérifiée, exécution métier non vérifiée :

| Domaine | Contrats / fichiers réutilisés |
| --- | --- |
| Comptes/solde | GET/POST `/finance/caisses`, GET/PATCH/DELETE `/finance/caisses/:id` ; FinanceController/Service, lectures treasury |
| Entrées/sorties/transferts/historique | GET/POST `/finance/mouvements` ; source, destination et type TRANSFERT existants |
| Dépenses dossier | GET `/finance/comptes-depenses`, POST `/finance/dossiers/:dossierId/depenses`, GET mouvements filtrés ; MouvementDialog F2.1 à cinq champs, six catégories |
| Frais et livre Dossier | POST `/dossiers`, GET `/dossiers/:id/livre-paiements`, GET `/dossiers/:id/historique` ; DossiersService, dossier-finance-read, ActivityLogService |
| Fiche F4 | DossierSecondarySections, LivrePaiements, DossierExpenses ; six onglets conservés, montants exacts consolidés |
| Factures/paiements | GET/POST `/factures`, GET `/factures/:id`, POST `/factures/preview`, POST `/factures/:id/paiements`, GET `/paiements` ; FacturesService/billing |
| Provisions | GET/POST `/provisions`, POST `/provisions/:id/imputations`, DELETE `/provisions/:id/imputations/:imputationId` ; ProvisionsService/lectures F3 |
| Reçus | GET `/recus`, GET `/recus/:id/pdf` ; RecusService/FinancialDataGuard |
| Pièces F5 | presign et création/liste sous `/finance/mouvements/:id/pieces-jointes`, lecture/téléchargement/suppression sous `/finance/pieces-jointes/:id` ; FinanceAttachmentsService, finance-upload, S3Service |
| Capacités et journaux | GET `/finance/permissions`, FinancePermissionService, guards JWT/FinancialDataGuard/RolesGuard, journaux F5 dans transactions |

Verrous F2.2/F3 présents : comptes triés FOR UPDATE, transaction Serializable/retries bornés, ordre facture/provision et numérotation FACT/REC sous verrous consultatifs. Présence statique, pas validation de courses réelles. Idempotence persistante seulement pour dépenses F2.1 ; aucun mécanisme général revendiqué. KYC/historique D2 et projections sûres non modifiés. La limite F4 de lectures séparées livre/dépenses sous concurrence reste documentée ; aucune transaction longue d'affichage ajoutée.

## G. Vérifications effectuées pendant R1

| Contrôle | Résultat et portée |
| --- | --- |
| TypeScript backend production | `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false` : réussi, code 0 |
| TypeScript frontend | `node node_modules/typescript/bin/tsc --noEmit --incremental false` : réussi, code 0 |
| git diff --check backend/frontend | Réussi, code 0 ; avertissements LF/CRLF uniquement |
| TCP local 2026/3000 | Ouverts au moment du contrôle ; aucun processus arrêté/redémarré |
| GET `http://127.0.0.1:2026/api/auth/me` sans session | HTTP 401 attendu ; ne prouve pas la compatibilité du schéma PostgreSQL |
| GET `http://localhost:3000/auth/login` | HTTP 200 |
| Fichier CSS Next local référencé par cette page | HTTP 200, contenu non vide ; aucune erreur PostCSS observée sur ce parcours |
| GET `/finance`, `/honoraires`, `/dossiers` sans session | HTTP 307 ; cohérent avec la protection de session. Ni rendu authentifié ni données financières validés |
| Build Next complet / toutes les pages Turbopack/Webpack | Non exécuté ; pas d'absence globale d'erreur affirmée à partir d'une seule page |
| Migrations et PostgreSQL READ ONLY R1 | Non exécutés, autorisation refusée |
| R2 CORS/inventaire/confidentialité | Non vérifiés à distance, autorisation refusée |
| Connexion authentifiée / scénarios C/D/F/P/R/I/S | Tous NON EXÉCUTÉS |

Aucune suite Jest/automatisée lancée. Aucun login, reset de mot de passe, upload, suppression, sauvegarde, restauration, seed ou migration exécuté. Les GET non authentifiés de disponibilité ne sont pas la recette financière et n'invoquent aucune création métier.

Seul fichier durable ajouté par R1 : `docs/finance-r1-preparation.md`. Aucun fichier source, modèle Prisma, variable d'environnement, document F5 ou composant modifié ; travaux locaux conservés. Un fichier temporaire de contrôle non exécuté a été retiré. Aucun commit/push. Les serveurs peuvent produire leurs caches/journaux normaux lors des GET locaux ; aucun fichier généré n'a été édité manuellement.

## H. Checklist de décision

- [x] Décision cabinet : base actuelle de développement/test conservée, future production séparée.
- [x] Configurations locales inventoriées sans secret affiché ; empreintes de rapprochement disponibles.
- [x] Routes et mécanismes F1–F5 présents statiquement ; limites d'idempotence documentées.
- [x] TypeScript et diff-check réussis ; frontend et API accessibles sans session.
- [ ] Cible effective de Nest rapprochée du projet/branche/base Neon confirmés en console.
- [ ] État des migrations/checksums et schéma effectif vérifiés en READ ONLY avec autorisation.
- [ ] Inventaire T0 et données de recette dédiées identifiés sans modifier les historiques.
- [ ] Sauvegarde ou point restaurable **réellement attesté**, procédure de retour approuvée.
- [ ] Périmètre test, confidentialité, droits, CORS et retour R2 attestés — sinon scénarios R2 interdits.
- [ ] Intégrations Google/SMTP et logs maîtrisés, aucun compte/calendrier réel utilisé par la recette.
- [ ] Création des quatre utilisateurs et jeux fictifs autorisée séparément, sans toucher aux comptes actuels.
- [ ] Autorisation explicite du cabinet pour les familles de scénarios effectivement déblocables.

**Conclusion : NON PRÊT À COMMENCER LES ÉCRITURES DE RECETTE.** Un statut technique satisfaisant ne lève pas les cases restantes. Aucune demande de nouvelle base Neon de test.

## I. Prochaine étape et autorisations

1. Fournir ou autoriser séparément les preuves de console Neon (projet/branche/endpoint, capacité et fenêtre de restauration) et R2 (bucket, confidentialité, contenu test, CORS). Aucune lecture refusée n'est relancée implicitement.
2. Autoriser de nouveau, si souhaité, une commande explicite limitée aux lectures PostgreSQL READ ONLY et/ou métadonnées R2 pour lever les constats non attestés. Le refus précédent reste respecté tant que cette nouvelle autorisation n'existe pas.
3. Après choix de retour à T0 : autoriser la sauvegarde/export privé et toute éventuelle configuration locale d'outils, ou la préservation d'état via une option Neon effectivement disponible. Toute branche de sauvegarde créée par une restauration demanderait un accord distinct ; aucune branche automatique.
4. Si R2 est mixte/incertain : décider d'une séparation sécurisée de stockage et autoriser ses modifications éventuelles. En attendant, recette documentaire bloquée.
5. Ensuite seulement : autoriser la création des utilisateurs/données fictifs et l'exécution d'un lot précis C/D/F/P/R/I/S. R1 ne vaut pas autorisation de ces écritures.
6. Toute restauration, nettoyage, migration ou modification d'historique nécessitera encore son autorisation propre et un plan concret revu. FinancialRequest et les corrections comptables restent hors R1.

R2 et les tests financiers ne sont pas commencés. Aucune opération d'écriture distante n'est autorisée par ce rapport.

## J. Complément R1.1 — levée des points non attestés

Contrôle du 17 novembre 2026, après demandes d'autorisation distinctes effectivement acceptées pour PostgreSQL et R2. Cette section actualise les points R1 correspondants sans effacer la chronologie : le refus de R1 n'a pas été contourné ; les lectures ont été proposées et autorisées à nouveau pendant R1.1. Aucune fonctionnalité F1–F5 ni variable d'environnement modifiée.

### J.1. Contrôles réellement effectués

1. Relecture du rapport R1, vérification locale de FinancePermissionService, des outils disponibles et des seuls états de présence des variables de gestion. Aucun secret affiché.
2. Connexion PostgreSQL avec la configuration DATABASE_URL actuelle : transaction `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, contrôle `transaction_read_only = on`, lectures du contexte, de `_prisma_migrations`, des valeurs de CategorieFinance et compteurs agrégés d'utilisateurs, puis ROLLBACK. Aucune donnée personnelle, aucun mot de passe/hash ou token extrait dans le rapport.
3. Lecture READ ONLY complémentaire des deux checksums différents, comparaison locale des représentations UTF-8 avec/sans BOM et LF/CRLF. Aucun fichier de migration réécrit et aucune ligne de l'historique Prisma modifiée.
4. Consultations R2 autorisées : `GetBucketCors` et `ListObjectsV2` limité à 1 000 métadonnées, sans lecture de contenu. Les deux ont échoué avant réponse HTTP. Une seconde tentative autorisée des mêmes opérations a permis de relever uniquement le code d'erreur technique, sans message contenant de connexion sensible.
5. Aucun accès à une console de gestion Neon/Cloudflare, aucun login utilisateur, test financier, test de concurrence, upload, suppression, sauvegarde, restauration, création de compte ou migration. Les scripts temporaires de lecture ont été retirés après contrôle.

### J.2. Neon et migrations : résultats vérifiés

| Élément | Résultat R1.1 |
| --- | --- |
| Empreinte endpoint interrogé | `50801685ae112600`, identique à la configuration examinée en R1 |
| Empreinte base ouverte | `693fe5919fc229a2`, identique à la configuration examinée en R1 |
| Identifiant technique de branche fourni par PostgreSQL | **`br-frosty-sun-atlvrzr1`**, via `current_setting('neon.branch_id', true)` |
| Nom humain de branche, projet Neon, statut root/child | Toujours non attestés ; l'identifiant technique ne les démontre pas |
| Schéma effectif de cette connexion | **public** |
| Version PostgreSQL déclarée | **18.7** |
| Mode de transaction | **READ ONLY confirmé** |
| Migrations locales / appliquées avec succès | **19 / 19** |
| Migrations en attente | **Aucune** |
| Migration non terminée et non annulée | **Aucune** |
| Migration appliquée inconnue du dépôt | **Aucune** |
| Nouvelles catégories de dépenses | RESTAURATION, COMMUNICATION, IMPRESSION_PHOTOCOPIE **présentes en base** |

La branche interrogée est donc identifiée techniquement et rapprochée de la cible configurée. L'environnement interne du processus Nest déjà en cours n'a pas été extrait : le lien avec ce processus reste fondé sur sa configuration et ne constitue pas une attestation indépendante de ses éventuelles variables héritées.

**Checksums :** les octets des fichiers locaux de `20260713021625_init` et `20260713102259_add_user_active` ne correspondent pas directement aux checksums stockés. Pour chacun, la représentation **UTF-8 sans BOM, LF** du contenu local correspond exactement au SHA-256 enregistré dans `_prisma_migrations`. L'écart est donc expliqué par la représentation BOM/fins de ligne ; aucune divergence de contenu SQL n'est établie après neutralisation. Aucune commande `migrate resolve`, réécriture de fichier, modification de checksum ou migration exécutée. Une future commande Prisma peut néanmoins signaler cette différence brute : ne pas l'« arranger » automatiquement.

Ces vérifications établissent l'état de l'historique et la présence des trois valeurs d'enum. Elles ne constituent pas un diff exhaustif de toutes les colonnes, contraintes ou objets SQL, ni une validation fonctionnelle de tous les endpoints. Le nom de la base reste masqué comme dans R1.

### J.3. Sauvegarde et restauration : blocage maintenu

Aucune variable `NEON_API_KEY`, `NEON_PROJECT_ID` ou `NEON_BRANCH_ID` n'est présente dans `.env` ou le processus local d'inspection ; aucun connecteur de gestion Neon adapté n'a été découvert. `neonctl`, `pg_dump` et `pg_restore` ne sont pas résolus dans le PATH contrôlé. Cela ne prouve pas leur absence de tout le poste ni l'absence d'une session de console déjà ouverte ; aucune de ces sessions n'a été consultée.

La connexion SQL et l'identifiant de branche ne permettent pas d'attester le plan Neon, sa fenêtre d'historique, un point restaurable ni les permissions de restauration. **Aucune sauvegarde existante ni possibilité réelle de retour à T0 n'est confirmée.** La procédure proposée en section D reste une préparation, non une capacité vérifiée.

Preuve requise : console Neon en lecture, identifiant de branche ci-dessus rapproché du nom/projet, type root/child, fenêtre de restauration effectivement disponible, horodatage restaurable et droits de l'opérateur. Si un parcours de restauration génère une branche de sauvegarde, son utilisation nécessite une autorisation spécifique ; aucune nouvelle branche créée dans R1.1. Sinon, choisir et faire valider une procédure d'archive logique et de restauration sur la base actuelle, avec outils adéquats et preuve de reprise. Aucun export ou essai de restauration réalisé.

### J.4. R2 : échec de transport confirmé, configuration distante inconnue

Les deux opérations autorisées ont échoué avec **`UNABLE_TO_VERIFY_LEAF_SIGNATURE`**, sans code HTTP. Il s'agit d'un échec de vérification de chaîne TLS dans ce client ; cela ne permet pas de conclure que les identifiants R2 sont faux, que le bucket est absent, qu'il est public/privé ou que CORS est incorrect. L'origine de la chaîne non reconnue (poste, interception réseau ou chaîne du serveur) n'a pas été déterminée.

TLS n'a pas été désactivé, aucune variable ni autorité de certification n'a été ajoutée/modifiée. Aucun recours à un autre outil pour contourner cette vérification. Les avertissements SDK Node 20 concernant une exigence future de Node 22 et pilote PostgreSQL concernant l'évolution de sslmode ont été observés ; aucune mise à jour npm/Node ni changement TLS effectué.

`CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` ne sont pas présents dans `.env` ou le processus d'inspection ; aucun connecteur de gestion approprié n'a été découvert. Les clés S3 existantes ne prouvent pas un droit d'administration Cloudflare. Aucun token n'est demandé en clair.

Restent **NON ATTESTÉS** : nom rapproché du bucket configuré, contenu exclusivement fictif, r2.dev/domaine public désactivés, règles CORS exactes, périmètre du token, rétention/restauration des objets. Même un succès GetBucketCors/ListObjectsV2 ne prouverait pas à lui seul la confidentialité publique ni le caractère fictif du contenu.

Prochaine vérification précise à autoriser : consultation en lecture de la console Cloudflare du bucket correspondant à l'empreinte `ab3c997ea5f2219d`, avec paramètres d'accès public/domaines/CORS et périmètre des accès. Fournir une attestation du propriétaire sur les fichiers présents, sans publier leurs noms ou contenu sensibles. Une nouvelle tentative SDK nécessitera d'abord un diagnostic de confiance TLS autorisé, puis une nouvelle lecture ; aucune modification de CORS ou du bucket n'est incluse. Si les fichiers sont mixtes ou leur origine incertaine, la recette documentaire reste bloquée et la séparation sécurisée doit être décidée séparément.

### J.5. Utilisateurs et permissions : disponibilités vérifiées

Compte agrégé lu sur la branche identifiée ; aucune connexion avec ces utilisateurs ni modification effectuée :

| Rôle | Actifs | Inactifs | Comptes actifs nommés avec préfixe QA-F5- |
| --- | ---: | ---: | ---: |
| AVOCAT | 1 | 0 | 0 |
| COMPTABLE | 1 | 0 | 0 |
| COLLABORATEUR_ASSOCIE | 5 | 0 | 0 |
| SECRETARIAT | 2 | 0 | 0 |

Les rôles et deux comptes financiers actifs existent. Les rôles non habilités existent aussi. **Aucun utilisateur inactif n'est présent.** Aucun compte préfixé QA-F5- n'a été trouvé ; cela n'exclut pas des comptes de test nommés autrement. Leur caractère dédié, l'accord pour les utiliser et la disponibilité de leurs identifiants de connexion ne sont pas attestés. Aucun compte actuel n'est réaffecté arbitrairement à la recette.

Contrôle statique de FinancePermissionService : AVOCAT et COMPTABLE disposent des capacités financières, documentaires et d'audit concernées ; les autres rôles listés n'en disposent pas. Le JWT contrôle l'état actif côté serveur. Cette inspection ne remplace pas les scénarios authentifiés de permissions F5, qui restent NON EXÉCUTÉS.

Après autorisation et restauration attestée : soit identifier et faire approuver des comptes fictifs existants dédiés, soit créer les comptes QA décrits en section E. Le scénario inactif requiert un nouveau compte dédié inactif ; ne pas désactiver un utilisateur actuel pour fabriquer ce cas. Aucun mot de passe lu ou changé.

### J.6. Checklist actualisée et conclusion

| Prérequis | État après R1.1 |
| --- | --- |
| Base actuelle réservée développement/recette | Décision cabinet confirmée, maintenue sans création de base |
| Branche de la connexion configurée | Identifiant technique vérifié ; nom humain/projet/type à confirmer en console |
| Schéma courant et migrations | public, 19/19 appliquées, aucun échec actif/attente ; deux différences brutes de checksum expliquées par BOM/LF |
| Compatibilité des catégories de dépenses | Trois valeurs P2.1 vérifiées en base |
| Sauvegarde et retour fiable à T0 | **BLOQUÉ PAR RESTAURATION**, aucune preuve disponible |
| R2 confidentialité/CORS/contenu test | **BLOQUÉ PAR CONFIGURATION/PREUVES**, erreur TLS des lectures SDK |
| Utilisateurs de recette | Comptes/rôles actifs présents ; **BLOQUÉ PAR DONNÉES DE TEST**, aucun inactif ni compte dédié attesté |
| Idempotence HTTP générale | Toujours non implémentée ; **BLOQUÉ PAR DÉCISION MÉTIER** pour cette garantie, proposition FinancialRequest inchangée |
| Scénarios financiers F5 et concurrence | **Tous NON EXÉCUTÉS**, aucune famille autorisée à démarrer par R1.1 |

**Conclusion actualisée : NO-GO pour la recette financière.** Les blocages de restauration, de maîtrise du stockage et des utilisateurs dédiés ne sont pas levés. Les migrations appliquées et l'identification technique de branche ne suffisent pas à déclarer GO.

Autorisations/précisions nécessaires, séparées :

1. Lecture de console Neon pour confirmer projet/nom/type de la branche, point restaurable et procédure disponible, sans création/restauration. Une preuve de console fournie par le responsable, expurgée de secrets, peut aussi documenter ces éléments.
2. Lecture de console Cloudflare pour attester confidentialité, CORS et périmètre du bucket ; attestation du contenu fictif par son responsable. Aucun changement de règle ni accès au contenu n'est autorisé implicitement.
3. Diagnostic TLS R2 limité à l'inspection de la chaîne et de la confiance du poste ; toute modification de certificats/environnement exigerait un accord distinct. Ne jamais désactiver TLS pour poursuivre.
4. Après preuve de retour T0 : autorisation précise de sauvegarde/préservation d'état et, séparément, préparation des utilisateurs/jeux fictifs. La présente mission ne vaut pas autorisation d'écriture.
5. Puis autorisation d'un lot explicite de recette, avec les limites d'idempotence connues. Aucune migration, correction historique, FinancialRequest, nouvelle base/branche/bucket ou phase R2 commencé.

Vérification locale finale : `git diff --check`. TypeScript et tests non relancés pendant R1.1, car seules des inspections et cette documentation ont été effectuées ; les succès R1 restent des résultats datés, pas une nouvelle exécution R1.1. Aucun commit/push.
