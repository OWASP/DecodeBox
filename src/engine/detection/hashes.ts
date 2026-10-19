
import type { HashIdentification, HashMatch } from '../types';

export type { HashIdentification, HashMatch };

interface PrefixRule {
  test: RegExp;
  name: string;
  context: string;
  confidence: number;
  salted?: boolean;
}

const PREFIXED: PrefixRule[] = [
  { test: /^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}$/, name: 'bcrypt', salted: true, context: 'Unix password hashing, and the default in many web frameworks', confidence: 0.99 },
  { test: /^\$argon2(id|i|d)\$/, name: 'Argon2', salted: true, context: 'Modern password hashing; winner of the Password Hashing Competition', confidence: 0.99 },
  { test: /^\$scrypt\$|^\$7\$/, name: 'scrypt', salted: true, context: 'Memory-hard password hashing', confidence: 0.98 },
  { test: /^\$y\$/, name: 'yescrypt', salted: true, context: 'Default on recent Debian and Fedora systems', confidence: 0.97 },
  { test: /^\$6\$/, name: 'SHA-512 crypt', salted: true, context: 'Linux /etc/shadow', confidence: 0.98 },
  { test: /^\$5\$/, name: 'SHA-256 crypt', salted: true, context: 'Linux /etc/shadow', confidence: 0.98 },
  { test: /^\$1\$/, name: 'MD5 crypt', salted: true, context: 'Legacy Unix /etc/shadow, and Cisco type 5', confidence: 0.98 },
  { test: /^\$apr1\$/, name: 'Apache MD5 (APR1)', salted: true, context: 'Apache .htpasswd files', confidence: 0.98 },
  { test: /^\$sha1\$\d+\$/, name: 'SHA-1 crypt', salted: true, context: 'NetBSD', confidence: 0.96 },
  { test: /^\$md5[,$]/, name: 'Sun MD5 crypt', salted: true, context: 'Solaris', confidence: 0.95 },
  { test: /^\$P\$[./A-Za-z0-9]{31}$/, name: 'phpass (portable)', salted: true, context: 'WordPress and phpBB3', confidence: 0.97 },
  { test: /^\$H\$[./A-Za-z0-9]{31}$/, name: 'phpass (phpBB3)', salted: true, context: 'phpBB3', confidence: 0.97 },
  { test: /^\$S\$[./A-Za-z0-9]{52}$/, name: 'Drupal 7 (SHA-512)', salted: true, context: 'Drupal 7', confidence: 0.97 },
  { test: /^\$pbkdf2(-sha(1|256|512))?\$/, name: 'PBKDF2 (passlib)', salted: true, context: 'Python passlib', confidence: 0.97 },
  { test: /^pbkdf2_sha(1|256|512)\$\d+\$/, name: 'PBKDF2 (Django)', salted: true, context: 'Django user accounts', confidence: 0.98 },
  { test: /^\{SSHA\}/, name: 'Salted SHA-1 (LDAP)', salted: true, context: 'OpenLDAP', confidence: 0.98 },
  { test: /^\{SHA\}/, name: 'SHA-1 (LDAP)', context: 'OpenLDAP; unsalted, so trivially cracked', confidence: 0.98 },
  { test: /^\{SMD5\}/, name: 'Salted MD5 (LDAP)', salted: true, context: 'OpenLDAP', confidence: 0.98 },
  { test: /^\{MD5\}/, name: 'MD5 (LDAP)', context: 'OpenLDAP; unsalted', confidence: 0.98 },
  { test: /^\{CRYPT\}/, name: 'crypt (LDAP)', salted: true, context: 'OpenLDAP wrapping a Unix crypt hash', confidence: 0.96 },
  { test: /^\*[0-9A-F]{40}$/i, name: 'MySQL 4.1+ (SHA-1 twice)', context: 'MySQL user table', confidence: 0.97 },
  { test: /^0x0100[0-9A-F]{48}$/i, name: 'MSSQL 2005+', salted: true, context: 'Microsoft SQL Server', confidence: 0.96 },
  { test: /^0x0200[0-9A-F]{136}$/i, name: 'MSSQL 2012+', salted: true, context: 'Microsoft SQL Server', confidence: 0.96 },
  { test: /^\$krb5tgs\$/, name: 'Kerberos TGS-REP', salted: true, context: 'Kerberoasting output', confidence: 0.99 },
  { test: /^\$krb5asrep\$/, name: 'Kerberos AS-REP', salted: true, context: 'AS-REP roasting output', confidence: 0.99 },
  { test: /^\$NT\$[0-9a-f]{32}$/i, name: 'NTLM', context: 'Windows account database', confidence: 0.98 },
  { test: /^\$DCC2\$/, name: 'Domain Cached Credentials 2', salted: true, context: 'Cached Windows domain logons', confidence: 0.98 },
  { test: /^\$ml\$/, name: 'macOS 10.8+ (PBKDF2-SHA512)', salted: true, context: 'macOS accounts', confidence: 0.97 },
  { test: /^\$sha1\$/, name: 'SHA-1 crypt', context: 'NetBSD', confidence: 0.95 },
  { test: /^\$bf\$|^\$2\$/, name: 'bcrypt (early variant)', context: 'Older OpenBSD', confidence: 0.9 },
];

const BY_HEX_LENGTH: Record<number, string[]> = {
  8: ['CRC-32', 'Adler-32', 'FNV-1a (32-bit)', 'CRC-32C', 'MurmurHash3 (32-bit)'],
  16: ['MySQL 3.2.3', 'CRC-64', 'DES (Unix, truncated)', 'FNV-1a (64-bit)'],
  32: ['MD5', 'NTLM', 'MD4', 'LM', 'RIPEMD-128', 'MD2', 'Haval-128', 'Tiger-128'],
  40: ['SHA-1', 'MySQL 4.1+ (unprefixed)', 'RIPEMD-160', 'Haval-160', 'Tiger-160'],
  48: ['Tiger-192', 'Haval-192', 'SHA-1 (truncated)'],
  56: ['SHA-224', 'SHA3-224', 'Haval-224', 'BLAKE2s-224'],
  64: ['SHA-256', 'SHA3-256', 'BLAKE2s-256', 'Keccak-256', 'RIPEMD-256', 'GOST R 34.11-94', 'Haval-256'],
  80: ['RIPEMD-320'],
  96: ['SHA-384', 'SHA3-384'],
  128: ['SHA-512', 'SHA3-512', 'BLAKE2b-512', 'Whirlpool', 'Keccak-512'],
};

const BY_BYTE_LENGTH: Record<number, string[]> = {
  16: ['MD5', 'MD4'],
  20: ['SHA-1', 'RIPEMD-160'],
  28: ['SHA-224'],
  32: ['SHA-256', 'BLAKE2s-256'],
  48: ['SHA-384'],
  64: ['SHA-512', 'BLAKE2b-512', 'Whirlpool'],
};

const LM_EMPTY = 'aad3b435b51404eeaad3b435b51404ee';

function bareHexMatches(hex: string): HashMatch[] {
  const names = BY_HEX_LENGTH[hex.length];
  if (!names) return [];

  const bits = hex.length * 4;
  const allUpper = hex === hex.toUpperCase() && /[A-F]/.test(hex);

  return names.map((name, index) => {
    let confidence = Math.max(0.2, 0.62 - index * 0.07);
    let reason = `${hex.length} hex digits (${bits} bits)`;

    if (hex.length === 32 && allUpper && name === 'NTLM') {
      confidence += 0.12;
      reason += ', upper case as Windows tooling prints NTLM';
    }
    if (hex.length === 32 && allUpper && name === 'MD5') {
      confidence -= 0.06;
    }

    return {
      name,
      confidence: Math.min(confidence, 0.75),
      reason,
      salt: {
        present: false,
        note: 'Unsalted, so the same password always produces this same hash — it may be in a lookup table.',
      },
    };
  });
}

function saltedPairMatches(text: string): HashIdentification | null {
  const split = /^([^:$*#]+)[:$*#]([^:$*#]{1,64})$/.exec(text);
  if (!split) return null;

  const [, left = '', right = ''] = split;
  const isHex = (part: string) => /^[0-9a-fA-F]+$/.test(part);
  const leftNames = isHex(left) ? BY_HEX_LENGTH[left.length] : undefined;
  const rightNames = isHex(right) ? BY_HEX_LENGTH[right.length] : undefined;

  if (leftNames && rightNames) return null;
  if (!leftNames && !rightNames) return null;

  const digest = leftNames ? left : right;
  const salt = leftNames ? right : left;
  const names = (leftNames ?? rightNames)!;
  const order = leftNames ? 'hash:salt' : 'salt:hash';

  return {
    matches: names.slice(0, 4).map((name, index) => ({
      name: `${name} with a salt`,
      confidence: Math.max(0.4, 0.72 - index * 0.12),
      reason: `${digest.length * 4}-bit digest and a ${salt.length}-character salt, written ${order}`,
      context: 'The layout wordlist crackers read and password dumps write',
      salt: {
        present: true,
        value: salt,
        note:
          `The salt is '${salt}'. Which side is the salt is a convention rather than a rule — ` +
          'both orders are in use - so check against the source before cracking.',
      },
    })),
    summary: `${text.length} characters, a digest and a salt`,
    oneWay: true,
  };
}

export function identifyHash(input: string): HashIdentification | null {
  const text = input.trim();
  if (text.length < 8 || /\s/.test(text)) return null;

  const matches: HashMatch[] = [];

  if (/^\d{1,10}:[A-Za-z0-9/+]{3,}:[A-Za-z0-9/+]{3,}(,".*")?$/.test(text)) {
    return {
      matches: [
        {
          name: 'ssdeep (context-triggered piecewise hash)',
          confidence: 0.95,
          reason: 'Block size, then two base64 signatures, separated by colons',
          context: 'Compare it against another ssdeep hash for similarity; it is not a digest to look up.',
          salt: { present: false, note: 'Fuzzy hashes are not salted and are not password hashes.' },
        },
      ],
      summary: `${text.length} characters, a fuzzy hash`,
      oneWay: true,
    };
  }


  for (const rule of PREFIXED) {
    if (rule.test.test(text)) {
      matches.push({
        name: rule.name,
        confidence: rule.confidence,
        reason: 'Self-identifying prefix',
        context: rule.context,
        salt: rule.salted
          ? { present: true, note: 'The salt is carried inside the hash string.' }
          : { present: false, note: 'Unsalted, so the same password always produces this same hash.' },
      });
    }
  }

  if (matches.length > 0) {
    return {
      matches: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 4),
      summary: `${text.length} characters, self-identifying format`,
      oneWay: true,
    };
  }

  const pair = /^([0-9a-f]{32}):([0-9a-f]{32})$/i.exec(text);
  if (pair) {
    const lmEmpty = pair[1]!.toLowerCase() === LM_EMPTY;
    return {
      matches: [
        {
          name: 'LM:NTLM pair',
          confidence: 0.96,
          reason: 'Two 32-digit hex halves separated by a colon',
          context: lmEmpty
            ? 'The LM half is the empty-password constant, so only the NTLM half carries a password'
            : 'The format dumped by secretsdump, pwdump and similar tools',
        },
      ],
      summary: '65 characters, two 128-bit digests',
      oneWay: true,
    };
  }

  const salted = saltedPairMatches(text);
  if (salted) return salted;

  const hex = /^(0x)?([0-9a-fA-F]+)$/.exec(text);
  if (hex) {
    const digits = hex[2]!;
    const found = bareHexMatches(digits);
    if (found.length > 0) {
      if (digits.toLowerCase() === LM_EMPTY) {
        found.unshift({
          name: 'LM hash of an empty password',
          confidence: 0.99,
          reason: 'Exactly the constant LM produces for a blank password',
          context: 'This account has no LM password set',
        });
      }
      return {
        matches: found.sort((a, b) => b.confidence - a.confidence).slice(0, 5),
        summary: `${digits.length} hex digits (${digits.length * 4} bits)`,
        oneWay: true,
      };
    }
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length >= 16 && text.length % 4 === 0) {
    const bytes = (text.length / 4) * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);
    const names = BY_BYTE_LENGTH[bytes];
    if (names) {
      return {
        matches: names.map((name, index) => ({
          name: `${name} (Base64)`,
          confidence: Math.max(0.18, 0.45 - index * 0.08),
          reason: `Base64 decoding to ${bytes} bytes (${bytes * 8} bits)`,
        })),
        summary: `${text.length} Base64 characters, ${bytes} bytes decoded`,
        oneWay: false,
      };
    }
  }

  return null;
}
