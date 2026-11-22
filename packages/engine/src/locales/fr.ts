export const fr: Record<string, string> = {
  'engine.outOfScope': "cible « {target} » hors du périmètre du mandat {mandate}. Rien n'a été envoyé.",
  'engine.detected.line1': 'Connection reset by peer',
  'engine.detected.line2':
    '[SOC NovaMind] Activité suspecte détectée. Session coupée, retour au dernier point de sauvegarde.',
  'engine.flagHint': 'Un code se valide avec la commande submit. Tape : submit {flag}',
  'engine.restricted':
    "outil non installé sur ce poste d'entraînement (LR-OS). Tape `help` pour voir ce qui est disponible.",
  'engine.gitUnavailable': "n'est pas disponible sur ce poste. Essaie clone, log, show, status ou remote.",
  'engine.sudo': 'Cet incident sera signalé à Ada.',
  'engine.exit': 'Tu es sur ton propre poste. Rien à quitter.',

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
  'cmd.curl': 'Envoie une requête HTTP (-I pour les en-têtes)',
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
    "curl envoie une requête HTTP et affiche la réponse brute. -I ne montre que les en-têtes, qui trahissent souvent le serveur et sa version.\n---\nChaque requête est enregistrée dans le journal d'accès du serveur web, avec ton adresse IP, l'heure, la page demandée et ton User-Agent. Beaucoup de pages 404 à la suite signalent quelqu'un qui cherche à l'aveugle.",
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
};
