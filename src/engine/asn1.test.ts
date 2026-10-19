import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe } from './types';


const CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDyzCCArOgAwIBAgIUP8V9YiXA+ARNHqta7Ehdc+ZUFbUwDQYJKoZIhvcNAQEL
BQAwUzELMAkGA1UEBhMCR0IxDzANBgNVBAgMBkxvbmRvbjEXMBUGA1UECgwORGVj
b2RlQm94IFRlc3QxGjAYBgNVBAMMEWRlY29kZWJveC5leGFtcGxlMB4XDTI2MDkw
ODA1MjcxOFoXDTM2MDkwNTA1MjcxOFowUzELMAkGA1UEBhMCR0IxDzANBgNVBAgM
BkxvbmRvbjEXMBUGA1UECgwORGVjb2RlQm94IFRlc3QxGjAYBgNVBAMMEWRlY29k
ZWJveC5leGFtcGxlMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyvx2
/4kjRayoeU6y9JuyMynkqR74XbVassBBPXq8Vc6M3hEH0S4QDxWPDX4BMaCHq74c
as4+7M1+wNNMlv+ZWfET0sE8PFeqaJOLCgFmx7MJYKOvbtFpGqv5kY4wfgrxybru
hwvKLgV2D2urjvqcqIwTF07gT/A5SvGuCmb2TDipIsliAAI/gX52OhZrDh53Y+co
ipA6yF823W3fRCz/WwiffpHwOf8NaqAS48J432f6zgFaCCxw7iTe1ELJ/NptRESG
43ivl6lowWgakMl4toWGI2D0+24aqYFnQV/G0quOsL62PA8D8+AkQp4ewY1tXfPQ
5PodPuPZGfCSlJu7XwIDAQABo4GWMIGTMB0GA1UdDgQWBBT292Tkv0X2nrtNTJP/
D0+z5JmTUjAfBgNVHSMEGDAWgBT292Tkv0X2nrtNTJP/D0+z5JmTUjAzBgNVHREE
LDAqghFkZWNvZGVib3guZXhhbXBsZYIVd3d3LmRlY29kZWJveC5leGFtcGxlMA4G
A1UdDwEB/wQEAwIFoDAMBgNVHRMBAf8EAjAAMA0GCSqGSIb3DQEBCwUAA4IBAQCG
WXoMbshxin0y1c8ikXd9aIdbIbht1DY6tzza3DekBTJMEgajQfjdIqWnZlIZqti/
fa16nqIFjfK1qc0VVyf3RSZ6XHrAZlxGrn1qdneaJ9Pi9HRWKcHkO70GwQoYu5fb
oZ4W1HqqDglKbiZO61qs5OIo6KjF4c5GI9vswzrd5PBsV+8p5tu/2G59MJY7GXMR
Bib7UPNOF26+2v0jlrd92kbYrVy+UqO2xJg0xfRFXjNiqn7lC3EbCoP0THpB5/cY
c2JGfgL+LnTF9GIFd04spWtdHGTRLhlzvzdIUSrbc4wEG08In1y7fWQiFZfuQXhC
8FQ6H7E6UtAeqoS4gEyH
-----END CERTIFICATE-----`;

const REQUEST = `-----BEGIN CERTIFICATE REQUEST-----
MIICbDCCAVQCAQAwJzELMAkGA1UEBhMCR0IxGDAWBgNVBAMMD3JlcXVlc3QuZXhh
bXBsZTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMr8dv+JI0WsqHlO
svSbsjMp5Kke+F21WrLAQT16vFXOjN4RB9EuEA8Vjw1+ATGgh6u+HGrOPuzNfsDT
TJb/mVnxE9LBPDxXqmiTiwoBZsezCWCjr27RaRqr+ZGOMH4K8cm67ocLyi4Fdg9r
q476nKiMExdO4E/wOUrxrgpm9kw4qSLJYgACP4F+djoWaw4ed2PnKIqQOshfNt1t
30Qs/1sIn36R8Dn/DWqgEuPCeN9n+s4BWggscO4k3tRCyfzabUREhuN4r5epaMFo
GpDJeLaFhiNg9PtuGqmBZ0FfxtKrjrC+tjwPA/PgJEKeHsGNbV3z0OT6HT7j2Rnw
kpSbu18CAwEAAaAAMA0GCSqGSIb3DQEBCwUAA4IBAQBB1aQzWN9cvVtxKFmqYMwi
li0GEpxZRveodMvbh6ri9j2zOaUMDLw0ngEDL34J1hQica+t8+FWKYUAlOums+Tc
xPFw18TNpQYA0A0Kcyosh51k3NVxIkbtjJ9B0Hx6N1L5jfZr+Ga38VjoxNPh9u2F
S0/TO2su7dH3dZ8+nT9VxiLGUeNYy/YPTKBvb45Ji1jg7eFqxTIA0O04gPXvccrq
wrBnJjSz6AukyRvhkZlAG2OQ2rrgzwY8bcBUqzji0hDyym1TdvL3jz//HSa7Own0
fNlHZXToT8sr4LV1Y7sBFTf4TIor++qExLzBZJDtEjUKc1NiMe1yNU+dSq6Yd2zm
-----END CERTIFICATE REQUEST-----`;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyvx2/4kjRayoeU6y9Juy
MynkqR74XbVassBBPXq8Vc6M3hEH0S4QDxWPDX4BMaCHq74cas4+7M1+wNNMlv+Z
WfET0sE8PFeqaJOLCgFmx7MJYKOvbtFpGqv5kY4wfgrxybruhwvKLgV2D2urjvqc
qIwTF07gT/A5SvGuCmb2TDipIsliAAI/gX52OhZrDh53Y+coipA6yF823W3fRCz/
WwiffpHwOf8NaqAS48J432f6zgFaCCxw7iTe1ELJ/NptRESG43ivl6lowWgakMl4
toWGI2D0+24aqYFnQV/G0quOsL62PA8D8+AkQp4ewY1tXfPQ5PodPuPZGfCSlJu7
XwIDAQAB
-----END PUBLIC KEY-----
`;

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

describe('object identifiers', () => {
  it('converts between dotted and DER form', async () => {
    expect(await run('1.2.840.113549.1.1.11', 'object-identifier-to-hex')).toBe(
      '2a864886f70d01010b',
    );
    expect(await run('2a864886f70d01010b', 'hex-to-object-identifier')).toBe(
      '1.2.840.113549.1.1.11',
    );
    expect(await run('2.5.29.17', 'object-identifier-to-hex')).toBe('551d11');
    expect(await run('551d11', 'hex-to-object-identifier')).toBe('2.5.29.17');
  });

  it('round-trips an identifier with a large arc', async () => {
    const oid = '1.3.6.1.4.1.11129.2.4.2';
    expect(await run(oid, 'object-identifier-to-hex', 'hex-to-object-identifier')).toBe(oid);
  });
});

describe('ASN.1', () => {
  it('renders the tag, length and value tree', async () => {
    const tree = await run(CERTIFICATE, 'parse-asn1');
    expect(tree.split('\n')[0]).toMatch(/^SEQUENCE \(\d+ bytes\)$/);
    expect(tree).toContain('OBJECT IDENTIFIER');
    expect(tree).toContain('sha256WithRSAEncryption (1.2.840.113549.1.1.11)');
    expect(tree).toContain('UTCTime');
  });

  it('reports where a length runs past the end', async () => {
    const result = await bake('300a', recipe('parse-asn1'));
    expect(result.error?.message).toMatch(/claims 10 bytes/);
  });
});

describe('X.509', () => {
  it('reads the same fields OpenSSL reports', async () => {
    const parsed = await run(CERTIFICATE, 'parse-x509-certificate');
    expect(parsed).toContain('Version: 3');
    expect(parsed).toContain('Serial number: 0x3fc57d6225c0f8044d1eab5aec485d73e65415b5');
    expect(parsed).toContain('Signature algorithm: sha256WithRSAEncryption');
    expect(parsed).toContain('Issuer: C=GB, ST=London, O=DecodeBox Test, CN=decodebox.example');
    expect(parsed).toContain('Subject: C=GB, ST=London, O=DecodeBox Test, CN=decodebox.example');
    expect(parsed).toContain('Not before: 2026-09-08T05:27:18Z');
    expect(parsed).toContain('Not after:  2036-09-05T05:27:18Z');
    expect(parsed).toContain('Algorithm: rsaEncryption');
    expect(parsed).toContain('Key size: 2048 bits');
    expect(parsed).toContain('Exponent: 65537');
  });

  it('reads the extensions, criticality included', async () => {
    const parsed = await run(CERTIFICATE, 'parse-x509-certificate');
    expect(parsed).toContain(
      'subjectAltName: DNS:decodebox.example, DNS:www.decodebox.example',
    );
    expect(parsed).toContain('keyUsage (critical): digitalSignature, keyEncipherment');
    expect(parsed).toContain('basicConstraints (critical): CA=false');
    expect(parsed).toContain(
      'subjectKeyIdentifier: f6f764e4bf45f69ebb4d4c93ff0f4fb3e4999352',
    );
  });

  it('extracts the public key as a usable PEM', async () => {
    expect(await run(CERTIFICATE, 'public-key-from-certificate')).toBe(PUBLIC_KEY);
  });

  it('reads a certificate signing request', async () => {
    const parsed = await run(REQUEST, 'parse-csr');
    expect(parsed).toContain('Subject: C=GB, CN=request.example');
    expect(parsed).toContain('Key size: 2048 bits');
    expect(parsed).toContain('Signature algorithm: sha256WithRSAEncryption');
  });

  it('refuses something that is not a certificate', async () => {
    const result = await bake('3003020101', recipe('parse-x509-certificate'));
    expect(result.error?.message).toMatch(/not an X.509 certificate/);
  });
});

describe('SSH keys', () => {
  it('reads an ed25519 host key', async () => {
    const parsed = await run(
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKbhawxr/csHKjSyn1LUygIzC784H0reRrRw+y0li9pv test@decodebox',
      'parse-ssh-host-key',
    );
    expect(parsed).toContain('Key type: ssh-ed25519');
    expect(parsed).toContain(
      'Public key: 0xa6e16b0c6bfdcb072a34b29f52d4ca02330bbf381f4ade46b470fb2d258bda6f',
    );
  });

  it('reports the size of an RSA host key', async () => {
    const parsed = await run(
      'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDF3hj+zRMvRdEXbt1ALKS6rpfpKenASdfbOX2X9QgWc9bm' +
        'QbZfvWO2zE3Kc1be+nMx5ws9IZNNu/UjyUPaXCaKRMfyNed9ha2vBdD5lPd8t3Fdecpu9xHH5dlFuFE0+jjA' +
        '5rJng1XbRNxUjfeejzlEoNaPrY5V18985GAyNvreWGK/VHqL1TWcEX3t1r+lcO61lotCMdgu3BV4kmCfWBB2' +
        'gBDHKm2r23ge5Njj7WQNzy1lSsNL4xbiYinBzublbWPc1ji80nydhRh7Nr2ft0Pg5iWNPma8Lxcs1NNeL3MW' +
        'PfXGGqk59MCtL8l+i5QN4CubUJY9nFQ45+3jhblnFyKj rsa@decodebox',
      'parse-ssh-host-key',
    );
    expect(parsed).toContain('Key type: ssh-rsa');
    expect(parsed).toContain('Exponent: 0x010001');
    expect(parsed).toContain('Key size: 2048 bits');
  });

  it('says so when there is no key', async () => {
    const result = await bake('not a key', recipe('parse-ssh-host-key'));
    expect(result.error?.message).toMatch(/No Base64 SSH key/);
  });
});
