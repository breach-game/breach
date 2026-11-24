export const en: Record<string, string> = {
  'engine.outOfScope': 'target "{target}" is outside the scope of mandate {mandate}. Nothing was sent.',
  'engine.detected.line1': 'Connection reset by peer',
  'engine.detected.line2':
    '[{target} SOC] Suspicious activity detected. Session cut, back to the last checkpoint.',
  'stage.cadrage': 'scoping',
  'stage.recon': 'reconnaissance',
  'stage.social': 'social engineering',
  'stage.injection': 'prompt injection',
  'stage.indirect': 'indirect prompt injection',
  'stage.agency': 'excessive agency',
  'stage.lateral': 'lateral movement',
  'stage.analysis': 'analysis',
  'stage.defense': 'defence',
  'stage.response': 'incident response',
  'stage.access': 'initial access',
  'stage.escalation': 'privilege escalation',
  'stage.supply': 'supply chain',
  'stage.cloud': 'cloud',
  'stage.rag': 'shared index',
  'stage.memory': 'memory poisoning',
  'stage.agents': 'agent impersonation',
  'stage.logic': 'business logic',
  'stage.disclosure': 'disclosure',
  'stage.phishing': 'phishing',
  'stage.iot': 'connected devices',
  'stage.firmware': 'firmware',
  'stage.web': 'web flaws',
  'stage.decision': 'decision',
  'stage.lessons': 'lessons learned',
  'stage.recovery': 'recovery',
  'engine.flagHint': 'A code is validated with the submit command. Type: submit {flag}',
  'engine.restricted':
    'tool not installed on this training workstation (LR-OS). Type `help` to see what is available.',
  'engine.gitUnavailable': 'is not available on this workstation. Try clone, log, show, status or remote.',
  'engine.sudo': 'This incident will be reported to Ada.',
  'engine.exit': 'You are on your own workstation. Nothing to leave.',
  'save.update.restart':
    'BREACH was updated while you were away, and the mission you had started cannot pick up where you left it. Your finished missions and their scores are kept. This one starts again from the beginning.',
  'save.update.kept':
    'BREACH was updated while you were away. Your finished missions and their scores are kept, let us carry on.',
  'save.import':
    'Progress imported. Your finished missions and their scores are here, we pick up at the next one.',
  'save.mission.restart':
    'This mission was updated since you last played it. Your save no longer applies: it starts again from the beginning.',

  'help.group.game': 'Game',
  'help.group.files': 'Files',
  'help.group.network': 'Network',
  'help.group.system': 'System',
  'help.footer':
    'explain <command>: what a tool does, and how a defender spots it. Tab completes, arrows recall.',

  'cmd.help': 'List available commands',
  'cmd.explain': 'Explain a tool and how defenders detect it',
  'cmd.man': 'Alias for explain',
  'cmd.mission': 'Show the briefing and objectives again',
  'cmd.hint': 'Ask Ada for a hint (three levels)',
  'cmd.notes': 'Notebook: `notes add <text>` or `notes`',
  'cmd.submit': 'Submit a flag you found: `submit FLAG{...}`',
  'cmd.pwd': 'Print the current directory',
  'cmd.cd': 'Change directory',
  'cmd.ls': 'List a directory (-l, -a)',
  'cmd.cat': 'Print a file',
  'cmd.echo': 'Print text',
  'cmd.grep': 'Search for a pattern in files or a stream (-i, -n, -v, -r)',
  'cmd.head': 'First lines of a file (-n)',
  'cmd.tail': 'Last lines of a file (-n)',
  'cmd.wc': 'Count lines, words and bytes',
  'cmd.find': 'Search for files (-name, -type)',
  'cmd.dig': 'Query the DNS',
  'cmd.whois': 'Registration record of a domain',
  'cmd.nmap': 'Discover hosts and services',
  'cmd.curl': 'Send an HTTP request (-I headers, -d sends data)',
  'cmd.open': 'Open an address in the browser',
  'engine.open': 'Opening {url} in the browser…',
  'explain.open':
    'open shows an address in the workstation browser. The browser draws the page as a visitor would see it, and "View source" shows what the server really sent, comments included.\n---\nFor the server, a browser visit and a curl request are the same line in the access log. Browsing like a normal visitor blends into the usual traffic.',
  'cmd.ping': 'Check whether a host answers',
  'cmd.ssh': 'Open a remote session',
  'cmd.mqtt': 'sub, pub: listen or publish on the message broker of connected devices',
  'cmd.git': 'clone, log, show: read a repository and its history',
  'cmd.whoami': 'Print your user name',
  'cmd.id': 'Print your identity and groups',
  'cmd.hostname': 'Print the name of your machine',
  'cmd.date': 'Print the in-game date',
  'cmd.uname': 'Print the system',
  'cmd.clear': 'Clear the screen',
  'cmd.history': 'Show the commands you typed',
  'cmd.sudo': 'Run as administrator',
  'cmd.exit': 'Close the session',
  'cmd.logout': 'Leave the SSH session',

  'explain.usage': 'usage: explain <command>',
  'explain.unknown': 'explain: unknown "{name}". Type `help` for the list.',
  'explain.defense': 'Defender side',
  'explain.grep':
    "grep filters lines that match a pattern. In an audit it is used to dig through configuration files, repositories or logs for words such as password, key or token.\n---\ngrep is also the defender's tool: it (or its SIEM equivalent) is how you search logs for an attacker's traces.",
  'explain.dig':
    'dig queries the DNS: addresses (A), mail servers (MX), name servers (NS), text records (TXT). It is passive reconnaissance: the query goes to a resolver, not to the target.\n---\nA regular DNS query is invisible to the target. A zone transfer (AXFR) or hundreds of subdomains tried in a row do show up in the DNS server logs.',
  'explain.whois':
    'whois prints the public record of a domain: owner, dates, name servers. It sometimes holds names and addresses that help later.\n---\nLooking it up is invisible to the target. The defence comes earlier: publish only what is strictly required in the record.',
  'explain.nmap':
    'nmap sends packets to a machine or an address range to learn what answers and which services listen. -sn only finds hosts, -sV asks each service for its version, -T sets the speed.\n---\nA scan leaves dozens of refused connections in the firewall logs within seconds. The faster it is (-T4, -A), the easier the detection rule is to write. It is the noisiest action of reconnaissance.',
  'explain.curl':
    'curl sends an HTTP request and prints the raw response. -I shows only the headers, which often give away the server and its version. -d sends data (a POST request), for example a message to the API of an assistant.\n---\nEvery request is recorded in the web server access log, with your IP address, the time, the page and your User-Agent. Many 404 pages in a row point to someone searching blindly.',
  'explain.ping':
    'ping sends a small ICMP packet and measures the response time. It checks that a machine is reachable.\n---\nA single ping goes unnoticed. Sweeping a whole range shows up in the firewall logs.',
  'explain.ssh':
    "ssh opens an encrypted terminal on another machine, with a password or a key. It is the main tool for moving from one machine to the next.\n---\nEvery attempt, successful or not, is written to the machine's authentication log (auth.log). Repeated failures raise an alert and an automatic ban.",
  'explain.mqtt':
    'MQTT is the protocol sensors and controllers use to exchange small messages, filed by topic on a broker. mqtt sub listens to a topic (# stands for everything below), mqtt pub publishes a message to it. A broker with no accounts and no rights per topic lets anyone read the measurements and send orders.\n---\nThe broker logs every connection, subscription and publication with the client name. A subscription to # or an order published by a sensor are good alert signals.',
  'explain.git':
    'git clone copies a repository with its whole history. git log lists commits, git show prints what a commit changed. A secret removed from a file is still readable in older commits.\n---\nCloning a public repository is a normal, barely visible action. The defence comes earlier: scan for secrets before every push, and revoke at once any key that was published, even briefly.',

  'mission.none': 'No mission in progress.',
  'mission.label': 'Mission',
  'mission.optional': '(bonus)',
  'hint.none': 'No hint available right now.',
  'notes.usage': 'usage: notes add <text>',
  'notes.added': 'Noted.',
  'notes.empty': 'Notebook is empty. Add a note with: notes add <text>',
  'submit.usage': 'usage: submit FLAG{...}',
  'submit.wrong': 'That is not a flag of this mission.',
  'submit.already': 'Flag already validated.',
  'submit.unseen':
    'The target never showed you this flag. Get it to appear on your screen first, then submit it.',
  'submit.ok': 'FLAG VALIDATED',
  'engine.failed.line1': '[{target} SOC] The attacker reached its goal.',
  'engine.failed.line2': 'The attack got through. Back to the last checkpoint: try another way.',
  'submit.revoked': 'This secret is worthless now: the target revoked it.',
  'defense.replay.unseen':
    '(replay) This flag never showed up during the replay: the attack no longer gets it.',
  'cmd.soc': 'SOC console: logs, search, alerts',
  'cmd.contain': 'Order a containment measure',
  'explain.soc':
    "soc is the console of the security operations centre (SOC). 'soc sources' lists the available logs, 'soc logs <host> [source]' prints them, 'soc search <text>' searches everywhere, 'soc alerts' shows what the detection rules raised. Every line comes from the game's event log, in the real tool's format (nginx, sshd, auditd...).",
  'explain.contain':
    "contain applies a containment measure: block an address, revoke a key, isolate a machine, switch off an agent's tool. Each measure stops part of the attack but costs the business something: the impact gauge shows it. Type 'contain' alone to see the measures available.",
  'soc.unavailable': 'The SOC console is only open during a defence mission.',
  'soc.usage': 'usage: soc sources | soc logs [host] [source] | soc search <text> | soc alerts',
  'contain.usage': 'usage: contain <action> <target>. Available measures:',
  'contain.unknown': 'no such measure is planned for this target',
  'contain.already': 'Measure already applied.',
  'contain.impact': 'Impact on {target}: +{impact}',
  'investigation.usage': 'usage: answer <question> <answer>. Questions:',
  'investigation.wrong': 'That is not the right answer.',
  'investigation.ok': 'ANSWER ACCEPTED',
  'cmd.report': 'writes the pentest report from your missions',
  'report.title': 'Penetration test report · {target} (mandate {mandate})',
  'report.client': 'Client: {target}',
  'report.auditor': 'Auditor: Ligne Rouge, operator kestrel, led by Ada',
  'report.date': 'Written on: {date}',
  'report.summary': 'Summary',
  'report.summary.text':
    '{attacks} intrusion finding(s) and {incidents} incident(s) handled in incident response. Total score: {score}. Every finding was replayed against the fixed target: the fix listed blocks the attack.',
  'report.empty': 'No mission finished yet: the report fills up along the campaign.',
  'report.findings': 'Findings',
  'report.class': 'Class:',
  'report.recommendations': 'Recommendations',
  'report.detection': 'Proposed detection:',
  'report.fix': 'Validated fix:',
  'report.fix.verified': '(the replayed attack fails)',
  'report.incidents': 'Incident response',
  'report.containment': 'Containment measures',
  'report.impact': 'impact {impact} %',
  'report.footer':
    'Fictional document produced in BREACH. {target}, its addresses and its data do not exist.',
  'report.saved': 'Report written to {path}',
  'cmd.sort': 'Sort lines (-n numbers, -r reverse, -u unique, -k field)',
  'cmd.uniq': 'Merge repeated lines that follow each other (-c counts them)',
  'cmd.cut': 'Keep some columns of each line (-d delimiter, -f fields)',
  'cmd.tr': 'Replace or delete characters in a stream (-d)',
  'cmd.diff': 'Show the lines that differ between two files',
  'cmd.base64': 'Encode to Base64, or decode with -d',
  'cmd.sha256sum': 'Print the SHA-256 fingerprint of a file',
  'cmd.sed': "Rewrite lines: `sed 's/old/new/' file`, -i changes the file",
  'cmd.verify': 'Check that what you fixed holds',
  'cmd.answer': 'Answer Ada: `answer a` for her questions, `answer <question> <answer>` in an investigation',
  'cmd.edit': 'Open a file in the editor',
  'cmd.nano': 'Open a file in the editor (same as edit)',
  'engine.edit': 'Opening {path} in the editor…',
  'verify.none': 'Nothing to verify right now.',
  'verify.ok': 'All checks pass.',
  'verify.failed': '{n} check(s) still fail. Fix the file, then run verify again.',
  'answer.none': 'Ada has no open question.',
  'answer.submit': 'A value the mission asks for (an address, a name, a path…) is sent with submit <value>.',
  'answer.usage': 'Answer with its letter, for example: answer a',
  'answer.decided': 'Decision made.',
  'cmd.strings': 'Print the readable text hidden in a binary file: strings <file>',
  'explain.strings':
    'strings prints every run of at least four readable characters in a file. In a program or a firmware image, it shows the addresses, keys and messages the code carries, without running anything.',
  'cmd.file': 'Tell what kind of file this is, from its content: file <file>',
  'explain.file':
    'file reads the first bytes of a file and says what it is, whatever its name says. A ".pdf" that is really a program is the first thing an analyst wants to know.',
  'cmd.unzip': 'List or extract a zip archive: unzip -l <file>, unzip <file> -d <folder>',
  'explain.unzip':
    'unzip -l lists an archive without opening it, unzip -p prints one member, unzip extracts it. Look at the list first: a member whose path climbs out of the folder (../) is a classic trap.',
  'cmd.tar': 'List or extract a tar archive: tar -tvf <file>, tar -xzf <file>',
  'explain.tar':
    'tar -t lists the members of an archive, tar -x extracts them, z for a .tar.gz, v for details. A release archive can hold files that are not in the repository it claims to come from.',
  'cmd.openssl':
    'Read a certificate or a fingerprint: openssl x509 -in <cert> -noout -text, openssl dgst -sha256 <file>',
  'explain.openssl':
    'openssl x509 reads a certificate: who it names (subject), who signed it (issuer), its dates and its other names. openssl dgst computes the fingerprint of a file, to compare it with the published one.',
  'cmd.hashid': 'Guess which algorithm made a hash, from its shape: hashid <hash>',
  'explain.hashid':
    'hashid only looks at the shape of a hash (length, prefix) and lists the algorithms that could have produced it. It cracks nothing: knowing the algorithm tells a defender whether stored passwords hold out.',
  'cmd.sbom': 'List the components of a project, and their known weaknesses: sbom <folder> [--vuln]',
  'explain.sbom':
    'sbom reads the lock files of a project and lists every component it really installs, with its exact version (a software bill of materials). With --vuln, it matches them against published advisories.',
  'cmd.mailhdr': 'Read the headers of a message: sender, route, SPF, DKIM, DMARC: mailhdr <file.eml>',
  'explain.mailhdr':
    'mailhdr lays out what a mail client hides: the real return address, the servers the message went through (oldest first), and what SPF, DKIM and DMARC concluded about the sender.',
  'cmd.nmcli':
    'Wi-Fi networks in range, and the ones this machine saved: nmcli device wifi list, nmcli connection show',
  'explain.nmcli':
    'nmcli device wifi list shows what every access point announces to anyone nearby: its name, channel, signal and the protection it asks for. It is the list your phone shows, nothing is captured. A network that is not yours stays out of scope, even when it is open.',
  'nmcli.usage':
    'usage: nmcli [-f FIELDS] device wifi list | nmcli [-f FIELDS] connection show | nmcli connection delete <name> | nmcli connection modify <name> connection.autoconnect yes|no',
  'cmd.tshark': 'Read a capture file: tshark -r <file.pcap> [-Y filter] [-V] [-q -z conv,ip]',
  'explain.tshark':
    'tshark -r lists the packets of a capture someone already took: who talked to whom, the names asked to the DNS, the name in each TLS hello, and anything sent in plain HTTP. Encrypted records show only their size. -Y filters (dns, tls, http, ip.addr==…), -V unfolds each packet, -q -z conv,ip sums the conversations. The game never captures anything live.',
  'tshark.live':
    'tshark: live capture is not part of this game. Read a capture file instead: tshark -r <file.pcap>',
  'tshark.usage': 'usage: tshark -r <file.pcap> [-Y <display filter>] [-V] [-q -z conv,ip|conv,tcp]',
  'cmd.exiftool': 'Read or remove the metadata of a photo: exiftool <photo>, exiftool -all= <photo>',
  'explain.exiftool':
    'exiftool shows what a camera or a phone wrote inside a photo: the device, the date, sometimes the exact place it was taken. `exiftool -all= photo.jpg` removes it all, `-gps:all=` only the position. Check before you publish.',
  'cmd.clip': 'Show what is on the clipboard, without pasting it: clip',
  'cmd.paste': 'Show what is on the clipboard (xclip -o, xsel -b -o, pbpaste, wl-paste)',
  'explain.clip':
    'A web page can put a text on your clipboard without showing it, then ask you to paste it somewhere. clip prints that text and runs nothing: read what you were about to paste.',
  'engine.clip.empty': 'clip: the clipboard is empty',
  'cmd.zbarimg': 'Read the QR code in a picture: zbarimg <image>',
  'explain.zbarimg':
    'zbarimg prints what a QR code holds, without opening it. A QR code is only a text: an address, a Wi-Fi network, a phone number. Read it before a phone acts on it.',
  'cmd.qr': 'Look at a QR code: qr decode <image> (what it holds and where it leads), qr show <image>',
  'explain.qr':
    'qr decode reads a QR code and says what a phone would do with it: open which site, join which Wi-Fi network. qr show draws the code. Its addresses are reserved names that lead nowhere.',
  'qr.usage': 'usage: qr decode <image> | qr show <image>',
  'qr.viewer': 'Opened in the image viewer: {file}',
  'qr.shown': '(drawn by the game; its address is a reserved name that leads nowhere)',
  'cmd.sms': 'Read the text messages of the phone under review: sms, then sms <number>',
  'explain.sms':
    'sms lists the inbox, and sms <number> shows one message with what the phone hides: the kind of sender (a name is free text anyone can set) and the site each link really opens.',
  'cmd.call': 'Telephone someone: call <number> "<what you say>"',
  'explain.call':
    'call dials a number and says one sentence. Calling back a number you already know, never the one in the message, is how a fake request is checked. The exchange keeps a record of every call.',
  'cmd.crontab': "List an account's scheduled jobs: crontab -l",
  'explain.crontab':
    'crontab -l shows the jobs the system runs at fixed times for this account. It is a classic place where an intruder leaves a way back in.',
  'crontab.readonly':
    'crontab: this machine is under investigation, nothing is changed by hand here. A job is removed by a containment order (contain).',
  'cmd.rule': 'Try a detection rule written in a file: rule test <file>',
  'explain.rule':
    'rule test reads your rule (source, then one field per line) and runs it over the logs of the mission. It counts the alerts on the attack and the false alerts on ordinary activity.',
  'rule.usage':
    'usage: rule test <file>\nA rule: one line "source: auth", then one field per line (user: name, src|startswith: 10.16.0.1, cmd|contains: word).',
  'rule.syntax': 'rule: cannot read this line: {line}',
  'eval.field': 'No tool call has a field named {name}. Their fields: {fields}.',
  'rule.field': 'No line of this source has a field named {name}. Its fields: {fields}.',
  'rule.nohunt': 'The mission does not expect this rule: result given for information.',
  'rule.pass': 'Rule accepted: {n} line(s) of the attack detected, no false alert.',
  'rule.false': '{n} false alert(s) on ordinary activity (lines marked "?"). Tighten the selection.',
  'cmd.eval': 'Try a guardrail written in a file: eval run <file>',
  'explain.eval':
    '`eval run <file>` tries a guardrail against the cases of the mission: attack requests, which it must block, and legitimate requests, which it must let through. One condition per line (`field: value`, or `field|contains`, `field|startswith`, `field|gte`); a request that meets them all is blocked.',
  'eval.usage':
    'usage: eval run <file>. The file holds one condition per line, for example `tool: refund`. A request that meets every condition is blocked.',
  'eval.none': 'No test set of the mission reads this file.',
  'eval.pass': 'Guardrail accepted: every attack is blocked, no legitimate request is.',
  'eval.wrongly': '{n} legitimate request(s) blocked (lines marked "!"). The guardrail is too broad.',
  'eval.missed': '{n} attack(s) still get through (lines marked "!").',
  'rule.early': 'No line of the attack is in the logs yet: run the test again in a moment.',
  'rule.missed': '{n} line(s) of the attack to detect still escape the rule.',
  'answer.right': 'Correct.',
  'answer.wrong': 'Not quite. Try again.',
  'explain.diff':
    'diff compares two files line by line: `<` lines are only in the first, `>` lines only in the second. It is how you spot what changed between two versions of a script or a configuration.\n---\nComparing what is deployed with what is in the repository is a basic integrity check. Several supply-chain attacks were found exactly this way: the published file was not the one in the source.',
  'explain.base64':
    'base64 turns any bytes into plain letters and digits, and back with -d. It is an encoding, not encryption: anyone can decode it, no key needed.\n---\nA secret "hidden" in Base64 in a configuration or a token is a secret in clear text. Secrets belong in a vault, and detection tools decode Base64 before they search.',
  'explain.sha256sum':
    'sha256sum prints the fingerprint of a file. Change one character and the fingerprint changes completely.\n---\nPublishing the fingerprint of a release and checking it before running the file detects a tampered download, as long as the fingerprint comes from another channel than the file.',
  'explain.sed':
    "sed rewrites text line by line. `sed 's/old/new/' file` prints the result, `sed -i` changes the file itself, and `sed '/word/d'` deletes the matching lines.\n---\nA fix applied by hand on one server is lost at the next deployment. The lasting fix goes into the repository and the deployment pipeline.",
  'cmd.jq': "Read JSON: jq '.field' file, jq '.list[].name'",
  'cmd.jwt': 'Read a JWT: jwt decode <token>',
  'cmd.review': 'Review a file line by line: review <file>, then review <file> <line>',
  'review.mark': 'faulty line',
  'review.usage':
    'Name a faulty line: review {file} <number>\n{found}/{total} found. A mistake costs 10 points.',
  'review.range': 'Give a line number between 1 and {n}.',
  'review.none': 'This file is not under review, or the review is over.',
  'review.again': 'You already named this line.',
  'review.wrong': 'Line {line}: not this one. Read the file again: look for the line the problem comes from.',
  'review.right': 'Line {line}: yes, that is one of the faulty lines. {left} left.',
  'review.done': 'Line {line}: yes. Review complete, every faulty line is found.',
  'explain.jq':
    'jq reads JSON and prints what you ask for: `.field`, `.list[0]`, `.list[].name`, `keys`, `length`. An API often returns many more fields than the page shows: jq lets you see them.\n---\nFor the defender the lesson is about the API: it should only return the fields the page needs. What a browser does not show is not hidden.',
  'explain.jwt':
    'jwt decode reads a JWT. Its first two parts are Base64: anyone can read them, without a key. The third is the signature, which proves the server issued the token, provided the server checks it.\n---\nA token must hold nothing secret, and the server must refuse a token without a valid signature (never the `none` algorithm). The SOC watches for bursts of refused tokens.',
  'cmd.ps': 'List the processes of the machine you are on: ps aux, ps -ef',
  'explain.ps':
    "ps lists what runs on the machine: owner, process number, parent, start time and command line. An intruder's program often hides behind an ordinary name: look at its path, its owner and when it started.",
  'cmd.ss': 'List network sockets: ss -tlnp (listening), ss -tnp (connections)',
  'explain.ss':
    'ss shows which ports the machine listens on and which connections are open, with -p the process behind each one. A program that talks to an unknown address, or a port nobody opened on purpose, stands out here.',
  'cmd.systemctl': 'State of the services: systemctl status <unit>, systemctl list-units',
  'explain.systemctl':
    'systemctl status tells whether a service runs, since when, from which file and with which command, then shows its last journal lines. A service added by an intruder comes back after every restart: it is a classic way to stay.',
  'cmd.journalctl': 'Read the system journal: journalctl -u <unit> [-n 20] [-g word]',
  'explain.journalctl':
    'journalctl reads what services wrote in the system journal. -u keeps one service, -n the last lines, -g those that contain a word.',
  'cmd.last': 'Past and current sessions on this machine: last [-n 10] [user]',
  'explain.last':
    'last reads the record of sessions opened on the machine: who, from where, when, and for how long. A session at night, from an unusual address, is worth a question.',
  'host.readonly':
    '{command}: this machine is under investigation, nothing is changed by hand here. A service is stopped by a containment order (contain).',
  'cmd.kubectl': 'Ask a Kubernetes cluster: kubectl get|describe|logs … [-n namespace]',
  'explain.kubectl':
    "kubectl asks the cluster's API server what runs there: pods, deployments, accounts, rights. Every request goes through the API server and lands in its log. A token found somewhere is only worth the rights of its account: read them before anything else.",
  'cmd.ldapsearch': 'Search a directory: ldapsearch -x -H ldap://<host> -b <base> "(filter)" [attributes]',
  'explain.ldapsearch':
    'ldapsearch reads a company directory: accounts, groups, who belongs to which group. Filters look like (&(objectClass=user)(memberOf=cn=admins,…)). A directory that answers without a password tells anyone how the company is organised.',
  'cmd.flows': 'Sum up the firewall flow log: flows [--src ip] [--dst ip] [--port n]',
  'explain.flows':
    'flows groups the firewall log by conversation: who talked to whom, on which port, how many times, how many bytes. A machine that sends far more than it receives is a first sign of a leak. No packet is ever captured: only the log the firewall writes.',
  'cmd.deploy': 'Put a version of a service in production: deploy <service> <version>',
  'explain.deploy':
    'deploy puts a version of a service in production, rollback takes the previous one back. In a crisis, going back to a known version is often the fastest repair: it is also a change, with its own cost.',
  'cmd.rollback': 'Take back the previous version of a service: rollback <service>',
  'cmd.flag': 'Feature flags of the target: flag list, flag set <name> on|off',
  'explain.flag':
    'A feature flag turns a part of an application on or off without deploying anything. Switching off a faulty feature buys time while the real fix is written.',
  'deploy.none': 'There is no deployment pipeline in this mission.',
  'deploy.usage':
    'usage: deploy <service> <version>  (rollback <service> takes the previous one back)\nServices and versions, the running one marked *:',
  'deploy.unknown': '{service}: no such service',
  'deploy.version': '{service}: no version {version}',
  'deploy.same': '{service}: version {version} already runs',
  'deploy.nothing': '{service}: no previous version to go back to',
  'flag.none': 'This target has no feature flags.',
  'flag.unknown': 'no such feature flag',
  'cmd.timeline': 'Put events back in order: timeline <id> <event> <event>…',
  'timeline.none': 'There is no timeline to rebuild in this mission.',
  'timeline.usage':
    'usage: timeline <id> to see its events, then timeline <id> <event> <event>… from the oldest to the newest',
  'timeline.how':
    'Give them from the oldest to the newest: timeline {id} <event> <event>… (a wrong order costs 10 points)',
  'timeline.unknown': 'timeline: unknown events: {ids}',
  'timeline.done': 'This timeline is already in order.',
  'timeline.right': 'Timeline in order.',
  'timeline.wrong': 'Not yet: {placed} of {total} events in the right place. 10 points lost.',
  'cmd.path': 'Name the hosts of a path, in order (an attack, a recovery…): path <id> <host> <host>…',
  'path.none': 'There is no attack path to trace in this mission.',
  'path.usage':
    'usage: path <id> <host> <host>… in the order the question asks (hostnames, short names or addresses)',
  'path.unknown': 'path: unknown hosts: {hosts}',
  'path.done': 'This path is already traced.',
  'path.right': 'Path traced.',
  'path.wrong': 'Not this path. 10 points lost.',
};
