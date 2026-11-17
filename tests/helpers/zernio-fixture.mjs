// Isolated workflow and fake Zernio service. No real credentials, footage or network.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../dashboard/lib/config.mjs';
import { buildState } from '../../dashboard/lib/state.mjs';
import { readManifests } from '../../dashboard/lib/manifest.mjs';
import { BASE, ROUTE } from '../../dashboard/lib/zernio.mjs';

export const ID = '2026-11-16-001-01';
export const TRIAL = '2026-11-16-002-01';
export const fakeKeys = { A: 'sk_fixture_login_A_1234567890', B: 'sk_fixture_login_B_1234567890' };
const bar = '='.repeat(60), section = (n, t) => `${bar}\n${n}\n${bar}\n\n${t}\n\n`;
export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zernio-test-'));
  const put = (p, t) => { const f = join(root, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof t === 'string' || Buffer.isBuffer(t) ? t : JSON.stringify(t)); };
  const sha = createHash('sha256').update('fixture-video').digest('hex');
  put('instagram_scripts_output/batch-2026-11-16-001/01-fixture.txt', `REEL 1: Publishing fixture\nStatus: READY TO RECORD\n\n${section('VERSION A', 'Approved words')}${section('VERSION B', 'Other words')}`);
  put('instagram_scripts_output/approved/batch-2026-11-16-001/01-fixture-version-a.txt', `Status at approval: READY TO RECORD\n\n${section('SCRIPT', 'Approved words')}${section('INSTAGRAM CAPTION', 'Instagram caption\n\n#automation')}${section('TIKTOK CAPTION', 'TikTok caption\n\n#tiktok')}${section('YOUTUBE SHORTS', 'Title: Fixture title\n\nDescription:\nYouTube description\n\n#shorts\n\nTags: automation, tutorial')}${section('CTA', 'Share this video.')}`);
  put('reels-data/outputs/batch-2026-11-16-002/reel-01-trial.md', '### REEL 1 — Trial reel\n\n**VERSION A — Faithful Rewrite**\n\nTrial A.\n\n**VERSION B — Stronger Alternative**\n\nTrial B.\n\n**FINAL COMPARISON**\n\n- Publication status: PENDING REVIEW\n');
  put('reels-data/inputs/batch-2026-11-16-002/trial.md', '## Reel: Trial reel\n\nSpoken trial words.');
  const project = { slug: 'publishing-fixture', preflightRequired: true, preflight: { status: 'approved' }, renders: [{ file: 'renders/candidate-v001.mp4', kind: 'candidate', version: 1, sha256: sha }], approvals: [{ candidate: 'renders/candidate-v001.mp4', status: 'approved', sha256: sha, approvedAt: '2026-11-16T10:00:00Z', approvedBy: 'Fixture' }] };
  put('video-projects/publishing-fixture/reel.json', project);
  put('video-projects/publishing-fixture/renders/candidate-v001.mp4', 'fixture-video');
  put('video-projects/publishing-fixture/renders/candidate-v001.qa/qa.json', { passed: true, verdict: 'VERIFIED', sha256: sha });
  put('video-projects/publishing-fixture/renders/final.mp4', 'fixture-video');
  put(`reels-data/content/${ID}.json`, { id: ID, links: { project: 'publishing-fixture' }, tasks: {}, publishing: {} });
  const account = (platform, permissions, metadata = {}) => ({ _id: `${platform}-account`, platform, username: `fixture.${platform}`, displayName: `Fixture ${platform}`, permissions, metadata, isActive: true });
  const accountSets = {
    A: [account('tiktok', ['video.publish', 'video.upload'], { apiFlavor: 'business' }), account('youtube', ['https://www.googleapis.com/auth/youtube.upload'])],
    B: [account('instagram', ['instagram_business_content_publish'], { profileData: { extraData: { accountType: 'MEDIA_CREATOR' } } }), account('facebook', ['pages_manage_posts'], { selectedPageId: '12345', selectedPageName: 'Fixture Page' })],
  };
  const creator = { creator: { canPostMore: true }, privacyLevels: [{ value: 'PUBLIC_TO_EVERYONE', label: 'Public to everyone' }], postingLimits: { maxVideoDurationSec: 600, interactionSettings: Object.fromEntries(['allow_comment', 'allow_duet', 'allow_stitch'].map(k => [k, { enabled: true, required: true, default: false }])) }, commercialContentTypes: [{ value: 'none', label: 'No commercial content' }, { value: 'brand_organic', label: 'Your brand' }, { value: 'brand_content', label: 'Branded content' }] };
  const calls = [], remote = new Map(), faults = {}, healthOverrides = {};
  const cfg = loadConfig({ root, missionCli: false, uploadsDir: join(root, 'Uploads'), zernio: { keys: fakeKeys } });
  const reply = (status, json = {}) => ({ status, json: async () => structuredClone(json) });
  const publicUrl = p => ({ instagram: 'https://www.instagram.com/reel/fixture/', facebook: 'https://www.facebook.com/reel/fixture/', tiktok: 'https://www.tiktok.com/@fixture/video/123/', youtube: 'https://www.youtube.com/shorts/fixture/' })[p];
  const result = (postId, p, state = 'published') => ({ _id: postId, status: state, platforms: [{ platform: p, accountId: `${p}-account`, status: state === 'scheduled' ? 'pending' : state, ...(state === 'published' ? { platformPostUrl: publicUrl(p), publishedAt: new Date().toISOString() } : {}), ...(state === 'failed' ? { errorMessage: 'Fixture failure' } : {}) }] });
  cfg.zernio.fetch = async (url, options = {}) => {
    const method = options.method || 'GET', body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : null;
    const login = Object.entries(fakeKeys).find(([, k]) => options.headers?.authorization === 'Bearer ' + k)?.[0] || null;
    const call = { url, method, login, headers: options.headers, body, manifests: readManifests(cfg) }; calls.push(call);
    if (url.startsWith('https://storage.fixture/')) { if (options.headers?.authorization) throw new Error('Credential leaked to storage'); if (faults.upload) return reply(503); return reply(200); }
    if (!url.startsWith(BASE) || !login) throw new Error('Unexpected network request blocked by fixture');
    const path = url.slice(BASE.length);
    if (method === 'GET' && path === '/accounts') return reply(200, { accounts: accountSets[login] });
    if (method === 'GET' && path === '/accounts/health') return reply(200, { accounts: accountSets[login].map(a => ({ accountId: a._id, status: 'healthy', canPost: true, needsReconnect: false, ...healthOverrides[a.platform] })) });
    if (method === 'GET' && path.startsWith('/accounts/tiktok-account/tiktok/creator-info')) return reply(200, creator);
    if (method === 'POST' && path === '/media/presign') return reply(200, { uploadUrl: `https://storage.fixture/${calls.length}`, publicUrl: `https://media.fixture/${calls.length}.mp4` });
    if (method === 'POST' && path === '/posts') {
      const p = body.platforms[0].platform;
      if (ROUTE[p] !== login) throw new Error('Wrong login used for platform');
      const fault = faults[p]; if (typeof fault === 'function') return fault(call);
      if (fault === 'timeout') throw new Error('Fixture timeout');
      if (fault === '500') return reply(500, { error: 'Fixture unavailable' });
      if (fault === '409') return reply(409, { code: 'idempotency_conflict' });
      if (fault === 'duplicate') return reply(409, { existingPostId: 'existing-fixture-post', error: 'Duplicate' });
      if (fault === '400') return reply(400, { error: 'Fixture validation error' });
      const same = [...remote.values()].find(x => x.key === options.headers['idempotency-key']);
      if (same) return reply(200, { post: same.post });
      const post = result('remote-' + p, p, fault === 'failed' ? 'failed' : body.scheduledFor ? 'scheduled' : 'published');
      if (body.tiktokSettings?.draft) delete post.platforms[0].platformPostUrl;
      remote.set(post._id, { key: options.headers['idempotency-key'], post });
      return reply(post.status === 'failed' ? 207 : 201, { post });
    }
    const match = path.match(/^\/posts\/([^/]+)(\/retry)?$/);
    if (match) {
      const saved = remote.get(match[1]); if (!saved) return reply(404);
      const p = saved.post.platforms[0].platform; if (ROUTE[p] !== login) throw new Error('Wrong status/retry login');
      if (method === 'GET' && !match[2]) return reply(200, { post: saved.post });
      if (method === 'POST' && match[2]) { saved.post = result(match[1], p); return reply(200, { post: saved.post }); }
    }
    throw new Error(`Unexpected mock endpoint: ${method} ${path}`);
  };
  const fields = {
    instagram: { text: 'Instagram text', tags: '#automation' }, facebook: { text: 'Separate Facebook text', tags: 'facebook' },
    youtube: { text: 'YouTube description', tags: 'shorts', title: 'A deliberate title', keywords: 'automation, tutorial', visibility: 'unlisted' },
    tiktok: { text: 'TikTok text', tags: 'tiktok', mode: 'direct', privacy: 'PUBLIC_TO_EVERYONE', comment: false, duet: false, stitch: false, commercial: 'none', consentPreview: true, consentExpress: true },
  };
  return { root, cfg, put, project, sha, fields, calls, remote, faults, creator, accountSets, healthOverrides, reply, result,
    item: () => buildState(cfg).items.find(i => i.id === ID), manifest: () => JSON.parse(readFileSync(join(cfg.contentDir, ID + '.json'), 'utf8')),
    action: (destinations = ['instagram'], extra = {}) => ({ id: ID, type: 'zernio-send', sha, mode: 'now', destinations, accounts: Object.fromEntries(destinations.map(p => [p, { accountId: p + '-account', login: ROUTE[p] }])), fields: structuredClone(fields), ...extra }),
  };
}
