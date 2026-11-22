export const en: Record<string, string> = {
  'engine.outOfScope': 'target "{target}" is outside the scope of mandate {mandate}. Nothing was sent.',
  'engine.detected.line1': 'Connection reset by peer',
  'engine.detected.line2':
    '[NovaMind SOC] Suspicious activity detected. Session cut, back to the last checkpoint.',
  'stage.cadrage': 'scoping',
  'stage.recon': 'reconnaissance',
  'engine.flagHint': 'A code is validated with the submit command. Type: submit {flag}',
  'engine.restricted':
    'tool not installed on this training workstation (LR-OS). Type `help` to see what is available.',
  'engine.gitUnavailable': 'is not available on this workstation. Try clone, log, show, status or remote.',
  'engine.sudo': 'This incident will be reported to Ada.',
  'engine.exit': 'You are on your own workstation. Nothing to leave.',

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
  'submit.ok': 'FLAG VALIDATED',
};
