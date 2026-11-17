# AUTH-AUDIT-01 — Authentification, invitations et vérification par email

Date : 17 novembre 2026. **Audit statique uniquement. Aucune implémentation autorisée par ce document.** Aucun appel de connexion, inscription, invitation, réinitialisation ou 2FA effectué ; aucune lecture PostgreSQL supplémentaire, aucun envoi email, modification de compte, secret affiché, migration, installation, suite Jest, commit ou push. Seul ce rapport est créé. Les travaux locaux D2 et F1–F5 sont conservés.

Les constats décrivent le code enregistré sur disque, pas une exploitation réalisée ni une certification du déploiement. L'architecture AcrediSpace n'a pas été fournie/inspectée : l'analyse porte sur le parcours métier décrit, sans supposer ses détails internes. Références de contexte : `docs/finance-r1-preparation.md` (dont R1.1), sans réutiliser des autorisations distantes pour une autre mission.

## A. État actuel

### Architecture réelle et délivrance d'accès

NestJS applique globalement JwtAuthGuard puis RolesGuard (`src/app.module.ts`). `@Public()` dispense du JWT, pas d'une future vérification métier. JwtStrategy extrait le bearer Authorization, vérifie signature/expiration, relit User et rejette l'absence ou active=false ; le rôle retourné vient de la base, pas d'un rôle potentiellement périmé du JWT. C'est un socle réutilisable.

`AuthService.register` crée un User au rôle COLLABORATEUR_ASSOCIE avec active=true par défaut, puis appelle `buildAuthResponse`. `login` vérifie email exact, état actif et bcrypt, puis appelle la même méthode. Elle signe immédiatement `{sub,email,role}` : **aucune vérification de twoFactorEnabled, de code 2FA, d'invitation ou d'adresse email vérifiée**. Le JWT complet expire après sept jours (`auth.module.ts`). Il n'a ni niveau d'authentification, ni identifiant de session, ni version de révocation contrôlée par JwtStrategy.

NextAuth Credentials (`velarium_front/src/auth.ts`) appelle directement `/auth/login`. Au succès, sa session JWT contient le rôle et apiAccessToken. Le callback session expose apiAccessToken à la session cliente ; SessionProvider existe dans le layout racine. Le cookie Auth.js est HttpOnly par défaut, mais cela **ne rend pas le bearer API inaccessible au JavaScript**, puisqu'il est copié dans le résultat de session. Aucune persistance de bearer dans localStorage/sessionStorage n'a été trouvée par la recherche ciblée ; localStorage repéré pour le thème seulement.

La configuration applicative ne fixe pas explicitement session.maxAge côté NextAuth. Le code de la dépendance installée (`node_modules/@auth/core/lib/init.js`, `lib/utils/cookie.js`) utilise un défaut de 30 jours pour la session, cookies HttpOnly/SameSite=Lax et Secure selon HTTPS. Ces valeurs sont des défauts inspectés, pas des attributs observés sur des cookies réels. Le bearer API reste à sept jours sans renouvellement : une session Next encore présente peut porter un bearer expiré.

### Routes backend existantes

Toutes sont préfixées `/api`. Fichiers principaux : `src/modules/auth/auth.controller.ts`, `auth.service.ts`, `auth.module.ts`, `jwt.strategy.ts`, `dto/*.dto.ts`.

| Méthode / route | DTO / service | Accès et comportement actuel |
| --- | --- | --- |
| POST /auth/register | RegisterDto / register | Public ; name, email valide, password ≥8 ; création active et JWT complet, 201 |
| POST /auth/login | LoginDto / login | Public ; email/password ; JWT complet, 200 ; inexistant/mauvais secret/inactif =>401 |
| POST /auth/forgot-password | ForgotPasswordDto / forgotPassword | Public, 200 générique ; token créé si email existant, lien écrit dans les logs ; pas de mail |
| POST /auth/reset-password | ResetPasswordDto / resetPassword | Public, 200 ; token brut et password ≥8 ; token absent/expiré=>400 |
| GET /auth/me | me | JWT requis, utilisateur actif via stratégie ; projection id/name/email/role/image/twoFactorEnabled ; active non renvoyé explicitement |
| POST /auth/change-password | ChangePasswordDto / changePassword | JWT actif, ancien secret et nouveau ≥8 ; 200 ; aucune révocation des JWT existants |
| POST /auth/2fa/setup | setupTwoFactor | JWT actif ; écrit un secret TOTP et retourne secret/QR ; 201 |
| POST /auth/2fa/enable | Enable2faDto / enableTwoFactor | JWT actif ; vérifie un TOTP, active un booléen ; 200 |
| POST /auth/2fa/disable | disableTwoFactor | JWT actif seul ; pas de mot de passe/code récent, efface secret/booléen ; 200 |

Les DTO utilisent class-validator et la ValidationPipe globale : whitelist, forbidNonWhitelisted et transform. Plusieurs champs (password login, code, token) n'ont qu'IsNotEmpty, sans IsString, bornes ou format strict ; ils peuvent atteindre bcrypt/otplib avec une forme invalide et provoquer des erreurs techniques au lieu d'un 400 stable. La borne maximale des mots de passe et le comportement bcrypt au-delà de sa limite en octets ne sont pas définis. Les huit caractères sont le minimum existant, pas une validation de robustesse complète.

Exceptions identifiées : UnauthorizedException 401, ConflictException 409 (email déjà existant), BadRequestException 400 (token/code), NotFoundException 404. Pas de filtre Auth spécifique ni de limitation applicative de tentatives retrouvés dans AuthModule/AppModule/package.json. Les protections éventuelles d'un reverse proxy ne sont pas attestées. `forgotPassword` masque l'existence par le texte de réponse, mais le temps de traitement/écriture et l'absence de limitation laissent des risques de timing et de saturation.

### Utilisateurs et autorisations

`UsersController` : GET `/users` accessible aux utilisateurs authentifiés pour la liste de sélection ; GET `/users/admin`, GET `/users/:id`, POST `/users`, PATCH `/users/:id` et routes de pièces utilisateurs réservés à **tout AVOCAT** via @Roles. UsersService.create reçoit un mot de passe choisi par l'administrateur, le hash bcrypt coût 10, crée un compte actif ; aucun statut d'invitation, mot de passe provisoire ou changement forcé. Le DTO permet tous les rôles de l'enum, y compris AVOCAT. UpdateUserDto permet name/role/active ; pas de changement email ou password via ce PATCH.

Rôles : AVOCAT, COLLABORATEUR_ASSOCIE, AVOCAT_STAGIAIRE, JURISTE, ARCHIVISTE, SECRETARIAT, COMPTABLE. Il n'existe pas de modèle général Permission ni d'habilitation explicite à inviter. FinancePermissionService expose des capacités propres à Finance ; **ne pas les détourner pour attribuer une permission d'invitation**. Les guards D2/Finance contrôlent réellement les appels Nest ; ils ne sont pas remplacés par le masquage UI.

`RolesGuard` accepte les routes sans métadonnée de rôle après le contrôle JWT global. Une inscription publique ne donne pas AVOCAT, mais donne un accès interne aux routes accessibles à tout authentifié. Les protections Finance continuent de refuser les rôles non financiers ; le risque n'est pas une élévation directe automatique vers Finance.

### Sessions, récupération et journaux

- Pas de route Nest de logout, refresh ou révocation de session trouvée ; les refreshTokenEncrypted Google Calendar concernent OAuth Google, **pas l'accès applicatif Velarium**.
- Expiration bearer vérifiée ; désactivation et changement de rôle pris en compte sur chaque requête Nest. Le rôle dans NextAuth reste un instantané, pouvant entraîner un affichage périmé ; l'API reste l'autorité.
- Logout NextAuth (`nav-user.tsx`, `UserDropdown.tsx`) efface la session navigateur, mais ne révoque pas une copie du bearer API. Un ancien bearer peut redevenir utilisable après réactivation du même compte tant qu'il n'est pas expiré.
- `lib/api.ts` redirige vers `/api/session-expired` sur 401 ; cette route appelle signOut puis login. `api-raw-authed.ts` et les relais spécialisés ont leurs propres réponses ; ne pas présumer une UX identique partout. Aucune session active n'est inventoriable via Prisma actuellement.
- `PasswordResetToken` stocke token brut aléatoire de 32 octets, email identifier et expiration une heure ; aucune suppression des autres tokens lors d'une nouvelle demande ou changement de mot de passe. Une ancienne demande non consommée peut encore servir après une autre réinitialisation.
- `resetPassword` fait lecture, bcrypt, update User, delete token **hors transaction atomique**. Deux appels simultanés peuvent lire le même token, modifier tous deux le mot de passe, puis l'un échouer à la suppression : l'usage unique n'est pas garanti atomiquement. Aucune révocation de sessions ni exigence 2FA après reset.
- AuthService/UsersService ne journalisent pas les événements de sécurité dans ActivityLog. Le seul log sensible explicite identifié est le lien complet de reset et l'email dans console.log. ActivityLog est réutilisable pour des acteurs connus, mais exige userId : il ne représente pas proprement un échec anonyme sans adaptation. Ne pas lui attribuer un faux auteur.

## B. Invitations : état et conception proposée

**Absentes dans le code et le schéma inspectés** : invitation email, liste/renvoi/révocation/acceptation, jeton hashé d'invitation, secret provisoire limité, statuts et permission spécifique. Le formulaire UserCreateDialog est une création directe de compte, pas une invitation. Aucun rapprochement automatique ni invitation réelle exécuté pour vérifier ces constats.

### Proposition de parcours, sans code ni décision de paramètres implicite

1. L'avocat **actif et explicitement habilité** demande une invitation, choisit un rôle dans le périmètre qu'il a le droit d'attribuer. Le serveur vérifie habilitation et rôle cible à la création, au renvoi et à la révocation ; la possession du rôle AVOCAT seul ne suffira pas dans le futur contrat. La liste autorisée est retournée par le backend, pas définie seulement par le select frontend.
2. Créer une invitation indépendante, pas un User actif avec le mot de passe provisoire dans passwordHash. Cette solution réutilise User à l'activation et évite de rendre passwordHash nullable uniquement pour les personnes non encore activées. L'UI peut afficher une personne invitée à partir de l'invitation, sans la traiter comme utilisatrice authentifiée.
3. Générer un token de lien à forte entropie, stocker son hash uniquement ; secret provisoire aléatoire distinct, stocké avec un hash de mot de passe. Expirations et tentatives explicites, aucun secret dans les logs ni mot de passe provisoire dans l'URL. Le secret provisoire ne doit jamais être accepté par `/auth/login`.
4. Transmettre le lien par email vérifié côté transport ; **transmettre le mot de passe provisoire par un canal distinct**. Le lien seul ne suffit pas à activer. Email saisi lors de l'activation doit correspondre à l'email canonique lié à l'invitation ; aucun transfert vers une adresse choisie dans le formulaire.
5. À l'acceptation : vérifier invitation en attente/non expirée/non révoquée, compte cible autorisé, token et secret provisoire, politique de mot de passe personnel. Verrou/consommation conditionnelle et création/rattachement du User dans la même transaction. Marquer accepté, invalider définitivement token/secret et vérifier l'email à cette occasion selon les preuves validées.
6. Renvoi : permissions revalidées, cooldown/quotas, rotation de token et secret ou politique équivalente à valider ; invalider l'ancien lien/code dans une transaction, pas deux invitations actives concurrentes. Révocation : aucun User courant désactivé automatiquement.

### Email déjà existant et concurrence

L'unicité actuelle porte sur User.email tel qu'enregistré ; PostgreSQL String unique n'impose pas une normalisation insensible à la casse. Ne pas mettre tous les emails en minuscules ou fusionner les comptes pendant l'audit. Prévoir un audit de collisions avant toute unicité canonique.

- Utilisateur actif avec mot de passe existant : ne pas créer un doublon, remplacer son mot de passe ou augmenter son rôle via une nouvelle invitation. Orienter vers le compte existant ; tout changement de rôle est une action administrative distincte, explicitement autorisée/journalisée.
- Utilisateur inactif : invitation ne vaut pas réactivation ; accord explicite requis selon politique à décider.
- Invitation déjà en attente : gérer renvoi/rotation, pas une nouvelle identité. Expirée/révoquée : ne pas réutiliser son secret.
- Activation simultanée : verrou sur invitation, unicité email et consommation conditionnelle ; un seul succès. Un contrôle préalable findUnique seul ne suffit pas ; gérer également le conflit SQL.
- Création/renvoi concurrents : sérialiser par identité canonique. Une contrainte partielle d'une invitation « en attente » doit être conçue avec statut persistant ; ne pas mettre `expiresAt > now()` dans un index supposé stable. Marquer explicitement les anciennes invitations expirées/révoquées sous verrou avant remplacement.

### Transmission du secret provisoire : décision UX à conserver ouverte

Option A : lien par email et secret remis oralement/après vérification d'identité ou par canal indépendant approuvé ; meilleure séparation, charge opérationnelle. Option B : secret remis via un gestionnaire sécurisé avec durée/accès distincts ; intégration et accès au gestionnaire à prévoir. Option C : activation sans secret provisoire, preuve renforcée différente ; UX plus simple mais **change le parcours validé**, ne pas la choisir sans accord. Envoyer lien et secret dans un même email, ou dans deux emails accessibles à la même boîte, n'offre pas une véritable séparation en cas de compromission de cette boîte.

## C. 2FA email : écart majeur et proposition

### Existant réel

TOTP via otplib/qrcode existe uniquement pour setup/enable/disable. Le secret est stocké en clair dans User.twoFactorSecret ; setup peut le remplacer sans contrôle d'enrôlement déjà actif, disable ne demande aucune réauthentification. Le flag n'est jamais exigé par login/JwtStrategy. Les badges « activée » dans UsersTable et TwoFactorSetup donnent donc une assurance que la connexion n'applique pas.

Aucun service d'email ni challenge email n'a été trouvé dans les modules, modèles et dépendances examinés. Pas de code numérique email, compteur d'essais, renvoi ou preuve de livraison. Les variables SMTP sont absentes des fichiers inventoriés dans R1 ; aucune vérification distante du transport effectuée. Les pages verify-email existantes ne déclenchent ni n'attestent un envoi. Un service email indisponible doit bloquer la nouvelle connexion, jamais rendre un JWT « de secours ».

### Automate proposé

`MOT_DE_PASSE_VALIDE → DEFI_EMAIL_EN_ATTENTE → CODE_CONSOMME → SESSION_COMPLETE`. Le premier état ne délivre **aucun bearer utilisable par les routes métier**, ni session NextAuth complète. Le client reçoit seulement un identifiant/ticket de défi opaque, court et strictement limité aux routes de vérification/renvoi. Un JWT partiel éventuel doit avoir type/audience/clés ou validation distincts et être refusé par le guard métier ; un JWT ordinaire portant `pending=true` serait dangereux si les guards l'ignorent.

Propositions à valider : code six chiffres produit par `crypto.randomInt`, expiration cinq minutes, cinq essais maximum par défi, renvoi après 60 secondes, quotas par compte et IP (éventuellement installation), nombre de défis actifs borné. Ces valeurs ne sont ni présentes ni décidées par cet audit. L'IP doit provenir d'une chaîne proxy de confiance configurée ; ne pas croire tout X-Forwarded-For ni bloquer durablement un compte par une simple attaque de verrouillage.

Le stockage d'un simple SHA-256 d'un code six chiffres est insuffisant face à une fuite de base (espace d'essai minuscule). Préférer une empreinte HMAC liée à challengeId/userId/code, avec secret serveur dédié/rotation contrôlée et comparaison sûre, en plus des limites serveur. Aucun code/secret/ticket complet dans les logs.

Vérification : sous verrou/écriture conditionnelle, vérifier compte actif, but LOGIN, version des identifiants, expiration, livraison préparée selon contrat et compteur ; incrémenter l'essai en échec sans rollback involontaire du compteur. En succès, consommer une seule fois et créer la session transactionnellement. Un token/challenge expiré ne devient pas valide après renvoi.

Renvoi : compteur atomique, cooldown, version/génération du défi ; précédent code invalidé. Renvois simultanés arbitrés ; les messages retardés doivent être gérés sans rendre l'ancien code valide. Vérification après changement de mot de passe, désactivation ou révocation : refus même si le code est bon. Plusieurs appareils ne doivent pas permettre de contourner quotas ou consommation.

### Exception limitée à la session d'activation

Après vérification sûre du lien, secret provisoire et nouveau mot de passe dans la transaction d'acceptation, le backend peut émettre **une session d'activation identifiée** autorisant ce seul premier accès sans second code saisi. Ce n'est ni `skip2fa=true` envoyé par le navigateur, ni un drapeau permanent User autorisant toutes les connexions.

Lier cette session à l'activation consommée, à sa version de sécurité et à un identifiant serveur ; un échange NextAuth éventuel utilise une preuve éphémère à usage unique, pas un champ arbitraire « déjà vérifié ». Le rejeu du lien/ticket ne produit pas une nouvelle session. La connexion personnelle suivante suit obligatoirement le défi email. Durée et possibilité de prolongation de cette session doivent être décidées ; un refresh ne doit pas la transformer en exemption permanente.

### Livraison et sécurité de messagerie

Créer un service Mail transversal, templates limités, URLs construites depuis une origine configurée de confiance (jamais le Host non vérifié), transport avec TLS valide, secrets côté serveur. Prévoir état d'envoi, erreurs bornées, retries contrôlés et identifiant d'envoi unique par génération. Une outbox persistante est la proposition la plus fiable si l'on exige des retries après crash ; aucune promesse « exactement un email » sans support du prestataire. L'API du prestataire peut accepter un envoi sans garantir son arrivée : distinguer soumis/livré/échoué, bounces si disponibles.

En panne de livraison : défi non transformé en authentification ; message utilisateur générique et possibilité de reprendre/renvoyer sous quotas. Pas de code universel, pas de bypass TOTP/email automatique, ni d'envoi hors quota par un second endpoint.

**Limite assumée du choix métier :** le code email dépend de la sécurité de la messagerie et se prête au phishing/relais en temps réel ; sa résistance est inférieure à FIDO2/WebAuthn lié à l'origine. Si le mot de passe peut aussi être réinitialisé depuis la même boîte, la compromission de cette boîte fragilise les deux preuves. Le choix email est conservé ; cet audit ne le remplace pas par une autre méthode. Référence : [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

## D. Prisma : réutilisation et changements minimaux proposés

### Capacité du schéma actuel

| État métier | Représentable aujourd'hui ? |
| --- | --- |
| Compte actif/désactivé, rôle et hash personnel | Oui : User.active/role/passwordHash |
| Invité, invitation en attente/expirée/révoquée/acceptée | Non ; active=false ne décrit pas une invitation |
| Secret provisoire, expiration et changement imposé | Non ; passwordHash seul ne distingue pas ces usages |
| Email vérifié | Non, aucun emailVerifiedAt |
| Défi email et consommation 2FA réussie | Non ; twoFactorEnabled concerne l'enrôlement TOTP, pas la preuve d'une session |
| Session complète révocable | JWT externe existe, aucun modèle de session en base |
| Token de récupération | PasswordResetToken existe, stockage brut/consommation à renforcer |
| Événement de sécurité | ActivityLog partiellement réutilisable pour acteur connu ; échecs anonymes non adaptés |

### Propositions documentaires, aucune modification de schema.prisma

1. **User** : emailVerifiedAt nullable, securityVersion entier ; habilitation explicite canManageInvitations (nom illustratif) ou modèle d'habilitation seulement si d'autres besoins le justifient. Réutiliser active, rôle et hash personnel. Ne pas ajouter « invité » au rôle ; ne pas détourner le flag TOTP comme indicateur de code email validé. Une obligation de changement peut rester portée par l'invitation jusqu'à activation plutôt qu'un champ User redondant.
2. **UserInvitation** : id, email canonique, rôle demandé, userId nullable pour rattachement contrôlé, invitedById, tokenHash unique, provisionalPasswordHash, expiresAt/provisionalExpiresAt, statut/acceptedAt/revokedAt, dates techniques, compteurs/limites et références de livraison. Les noms sont proposés ; préciser invariants du statut avant SQL. Token et mot de passe provisoire ne sont jamais enregistrés en clair. Une seule invitation exploitable par identité ; indexes/contraintes de concurrence à valider.
3. **AuthenticationChallenge** : id opaque, userId, purpose LOGIN (et éventuellement récupération distincte), empreinte du code, génération, securityVersion au départ, expiration, tentatives, dernier renvoi/quotas, consumedAt/revokedAt, état d'envoi. Aucune session complète dans ce modèle avant succès.
4. **Révocation** : pour un minimum global, securityVersion strictement comparée dans le JWT suffit à invalider toutes les sessions d'un utilisateur. Pour déconnexion de cette seule session, liste des sessions et exception d'activation précisément contrôlable, proposer un modèle AuthSession (sid, userId, version, mode PASSWORD_EMAIL_OTP ou INVITATION_ACTIVATION, authenticatedAt, expiresAt, revokedAt, invitationId si applicable). Un modèle de refresh séparé n'est pas nécessaire si l'on n'ajoute pas de refresh ; éviter de l'introduire par habitude.
5. **PasswordResetToken** : réutiliser sa fonction, remplacer token brut par tokenHash, lier clairement l'utilisateur/but et ajouter consumedAt si la politique exige l'historisation. Consommation + passwordHash + securityVersion + invalidation des autres défis/tokens dans une transaction. Pas de réemploi des tokens d'invitation comme reset.
6. **Journaux** : ActivityLog pour événements connus avec projections adaptées ; proposition SecurityEvent dédiée si traces anonymes/IP, catégories et accès séparés sont nécessaires. UserId nullable pour événements anonymes uniquement si ce choix n'altère pas les lecteurs existants ; ne pas modifier ActivityLog sans examiner tous ses usages. Données minimales, durée de rétention et accès à valider.
7. **Mail** : outbox dédiée uniquement si livraison/retry durable requis ; état lié à la génération d'invitation/défi. Ne pas stocker longtemps un code ou secret provisoire en clair pour permettre le renvoi. Une outbox contenant un secret à transmettre demande chiffrement, rétention courte et suppression après envoi, ou une conception à jeton déterministe signé soigneusement séparée à étudier ; ne pas prétendre qu'un hash peut être transformé en code à envoyer.

Ces adaptations nécessiteraient des migrations **futures autorisées**, pas un nouveau schéma parallèle d'utilisateurs. Déployer de manière additive, avec colonnes nullables/defaults compatibles ; audit des collisions email avant contrainte canonique ; aucun email marked verified par défaut pour satisfaire la migration. Ne pas supprimer les secrets TOTP historiques avant décision de transition. Ne pas modifier les relations User avec Finance/Dossier/sanctions.

### Transition des utilisateurs actuels

Le schéma impose passwordHash non nullable, ce qui ne prouve pas individuellement sa validité. R1.1 a recensé antérieurement neuf utilisateurs actifs (1 AVOCAT, 1 COMPTABLE, 5 COLLABORATEUR_ASSOCIE, 2 SECRETARIAT), sans inactif ; aucun nouvel inventaire de hashes/2FA/sessions n'est effectué dans cet audit.

Conserver IDs, rôles, active, hash personnel et relations métier. Pour les utilisateurs existants sans invitation, permettre une transition par mot de passe actuel puis code adressé à l'email enregistré et approuvé ; vérification de l'adresse/enrôlement au succès, sans réinvitation systématique. Un changement d'adresse requiert une procédure distincte d'identité ; un administrateur ne doit pas simplement réorienter le code vers sa propre boîte. Les inactifs éventuels restent inactifs.

À la bascule, les anciens JWT sans niveau de preuve/version ne doivent pas être acceptés comme sessions complètes modernes. Définir une coupure ou fenêtre de transition explicitement approuvée et un traitement de session NextAuth périmée ; ne pas donner à l'absence de claim une valeur par défaut qui contourne la nouvelle règle. Le refresh, s'il est créé plus tard, doit retrouver une session complète non révoquée et ne jamais augmenter le niveau de preuve ni ressusciter une exception d'activation consommée.

Le reset/change-password doit révoquer les sessions concernées selon la politique retenue ; définir clairement session courante/autres appareils. Prévoir une procédure de récupération après perte d'accès email sans secours universel. Conserver au moins un opérateur habilité identifié avant activation obligatoire, sans backdoor ni désactivation d'un compte actuel pendant l'audit.

## E. Frontend : réutilisation et écrans manquants

| Élément | État réel / fichiers frontend |
| --- | --- |
| Connexion email/password | Existe : components/login-form.tsx, auth/login/BasicLoginPage.tsx ; Credentials puis dashboard, aucune étape email |
| Inscription libre | Existe : components/signup-form.tsx, auth/register/actions.ts et page ; connexion automatique après création, contraire au parcours privé |
| Gestion utilisateurs | Existe : roles-securite/RolesSecuritePage, UserCreateDialog, UsersTable, UserDetailsDialog, actions.ts ; AVOCAT en UI et Nest ; crée un mot de passe final, pas invitation |
| Gestion invitations/états/renvoi/révocation | Absente après inspection des routes, actions et composants ciblés |
| Activation lien + secret provisoire + nouveau mot de passe | Absente ; le formulaire reset existant n'est pas un endpoint d'activation |
| Vérification email | auth/verify-email/VerifyEmailForm.tsx : écran informatif statique affirmant un envoi, sans vérification backend |
| Configuration 2FA | compte/securite/TwoFactorSetup.tsx et actions.ts : QR TOTP, activation et désactivation ; pas code email de connexion |
| Mot de passe et récupération | compte/securite/PasswordSettings, auth/forgot-password, auth/reset-password, password-reset-success ; composants réutilisables avec contrats renforcés |
| Sessions expirées | api/session-expired/route.ts, lib/api.ts ; existe, à étendre au futur contexte de défi/activation expirés |
| Code email, renvoi, erreurs invitation expirée/révoquée | Écrans et machine d'état à développer |

Le proxy Next (`src/proxy.ts`) exclut `/api` de son matcher ; les relais doivent rester protégés individuellement. auth.config.ts teste principalement auth.user ; aucun niveau 2FA. `RolesSecuritePage` filtre le rôle de session, puis Nest revérifie le rôle réel. Les relais sanctions relisent `/auth/me` ; les actions sensibles ne peuvent pas se fier seulement au cookie ou au menu. Ne pas ajouter un booléen frontend permettant d'obtenir un bearer complet.

Proposition UX : réutiliser cards/input/OTP/messages existants, page de login en deux états (identifiants puis code), délai de renvoi présenté sans être l'autorité serveur ; invitation dans la gestion actuelle, activation distincte avec états lien expiré/révoqué/déjà consommé ; nouveau mot de passe confirmé puis échange de session d'activation unique. Pas de secret provisoire dans query string, historique navigateur, analytics ou formulaire prérempli persistant. Nettoyer le token du lien après échange sûr ; conserver un contexte court côté serveur, sans consommer l'invitation par un simple GET (scanners d'email).

Les erreurs API 400/401/403/409/429/503 doivent être compréhensibles et ne pas distinguer publiquement des emails existants. Le login actuel convertit la plupart des ApiError en null, donc « mauvais identifiants » peut masquer une panne API ; un futur 2FA_REQUIRED ne doit pas être traité comme connexion réussie. La session NextAuth ne doit être créée qu'après vérification serveur ou exception d'activation consommée, pas après la seule première étape.

## F. Risques classés

Criticités proposées pour l'ERP privé et le parcours validé, pas scores CVSS ni résultats d'exploitation.

| Priorité | Constat / preuves | Impact et action minimale proposée |
| --- | --- | --- |
| **P0** | Inscription @Public + User actif + JWT immédiat : auth.controller.ts:19, auth.service.ts:30–50, signup-form.tsx | Accès interne sans invitation ; fermer l'inscription côté serveur et retirer le parcours public, sans supprimer les comptes |
| **P0** | login ne vérifie jamais twoFactorEnabled : auth.service.ts:53–71/204 ; JwtStrategy ignore tout niveau de preuve | 2FA affichée mais contournée par le contrat de connexion ; ne pas présenter TOTP comme protection effective, concevoir le défi serveur avant toute activation email |
| **P0** | Lien de récupération complet dans console.log, token brut : auth.service.ts:104–126, PasswordResetToken | Logs/DB exposent une capacité de changement de mot de passe ; supprimer la divulgation et protéger le stockage/consommation avant usage réel |
| **P1** | Reset non transactionnel, plusieurs tokens actifs et JWT non révoqués : auth.service.ts:129–151, changePassword, JwtStrategy | Course de consommation, accès conservé après récupération ; consommation unique et version/session révocable |
| **P1** | setup remplace secret actif, disable sous JWT seul ; secret TOTP brut : auth.service.ts:158–200 | Dégradation silencieuse d'un facteur, vol de session suffisant ; réauthentification forte et politique de transition validée |
| **P1** | Pas de throttle/compteurs Auth retrouvés, réponses inactif distinctes, coût bcrypt différent si email inconnu | Brute force, credential stuffing, timing et spam reset ; quotas compte/IP et erreurs homogènes, infrastructure proxy à vérifier |
| **P1** | Tous AVOCATS peuvent créer/affecter tous rôles, aucune habilitation invitation ni journal User : UsersController/Service | Surdélégation future et faible traçabilité ; permission explicite/default deny, rôles assignables validés, journal atomique |
| **P1** | apiAccessToken exposé à la session cliente : auth.ts:73, SessionProvider | Impact d'une XSS accru ; étudier conservation du bearer côté serveur et relais/BFF sans suppression improvisée des contrats utilisés |
| **P1** | Aucun emailVerifiedAt, SMTP, invitation, challenge email ou état d'envoi | Nouveau parcours inexécutable de manière sûre ; ne pas livrer un JWT si l'email échoue, développer les primitives durables |
| **P1** | Pas de canonicalisation email et unicité exploitable pour invitations concurrentes | Identités en double/collisions ; audit des données puis contrainte/transaction adaptées, sans fusion automatique |
| **P2** | DTO peu stricts pour certains champs, aucune borne password/code/token | Erreurs techniques, charge bcrypt et contrats ambigus ; formats/bornes en octets adaptés, gestion d'erreur stable |
| **P2** | Session Next potentiellement plus longue que JWT, rôle UI non rafraîchi, verify-email statique | UX trompeuse, affichage périmé ; politique cohérente et messages véridiques, guards backend maintenus |
| **P2** | Cookies/proxy/taux limites transport non observés en déploiement ; API_URL locale codée en dur | Préparation production incomplète ; vérification HTTPS/cookies/origines/URL séparée, aucune refonte Auth par défaut |
| **P2** | Tests Auth très limités, signAsync mocké alors que service signe avec sign | Pas de couverture de succès/2FA/récupération/concurrence ; compléter les cas en AUTH-05 sans prétendre aux résultats des suites métier |

Les tests existants examinés `auth.service.spec.ts` couvrent résolution et rejet absent/inactif ; `auth.controller.spec.ts` couvre délégation login. Ils n'ont pas été exécutés. Aucun test d'intrusion, exfiltration de JWT, tentative publique d'inscription ni accès réel aux logs effectué.

## G. Plan progressif proposé

Les phases sont des propositions nécessitant validation, pas un mandat d'implémentation. Le transport email, la consommation atomique et la révocation sont des dépendances communes à régler avant activation globale de la 2FA.

| Phase | Périmètre/fichiers ou modules | Prisma éventuel | Risques de régression et critères d'acceptation |
| --- | --- | --- | --- |
| AUTH-01 — socle | AuthController/Service/DTO/JwtStrategy, users, guards ; fermer register serveur, logs sans secrets, récupération atomique, quotas, politique de sessions et permission d'invitation | securityVersion, adaptation reset et habilitation explicite ; AuthSession si révocation individuelle retenue | Éviter verrouillage des comptes existants et rupture relais ; anciens comptes conservés, registration directe impossible, désactivation/rôle effectifs, récupération consommée une fois, tokens révoqués selon politique, aucune perte D2/Finance |
| AUTH-02 — invitations et activation | Nouveau service invitations + UsersController/UI admin ensuite ; mail/templates/livraison, activation/exchange | Invitation durable, emailVerifiedAt ; outbox si retenue, index anti-doublon | Aucun User actif avant acceptation, aucun écrasement de compte existant ; permissions explicites, lien+secret requis, expiration/révocation/usage unique et double acceptation arbitrée, première session liée à activation unique |
| AUTH-03 — défis email | AuthService/controller, guards niveau de preuve, Mail, compteurs/quotas/retries, gestion transition TOTP | Challenge durable, session/niveau/version et traces sécurité | Aucun bearer complet avant code hors exception validée ; rejeu/expiration/tentatives/renvois/concurrence refusés ; panne mail sans bypass ; prochaine connexion après activation exige un code |
| AUTH-04 — intégration Next | auth.ts/auth.config/proxy, login-form, activation/OTP, roles-securite, compte/securite, lib/api et relais | Aucun nouveau modèle frontend ; contrats backend des phases précédentes | Ne pas perdre token/session ni autoriser une session partielle via Credentials ; écrans responsive/erreurs homogènes, actions directes protégées, déconnexion et expiration cohérentes, aucun secret dans navigateur/logs au-delà du contrat validé |
| AUTH-05 — validation et bascule | Tests ciblés backend/frontend, HTTP direct, transport email de test et revue logs, recette authentifiée | Aucun nouveau besoin de modèle à ce stade | Tests existants + nouveaux, charge/concurrence, migration additive répétable et retour documenté ; pas d'envoi réel ni de bascule tant que preuves/autorisation manquent |

AUTH-02 et AUTH-03 doivent être intégrées à AUTH-04 progressivement avant leur mise en service ; ne pas casser la connexion pendant un déploiement backend/frontend décalé. Une stratégie temporaire doit être validée explicitement, avec accès de récupération contrôlé ; pas de bypass permanent ajouté pour faciliter le déploiement.

### Contrats futurs à discuter, aucune route existante modifiée

- Gestion autorisée : POST/GET invitations, POST renvoi, POST révocation ; périmètre et rôle assignable contrôlés côté Nest.
- Public limité : POST validation/activation d'invitation et échange de preuve, POST login démarrant un défi, POST vérification/renvoi du défi. Tous les endpoints pré-authentifiés doivent être séparés des routes métier et soumis aux quotas.
- Session : logout/révocation au périmètre décidé ; pas de refresh ajouté tant que nécessaire/politique non validés.

### Critères de recette de sécurité à préparer, non exécutés

Inscription publique refusée ; AVOCAT non habilité à inviter refusé ; rôle cible non autorisé refusé ; invitation compte inexistant/existant/inactif/doublon ; email différent ; lien/secret erronés/expirés/révoqués ; double acceptation ; renvoi concurrent ; code faux/rejoué/expiré et compteurs durables ; ancien code après renvoi ; IP derrière proxy de confiance ; tentative de bearer partiel contre Dossier/Finance/KYC/sanctions ; panne mail et reprise sans double délivrance ; vol/rejeu de preuve d'activation ; seconde connexion imposant OTP ; password reset/change et révocation ; logout/session expirée/rôle changé/inactif ; ancien JWT après réactivation ; non-divulgation de secrets par logs/erreurs/session.

Environnement de test et restauration doivent être attestés avant toute écriture, comme R1.1 le demande ; l'email de recette doit être capturé dans une boîte/transport de test, jamais chez les collaborateurs réels. Pas de Jest ni de scénarios exécutés pendant cet audit.

## H. Décisions encore nécessaires

Les décisions déjà validées ne sont pas rouvertes : application privée sans inscription libre, invitation par avocat habilité, lien et secret provisoire, nouveau mot de passe, code email aux connexions suivantes et exception limitée à la session d'activation.

Restent à arbitrer :

1. Quels AVOCATS reçoivent l'habilitation explicite, qui peut l'accorder/révoquer et quels rôles chacun peut attribuer, notamment AVOCAT lui-même ? Éviter de précocher tous les avocats à la migration.
2. Canal indépendant choisi pour le secret provisoire, durée du lien/secret et politique de renvoi ; traitement d'une personne déjà active ou désactivée. Aucune réactivation/élévation implicite.
3. Validation des paramètres proposés du défi (six chiffres/cinq minutes/cinq essais/cooldown/quotas/concurrence) et traitement d'un compte temporairement limité sans DoS permanent.
4. Durées des sessions complètes et d'activation, délai inactif/absolu, périmètre de révocation logout/change/reset, besoin réel ou non de refresh. Toute prolongation de l'exception d'activation doit rester bornée et ne pas s'étendre aux connexions futures.
5. Prestataire email/SMTP, domaine d'envoi, exigences TLS et livraison/retry, outbox et rétention, modalités de secours après perte de messagerie. Aucun secret à transmettre dans le rapport.
6. Transition du TOTP existant vers l'email obligatoire, vérification préalable des adresses enregistrées et stratégie de bascule des anciens JWT ; pas de réinvitation systématique ni de déverrouillage automatique.
7. Accès/durée de conservation des journaux de sécurité et données IP, liste des opérateurs de récupération, procédure d'identité lors d'un changement d'adresse. Pas de nouveau rôle imposé.
8. Réduction de l'exposition du bearer API au frontend et impact sur les contrats session/actions ; accepter ou remplacer par une conservation serveur en mesurant les usages existants.

## Conclusion

1. **Déjà présent dans le code :** authentification bcrypt/JWT, rejet des inactifs, rôle persistant relu par Nest, session NextAuth, administration utilisateurs AVOCAT, formulaires de mot de passe, guards D2/Finance.
2. **Réutilisable :** User et ses relations, services bcrypt/crypto, JwtStrategy/RolesGuard, lecteurs de capacités, primitives de journal avec adaptation contrôlée, composants UI et relais existants. TOTP n'est pas un service de code email.
3. **À corriger :** inscription publique, absence de contrôle effectif du second facteur, secrets de reset en log/DB, consommation non atomique, révocation de sessions, contrôles de tentatives et messages trompeurs.
4. **À développer après validation :** invitations durables et habilitations, activation/secret provisoire, défis et livraison email, état de session/niveau d'authentification, écrans associés et recette de sécurité.
5. **Bloquants :** P0 identifiés ; transport email inexistant ; choix de migration/bascule et récupération à valider ; environnement de recette encore NO-GO selon R1.1. Aucun parcours email sûr ne peut être déclaré opérationnel aujourd'hui.
6. **Première phase recommandée : AUTH-01**, puis transport/invitations/défis et frontend coordonnés. **Aucune implémentation commencée ; attendre l'analyse et la validation du responsable.**

Références de sécurité consultées, distinctes des preuves du dépôt : [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) pour limites des facteurs/phishing, [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) pour jetons sûrs, expiration et consommation unique. Les durées/quotas précis du futur produit restent des propositions à valider.
