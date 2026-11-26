const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');

// GitHub supplies first-time status in generated Markdown, not in a structured field.
// Accept its contributor records only, then confirm the PR author and merge via the pulls API.
async function newContributors(repository, previousTag, tag, api, warn) {
  let lines;
  try {
    const { body } = await api('POST', 'releases/generate-notes', {
      tag_name: tag, previous_tag_name: previousTag,
    });
    lines = body.split(/\r?\n/);
  } catch {
    warn('GitHub contributor metadata is unavailable. Omitting credits.');
    return [];
  }
  const heading = lines.indexOf('## New Contributors');
  if (heading < 0) return [];
  if (heading !== lines.lastIndexOf('## New Contributors')) {
    warn('Ambiguous GitHub contributor section. Omitting credits.');
    return [];
  }

  const credits = [];
  const seen = new Set();
  for (const line of lines.slice(heading + 1)) {
    if (/^#{1,6} |^\*\*Full Changelog/.test(line)) break;
    if (!line.trim()) continue;
    const match = /^[-*] @([\w-]+(?:\[bot\])?) made their first contribution in (?:https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/|#)([1-9]\d*)\.?$/.exec(line);
    if (!match || (match[2] && match[2] !== repository)) {
      warn('Unrecognized GitHub contributor record. Skipping it.');
      continue;
    }
    const [, login, , number] = match;
    if (seen.has(login.toLowerCase())) continue;
    let pr;
    try {
      pr = await api('GET', `pulls/${number}`);
    } catch {
      warn(`Contributor metadata for PR #${number} is unavailable. Skipping it.`);
      continue;
    }
    if (!pr?.merged_at || pr.base?.ref !== 'main' || pr.base.repo?.full_name !== repository ||
        pr.user?.login?.toLowerCase() !== login.toLowerCase() || String(pr.number) !== number) {
      warn(`Could not confirm the contributor on PR #${number}. Skipping it.`);
      continue;
    }
    seen.add(login.toLowerCase());
    credits.push(`- @${pr.user.login} made their first contribution in [#${number}](https://github.com/${repository}/pull/${number}).`);
  }
  return credits;
}

async function formatNotes(original, tag, repository, api, warn) {
  const notes = original.replace(/\r\n/g, '\n').trim();
  const [header, ...lines] = notes.split('\n');
  const changes = lines.join('\n').trim();
  const match = /^## \[(?<version>[\d.]+)\]\((?<comparison>\S+\/compare\/(?<previousTag>v\d+\.\d+\.\d+)\.\.\.v[\d.]+)\) \((?<date>\d{4}-\d{2}-\d{2})\)$/.exec(header);
  if (!match || 'v' + match.groups.version !== tag || !changes ||
      match.groups.comparison !== `https://github.com/${repository}/compare/${match.groups.previousTag}...${tag}` ||
      /^## (?:What's Changed|New Contributors|Standalone Edition)$/m.test(changes)) {
    throw new Error('Unrecognized Release Please notes. Leaving the published body intact.');
  }
  const { comparison, previousTag, date } = match.groups;
  const credits = await newContributors(repository, previousTag, tag, api, warn);
  const title = `OWASP DecodeBox ${tag}`;
  return [
    `# ${title}`,
    `Changes since [${previousTag}](${comparison}) · ${date}`,
    "## What's Changed",
    changes,
    ...(credits.length ? ['## New Contributors', credits.join('\n')] : []),
    '## Standalone Edition',
    `Download \`OWASP-DecodeBox-Standalone-${tag}.html\` from the release assets and open it in your browser.`,
    'Core encoding, decoding, and analysis work offline. Processing runs locally in your browser, ' +
      'with no installation or server required.',
    'Large inputs can pause the tab. Download a new copy for updates and security fixes.',
  ].join('\n\n');
}

const marker = '<!-- decodebox-release-notes:';
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

// The checksum binds the visible bytes, both original hashes and the phase to this release ID.
function markedBody(release, phase, visible, originalHash, titleHash) {
  const seal = sha256(JSON.stringify([release.id, release.tag_name, phase, originalHash, titleHash, visible]));
  return visible + '\n\n' + marker + ['v1', phase, originalHash, titleHash, seal].join(' ') + ' -->';
}

function inspectMarker(release) {
  const [visible, suffix, extra] = release.body.split('\n\n' + marker);
  if (visible.includes(marker) || extra !== undefined) throw new Error('Malformed or duplicate integrity marker.');
  if (suffix === undefined) return null;
  const fields = /^v1 (baseline|formatted) ([a-f0-9]{64}) ([a-f0-9]{64}) [a-f0-9]{64} -->$/.exec(suffix);
  if (!fields) throw new Error('Invalid release notes integrity marker.');
  const [, phase, originalHash, titleHash] = fields;
  if (markedBody(release, phase, visible, originalHash, titleHash) !== release.body ||
      (phase === 'baseline' && sha256(visible) !== originalHash)) {
    throw new Error('Release body or integrity marker changed. Review the published notes.');
  }
  const expectedTitle = 'OWASP DecodeBox ' + release.tag_name;
  if (release.name !== expectedTitle && (phase === 'formatted' || sha256(release.name) !== titleHash)) {
    throw new Error('The release title changed. Review the published title.');
  }
  return { phase, visible, originalHash, titleHash };
}

function validateRelease(release, tag, id) {
  if (!Number.isSafeInteger(release?.id) || release.id <= 0 || (id && String(release.id) !== id) ||
      release.tag_name !== tag || release.draft !== false || typeof release.published_at !== 'string' ||
      !Number.isFinite(Date.parse(release.published_at)) ||
      typeof release.name !== 'string' || typeof release.body !== 'string') {
    throw new Error('Expected the requested published release, its ID, title and notes.');
  }
}

function standaloneAsset(release) {
  const name = 'OWASP-DecodeBox-Standalone-' + release.tag_name + '.html';
  const matches = release.assets?.filter(asset => asset.name === name) ?? [];
  const [asset] = matches;
  if (matches.length !== 1 || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.id) || asset.id <= 0 ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error('Expected one uploaded ' + name + ' with a SHA-256 digest. Run the standalone rebuild first.');
  }
  return asset;
}

async function publishReleaseNotes({ mode, tag, id, original, title, version, digest, repository }, api,
  warn = console.warn, downloadDigest = hashGitHubAsset) {
  if (!['baseline', 'format', 'repair'].includes(mode)) throw new Error('Choose baseline, format or repair.');
  if (!/^v(0|[1-9]\d*)(\.(0|[1-9]\d*)){2}$/.test(tag) || ['v0.1.0', 'v0.1.1'].includes(tag)) {
    throw new Error('Invalid or protected release tag.');
  }
  if (mode !== 'repair' && !/^[1-9]\d*$/.test(id)) throw new Error('Missing release creation ID.');
  const current = await api('GET', mode === 'repair' ? 'releases/tags/' + tag : 'releases/' + id);
  validateRelease(current, tag, mode === 'repair' ? undefined : id);
  const endpoint = 'releases/' + current.id;
  let payload;
  if (mode === 'baseline') {
    if ('v' + version !== tag || typeof original !== 'string' || !original || !title) {
      throw new Error('Incomplete Release Please creation response.');
    }
    const state = inspectMarker(current);
    if (state && state.originalHash === sha256(original) && state.titleHash === sha256(title)) return;
    if (state || current.body !== original || current.name !== title) {
      throw new Error('Title or body differs from the creation response. Refusing to record a baseline.');
    }
    payload = { body: markedBody(current, 'baseline', original, sha256(original), sha256(title)) };
  } else {
    const asset = standaloneAsset(current);
    if (mode === 'repair') digest = await downloadDigest(repository, asset);
    if (digest !== asset.digest) throw new Error('Standalone asset digest mismatch.');
    const state = inspectMarker(current);
    if (!state) throw new Error('Missing creation baseline. Review the release manually.');
    if (state.phase === 'baseline') {
      const formatted = await formatNotes(state.visible, tag, repository, api, warn);
      payload = { body: markedBody(current, 'formatted', formatted, state.originalHash, state.titleHash) };
      const expectedTitle = 'OWASP DecodeBox ' + tag;
      if (current.name !== expectedTitle) payload.name = expectedTitle;
    }

    // Recheck after the download and contributor lookups, including on a no-op repair.
    // GitHub documents no conditional PATCH for releases.
    const latest = await api('GET', endpoint);
    validateRelease(latest, tag, String(current.id));
    const latestAsset = standaloneAsset(latest);
    if (latest.body !== current.body || latest.name !== current.name ||
        latestAsset.id !== asset.id || latestAsset.size !== asset.size || latestAsset.digest !== digest) {
      throw new Error('Release metadata or asset changed while formatting. Retry after review.');
    }
    if (state.phase === 'formatted') return;
  }
  const updated = await api('PATCH', endpoint, payload);
  validateRelease(updated, tag, String(current.id));
  if (updated.body !== payload.body || updated.name !== (payload.name ?? current.name)) {
    throw new Error('GitHub did not confirm the requested release metadata.');
  }
  return updated.body;
}

// Recovery has no local build. Stream the asset by its GitHub ID and hash the actual bytes.
async function hashGitHubAsset(repository, asset) {
  const hash = createHash('sha256');
  let bytes = 0;
  const child = spawn('gh', ['api', '-H', 'Accept: application/octet-stream',
    'repos/' + repository + '/releases/assets/' + asset.id], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    hash.update(chunk);
  });
  const [code] = await once(child, 'close');
  if (code !== 0 || bytes !== asset.size) throw new Error('Could not verify the complete standalone asset download.');
  return 'sha256:' + hash.digest('hex');
}

module.exports = { publishReleaseNotes };
if (require.main === module) {
  const { RELEASE_TAG: tag, RELEASE_ID: id, RELEASE_VERSION: version, ORIGINAL_TITLE: title,
    ORIGINAL_NOTES: original, VERIFIED_DIGEST: digest, GITHUB_REPOSITORY: repository } = process.env;
  const api = (method, path, payload) => JSON.parse(execFileSync('gh', [
    'api', '--method', method, 'repos/' + repository + '/' + path, ...(payload ? ['--input', '-'] : []),
  ], { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
  publishReleaseNotes({ mode: process.argv[2], tag, id, version, title, original, digest, repository }, api)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
