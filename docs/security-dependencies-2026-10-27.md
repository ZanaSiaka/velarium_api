# Audit des dependances — 27 octobre 2026

## Etat de l'intervention

Diagnostic complet effectue sur les deux projets. La consultation supplementaire du registre puis la commande de mise a jour ciblee ont ete refusees par l'outil d'autorisation avant execution. Aucune installation ou modification des manifestes et fichiers de verrouillage n'a ete effectuee pendant cette intervention. Les corrections restent a appliquer et a valider. Aucune migration ou modification PostgreSQL.

Le fichier `npm-audit-2026-10-27.json` adjacent conserve les paquets, versions, chemins verrouilles, niveaux, plages affectees, correctifs proposes et liens des avis recuperes. Les alertes de paquets parents et enfants ne sont pas des failles independantes.

| Projet | Moderees | Elevees | Critiques | Total avant/apres |
| --- | ---: | ---: | ---: | ---: |
| velarium_api | 6 | 12 | 2 | 20 / 20 (aucune mise a jour) |
| velarium_front | 7 | 14 | 5 | 26 / 26 (aucune mise a jour) |

## Corrections prioritaires compatibles a preparer

| Paquet actuel | Origine / exposition | Cible issue des avis et compatibilite |
| --- | --- | --- |
| API: @nestjs/platform-express 11.1.27 -> multer 2.1.1 | Production, analyse des uploads dont P2; plusieurs DoS | Multer >=2.5.0. Le parent epingle 2.1.1: un simple update de Multer ne suffit pas. Preferer une version corrigee du parent dans NestJS 11 et aligner common/core/testing; sinon override cible et tests HTTP. Version exacte du parent a verifier sur le registre. |
| API: express 5.2.1 -> body-parser 2.3.0 | Production, requetes HTTP compressees | body-parser >=2.4.0, compatible avec le range ^2.2.1 du parent. |
| API: express -> proxy-addr 2.0.7 | Production, critique sous certaines configurations trust proxy IPv6 | 2.0.8, compatible avec ^2.0.7. Aucun trust proxy explicite trouve dans src; ne pas conclure a une exploitation prouvee. |
| Front: next 16.1.6 | Production: App Router, Server Actions, proxy et optimisation images; avis critiques dont Windows | L'audit propose 16.4.3; aligner eslint-config-next. Meme majeure, mais verifier engines, peers React/Auth.js, build et comportement des routes avant adoption. |
| Front: next-auth 5.0.0-beta.31 -> @auth/core 0.41.2 | Production, authentification | next-auth 5.0.0-beta.32 / core 0.41.3. Mettre a jour le parent, pas core isole. Verrouiller la beta exacte plutot que le tag mouvant beta. |
| Front: jspdf 4.2.1 -> dompurify 3.4.11 | Optionnelle de production; pas d'appel doc.html trouve, export PDF par autoTable | DOMPurify >=3.4.17 d'apres les plages affectees recues; mise a jour dans ^3.3.1, puis verifier PDF et absence de nouveaux avis. |
| API: @nestjs/swagger 11.4.5 -> js-yaml 4.3.0 | Production; aucun endpoint de lecture YAML utilisateur identifie | js-yaml >=4.3.2. Parent epingle 4.3.0: version corrigee de Swagger 11 a verifier, ou override cible. |
| API: ts-jest -> handlebars 4.7.9 | Developpement uniquement; seconde critique API, pas de rendu Handlebars metier trouve | 4.7.10 ou plus, hors plage <=4.7.9; verifier disponibilite, mettre a jour dans la majeure 4 et rejouer Jest. |

La faille Auth.js de controle par simple existence de auth n'est pas demontree dans le code inspecte: auth.config.ts teste auth?.user, et le relais P2 exige le jeton API et AVOCAT. Le fournisseur configure est Credentials, pas un fournisseur email/OAuth. Les mises a jour restent justifiees sans affirmer une compromission.

## Alertes et migrations a traiter separement

- **Zod 3.25.76**: aucun correctif 3.x propose; avis <4.6.6, npm propose 4.6.7. Migration majeure risquee, non executee. Les formulaires utilisent @hookform/resolvers 3.10.0 dont le resolver lit error.errors; ne pas remplacer globalement Zod par 4 sans resolver compatible et verification des schemas, coercitions, erreurs, types et PATCH P0/P1. Les schemas serveur inspectes sont principalement scalaires; un z.array de collaborateurs existe cote formulaire. Pas de schema serveur de collection contrainte vulnerable identifie par la recherche, ce qui ne prouve pas l'absence d'autres risques.
- **xlsx 0.18.5**: pas de correction sur la distribution npm auditee (fixAvailable=false). Correctifs upstream annonces >=0.19.3 (prototype pollution), >=0.20.2 (ReDoS). Utilise uniquement dans data-table.tsx pour json_to_sheet/book_new/book_append_sheet/write; aucune lecture de fichier via XLSX trouvee. P2 utilise yauzl/sax cote API. Conserver les exports et preparer une source officielle verifiee ou un remplacement limite avec tests d'export, sans suppression automatique de la fonctionnalite.
- **Prisma 7.8.0 / @prisma/config / deepmerge-ts / mysql2 / @prisma/dev**: chaine CLI developpement/optionnelle (devOptional dans le verrouillage), pas le pilote PostgreSQL metier. Prisma reste 7.8.0. Ne pas forcer deepmerge-ts 8 dans une dependance epinglee 7 sans validation. Aucune connexion MySQL metier trouvee.
- **shadcn 4.0.2** est declare dans dependencies, mais c'est un CLI. Il amene MCP SDK -> Express/proxy-addr/body-parser, browserslist, etc. Aucun import applicatif shadcn trouve. Le deplacer vers devDependencies reduit le contenu d'un deploiement --omit=dev sans corriger les failles d'outillage; envisager egalement une mise a jour compatible du CLI. Ne pas presenter cela comme une suppression des alertes.
- **sharp 0.34.5** via Next: avis corrige >=0.35.5. Preferer une version de Next embarquant cette branche; ne pas forcer une version 0.x potentiellement incompatible sans verification.
- **postcss** 8.4.31 via Next, 8.5.16 a la racine: corrige au-dela de 8.5.22 d'apres les avis. Preferer la mise a jour du parent Next puis de la version racine compatible.
- **source-map-js** 1.2.1: corrige >=1.2.2.
- **fast-uri** 3.1.3: les avis complets exigent 3.1.9, pas seulement 3.1.4 recommande dans le premier audit.
- Autres outils: brace-expansion (branches 1.1.21 / 2.1.7 / 5.0.12 selon le parent), browserslist (>4.28.6), baseline-browser-mapping (>=2.11.0), @hono/node-server (>=1.19.15), hono (>4.13.10), valibot (>1.4.1), postcss-selector-parser (>=7.1.6). Voir le JSON pour les chemins exacts; ne pas forcer toutes les branches vers une meme majeure.
- qs 6.15.3: correctif >=6.16.0.

## Sequence et validation restantes

1. Autoriser les installations ciblees en conservant la verification TLS et sans audit fix --force.
2. Mettre a jour NestJS 11/Express, puis verifier le verrouillage effectif de Multer, body-parser et proxy-addr. Utiliser --ignore-scripts pour eviter le postinstall Prisma automatique pendant la correction des dependances.
3. Mettre a jour Next/Auth.js et dependances compatibles du frontend. Verifier les engines et peers, conserver les modifications locales existantes et ne jamais fabriquer le lockfile manuellement.
4. Traiter les migrations Zod/xlsx dans une intervention preparee avec tests de contrats.
5. TypeScript API/front: tsc --noEmit --incremental false. Backend: jest --runInBand --no-cache. Frontend: node --test tests/dossier-creation.cjs tests/p1-contracts.cjs tests/client-import.cjs.
6. Tester sessions Credentials/JWT, gestion des erreurs et droits, preview/confirm multipart sans ecriture reelle en base (mocks), exports Excel/PDF et build Next sans acces metier a PostgreSQL.
7. Refaire npm audit --json complet et --omit=dev dans chaque projet; comparer les versions effectivement installees et les chemins de dependances. git diff --check dans les deux projets.
8. Redemarrer les serveurs apres mise a jour: un processus deja lance garde les anciennes dependances chargees.

## Validations executees pendant cette intervention

- TypeScript API et frontend: reussis avec --noEmit --incremental false.
- Backend: jest --runInBand --no-cache, 12 suites et 168/168 tests reussis, dont Auth et import P2 avec mocks.
- Frontend: node --test tests/dossier-creation.cjs tests/p1-contracts.cjs tests/client-import.cjs, 61/61 tests reussis.
- git diff --check: reussi dans les deux projets; avertissements LF/CRLF sur deux tests Auth existants cote API.
- JSON du rapport relu: 20 entrees API et 26 frontend, conformes aux totaux des audits.
- Pas de test de connexion avec identifiants reels, pas d'import reel, pas de build production ou de validation apres mise a jour (aucune installation n'a ete autorisee).

Ces tests confirment l'etat fonctionnel inchange, pas la correction des vulnerabilites. Aucun correctif de dependance n'est valide a ce stade.

