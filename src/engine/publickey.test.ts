import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe } from './types';


type Entry = string | [string, Record<string, string | number | boolean>];

function recipe(...entries: Entry[]): Recipe {
  return {
    id: 'test',
    name: 'test',
    steps: entries.map((entry, i) => {
      const [opId, overrides] = typeof entry === 'string' ? [entry, {}] : entry;
      const op = getOperation(opId);
      if (!op) throw new Error(`Unknown operation '${opId}'`);
      return {
        uid: `s${i}`,
        opId,
        args: op.args.map((a) => ({ ...a, value: overrides[a.name] ?? a.value })),
        disabled: false,
      };
    }),
  };
}

async function run(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return renderText(result.output);
}

const RSA_PRIVATE = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDLky2RVm4QUosV
z08BKPVZhvGe1pn3RjWllliF0LHNUXBLTY5v7HVTTT2VRewutjZERHr4SgGEc3uV
LvuEECo+DJqCVP4q1b0XoD4NOs3yBcPC47ODrJ78Y/t4J62E99LCQ0Xnf1cHKTP1
DUkv3V9sF2h32PnlizAwNNpBscoPiiarlf3CmZXEBga01Oso4Irp2cQeBgHJONl9
jZc7derKR3XptNvZH7h773aFHbk6IZextI5XHOPk8EH59HxrZDKxXbHOr6c4H41l
6ZDhkEBkWM84MlULd/YmLhhlLkhHo7eIUkgC4ySW6gVgP+Er1pntRLndNCcp4VlK
8mpERv8JAgMBAAECggEAF6vW9hnjNXGrq48OBDgDg3P9/3a7s3WOAmGfjHvOWO35
zT/I6rnHkLagDQ3y3yGf4MNHuzw7ve+BtMCgTWRlzQ5BHxuL7GYrFSa0YGxwiw5h
i3VXp914JSfpEzkl45q/fog9BiSX9YS0fm+bjX3DvTlhk+H+eNL8+PYEVPQ75x93
bu74+H+SPaK9A+P05XFvb3mujF75Gtl/zkOkBC/QpR/uuz4hFZXc4Uw3hMZ5ONol
+GYtt1quO9UKYbAXymCNJQ2K+DHXS3H1EUVKwjkt2I0ZIqVrEkXZ44nC5K/A1wJZ
J5PtV0SMdfjmqjRudHLNQ8Dw+ECcXPpssxiW4J2UqQKBgQD8xSbL4JZGW2rVZC7T
0TeR2pR9bv+jzcdpSHnsWY/HQLbonG07I8uBNTCYhScVJCd8vXqVFa2Vr1sXxIFI
rahsySgoDt+TDExHtxygcs4gFNgfJ+sABe8GFi65TTysRZ5kriLp9Q8CfC/5g4+f
xye39ZrhskgOLOnB/76rjz2lpQKBgQDOLRoFgbcpiqu7f3qtuj8Bhzq6F7xCrTM8
C19G+xmPOUGt1NWq1F8IwrgwL9Wm8nkPu251s7T1eK06PfeC3zKxlFYfhLHHGQ4G
59BH4FLUC5yl7UoDJcmQ/w+zQ5f/Yr9K024SlFdTSOOUiLfTT6UZi9IzGVmgKnF2
a/aFgddelQKBgGKQMe+f9JkcvozVEtlvpH6QQASlSrPB4vcv1rMNvV3R40DS9ljw
PUN1zSw8B6Bbx7YBYJJPsK9EgH3FFzCS3rEEw07TdeSuD/SK93OtMKkb16ZWd3E7
3xd9gNyqvHTkdL4HlP+rmh269S4TWebQzrER6UIGtcgpRUFrixr0sPItAoGAS7A8
/EaJciOpNdTvuXVFCg+V3Jk4EJY619Eo8grecDjJxsH6ipMaLEInkfENkxMypDbf
rzAAv5jEpzv2cEH1/0EAeOOiy/+Dqb9SNADDB3sXz8YTxKILpEIuhlXLKAMdTJ/f
qcxxXm7EtVOXgGidqIou6Xll8KmEK8AoqQxofx0CgYBumgVqVDuSG6VYzdoqmB99
wYZhdNEyTw9K2+yrwTpuS5PuPziHjK+6SH71bCTiNk00MnCsLMmR0NuW4VMdDkON
F4loBF9x3f9yhdsWlyNJKtjwpCLpJd8t5nyVQ6ejpcFJCLRwt7pWvPej4jvIUARd
kGzNSimi+jE0zEwsepB4QQ==
-----END PRIVATE KEY-----`;

const RSA_PUBLIC = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy5MtkVZuEFKLFc9PASj1
WYbxntaZ90Y1pZZYhdCxzVFwS02Ob+x1U009lUXsLrY2RER6+EoBhHN7lS77hBAq
PgyaglT+KtW9F6A+DTrN8gXDwuOzg6ye/GP7eCethPfSwkNF539XBykz9Q1JL91f
bBdod9j55YswMDTaQbHKD4omq5X9wpmVxAYGtNTrKOCK6dnEHgYByTjZfY2XO3Xq
ykd16bTb2R+4e+92hR25OiGXsbSOVxzj5PBB+fR8a2QysV2xzq+nOB+NZemQ4ZBA
ZFjPODJVC3f2Ji4YZS5IR6O3iFJIAuMkluoFYD/hK9aZ7US53TQnKeFZSvJqREb/
CQIDAQAB
-----END PUBLIC KEY-----`;

const RSA_PKCS1_PRIVATE = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAy5MtkVZuEFKLFc9PASj1WYbxntaZ90Y1pZZYhdCxzVFwS02O
b+x1U009lUXsLrY2RER6+EoBhHN7lS77hBAqPgyaglT+KtW9F6A+DTrN8gXDwuOz
g6ye/GP7eCethPfSwkNF539XBykz9Q1JL91fbBdod9j55YswMDTaQbHKD4omq5X9
wpmVxAYGtNTrKOCK6dnEHgYByTjZfY2XO3Xqykd16bTb2R+4e+92hR25OiGXsbSO
Vxzj5PBB+fR8a2QysV2xzq+nOB+NZemQ4ZBAZFjPODJVC3f2Ji4YZS5IR6O3iFJI
AuMkluoFYD/hK9aZ7US53TQnKeFZSvJqREb/CQIDAQABAoIBABer1vYZ4zVxq6uP
DgQ4A4Nz/f92u7N1jgJhn4x7zljt+c0/yOq5x5C2oA0N8t8hn+DDR7s8O73vgbTA
oE1kZc0OQR8bi+xmKxUmtGBscIsOYYt1V6fdeCUn6RM5JeOav36IPQYkl/WEtH5v
m419w705YZPh/njS/Pj2BFT0O+cfd27u+Ph/kj2ivQPj9OVxb295roxe+RrZf85D
pAQv0KUf7rs+IRWV3OFMN4TGeTjaJfhmLbdarjvVCmGwF8pgjSUNivgx10tx9RFF
SsI5LdiNGSKlaxJF2eOJwuSvwNcCWSeT7VdEjHX45qo0bnRyzUPA8PhAnFz6bLMY
luCdlKkCgYEA/MUmy+CWRltq1WQu09E3kdqUfW7/o83HaUh57FmPx0C26JxtOyPL
gTUwmIUnFSQnfL16lRWtla9bF8SBSK2obMkoKA7fkwxMR7ccoHLOIBTYHyfrAAXv
BhYuuU08rEWeZK4i6fUPAnwv+YOPn8cnt/Wa4bJIDizpwf++q489paUCgYEAzi0a
BYG3KYqru396rbo/AYc6uhe8Qq0zPAtfRvsZjzlBrdTVqtRfCMK4MC/VpvJ5D7tu
dbO09XitOj33gt8ysZRWH4SxxxkOBufQR+BS1Aucpe1KAyXJkP8Ps0OX/2K/StNu
EpRXU0jjlIi300+lGYvSMxlZoCpxdmv2hYHXXpUCgYBikDHvn/SZHL6M1RLZb6R+
kEAEpUqzweL3L9azDb1d0eNA0vZY8D1Ddc0sPAegW8e2AWCST7CvRIB9xRcwkt6x
BMNO03Xkrg/0ivdzrTCpG9emVndxO98XfYDcqrx05HS+B5T/q5oduvUuE1nm0M6x
EelCBrXIKUVBa4sa9LDyLQKBgEuwPPxGiXIjqTXU77l1RQoPldyZOBCWOtfRKPIK
3nA4ycbB+oqTGixCJ5HxDZMTMqQ2368wAL+YxKc79nBB9f9BAHjjosv/g6m/UjQA
wwd7F8/GE8SiC6RCLoZVyygDHUyf36nMcV5uxLVTl4BonaiKLul5ZfCphCvAKKkM
aH8dAoGAbpoFalQ7khulWM3aKpgffcGGYXTRMk8PStvsq8E6bkuT7j84h4yvukh+
9Wwk4jZNNDJwrCzJkdDbluFTHQ5DjReJaARfcd3/coXbFpcjSSrY8KQi6SXfLeZ8
lUOno6XBSQi0cLe6Vrz3o+I7yFAEXZBszUopovoxNMxMLHqQeEE=
-----END RSA PRIVATE KEY-----`;

const EC_PRIVATE = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgI2CgJZLDSqUdeNpB
xMT6MVGptDIMg+aB7Nn653PULx+hRANCAASB+/CjQxP789mX1aENx50pU0RzaM1P
n3YSQ5aq19tzUnm8OEtbsOBO+knnHAuwZJorRVRFkMxVvn0thq1FYv8G
-----END PRIVATE KEY-----`;

const EC_PUBLIC = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEgfvwo0MT+/PZl9WhDcedKVNEc2jN
T592EkOWqtfbc1J5vDhLW7DgTvpJ5xwLsGSaK0VURZDMVb59LYatRWL/Bg==
-----END PUBLIC KEY-----`;

const EC_SEC1_PRIVATE = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEICNgoCWSw0qlHXjaQcTE+jFRqbQyDIPmgezZ+udz1C8foAoGCCqGSM49
AwEHoUQDQgAEgfvwo0MT+/PZl9WhDcedKVNEc2jNT592EkOWqtfbc1J5vDhLW7Dg
TvpJ5xwLsGSaK0VURZDMVb59LYatRWL/Bg==
-----END EC PRIVATE KEY-----`;

const MESSAGE = 'The quick brown fox';
const RSA_SIGNATURE = 'D0RPVjZCqwNOmtHBJhHRr7iXiijJDmaSEhsIrPGe6j5Bdv9Em5qn5YHuAK/kbl0T3g2GwcwkSivZzthhEPqPjZjR3Aapvt2nWC5oHKN96tPSdduG/5cAcZKpZbgpTxtjmk8lGfKg/kqEbA/bwrHJKAeb9MBTsWSIIz4EgFTiRIiDecucKS7cDAY25AxI0sYpVtEnQ+JVp2KKMK6Zz4GlcY/90+NUzHKs4aSm7PHww/y11N5Tvn4Uik4tFGYHWWucPcWpi4kSBoR4O2a2RlLn+zNghXLoTJ4cvlblk2qtoa4EvlsxngQVwRQtY+vAnG5Ww1Art9GYgv8/arclPC09Og==';
const EC_SIGNATURE_DER = 'MEYCIQDHnoaB2wmTu+9wbQuKLAz0qnCADTNGm3LzP9c8kLawHAIhAPXB+gqCd7YTvKvoaf4pdNP3h96jyES6qg5AnLun4mmi';

describe('RSA signing', () => {
  it('verifies a signature OpenSSL made', async () => {
    expect(
      await run(MESSAGE, [
        'rsa-verify',
        { Key: RSA_PUBLIC, Signature: RSA_SIGNATURE, 'Signature format': 'Base64' },
      ]),
    ).toMatch(/^Verified/);
  }, 30000);

  it('rejects the same signature over different data', async () => {
    expect(
      await run('The quick brown cat', [
        'rsa-verify',
        { Key: RSA_PUBLIC, Signature: RSA_SIGNATURE, 'Signature format': 'Base64' },
      ]),
    ).toMatch(/^Not verified/);
  }, 30000);

  it('produces the same signature OpenSSL did', async () => {
    expect(await run(MESSAGE, ['rsa-sign', { Key: RSA_PRIVATE, Output: 'Base64' }])).toBe(
      RSA_SIGNATURE,
    );
  }, 30000);

  it('reads a traditional PKCS#1 private key', async () => {
    expect(await run(MESSAGE, ['rsa-sign', { Key: RSA_PKCS1_PRIVATE, Output: 'Base64' }])).toBe(
      RSA_SIGNATURE,
    );
  }, 30000);

  it('signs and verifies with PSS, where each signature differs', async () => {
    const first = await run(MESSAGE, ['rsa-sign', { Key: RSA_PRIVATE, Scheme: 'PSS' }]);
    const second = await run(MESSAGE, ['rsa-sign', { Key: RSA_PRIVATE, Scheme: 'PSS' }]);
    expect(first).not.toBe(second); 

    expect(
      await run(MESSAGE, ['rsa-verify', { Key: RSA_PUBLIC, Signature: first, Scheme: 'PSS' }]),
    ).toMatch(/^Verified/);
  }, 30000);

  it('refuses a key that is not one', async () => {
    const result = await bake(MESSAGE, recipe(['rsa-sign', { Key: 'not a key' }]));
    expect(result.error?.message).toMatch(/No PEM block found/);
  });
});

describe('RSA encryption', () => {
  it('round-trips a message through OAEP', async () => {
    const secret = 'meet me at the usual place';
    const cipher = await run(secret, ['rsa-encrypt', { Key: RSA_PUBLIC }]);
    expect(cipher).not.toContain(secret);
    expect(await run(cipher, ['rsa-decrypt', { Key: RSA_PRIVATE }])).toBe(secret);
  }, 30000);

  it('says why a message too long for the key failed', async () => {
    const result = await bake('x'.repeat(500), recipe(['rsa-encrypt', { Key: RSA_PUBLIC }]));
    expect(result.error?.message).toMatch(/shorter than its modulus/);
  }, 30000);

  it('fails to decrypt with the wrong padding hash', async () => {
    const cipher = await run('hello', ['rsa-encrypt', { Key: RSA_PUBLIC, Hash: 'SHA-256' }]);
    const result = await bake(
      cipher,
      recipe(['rsa-decrypt', { Key: RSA_PRIVATE, Hash: 'SHA-512' }]),
    );
    expect(result.error?.message).toMatch(/did not decrypt/);
  }, 30000);
});

describe('ECDSA', () => {
  it('verifies a DER signature OpenSSL made', async () => {
    expect(
      await run(MESSAGE, [
        'ecdsa-verify',
        { Key: EC_PUBLIC, Signature: EC_SIGNATURE_DER, 'Signature format': 'Base64' },
      ]),
    ).toMatch(/^Verified/);
  }, 30000);

  it('rejects it over different data', async () => {
    expect(
      await run('something else', [
        'ecdsa-verify',
        { Key: EC_PUBLIC, Signature: EC_SIGNATURE_DER, 'Signature format': 'Base64' },
      ]),
    ).toMatch(/^Not verified/);
  }, 30000);

  it('signs in both forms and verifies its own work', async () => {
    const raw = await run(MESSAGE, ['ecdsa-sign', { Key: EC_PRIVATE }]);
    expect(raw).toHaveLength(128); 

    const der = await run(MESSAGE, ['ecdsa-sign', { Key: EC_PRIVATE, 'Signature form': 'DER' }]);
    expect(der.startsWith('30')).toBe(true);

    for (const signature of [raw, der]) {
      expect(await run(MESSAGE, ['ecdsa-verify', { Key: EC_PUBLIC, Signature: signature }])).toMatch(
        /^Verified/,
      );
    }
  }, 30000);

  it('explains what to do with a SEC1 key', async () => {
    const result = await bake(MESSAGE, recipe(['ecdsa-sign', { Key: EC_SEC1_PRIVATE }]));
    expect(result.error?.message).toMatch(/SEC1 key/);
  });
});

describe('ECDSA Signature Conversion', () => {
  it('converts a DER signature to raw and back', async () => {
    const raw = await run(EC_SIGNATURE_DER, 'from-base64', [
      'ecdsa-signature-conversion',
      { 'Input format': 'DER', 'Output format': 'Raw (r||s)', Encoding: 'Raw bytes' },
    ]);
    expect(raw).toHaveLength(64);

    const back = await run(raw, [
      'ecdsa-signature-conversion',
      { 'Input format': 'Raw (r||s)', 'Output format': 'DER', Encoding: 'Raw bytes' },
    ]);
    expect(await run(back, 'to-base64')).toBe(EC_SIGNATURE_DER);
  });

  it('writes the two halves as JSON', async () => {
    const json = JSON.parse(
      await run(EC_SIGNATURE_DER, 'from-base64', [
        'ecdsa-signature-conversion',
        { 'Input format': 'DER', 'Output format': 'JSON', Encoding: 'Raw bytes' },
      ]),
    ) as { r: string; s: string };
    expect(json.r).toMatch(/^[0-9a-f]{64}$/);
    expect(json.s).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads JSON back into a signature the verifier accepts', async () => {
    const json = await run(EC_SIGNATURE_DER, 'from-base64', [
      'ecdsa-signature-conversion',
      { 'Input format': 'DER', 'Output format': 'JSON', Encoding: 'Raw bytes' },
    ]);
    const raw = await run(json, [
      'ecdsa-signature-conversion',
      { 'Input format': 'JSON', 'Output format': 'Raw (r||s)', Encoding: 'Hex' },
    ]);
    expect(await run(MESSAGE, ['ecdsa-verify', { Key: EC_PUBLIC, Signature: raw }])).toMatch(
      /^Verified/,
    );
  }, 30000);

  it('refuses a raw signature of the wrong length', async () => {
    const result = await bake(
      'abcd',
      recipe(['ecdsa-signature-conversion', { 'Input format': 'Raw (r||s)' }]),
    );
    expect(result.error?.message).toMatch(/is 64 bytes; this one is 2/);
  });
});

describe('key generation and conversion', () => {
  it('generates an RSA pair its own operations can use', async () => {
    const pair = await run('', ['generate-rsa-key-pair', { 'Key size': '2048' }]);
    expect(pair).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pair).toContain('-----BEGIN PRIVATE KEY-----');

    const [publicKey, privateKey] = pair.split('\n\n');
    const signature = await run(MESSAGE, ['rsa-sign', { Key: privateKey! }]);
    expect(await run(MESSAGE, ['rsa-verify', { Key: publicKey!, Signature: signature }])).toMatch(
      /^Verified/,
    );
  }, 120000);

  it('generates an ECDSA pair its own operations can use', async () => {
    const pair = await run('', ['generate-ecdsa-key-pair', { Curve: 'P-384' }]);
    const [publicKey, privateKey] = pair.split('\n\n');
    const signature = await run(MESSAGE, [
      'ecdsa-sign',
      { Key: privateKey!, Curve: 'P-384', Hash: 'SHA-384' },
    ]);
    expect(signature).toHaveLength(192); 
    expect(
      await run(MESSAGE, [
        'ecdsa-verify',
        { Key: publicKey!, Signature: signature, Curve: 'P-384', Hash: 'SHA-384' },
      ]),
    ).toMatch(/^Verified/);
  }, 60000);

  it('converts PEM to JWK and back', async () => {
    const jwk = JSON.parse(await run(EC_PUBLIC, 'pem-to-jwk')) as { kty: string; crv: string };
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');

    const back = await run(JSON.stringify(jwk), 'jwk-to-pem');
    expect(back.replace(/\s/g, '')).toBe(EC_PUBLIC.replace(/\s/g, ''));
  }, 30000);

  it('converts an RSA public key to JWK', async () => {
    const jwk = JSON.parse(await run(RSA_PUBLIC, 'pem-to-jwk')) as {
      kty: string;
      n: string;
      e: string;
    };
    expect(jwk.kty).toBe('RSA');
    expect(jwk.e).toBe('AQAB');
    expect(jwk.n.length).toBeGreaterThan(300);
  }, 30000);

  it('derives the public key from a private one', async () => {
    expect((await run(RSA_PRIVATE, 'public-key-from-private-key')).replace(/\s/g, '')).toBe(
      RSA_PUBLIC.replace(/\s/g, ''),
    );
    expect((await run(EC_PRIVATE, 'public-key-from-private-key')).replace(/\s/g, '')).toBe(
      EC_PUBLIC.replace(/\s/g, ''),
    );
  }, 60000);

  it('refuses JSON that is not a JWK', async () => {
    const result = await bake('{"hello":"world"}', recipe('jwk-to-pem'));
    expect(result.error?.message).toMatch(/needs a 'kty'/);
  });
});
