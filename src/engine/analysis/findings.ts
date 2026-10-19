import type { Finding, Severity } from './types';
import { shannonEntropy, asBytes } from '../core/bytes';


interface Rule {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  reference?: string;
  test: (text: string, context: RuleContext) => string | null;
}

interface RuleContext {
  depth: number;
  format: string;
  decoded: boolean;
}

function match(text: string, pattern: RegExp): string | null {
  const found = pattern.exec(text);
  return found ? found[0].slice(0, 200) : null;
}

const NESTING_ALARM = 4;

const RULES: Rule[] = [
  {
    id: 'private-key',
    severity: 'critical',
    title: 'Private key material',
    detail:
      'A private key is present in this data. Treat it as compromised: rotate it, and check where this blob has already been sent or logged.',
    reference: 'CWE-522',
    test: (text) => match(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----/),
  },
  {
    id: 'cloud-credential',
    severity: 'critical',
    title: 'Cloud or service credential',
    detail:
      'This looks like a live access key. Anything reaching this tool has already been in a clipboard and a browser tab, so assume exposure and revoke it.',
    reference: 'CWE-798',
    test: (text) =>
      match(
        text,
        /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{16,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bsk-[A-Za-z0-9]{20,}\b|\bAIza[0-9A-Za-z_-]{35}\b/,
      ),
  },
  {
    id: 'basic-auth-url',
    severity: 'high',
    title: 'Credentials embedded in a URL',
    detail:
      'A username and password are carried in the URL itself, where they end up in proxy logs, browser history and referrer headers.',
    reference: 'CWE-598',
    test: (text) => match(text, /\b[a-z]+:\/\/[^/\s:@]+:[^/\s:@]+@[^\s/]+/i),
  },
  {
    id: 'connection-string',
    severity: 'high',
    title: 'Database connection string with a password',
    detail: 'A connection string carrying a password was found in the decoded content.',
    reference: 'CWE-798',
    test: (text) =>
      match(text, /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s:@]+:[^\s@]+@/i),
  },

  {
    id: 'jwt-alg-none',
    severity: 'critical',
    title: 'JWT declares alg: none',
    detail:
      'The token asks to be accepted without a signature. Any verifier that honours this header accepts a token an attacker wrote themselves.',
    reference: 'CWE-347',
    test: (text) => match(text, /"alg"\s*:\s*"none"/i),
  },
  {
    id: 'jwt-weak-alg',
    severity: 'medium',
    title: 'JWT signed with a symmetric algorithm',
    detail:
      'HS256 and its relatives share one secret between signer and verifier. Where the verifier also accepts RS256, this is the shape of the algorithm-confusion attack.',
    reference: 'CWE-347',
    test: (text) => match(text, /"alg"\s*:\s*"HS(?:256|384|512)"/i),
  },
  {
    id: 'jwt-long-life',
    severity: 'low',
    title: 'Token valid for an unusually long time',
    detail:
      'The expiry is more than a year out. A token with that lifetime is effectively a permanent credential.',
    test: (text) => {
      const found = /"exp"\s*:\s*(\d{10})\b/.exec(text);
      if (!found) return null;
      const exp = Number(found[1]) * 1000;
      const year = 365 * 24 * 3600 * 1000;
      return exp - Date.now() > year ? found[0] : null;
    },
  },

  {
    id: 'embedded-executable',
    severity: 'critical',
    title: 'Executable revealed after decoding',
    detail:
      'The decoded bytes carry an executable header. Something in this chain was carrying a binary in a form designed not to look like one.',
    reference: 'CWE-506',
    test: (text, context) => {
      if (!context.decoded) return null;
      const bytes = asBytes(text.slice(0, 8));
      const isMz = bytes[0] === 0x4d && bytes[1] === 0x5a;
      const isElf = bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
      const isMacho = bytes[0] === 0xcf || bytes[0] === 0xce ? bytes[1] === 0xfa : false;
      return isMz ? 'MZ (Windows PE)' : isElf ? '\\x7fELF' : isMacho ? 'Mach-O' : null;
    },
  },
  {
    id: 'dos-stub',
    severity: 'high',
    title: 'Windows executable stub text',
    detail:
      'The classic DOS stub message appears in the decoded data, which means a PE file is present even if the header sits at an offset.',
    test: (text, context) =>
      context.decoded ? match(text, /This program cannot be run in DOS mode/) : null,
  },

  {
    id: 'powershell-download',
    severity: 'critical',
    title: 'PowerShell download-and-execute',
    detail:
      'This is the standard shape of a first-stage loader: fetch a payload over the network and run it in memory, leaving nothing on disk.',
    reference: 'CWE-94',
    test: (text) =>
      match(
        text,
        /(?:IEX|Invoke-Expression|iex)\s*[\s(]*.{0,80}(?:DownloadString|DownloadFile|Invoke-WebRequest|WebClient|Net\.WebClient)/is,
      ),
  },
  {
    id: 'powershell-encoded',
    severity: 'high',
    title: 'PowerShell encoded command',
    detail:
      'A command is being passed Base64-encoded, usually with the window hidden and the execution policy bypassed. Legitimate scripts rarely need any of that.',
    reference: 'CWE-78',
    test: (text) =>
      match(text, /-e(?:nc|ncoded|ncodedcommand)?\s+[A-Za-z0-9+/=]{40,}|-ExecutionPolicy\s+Bypass|-w\s+hidden|-WindowStyle\s+Hidden/i),
  },
  {
    id: 'lolbin',
    severity: 'high',
    title: 'Living-off-the-land binary',
    detail:
      'A signed Windows utility is being used to fetch or run code. These are chosen precisely because they are already trusted on the host.',
    reference: 'CWE-506',
    test: (text) =>
      match(
        text,
        /\b(?:certutil(?:\.exe)?\s+.{0,60}-(?:urlcache|decode)|mshta(?:\.exe)?\s+http|regsvr32(?:\.exe)?\s+.{0,40}scrobj|rundll32(?:\.exe)?\s+javascript:|bitsadmin(?:\.exe)?\s+\/transfer)/i,
      ),
  },
  {
    id: 'reverse-shell',
    severity: 'critical',
    title: 'Reverse shell',
    detail: 'This is a command that opens an interactive shell back to a remote host.',
    reference: 'CWE-78',
    test: (text) =>
      match(
        text,
        /\b(?:bash\s+-i\s*>&\s*\/dev\/tcp\/|nc\s+(?:-[a-z]*e\s|\S+\s+\d+\s*-e\s)|python\d?\s+-c\s+.{0,40}socket|socket\.socket\(.{0,60}connect)/i,
      ),
  },
  {
    id: 'shell-download',
    severity: 'high',
    title: 'Shell download-and-execute',
    detail: 'A payload is fetched and piped straight into a shell without ever touching disk.',
    reference: 'CWE-94',
    test: (text) => match(text, /\b(?:curl|wget)\b[^\n|;]{0,120}\|\s*(?:ba)?sh\b/i),
  },

  {
    id: 'jndi-injection',
    severity: 'critical',
    title: 'JNDI lookup (Log4Shell shape)',
    detail:
      'A JNDI lookup in user-controlled data is the Log4Shell exploitation pattern. Obfuscated variants using ${lower:} and similar are also matched.',
    reference: 'CVE-2021-44228',
    test: (text) => match(text, /\$\{(?:[a-z:${}]{0,40})?jndi\s*:|\$\{(?:lower|upper|env|sys):/i),
  },
  {
    id: 'sql-injection',
    severity: 'high',
    title: 'SQL injection payload',
    detail:
      'The decoded content contains a SQL injection pattern. If this came out of a request parameter, it is an attempt rather than a coincidence.',
    reference: 'CWE-89',
    test: (text) =>
      match(
        text,
        /(?:'\s*(?:or|and)\s+'?\d+'?\s*=\s*'?\d|\bunion\s+(?:all\s+)?select\b|\bsleep\s*\(\s*\d|\bbenchmark\s*\(|\bwaitfor\s+delay\b|\bxp_cmdshell\b|--\s*$)/i,
      ),
  },
  {
    id: 'xss-payload',
    severity: 'high',
    title: 'Cross-site scripting payload',
    detail:
      'Script-executing markup appeared after decoding — which is the point of the encoding. A filter that inspected the encoded form would not have seen this.',
    reference: 'CWE-79',
    test: (text) =>
      match(
        text,
        /<script[\s>]|javascript:\s*[a-z]|on(?:error|load|click|mouseover|focus)\s*=\s*["'`]?[a-z(]|<img[^>]+onerror|<svg[^>]+on[a-z]+=/i,
      ),
  },
  {
    id: 'path-traversal',
    severity: 'high',
    title: 'Path traversal',
    detail:
      'A directory traversal sequence is present. Encoding it is how these get past filters that only check the raw request.',
    reference: 'CWE-22',
    test: (text) => match(text, /(?:\.\.[/\\]){2,}|\.\.%2f|%2e%2e[/\\%]/i),
  },
  {
    id: 'command-injection',
    severity: 'high',
    title: 'Command injection',
    detail: 'Shell metacharacters are chained onto a command in a way that runs a second one.',
    reference: 'CWE-78',
    test: (text) =>
      match(text, /[;&|`]\s*(?:cat|ls|id|whoami|uname|nc|curl|wget|ping|sh|bash)\b|\$\(\s*(?:id|whoami|cat)\b/i),
  },
  {
    id: 'ssrf-metadata',
    severity: 'critical',
    title: 'Cloud metadata endpoint',
    detail:
      'A request aimed at the instance metadata service. This is how SSRF is turned into credential theft in every major cloud.',
    reference: 'CWE-918',
    test: (text) =>
      match(text, /169\.254\.169\.254|metadata\.google\.internal|metadata\.azure\.com/i),
  },
  {
    id: 'deserialization',
    severity: 'critical',
    title: 'Serialized object',
    detail:
      'Serialized object data was found. Deserialising untrusted input of this kind is a direct path to remote code execution in both Java and PHP.',
    reference: 'CWE-502',
    test: (text) =>
      match(text, /^rO0AB|\bac\s?ed\s?00\s?05\b|^(?:a:\d+:\{|O:\d+:")|\bjava\.lang\.Runtime\b/),
  },
  {
    id: 'xxe',
    severity: 'high',
    title: 'External entity declaration',
    detail:
      'An XML external entity is declared. A parser with entity resolution enabled will fetch whatever this points at.',
    reference: 'CWE-611',
    test: (text) => match(text, /<!ENTITY\s+\S+\s+SYSTEM\s|<!DOCTYPE[^>]+SYSTEM\s/i),
  },
  {
    id: 'template-injection',
    severity: 'medium',
    title: 'Template injection probe',
    detail:
      'A server-side template expression appears in the data. These are the standard probes for template injection.',
    reference: 'CWE-1336',
    test: (text) => match(text, /\{\{\s*\d+\s*[*+]\s*\d+\s*\}\}|\{\{.{0,40}(?:config|self|request|__class__)/i),
  },

  {
    id: 'deep-nesting',
    severity: 'medium',
    title: 'Deeply nested encoding',
    detail:
      'This content sits behind several layers of encoding. Legitimate data is rarely wrapped this many times; the usual reason is getting past something that only inspects one layer.',
    test: (_text, context) =>
      context.depth >= NESTING_ALARM ? `${context.depth} layers deep` : null,
  },
  {
    id: 'homoglyph-domain',
    severity: 'high',
    title: 'Internationalised domain name',
    detail:
      'A punycode domain can render as a visually identical copy of a legitimate one. Decode it before trusting what it looks like.',
    reference: 'CWE-1007',
    test: (text) => match(text, /\bxn--[a-z0-9-]+\.[a-z]{2,}/i),
  },
  {
    id: 'defanged-ioc',
    severity: 'info',
    title: 'Defanged indicator',
    detail:
      'The content contains deliberately neutered indicators, which usually means it came from a report or a threat feed rather than from live traffic.',
    test: (text) => match(text, /hxxps?:\/\/|\[\.\]|\[:\/\/\]|\[at\]/i),
  },
  {
    id: 'null-byte',
    severity: 'medium',
    title: 'Null byte injection',
    detail:
      'An encoded null byte is present. These are used to truncate strings inside parsers written in C, slipping past extension and path checks.',
    reference: 'CWE-158',
    test: (text) => match(text, /%00|\\x00|\\u0000/i),
  },
  {
    id: 'high-entropy',
    severity: 'info',
    title: 'High-entropy content',
    detail:
      'The bytes carry no visible structure. That is what compressed or encrypted data looks like, and it is where a decode chain normally stops.',
    test: (text, context) => {
      if (!context.decoded || text.length < 64) return null;
      const entropy = shannonEntropy(asBytes(text.slice(0, 4096)));
      return entropy > 7.5 ? `${entropy.toFixed(2)} bits per byte` : null;
    },
  },
  {
    id: 'obfuscated-script',
    severity: 'medium',
    title: 'Obfuscated script',
    detail:
      'The script uses constructs whose only purpose is to be hard to read: string concatenation of single characters, character-code assembly, or dynamic evaluation.',
    reference: 'CWE-506',
    test: (text) =>
      match(
        text,
        /(?:eval|Function|setTimeout)\s*\(\s*(?:atob|unescape|decodeURIComponent|String\.fromCharCode)|(?:String\.fromCharCode\s*\(\s*\d+\s*,\s*\d+\s*,){2}|(?:'\s*\+\s*'){6,}|\[\s*char\s*\]|FromBase64String/i,
      ),
  },
  {
    id: 'excessive-encoding',
    severity: 'low',
    title: 'Double URL encoding',
    detail:
      'Percent signs are themselves encoded. This is a known way past filters that decode once and then check.',
    reference: 'CWE-177',
    test: (text) => match(text, /%25(?:2[0-9a-f]|3[0-9a-f]|[0-9a-f]{2})/i),
  },
];

export function findIssues(
  text: string,
  depth: number,
  path: string,
  format: string,
): Finding[] {
  if (text.length === 0) return [];
  const sample = text.length > 128 * 1024 ? text.slice(0, 128 * 1024) : text;
  const context: RuleContext = { depth, format, decoded: depth > 0 };

  const found: Finding[] = [];
  for (const rule of RULES) {
    const evidence = rule.test(sample, context);
    if (evidence === null) continue;
    found.push({
      id: rule.id,
      severity: rule.severity,
      title: rule.title,
      detail: rule.detail,
      evidence: evidence.trim(),
      depth,
      path,
      ...(rule.reference ? { reference: rule.reference } : {}),
    });
  }
  return found;
}

export function mergeFindings(all: Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const finding of all) {
    const existing = byId.get(finding.id);
    if (!existing || finding.depth < existing.depth) byId.set(finding.id, finding);
  }
  return [...byId.values()];
}

export const RULE_COUNT = RULES.length;
