import type { Host } from '@breach/pack-schema';
import { FilterError, ldif, parseFilter } from '../ldap.ts';
import { resolveTarget, type Target } from '../net.ts';
import { canRead, lookup } from '../vfs.ts';
import { type Chunk, type Command, type CommandCtx, err, getopt, out, type Run, wait } from './types.ts';

/**
 * Clients of a cluster and a directory. Both go through the scope guard like every network command.
 * `kubectl` asks the API server for a path, which the pack answers as a web route (its variants
 * apply: a token is an `Authorization: Bearer` header); `ldapsearch` reads a directory declared as
 * data on the host. Neither changes anything.
 */

function* gate(
  ctx: CommandCtx,
  raw: string,
): Generator<Chunk, Exclude<Target, { kind: 'out-of-scope' }> | null> {
  const target = resolveTarget(ctx.world, raw);
  if (target.kind !== 'out-of-scope') return target;
  ctx.emit({ type: 'OutOfScope', target: raw, command: ctx.name });
  yield err(`${ctx.name}: ${ctx.t('engine.outOfScope', { target: raw })}`);
  return null;
}

/* ---------- kubectl ---------- */

interface Kind {
  plural: string;
  group: string;
  namespaced: boolean;
}
const core = (plural: string, namespaced = true): Kind => ({ plural, group: '', namespaced });
const KINDS: Record<string, Kind> = {};
for (const [names, kind] of [
  [['po', 'pod', 'pods'], core('pods')],
  [['svc', 'service', 'services'], core('services')],
  [['secret', 'secrets'], core('secrets')],
  [['cm', 'configmap', 'configmaps'], core('configmaps')],
  [['sa', 'serviceaccount', 'serviceaccounts'], core('serviceaccounts')],
  [['ev', 'event', 'events'], core('events')],
  [['ns', 'namespace', 'namespaces'], core('namespaces', false)],
  [['no', 'node', 'nodes'], core('nodes', false)],
  [['deploy', 'deployment', 'deployments'], { plural: 'deployments', group: 'apps', namespaced: true }],
  [['ds', 'daemonset', 'daemonsets'], { plural: 'daemonsets', group: 'apps', namespaced: true }],
  [['role', 'roles'], { plural: 'roles', group: 'rbac.authorization.k8s.io', namespaced: true }],
  [
    ['rolebinding', 'rolebindings'],
    { plural: 'rolebindings', group: 'rbac.authorization.k8s.io', namespaced: true },
  ],
  [
    ['clusterrole', 'clusterroles'],
    { plural: 'clusterroles', group: 'rbac.authorization.k8s.io', namespaced: false },
  ],
  [
    ['clusterrolebinding', 'clusterrolebindings'],
    { plural: 'clusterrolebindings', group: 'rbac.authorization.k8s.io', namespaced: false },
  ],
] as [string[], Kind][])
  for (const n of names) KINDS[n] = kind;

/** The API path kubectl asks for, as the API server's access log records it. */
export function kubePath(kind: Kind, ns: string | null, name?: string): string {
  const prefix = kind.group ? `/apis/${kind.group}/v1` : '/api/v1';
  const scope = kind.namespaced && ns ? `/namespaces/${ns}` : '';
  return `${prefix}${scope}/${kind.plural}${name ? `/${name}` : ''}`;
}

/** `server:`, `token:` and `namespace:` from the player's kubeconfig, when there is one. */
function kubeconfig(ctx: CommandCtx): { server?: string; token?: string; namespace?: string } {
  const node = lookup(ctx.state.fs, `${ctx.game.home}/.kube/config`);
  if (node?.t !== 'f' || !canRead(node, ctx.game.currentUser)) return {};
  const pick = (key: string) =>
    new RegExp(`^\\s*${key}:\\s*"?([^"\\s]+)"?\\s*$`, 'm').exec(node.content)?.[1];
  return { server: pick('server'), token: pick('token'), namespace: pick('namespace') };
}

const UA_KUBECTL = 'kubectl/v1.31.2 (linux/amd64) kubernetes/0e5c3ea';

const kubectl: Command = {
  name: 'kubectl',
  summary: 'cmd.kubectl',
  explain: 'explain.kubectl',
  group: 'network',
  async *run(ctx): Run {
    const { flags, values, rest } = getopt(ctx.args, ['n', 's', 'server', 'token', 'namespace', 'o', 'c']);
    const [verb, what, maybeName] = rest;
    const config = kubeconfig(ctx);
    const server = values.server ?? values.s ?? config.server;
    if (!verb || !['get', 'describe', 'logs'].includes(verb) || !what) {
      yield err(
        'usage: kubectl get <resource> [name] [-n namespace | -A]\n       kubectl describe <resource> <name> [-n namespace]\n       kubectl logs <pod> [-n namespace]\n       (--server https://<api>:6443 and --token <token>, or ~/.kube/config)',
      );
      return 1;
    }
    if (!server) {
      yield err(
        'The connection to the server localhost:8080 was refused - did you specify the right host or port?',
      );
      return 1;
    }
    const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/.exec(server);
    const hostname = (m?.[1] ?? '').toLowerCase();
    const port = Number(m?.[2] ?? 6443);
    const target = yield* gate(ctx, hostname);
    if (!target) return 9;
    if (target.kind !== 'host') {
      yield err(`Unable to connect to the server: dial tcp: lookup ${hostname}: no such host`);
      return 1;
    }
    const host: Host = target.host;
    ctx.noise();
    yield wait(300);
    if (
      !host.web ||
      !host.services.some((s) => s.port === port && /^(kubernetes|k8s|kube-apiserver)$/.test(s.name))
    ) {
      yield err(
        `The connection to the server ${hostname}:${port} was refused - did you specify the right host or port?`,
      );
      return 1;
    }
    ctx.emit({ type: 'HostDiscovered', host: host.id });
    // `kubectl get pods/web-1` is `kubectl get pods web-1`.
    const [res, slashName] = what.split('/');
    const isLogs = verb === 'logs';
    const kind = isLogs ? KINDS.pods! : KINDS[(res ?? '').toLowerCase()];
    const name = isLogs ? what : (slashName ?? maybeName);
    if (!kind) {
      yield err(`error: the server doesn't have a resource type "${res}"`);
      return 1;
    }
    if ((verb === 'describe' || isLogs) && !name) {
      yield err(`error: you must specify the name of the resource to ${verb}`);
      return 1;
    }
    const all = flags.has('A') || flags.has('all-namespaces');
    const ns = all && !name ? null : (values.n ?? values.namespace ?? config.namespace ?? 'default');
    let path = kubePath(kind, ns, name);
    if (verb === 'describe') path += '/describe';
    if (isLogs) path += '/log';
    const token = values.token ?? config.token;
    const header = token ? `Authorization: Bearer ${token}` : undefined;
    const res2 = ctx.game.http(host, { scheme: 'https', hostname, port, path }, 'GET', UA_KUBECTL, {
      header,
    });
    if (res2.status === 200) {
      yield out(res2.body || (name ? '' : `No resources found in ${ns ?? 'any'} namespace.`));
      return 0;
    }
    const plain = res2.route !== undefined && res2.body && !res2.body.trimStart().startsWith('<');
    if (plain) yield err(res2.body);
    else if (res2.status === 401) yield err('error: You must be logged in to the server (Unauthorized)');
    else if (res2.status === 403)
      yield err(
        `Error from server (Forbidden): ${kind.plural} is forbidden: User "system:anonymous" cannot ${verb === 'get' && !name ? 'list' : 'get'} resource "${kind.plural}" in API group "${kind.group}"${ns ? ` in the namespace "${ns}"` : ''}`,
      );
    else if (name) yield err(`Error from server (NotFound): ${kind.plural} "${name}" not found`);
    else yield out(`No resources found in ${ns ?? 'any'} namespace.`);
    return 1;
  },
};

/* ---------- ldapsearch ---------- */

const ldapsearch: Command = {
  name: 'ldapsearch',
  summary: 'cmd.ldapsearch',
  explain: 'explain.ldapsearch',
  group: 'network',
  async *run(ctx): Run {
    const { flags, values, rest } = getopt(ctx.args, ['H', 'h', 'b', 'D', 'w', 'p', 's']);
    const uri = values.H ?? (values.h ? `ldap://${values.h}${values.p ? `:${values.p}` : ''}` : undefined);
    if (!uri) {
      yield err(
        "ldap_sasl_bind(SIMPLE): Can't contact LDAP server (-1)\nusage: ldapsearch -x -H ldap://<host> -b <base> [-D <binddn> -w <password>] [filter] [attributes...]",
      );
      return 255;
    }
    const m = /^ldaps?:\/\/([^/:]+)(?::(\d+))?/i.exec(uri);
    const hostname = (m?.[1] ?? '').toLowerCase();
    const port = Number(m?.[2] ?? (uri.toLowerCase().startsWith('ldaps') ? 636 : 389));
    const target = yield* gate(ctx, hostname);
    if (!target) return 9;
    if (target.kind !== 'host') {
      yield err("ldap_sasl_bind(SIMPLE): Can't contact LDAP server (-1)");
      return 255;
    }
    const host = target.host;
    ctx.noise();
    yield wait(250);
    if (!host.directory || !host.services.some((s) => s.port === port && /^ldaps?$/.test(s.name))) {
      yield err("ldap_sasl_bind(SIMPLE): Can't contact LDAP server (-1)");
      return 255;
    }
    ctx.emit({ type: 'HostDiscovered', host: host.id });
    const [rawFilter = '(objectClass=*)', ...attrs] = rest;
    const base = values.b ?? host.directory.base;
    try {
      parseFilter(rawFilter);
    } catch (e) {
      if (!(e instanceof FilterError)) throw e;
      yield err('ldapsearch: ldap_search_ext: Bad search filter (-7)');
      return 255;
    }
    const result = ctx.game.ldapSearch(host.id, {
      base,
      filter: rawFilter,
      ...(values.D ? { bind: values.D, password: values.w ?? '' } : {}),
    });
    if (!result) return 255;
    if (!result.ok && result.code === 49) {
      yield err('ldap_bind: Invalid credentials (49)');
      return 49;
    }
    const quiet = flags.has('L');
    const lines: string[] = [];
    if (!quiet)
      lines.push(
        '# extended LDIF',
        '#',
        '# LDAPv3',
        `# base <${base}> with scope subtree`,
        `# filter: ${rawFilter}`,
        `# requesting: ${attrs.length ? attrs.join(' ') : 'ALL'}`,
        '#',
        '',
      );
    if (result.ok) {
      for (const e of result.entries) {
        if (!quiet) lines.push(`# ${e.dn.split(',')[0]?.split('=')[1] ?? e.dn}`);
        lines.push(ldif(e, attrs), '');
      }
      if (!quiet)
        lines.push(
          '# search result',
          'search: 2',
          'result: 0 Success',
          '',
          `# numResponses: ${result.entries.length + 1}`,
          ...(result.entries.length ? [`# numEntries: ${result.entries.length}`] : []),
        );
    } else {
      const text = result.code === 32 ? '32 No such object' : '50 Insufficient access';
      lines.push('# search result', 'search: 2', `result: ${text}`, '', '# numResponses: 1');
    }
    yield out(lines.join('\n').trimEnd());
    return result.ok ? 0 : result.code;
  },
};

export const infraCommands: Command[] = [kubectl, ldapsearch];
