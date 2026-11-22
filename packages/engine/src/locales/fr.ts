export const fr: Record<string, string> = {
  'engine.outOfScope': "cible « {target} » hors du périmètre du mandat {mandate}. Rien n'a été envoyé.",
  'engine.detected.line1': 'Connection reset by peer',
  'engine.detected.line2':
    '[SOC NovaMind] Activité suspecte détectée. Session coupée, retour au dernier point de sauvegarde.',
  'stage.cadrage': 'cadrage',
  'stage.recon': 'reconnaissance',
  'stage.social': 'ingénierie sociale',
  'stage.injection': 'injection de prompt',
  'stage.indirect': 'injection indirecte',
  'stage.agency': 'agent trop puissant',
  'stage.lateral': 'mouvement latéral',
  'engine.flagHint': 'Un code se valide avec la commande submit. Tape : submit {flag}',
  'engine.restricted':
    "outil non installé sur ce poste d'entraînement (LR-OS). Tape `help` pour voir ce qui est disponible.",
  'engine.gitUnavailable': "n'est pas disponible sur ce poste. Essaie clone, log, show, status ou remote.",
  'engine.sudo': 'Cet incident sera signalé à Ada.',
  'engine.exit': 'Tu es sur ton propre poste. Rien à quitter.',
  'save.update.restart':
    "BREACH a été mis à jour pendant ton absence, et la mission que tu avais commencée ne peut pas reprendre où tu l'avais laissée. Tes missions terminées et leurs scores sont gardés. Celle-ci reprend à son début.",
  'save.update.kept':
    'BREACH a été mis à jour pendant ton absence. Tes missions terminées et leurs scores sont gardés, on continue.',
  'save.import':
    'Progression importée. Tes missions terminées et leurs scores sont là, on reprend à la suivante.',
  'save.mission.restart':
    "Cette mission a été mise à jour depuis ta dernière partie. Ta sauvegarde ne s'applique plus : elle reprend à son début.",

  'help.group.game': 'Jeu',
  'help.group.files': 'Fichiers',
  'help.group.network': 'Réseau',
  'help.group.system': 'Système',
  'help.footer':
    'explain <commande> : à quoi sert un outil, et comment un défenseur le repère. Tab complète, les flèches rappellent.',

  'cmd.help': 'Liste les commandes disponibles',
  'cmd.explain': 'Explique un outil et sa détection côté défense',
  'cmd.man': 'Alias de explain',
  'cmd.mission': 'Rappelle le briefing et les objectifs',
  'cmd.hint': 'Demande un indice à Ada (trois niveaux)',
  'cmd.notes': 'Carnet : `notes add <texte>` ou `notes`',
  'cmd.submit': 'Soumet un flag trouvé : `submit FLAG{...}`',
  'cmd.pwd': 'Affiche le dossier courant',
  'cmd.cd': 'Change de dossier',
  'cmd.ls': "Liste le contenu d'un dossier (-l, -a)",
  'cmd.cat': 'Affiche un fichier',
  'cmd.echo': 'Affiche du texte',
  'cmd.grep': 'Cherche un motif dans des fichiers ou un flux (-i, -n, -v, -r)',
  'cmd.head': "Premières lignes d'un fichier (-n)",
  'cmd.tail': "Dernières lignes d'un fichier (-n)",
  'cmd.wc': 'Compte lignes, mots et octets',
  'cmd.find': 'Cherche des fichiers (-name, -type)',
  'cmd.dig': 'Interroge le DNS',
  'cmd.whois': "Fiche d'enregistrement d'un domaine",
  'cmd.nmap': 'Découvre hôtes et services',
  'cmd.curl': 'Envoie une requête HTTP (-I en-têtes, -d envoie des données)',
  'cmd.open': 'Ouvre une adresse dans le navigateur',
  'engine.open': 'Ouverture de {url} dans le navigateur…',
  'explain.open':
    "open affiche une adresse dans le navigateur du poste. Le navigateur montre la page comme la verrait un visiteur, et « Voir la source » montre ce que le serveur a vraiment envoyé, commentaires compris.\n---\nPour le serveur, une visite au navigateur ou une requête curl, c'est la même ligne dans le journal d'accès. Naviguer comme un visiteur normal se fond dans le trafic habituel.",
  'cmd.ping': 'Teste si un hôte répond',
  'cmd.ssh': 'Ouvre une session distante',
  'cmd.git': 'clone, log, show : lire un dépôt et son historique',
  'cmd.whoami': 'Affiche ton utilisateur',
  'cmd.id': 'Affiche ton identité et tes groupes',
  'cmd.hostname': 'Affiche le nom de ta machine',
  'cmd.date': 'Affiche la date du jeu',
  'cmd.uname': 'Affiche le système',
  'cmd.clear': "Efface l'écran",
  'cmd.history': 'Affiche les commandes déjà tapées',
  'cmd.sudo': 'Exécute en administrateur',
  'cmd.exit': 'Ferme la session',
  'cmd.logout': 'Quitte la session SSH',

  'explain.usage': 'usage : explain <commande>',
  'explain.unknown': 'explain : « {name} » inconnu. Tape `help` pour la liste.',
  'explain.defense': 'Côté défense',
  'explain.grep':
    "grep filtre des lignes selon un motif. En audit, on s'en sert pour fouiller des fichiers de configuration, des dépôts ou des logs à la recherche de mots comme password, key ou token.\n---\ngrep est aussi l'outil du défenseur : c'est avec lui (ou son équivalent dans un SIEM) qu'on cherche dans les logs les traces d'un attaquant.",
  'explain.dig':
    "dig interroge le DNS : adresses (A), serveurs de mail (MX), serveurs de noms (NS), textes (TXT). C'est de la reconnaissance passive, la requête part vers un résolveur et pas vers la cible.\n---\nUne requête DNS classique est invisible pour la cible. Un transfert de zone (AXFR) ou des centaines de sous-domaines testés à la suite se voient, eux, dans les logs du serveur DNS.",
  'explain.whois':
    "whois affiche la fiche publique d'un domaine : propriétaire, dates, serveurs de noms. On y trouve parfois des noms et des adresses utiles pour la suite.\n---\nLa consultation est invisible pour la cible. La parade est en amont : ne publier que le strict nécessaire dans la fiche.",
  'explain.nmap':
    "nmap envoie des paquets vers une machine ou une plage d'adresses pour savoir ce qui répond et quels services écoutent. -sn se limite à repérer les hôtes, -sV interroge chaque service pour connaître sa version, -T règle la vitesse.\n---\nUn scan laisse des dizaines de connexions refusées dans les logs du pare-feu en quelques secondes. Plus il est rapide (-T4, -A), plus la règle de détection est simple à écrire. C'est l'action la plus bruyante de la reconnaissance.",
  'explain.curl':
    "curl envoie une requête HTTP et affiche la réponse brute. -I ne montre que les en-têtes, qui trahissent souvent le serveur et sa version. -d envoie des données (requête POST), par exemple un message à l'API d'un assistant.\n---\nChaque requête est enregistrée dans le journal d'accès du serveur web, avec ton adresse IP, l'heure, la page demandée et ton User-Agent. Beaucoup de pages 404 à la suite signalent quelqu'un qui cherche à l'aveugle.",
  'explain.ping':
    "ping envoie un petit paquet ICMP et mesure le temps de réponse. Il sert à vérifier qu'une machine est joignable.\n---\nUn ping isolé passe inaperçu. Un balayage de toute une plage, lui, apparaît dans les logs du pare-feu.",
  'explain.ssh':
    "ssh ouvre un terminal chiffré sur une autre machine, avec un mot de passe ou une clé. C'est l'outil principal pour se déplacer d'une machine à l'autre.\n---\nChaque tentative, réussie ou non, est écrite dans le journal d'authentification de la machine (auth.log). Des échecs répétés déclenchent une alerte et un blocage automatique.",
  'explain.git':
    "git clone copie un dépôt avec tout son historique. git log liste les commits, git show affiche ce qu'un commit a changé. Un secret supprimé d'un fichier reste lisible dans les anciens commits.\n---\nLe clone d'un dépôt public est une action normale, peu visible. La parade est en amont : scanner les secrets avant chaque push, et révoquer immédiatement toute clé qui a été publiée, même brièvement.",

  'mission.none': 'Aucune mission en cours.',
  'mission.label': 'Mission',
  'mission.optional': '(bonus)',
  'hint.none': "Pas d'indice disponible pour l'instant.",
  'notes.usage': 'usage : notes add <texte>',
  'notes.added': 'Noté.',
  'notes.empty': 'Carnet vide. Ajoute une note avec : notes add <texte>',
  'submit.usage': 'usage : submit FLAG{...}',
  'submit.wrong': "Ce n'est pas un flag de cette mission.",
  'submit.already': 'Flag déjà validé.',
  'submit.ok': 'FLAG VALIDÉ',
  'cmd.sort': 'Trier des lignes (-n nombres, -r inverse, -u sans doublon, -k champ)',
  'cmd.uniq': 'Fusionner les lignes identiques qui se suivent (-c les compte)',
  'cmd.cut': 'Garder certaines colonnes de chaque ligne (-d séparateur, -f champs)',
  'cmd.tr': 'Remplacer ou supprimer des caractères dans un flux (-d)',
  'cmd.diff': 'Montrer les lignes qui diffèrent entre deux fichiers',
  'cmd.base64': 'Encoder en Base64, ou décoder avec -d',
  'cmd.sha256sum': "Afficher l'empreinte SHA-256 d'un fichier",
  'cmd.sed': "Réécrire des lignes : `sed 's/ancien/nouveau/' fichier`, -i modifie le fichier",
  'cmd.verify': 'Vérifier que ta correction tient',
  'cmd.answer': "Répondre à la question d'Ada : `answer a`",
  'cmd.edit': "Ouvrir un fichier dans l'éditeur",
  'cmd.nano': "Ouvrir un fichier dans l'éditeur (comme edit)",
  'engine.edit': "Ouverture de {path} dans l'éditeur…",
  'verify.none': "Rien à vérifier pour l'instant.",
  'verify.ok': 'Tous les contrôles passent.',
  'verify.failed': '{n} contrôle(s) en échec. Corrige le fichier, puis relance verify.',
  'answer.none': "Ada n'a pas de question en attente.",
  'answer.usage': 'Réponds avec sa lettre, par exemple : answer a',
  'answer.right': 'Exact.',
  'answer.wrong': 'Pas tout à fait. Essaie encore.',
  'explain.diff':
    "diff compare deux fichiers ligne à ligne : les lignes `<` ne sont que dans le premier, les lignes `>` que dans le second. C'est ainsi qu'on repère ce qui a changé entre deux versions d'un script ou d'une configuration.\n---\nComparer ce qui est déployé avec ce qui est dans le dépôt est un contrôle d'intégrité de base. Plusieurs attaques de la chaîne logicielle ont été découvertes exactement comme ça : le fichier publié n'était pas celui des sources.",
  'explain.base64':
    "base64 transforme n'importe quels octets en lettres et chiffres, et l'inverse avec -d. C'est un encodage, pas un chiffrement : tout le monde peut le décoder, sans clé.\n---\nUn secret « caché » en Base64 dans une configuration ou un jeton est un secret en clair. Les secrets vont dans un coffre, et les outils de détection décodent le Base64 avant de chercher.",
  'explain.sha256sum':
    "sha256sum affiche l'empreinte d'un fichier. Un seul caractère changé, et l'empreinte change du tout au tout.\n---\nPublier l'empreinte d'une version et la vérifier avant de lancer le fichier détecte un téléchargement modifié, à condition que l'empreinte arrive par un autre canal que le fichier.",
  'explain.sed':
    "sed réécrit du texte ligne à ligne. `sed 's/ancien/nouveau/' fichier` affiche le résultat, `sed -i` modifie le fichier lui-même, et `sed '/mot/d'` supprime les lignes qui correspondent.\n---\nUne correction faite à la main sur un serveur est perdue au prochain déploiement. La correction durable va dans le dépôt et dans la chaîne de déploiement.",
};
