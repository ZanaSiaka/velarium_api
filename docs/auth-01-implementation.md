# AUTH-01 — Sécurisation du socle existant

Date : 17 novembre 2026. Intervention limitée à AUTH-01 après lecture d'AUTH-AUDIT-01 et inspection des modifications locales. **Code implémenté et contrôles TypeScript réussis ; aucune recette authentifiée ou de concurrence exécutée.** Aucun accès PostgreSQL/R2, écriture métier, email, migration, seed, installation, modification d'environnement, commit ou push effectué pendant cette intervention. Les modifications locales préexistantes sont conservées.

## 1. Bilan explicite des P0

| Vulnérabilité de l'audit | État AUTH-01 | Portée et limite |
| --- | --- | --- |
| Inscription publique créant compte actif et JWT | **CORRIGÉE** dans le code | AuthService.register refuse inconditionnellement ; page/action/formulaire/liens publics fermés. Aucune suppression des comptes existants. Validation HTTP réelle non exécutée |
| Second facteur configuré mais jamais requis lors du login | **NON CORRIGÉE** sur le contrôle de connexion, conformément au périmètre | Aucun défi email ni obligation globale ajouté. Les libellés trompeurs sont corrigés ; la connexion reste au mot de passe. AUTH-03/04 nécessaires |
| Token de récupération brut et lien divulgué dans les logs | **PARTIELLEMENT CORRIGÉE** | Log et émission de tokens supprimés ; seul un token stocké sous empreinte peut être consommé. Les anciens tokens bruts restent conservés et refusés. Pas de purge des anciennes bases/logs ni de transport email : récupération de bout en bout non opérationnelle |

Ne pas présenter AUTH-01 comme une authentification 2FA complète ou une activation des invitations.

## 2. Fermeture de l'inscription

`POST /api/auth/register` reste identifiable pour un refus explicite. `@Public` permet d'atteindre la réponse de fermeture même sans JWT ; **cela ne laisse aucun chemin de création** : le service lève ForbiddenException avant toute lecture, hash, écriture ou émission de JWT. Avec DTO valide : HTTP 403 ; un corps invalide peut être rejeté par la ValidationPipe avec 400 avant le service. La route ne devient pas un mécanisme administratif.

Frontend : `/auth/register` redirige vers login, le lien de création est retiré de LoginForm, SignupForm est remplacé par une information de fermeture sans formulaire, et la Server Action registerUser refuse sans appeler Nest. Même une action invoquée directement ne crée rien. La création administrative `/api/users`, ses rôles et ses formulaires restent inchangés, en attendant AUTH-02.

## 3. Récupération et changement de mot de passe

### Pas de livraison fictive

`POST /api/auth/forgot-password` renvoie désormais **503 pour toute adresse valide**, avec un message unique d'indisponibilité. Aucun utilisateur n'est recherché, aucun token créé ni lien écrit dans les logs. Les erreurs de validation restent 400 et les limites peuvent produire 429. Ce comportement ne révèle pas si l'adresse existe et ne prétend pas qu'un email a été envoyé.

La page forgot-password n'offre plus un formulaire promettant un envoi ; elle indique l'indisponibilité et renvoie au cabinet. L'écran verify-email n'affirme plus un envoi inexistant. Aucun mode de secours divulguant un token n'est ajouté. La Server Action historique de demande reste compatible avec le traitement des ApiError ; elle ne contourne pas le 503.

### Stockage sous empreinte compatible sans migration

`PasswordResetToken.token` est une String unique sans limite de longueur déclarée. Il peut conserver **une représentation d'empreinte**, sans renommer de colonne ou rendre l'ancien schéma incompatible :

`sha256:` + SHA-256 de `password-reset-v1.` suivi du token brut.

Le futur token brut doit avoir 32 octets aléatoires encodés sur 64 caractères hexadécimaux ; le DTO de consommation exige ce format. Le helper `resetTokenFingerprint` sert uniquement à la représentation de stockage/recherche, pas à émettre des liens. Aucun générateur/livreur opérationnel ajouté dans AUTH-01. Un SHA-256 convient à ce secret aléatoire à forte entropie ; cette décision **ne s'applique pas** au futur code email six chiffres, qui exigera une protection adaptée.

La consommation ne cherche jamais une valeur brute en secours. Ainsi les lignes historiques ne sont ni supprimées ni converties automatiquement, et leurs anciens liens ne sont plus acceptés. Des valeurs potentiellement divulguées dans d'anciens logs restent un sujet de traitement séparé ; aucune purge de logs ni de données décidée implicitement.

### Consommation atomique et préservation des lignes

`resetPassword` : recherche de l'empreinte, rejet générique d'un token absent/expiré, bcrypt hors transaction ; puis transaction avec verrou paramétré FOR UPDATE sur le User ciblé, relecture active, expiration conditionnelle du token (`updateMany`, count exactement 1), changement de passwordHash et expiration des autres tokens encore utilisables de la même identité. Aucun delete : les lignes restent présentes, l'expiration matérialise leur invalidation.

Deux consommations du même token ou de deux tokens du même compte sont sérialisées par le verrou utilisateur. La seconde constate l'expiration et échoue ; la transaction annule toute écriture partielle en cas d'erreur. Les identités ne sont pas fusionnées ou recanonisées. Un compte inactif ne devient pas actif par reset. **Ces garanties sont vérifiées statiquement ; la concurrence réelle n'a pas été testée.**

`changePassword` : ancien mot de passe vérifié, nouveau hash calculé avant transaction, même verrou utilisateur, relecture de l'état actif et comparaison du hash observé avant le verrou. Si une autre modification est intervenue, refus et reconnexion ; sinon update du hash et expiration des tokens de récupération utilisables dans la même transaction. Aucun compte n'a réellement été modifié pendant AUTH-01.

L'émetteur de tokens reste fermé faute d'email ; le consommateur d'empreintes est préparé, mais aucune nouvelle empreinte n'est créée par l'application actuelle. **La récupération n'est donc pas opérationnelle de bout en bout.** L'intégration email devra émettre uniquement cette représentation et faire l'objet de tests dédiés avant remise en service.

## 4. Révocation compatible avec le schéma actuel

### Protection activée dans le code

Les JWT nouveaux conservent sub/email/role et ajoutent `credentialTag` : HMAC-SHA256 avec le secret JWT, sur un domaine séparé, l'ID du User et son passwordHash courant. Le bcrypt hash et le secret ne sont pas placés dans le JWT. JwtStrategy sélectionne le hash côté serveur, compare l'empreinte en temps constant et ne renvoie que l'identité/rôle publics.

Le rôle et active continuent d'être relus en base. Un changement de rôle ne casse pas la session à lui seul ; le rôle réel devient immédiatement l'autorité Nest. Un changement/reset du hash invalide **tous les bearer précédents, y compris celui de la session courante**, dès la prochaine validation JWT. Même si le nouveau mot de passe est identique, un nouveau hash salé change la liaison. Une requête déjà autorisée avant le changement n'est pas annulée rétroactivement.

L'absence ou la malformation de credentialTag est refusée. **Tous les anciens JWT sans cette liaison nécessiteront une reconnexion unique au déploiement.** Aucun mode de compatibilité permanent acceptant un JWT ancien n'est ajouté. Les identifiants personnels restent valables : aucun mot de passe, rôle ou état actif existant n'est changé pour réaliser cette bascule. Déployer la signature et sa vérification ensemble ; éviter un parc mixte d'instances ancien/nouveau code.

Le contrat bearer et les enveloppes de réponse restent identiques ; les relais n'ont pas à construire une nouvelle preuve. Un 401 suit leur traitement existant ; lib/api.ts utilise déjà session-expired. Le frontend se déconnecte explicitement après succès de change-password. NextAuth conserve sa stratégie JWT, avec maxAge explicite sept jours, identique à la durée nominale du bearer. Cela ne garantit pas une expiration exactement simultanée : la session Auth.js peut être renouvelée selon son activité, alors que le bearer ne l'est pas ; le 401 reste l'autorité. Aucun refresh ajouté.

### Limites et version utilisateur future

Cette liaison est une **version dérivée des identifiants**, choisie pour protéger immédiatement les changements de mot de passe sans sélectionner une colonne absente de la base. Ce n'est pas un registre de sessions : logout NextAuth seul ne révoque toujours pas une copie du bearer API ; pas de révocation administrative indépendante du mot de passe, ni par appareil. Désactivation puis réactivation sans changement de hash peut rendre utilisable un bearer non expiré. Ces limites restent explicites.

Une colonne `User.securityVersion Int @default(0)` est préférable pour une révocation globale indépendante des identifiants, si ce besoin est validé. Proposition minimale documentaire, **ni présente dans schema.prisma ni créée comme migration active** :

```prisma
// Dans User, après autorisation et validation de compatibilité :
securityVersion Int @default(0)
```

```sql
-- Proposition non exécutée ; ne fait pas partie des migrations actuelles.
ALTER TABLE "User" ADD COLUMN "securityVersion" INTEGER NOT NULL DEFAULT 0;
```

Pour la rendre effective : autoriser la migration après restauration attestée, appliquer et vérifier la colonne, générer le client, signer/contrôler strictement la version, incrémenter dans les transactions reset/change/logout global selon la politique retenue et traiter les JWT anciens sans claim. Ne jamais activer une lecture Prisma de cette colonne avant sa présence réelle, ni considérer un claim absent comme une version zéro valide. Une session individuelle nécessiterait un modèle supplémentaire à analyser, hors AUTH-01. Aucune fonctionnalité dépendant de cette proposition n'est déclarée opérationnelle.

La bascule AUTH-03 devra encore ajouter une preuve effective de second facteur et rejeter les JWT de la période mot-de-passe-seul ; credentialTag n'est pas une preuve de 2FA. Pas de JWT partiel ni de bypass d'activation introduit.

## 5. Validation stricte et anti-abus

DTO : types chaînes exigés, email valide et limité à 254 caractères ; ancien mot de passe/login limités à 1 024 caractères pour garder une marge de compatibilité avec les secrets historiques, sans trim ni normalisation du mot de passe ; nouveaux mots de passe ≥8 caractères et **≤72 octets UTF-8** pour éviter la troncature silencieuse bcrypt ; code TOTP existant six chiffres ; reset token 64 caractères hexadécimaux. Registration, bien que fermée, conserve des types et bornes stricts. Les validateurs byte-length sont cohérents avec TextEncoder côté formulaire de changement.

Le login retourne le même 401 pour utilisateur absent, inactif ou mauvais secret ; comparaison bcrypt également effectuée pour une adresse inconnue, avec un hash leurre de coût 10. Le hash leurre ne correspond à aucun compte par défaut et ne permet jamais de connexion. Cela réduit une différence de temps évidente, sans prétendre garantir une égalité temporelle de toutes les réponses.

AuthRateLimitGuard, sans dépendance supplémentaire :

| Route | Fenêtre fixe | Pair TCP | Identité |
| --- | ---: | ---: | ---: |
| login | 5 min | 30 requêtes | 10 par email |
| forgot-password | 15 min | 10 | 3 par email |
| reset-password | 15 min | 20 | 5 par token |
| change-password | 5 min | 30 | 5 par User authentifié |

Les requêtes sont comptées avant validation du corps/bcrypt, y compris les succès. Clés mémoire HMAC avec secret éphémère, pas d'email/IP/token brut dans la map ; bornée à 20 000 entrées, expiration absolue, 429 avec Retry-After. Une tentative refusée ne prolonge pas la fenêtre ; pas de désactivation ni verrouillage permanent en base. En saturation de la map, refus temporaire plutôt que croissance mémoire illimitée ou suppression silencieuse d'un compteur valide.

L'IP est exclusivement `request.socket.remoteAddress` : X-Forwarded-For/X-Real-IP non fiables ignorés, aucune confiance proxy modifiée. Comme Next agit comme relais, plusieurs utilisateurs partagent son IP ; la limite par pair est donc aussi une limite commune du relais. Il faudra calibrer explicitement ce point avant production.

**Limites :** compteurs locaux au processus, perdus au redémarrage et non partagés entre instances ; ce n'est pas une protection distribuée ou une attestation contre toute attaque. Les limites connues par identité peuvent provoquer une indisponibilité temporaire ciblée ; elles ne doivent pas être présentées comme mécanisme anti-DoS parfait. Un magasin partagé et une politique de proxy fiable relèvent d'une étape ultérieure validée. Pas de nouvelle variable d'environnement ni Redis imposé pendant AUTH-01.

## 6. TOTP et autorisations métier préservés

Les secrets/booléens TOTP ne sont pas migrés, effacés ou réinterprétés. Le fonctionnement historique setup/enable/disable reste présent ; seuls le format du code et les messages sont ajustés. La table utilisateur affiche « TOTP historique (non exigé) » et configuré/non configuré. L'écran de sécurité explique qu'aucun second facteur n'est actuellement exigé ; le message verify-email n'invente plus d'envoi.

**Le contrôle 2FA du login reste NON CORRIGÉ dans AUTH-01 par périmètre explicite.** Les risques historiques de setup/disable sous JWT seul et du secret TOTP en clair restent à traiter dans une transition validée. Aucune obligation email, invitation ou nouvelle permission ajoutée. Aucun rôle attribué, retiré ou modifié.

FinancePermissionService, FinancialDataGuard, permissions KYC, Dossiers, sanctions et projections D2 ne sont pas modifiés dans cette intervention. La liaison JWT renforce l'authentification globale mais ne remplace aucune autorisation métier. Les modifications Finance déjà locales ne font pas partie d'AUTH-01.

## 7. Fichiers de cette intervention

### Backend modifié

- `src/modules/auth/auth.controller.ts` : gardes anti-abus et no-store sur login/me.
- `src/modules/auth/auth.service.ts` : fermeture register, indisponibilité explicite de forgot, reset/change atomiques, JWT lié aux identifiants et login générique.
- `src/modules/auth/auth.module.ts` : fourniture du garde anti-abus.
- `src/modules/auth/jwt.strategy.ts` : contrôle de liaison du JWT, utilisateur actif et rôle persistant conservés.
- `src/modules/auth/dto/login.dto.ts`, `forgot-password.dto.ts`, `reset-password.dto.ts`, `change-password.dto.ts`, `register.dto.ts`, `enable-2fa.dto.ts` : validations.

### Backend créé

- `src/modules/auth/auth-credentials.ts` : empreintes de liaison et de récupération.
- `src/modules/auth/auth-rate-limit.guard.ts` : limites locales bornées.
- `src/modules/auth/dto/auth-password.validator.ts` : borne bcrypt en octets.
- `docs/auth-01-implementation.md` : ce rapport.

### Frontend modifié, empreintes préalables vérifiées avant écriture

- `src/components/login-form.tsx`, `src/components/signup-form.tsx`.
- `src/app/(no-layout-pages)/auth/register/page.tsx`, `register/actions.ts`.
- `src/app/(no-layout-pages)/auth/forgot-password/ForgotPasswordPage.tsx`.
- `src/app/(no-layout-pages)/auth/verify-email/VerifyEmailForm.tsx`.
- `src/app/(layout-pages)/compte/securite/TwoFactorSetup.tsx`, `PasswordSettings.tsx`, `actions.ts`.
- `src/app/(layout-pages)/roles-securite/UsersTable.tsx`.
- `src/auth.ts`.

Aucun fichier Prisma ou migration modifié/créé ; aucune génération de client nécessaire pour les corrections actives. La proposition securityVersion reste dans ce document, hors du dossier de migrations, pour éviter son application accidentelle avant validation.

## 8. Contrats et fonctionnalités disponibles/préparées

| Contrat | Comportement après déploiement du code |
| --- | --- |
| POST /auth/register | Refus 403 pour corps valide, sans création ni JWT |
| POST /auth/login | Même enveloppe 200 accessToken/user, plus claim interne ; erreurs génériques, 429 possible |
| POST /auth/forgot-password | 503 uniforme, aucune émission ni création de token |
| POST /auth/reset-password | Préparé pour empreinte, 400 pour ancien lien brut/invalide/expiré ; 200 atomique seulement si un token haché valide existe ; 429 possible |
| POST /auth/change-password | Enveloppe success conservée ; tous les bearer liés à l'ancien hash deviennent invalides, y compris courant ; 429 possible |
| GET /auth/me et routes protégées | JWT signé mais ancien/non lié/périmé =>401 ; rôle/active relus en base |
| TOTP | Contrats existants préservés, format code strict ; aucune preuve 2FA exigée au login |

Opérationnel immédiatement **dans le code, sans migration** : fermeture register, retrait de la divulgation, refus uniforme forgot, empreintes/consommation, liaison et contrôles JWT, limites locales/DTO et messages frontend. Préparé mais non opérationnel de bout en bout : récupération email. Proposé seulement : securityVersion persistante et révocation globale indépendante du mot de passe. Pas commencé : AUTH-02 invitations, AUTH-03 code email, nouvelle gestion de sessions/refresh.

## 9. Contrôles et limites de validation

| Contrôle | Résultat |
| --- | --- |
| TypeScript backend production : `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false` | Réussi, code 0 |
| TypeScript frontend : `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Réussi, code 0 |
| `git diff --check` backend et frontend | Réussi, code 0 ; avertissements LF/CRLF sur le travail local |
| Inspection statique routes/guards | Register sans user.create/sign ; forgot sans log/token/create ; reset sans lookup brut ni delete ; JWT actif/claim/rôle vérifiés ; contrôles métier inchangés |
| Jest/autres suites automatisées | Non exécutés, conformément à la consigne |
| Login/reset/change-password réels, courses et SMTP | Non exécutés ; aucune écriture PostgreSQL ni email |

Les protections transactionnelles et le guard doivent encore être éprouvés par tests ciblés puis recette isolée autorisée : deux resets, reset/change concurrent, claims anciens/altérés, ancien bearer après changement, faux en-têtes IP, expiration/saturation des compteurs, erreur 503 de récupération et fermeture directe de register. Les tests Auth existants sont limités ; les résultats antérieurs P0/P1/Finance ne constituent pas une validation des nouvelles modifications. Aucun serveur lancé/redémarré par cette intervention ; ne pas déduire de la compilation que le code actuellement chargé par un processus est déjà validé en conditions réelles.

## 10. Impacts et prérequis avant AUTH-02

- Aucune modification des utilisateurs actuels, de leurs mots de passe/rôles/relations ou tokens pendant les travaux. Au déploiement, reconnexion nécessaire pour les anciens JWT ; prévoir l'information des utilisateurs et un déploiement coordonné. Pas de réinvitation systématique.
- Les anciens liens de récupération deviennent inutilisables sans être supprimés. Avec l'absence de mail, un utilisateur ayant perdu son mot de passe n'a pas de récupération autonome ; la procédure d'assistance doit être validée avant usage réel. Ne pas rétablir les logs de secrets comme secours.
- La déconnexion navigateur ne vaut toujours pas révocation serveur indépendante, le bearer est encore exposé à la session cliente et les limites sont locales. Réactivation de compte sans changement d'identifiants, perte de secret JWT et rotation de clés restent des décisions à encadrer ; aucune clé changée pendant AUTH-01.
- R1.1 reste **NO-GO** pour les écritures de recette tant que restauration, périmètre R2 et utilisateurs dédiés ne sont pas attestés. Aucun test financier ni phase R2 commencé.
- Avant AUTH-02 : validation de ce rapport et de la politique de reconnexion, attribution explicite de la future permission d'invitation, rôles assignables, canal du secret provisoire, état des comptes existants, service email/test de livraison, persistance d'invitation et stratégie de migration/restauration autorisées. Ne pas créer automatiquement une permission pour tous les AVOCATS.
- Avant activation de récupération : transport réellement opérationnel, tokens aléatoires stockés sous empreinte uniquement, gestion des erreurs sans secrets et validation de concurrence/révocation. Avant obligation 2FA : AUTH-03/04 coordonnés, sans accepter les bearer mot-de-passe-seul comme une preuve forte.

**AUTH-01 s'arrête ici. Aucune invitation ni 2FA email implémentée. Attendre la validation du responsable avant les phases suivantes.**
