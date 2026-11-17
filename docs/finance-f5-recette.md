# F5 — Recette authentifiée préparée, non exécutée

Tous les scénarios ci-dessous sont **NON EXÉCUTÉS**. Aucun succès fonctionnel ni validation de concurrence n'est revendiqué. Ne pas utiliser la base réelle ni le bucket réel du cabinet. Ce document n'est pas un script d'exécution et ne déclenche aucune écriture.

## Porte d'entrée obligatoire

Avant de créer la moindre donnée :

- Faire identifier dans Neon la branche de test distincte, son origine et l'endpoint exact. Comparer confidentiellement les configurations de l'API et du frontend à cette branche, sans copier DATABASE_URL/token dans les preuves. L'appellation « développement » ou NODE_ENV ne prouve pas l'isolation.
- Vérifier absence de routage vers l'API réelle, base réelle, bucket R2 réel, SMTP réel ou intégrations tierces réelles ; déconnecter/remplacer ces intégrations dans l'environnement dédié sous validation de son responsable.
- Confirmer schéma/migrations compatibles, utilisateurs fictifs et mots de passe dédiés. Aucune migration automatique ; toute préparation de schéma exige son autorisation propre.
- R2 : bucket privé distinct, absence d'URL publique et de règle rendant les objets accessibles ; CORS du frontend de test autorisant PUT, Content-Type et If-None-Match. Conserver la preuve console sans secrets.
- Fournir preuve de restauration disponible et procédure de retour sur la branche de test. Ne pas présumer de sauvegarde Neon. Définir les règles de nettoyage de branche/bucket de test avec leur responsable ; aucune suppression récursive ou automatique sur l'environnement réel.
- Autoriser explicitement la recette et ses écritures fictives sur cet environnement. Ne pas traiter l'autorisation d'audit READ ONLY comme une autorisation d'écriture.

Si un point manque, arrêter la recette avant toute écriture et noter le blocage. État actuel : isolation et restauration non attestées, recette non démarrée.

## Données et preuves communes

Jeu fictif à préparer après cette porte d'entrée : utilisateurs A (AVOCAT actif), C (COMPTABLE actif), N (rôle non financier), I (inactif), clients/dossiers `QA-F5-*` sans personnes réelles. Comptes X1/X2 actifs XOF avec 500 000 FCFA initiaux chacun, X0 actif XOF à zéro, XI inactif, EUR actif EUR ; moyens explicitement configurés. Les comptes et montants ne sont pas ceux du cabinet.

Pour chaque ligne : restaurer le point de départ isolé approprié, relever les IDs techniques et les valeurs exactes avant action. Collecter statut HTTP et réponse expurgée de jetons/secrets/URLs signées, captures autorisées des écrans, inventaire en lecture seule des mouvements/relations/reçus/journaux, soldes et montants exacts avant/après. Horodater et noter acteur, compte, dossier, référence et clé de demande de test dans le dossier de recette privé. Les journaux doivent montrer l'auteur et les liens attendus sans doublon.

Critère commun de réussite : **tous** les résultats attendus de la ligne sont observés, avec preuves API et données/écrans correspondantes ; aucune écriture partielle ou modification inattendue. Sinon : échec documenté ou blocage, jamais succès présumé. Les références à « aucun mouvement » signifient que le nombre et les montants restent identiques au point de départ.

## Comptes et trésorerie

| ID / prérequis et données | Action | Résultat attendu et preuves spécifiques |
| --- | --- | --- |
| C01 — A ou C, données fictives | Créer X1/X2/X0/EUR avec moyens configurés | Comptes distincts, devise/solde initial exacts, auteur/date de création journalisés ; liste et détail cohérents |
| C02 — X1 initial 500 000 | Consulter liste et détail | Solde 500 000, entrées/sorties zéro ; valeurs exactes identiques, aucun mouvement créé par lecture |
| C03 — X1, entrée manuelle 10 000 | Créer ENTREE avec source manuelle autorisée | Une entrée, solde 510 000, auteur/date métier/date technique/source/compte/trace ; aucun reçu métier inventé |
| C04 — X1, sortie 5 000 | Créer SORTIE valide | Une sortie et débit unique de 5 000 ; aucun impact facture/provision |
| C05 — X1/X2 actifs XOF | Transférer 20 000 de X1 vers X2 | Une opération TRANSFERT, débit/crédit uniques 20 000, somme des deux soldes inchangée, aucun encaissement externe |
| C06 — X0 à zéro | Sortie/transfert de 1 | Refus explicite, aucune écriture ni trace de succès, pas de découvert inventé |
| C07 — XI inactif | Entrée/sortie, puis transfert vers XI | Refus selon contrôle existant ; aucune écriture partielle |
| C08 — X1 possède mouvements | Modifier solde initial/devise/type ; supprimer | Refus de réécriture/suppression avec historique ; nom/informations autorisées restent modifiables selon contrat |
| C09 — X1 XOF et EUR | Transférer de X1 à EUR | Refus devises incompatibles, aucune conversion ni mouvement |
| C10 — compte fictif historique FCFA préparé par restauration isolée approuvée | Nouvelle opération et lecture historique | Historique visible ; nouvelle opération incompatible refusée ; aucune normalisation implicite |

## Dossiers et factures

| ID / prérequis et données | Action | Résultat attendu et preuves spécifiques |
| --- | --- | --- |
| D01 — client fictif, A ou C, X1 | Créer dossier sans confirmation de paiement | HTTP 400 explicite ; ni dossier, ni frais, ni mouvement/reçu partiel |
| D02 — frais 25 000, X1 XOF/moyen autorisé | Créer dossier avec paiement confirmé | Dossier + frais PAYE + une ENTREE + un reçu atomiques, auteur/trace dans transaction, recette solde +25 000 |
| D03 — dossier D02, permissions | Ouvrir Ajouter une dépense | Modale F2.1 inchangée : cinq champs, six catégories ; comptes dynamiques noms seuls, aucun solde ni présélection |
| D04 — transport/motif/5 000/date/X1 | Confirmer la dépense | Un SORTIE partagé par dossier et Finance ; solde -5 000, dépenses +5 000 ; honoraires/provisions/reste client inchangés |
| D05 — plusieurs devises/historique de test | Filtrer dépenses catégorie/période, rafraîchir fiche | Totaux du tableau par devise, synthèse toutes périodes ; pas d'addition de devises ni zéro pour une donnée inconnue |
| F01 — dossier éligible, lignes fictives | Demander aperçu backend puis créer facture | Aperçu sans écriture ; création TTC/HT/TVA égaux à l'aperçu, numéro FACT unique, trace avec auteur et montants exacts |
| F02 — frais à facturer selon état fictif restauré | Inclure frais dans facture, retenter inclusion | Intégration unique selon F3 ; pas de nouvelle entrée de trésorerie lors de la facturation, pas de double charge |
| F03 — facture TTC 100 000, provision absente | Paiement direct 30 000 sur X1 | Une entrée et un paiement ; réglé 30 000/reste 70 000 identiques Finance/Dossier, source et auteur traçables |
| F04 — F03 | Payer 70 000 | Facture PAYEE, reste zéro ; une nouvelle entrée de 70 000, aucun doublon de mouvements |
| F05 — échéance passée, TTC 100 000, paiement 30 000 | Lire puis ajouter règlement valide | Priorité EN_RETARD pour une facture échue partiellement réglée ; pas de réécriture historique par simple lecture |
| F06 — reste dû 70 000 | Tenter paiement 70 001 | Refus, aucun paiement/mouvement/trace de succès partiel, solde compte inchangé |
| F07 — brouillon fictif | Lire synthèse et tenter règlement/imputation | Visible séparément ; exclu de total exigible et des actions autorisées, rejet serveur direct |
| F08 — deux factures dont excédent historique sur la première | Consulter reste global | Somme des restes par facture ; excédent affiché séparément, aucune compensation avec la seconde |
| F09 — historiques incomplets/TVA ambiguë de copie isolée | Lire facture et fiche | Indisponibilité/avertissement F3 conservés ; aucune donnée réécrite, aucune déclaration automatique d'erreur fiscale |

## Provisions et traces

| ID / prérequis et données | Action | Résultat attendu et preuves spécifiques |
| --- | --- | --- |
| P01 — dossier avec facture TTC 100 000, X1 | Encaisser provision 60 000 | Une provision + ENTREE + reçu atomiques, disponible 60 000 ; dette facture reste 100 000, journal PROVISION_ENCAISSEE |
| P02 — P01 | Imputer 20 000 à la facture | Disponible 40 000, réglé 20 000/reste 80 000 ; aucun nouvel encaissement ni variation du solde de X1 ; trace liée aux deux objets |
| P03 — autre facture du même dossier, reste ≥40 000 | Imputer les 40 000 restants | Disponible zéro, imputation totale reconnue ; pas d'entrée supplémentaire |
| P04 — provision déjà imputée au même couple facture | Répéter création d'imputation, ou dépasser disponible/reste | Refus/contrainte de couple, aucune double affectation ; cette protection n'est pas un rejeu HTTP de résultat |
| P05 — facture d'un autre dossier/client | Tenter une imputation | Refus, disponible et facture inchangés |
| P06 — historique factureId sans montant explicite | Consulter et tenter imputation | Affectation/disponible ambigus, action refusée ; aucune assimilation au montant total |
| P07 — imputation de test existante, A ou C | Utiliser retrait existant après approbation de recette | Auteur et instantané original conservés dans le journal transactionnel, statut/reste recalculés selon F3 ; aucun mouvement de remboursement inventé. Motif obligatoire/contrepassation non implémentés |
| P08 — panne transactionnelle simulée uniquement dans l'environnement dédié | Échouer après préparation d'une opération avant commit | Ni écriture métier ni trace de succès commitée ; prouver le rollback par lectures, pas en désactivant les permissions |

## Concurrence réelle — sessions indépendantes

La preuve doit contenir les horaires de départ/fin, les réponses des **deux** requêtes, leurs identifiants et les données après commit. Un rejeu séquentiel n'est pas une preuve de concurrence. Utiliser un outil manuel approuvé avec barrière de départ ; aucune suite automatisée n'est lancée dans F5.

| ID / prérequis et données | Actions simultanées | Résultat attendu et preuve spécifique |
| --- | --- | --- |
| R01 — X1 à 100 000 | Deux sorties de 80 000 | Une seule réussit, autre refus/conflit contrôlé ; solde 20 000, jamais -60 000 |
| R02 — X1 à 100 000, X2 actif | Sortie 80 000 et transfert 80 000 depuis X1 | Au plus un succès ; débit total ≤100 000, pas de crédit destination orphelin |
| R03 — X1/X2, soldes contrôlés | Deux transferts en sens opposés | Pas de deadlock non géré ni débit/crédit partiel ; somme soldes conservée, retries bornés |
| R04 — facture reste 100 000 | Deux paiements de 80 000 | Au plus un succès ; aucun trop-perçu nouveau ; statut et solde cohérents |
| R05 — provision disponible 100 000, deux factures | Deux imputations de 80 000 | Au plus une allocation de 80 000 ; disponible jamais négatif, aucun cash supplémentaire |
| R06 — facture reste 100 000, provision confirmée | Paiement de 80 000 et imputation de 80 000 | Somme réglée ≤100 000 ; le verrou facture arbitre ; pas de compensation artificielle |
| R07 — année identique | Deux créations FACT, puis deux encaissements générant REC | Références uniques et formats inchangés ; un verrou de numérotation ne vaut pas idempotence de création |

## Idempotence HTTP et interruption

| ID / prérequis et données | Action | Résultat attendu et preuves spécifiques |
| --- | --- | --- |
| I01 — dépense, UUIDv4 fixe K, contenu B | Double clic et répétition séquentielle K/B | Même id mouvement ; une sortie, une trace de succès, effet solde unique |
| I02 — I01 confirmé | Envoyer K avec autre montant/motif/date/compte/dossier | HTTP 409 ; première opération inchangée, aucune seconde écriture |
| I03 — K confirmé sous A | Rejouer sous C ou pour autre dossier | Conflit sans retourner l'opération d'autrui ; aucune fuite ni nouvelle écriture |
| I04 — requête K/B | Interrompre réponse réseau après commit possible, reprendre K/B | Retrouver même id si commit ; sinon une création unique ; conserver clé et contenu, ne pas générer K2 pour résoudre l'incertitude |
| I05 — K/B identique, deux sessions | Envoyer simultanément | Une sortie unique, même id après rejeu ou conflit transitoire documenté puis récupération ; aucune double trace |
| I06 — même montant/date/compte, clés K1/K2 différentes | Deux saisies délibérément distinctes | Deux opérations autorisées si fonds/règles valides ; aucun blocage automatique par similitude |
| I07 — autre endpoint financier sans registre général | Observer reprise/double clic sur données fictives réinitialisables | Lacune documentée, aucune garantie de rejeu unique revendiquée. Ne pas compter l'expérience comme validation d'idempotence ; registre proposé à valider avant activation généralisée |

## Justificatifs, permissions et confidentialité

Utiliser uniquement des fichiers fictifs sans donnée personnelle ; les URLs signées et jetons ne doivent pas figurer en clair dans les preuves conservées.

| ID / prérequis et données | Action | Résultat attendu et preuves spécifiques |
| --- | --- | --- |
| S01 — A/C actifs, mouvement fictif | Presign PDF/PNG/JPEG/WebP valide, PUT avec headers, confirmation | Pièce rattachée au bon mouvement, taille/type R2 conformes, trace de dépôt atomique ; aucun nouveau mouvement |
| S02 — fichier >10 Mio, vide, type interdit ou taille manquante | Presign/confirmation | Refus explicite ; aucune pièce persistée |
| S03 — presign sous A pour mouvement M | Confirmer sous C, pour M2, autre clé/nom/taille/type, jeton modifié/expiré | Refus 400/403 adapté, aucune association à une autre opération |
| S04 — presign obtenu sans upload ou PUT de taille/type différents | Confirmer | 404 absent ou 400 incohérent ; panne stockage => 503, aucune métadonnée mensongère |
| S05 — pièce déjà confirmée | Refaire PUT sur même URL/clé ; confirmer deux fois | PUT conditionnel refuse écrasement ; confirmation répétée/concurrente =>409, une seule pièce et trace de dépôt |
| S06 — pièce privée valide | Voir/télécharger via endpoint authentifié | URL temporaire, pas publique ; headers privés, nom/type contrôlés. Une URL signée déjà remise reste un bearer token jusqu'à expiration |
| S07 — A/C autorisé, puis N/I/sans session | Appels directs création/lecture/journaux/pièces/reçus | A/C selon capacités existantes ; N =>403, absent/inactif=>401, aucune fuite de montant/clé/signature dans erreur ou projection générale |
| S08 — utilisateur non financier connaissant une clé finance | Tenter référence via pièce utilisateur et téléchargement générique | Aucune signature S3 de finance/ via le chemin générique ; refus côté serveur, pas simple masquage UI |
| S09 — N et A | Consulter journal générique, historique Dossier, KYC | N ne voit aucune trace financière sensible ; historique Dossier et KYC restent réservés selon D2 ; métadonnées brutes absentes du journal générique |
| S10 — pièce de test supprimable | Supprimer avec acteur autorisé, puis simuler panne R2/SQL séparément | Intention avant suppression, auteur conservé ; succès journalisé seulement après progression prévue. Cas fichier supprimé/métadonnée restante qualifié et jamais traité comme succès complet |
| S11 — pièce historique hors préfixe de son mouvement | Demander lecture/suppression | Refus sécurisé, données historiques non déplacées ni supprimées arbitrairement ; qualification manuelle requise |
| S12 — fiche Dossier et Finance ouverts | Rafraîchir après opérations précédentes | Totaux comparables identiques à périmètre égal ; aucune addition opération+mouvement ; dépenses hors dette et provisions non imputées hors règlement |
| S13 — Dashboard période limitée et dossier tout historique | Comparer avec Finance, livre et comptes | Écarts de période/devise/legacy explicités ; inconnus indisponibles, aucune égalité forcée ni transaction longue d'affichage |

## Bilan à remplir après autorisation

| Rubrique | Situation actuelle |
| --- | --- |
| Audit historique PostgreSQL READ ONLY | Exécuté, voir rapport F5 et registre local confidentiel |
| Scénarios C/D/F/P/R/I/S ci-dessus | Non exécutés |
| Isolation Neon et R2 | Non attestée |
| Sauvegarde/restauration | Non attestée |
| Concurrence réelle | Non validée |
| CORS/HEAD/PUT conditionnel du stockage réel de test | Non validés |
| Idempotence générale hors dépense | Non implémentée, décision/migration à valider |
| Validation fonctionnelle F5 | En attente |
