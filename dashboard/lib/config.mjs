// Where the dashboard looks. Everything is derived from the repo root; the few machine-specific
// locations can be overridden with environment variables, never edited in code.
import { resolve, join } from 'node:path';

export function loadConfig(overrides = {}) {
  const root = resolve(overrides.root || process.env.DASH_ROOT || join(import.meta.dirname, '..', '..'));
  const cfg = {
    root,
    port: Number(process.env.DASH_PORT || 4319),
    lan: process.env.DASH_LAN === '1', // phone access over home Wi-Fi; off unless asked for
    host: process.env.DASH_LAN === '1' ? '0.0.0.0' : '127.0.0.1',
    linkCommand: ['python', '-I', '-X', 'utf8', process.env.DASH_LINK_SCRIPT || 'C:/Users/no_1_/.claude/skills/ig-insights/scripts/link.py'],
    dueHour: Number(process.env.DASH_DUE_HOUR || 9), // in dueTimeZone, not this PC's clock
    dueTimeZone: process.env.DASH_TZ || 'Europe/London',
    dueConfirmed: process.env.DASH_DUE_CONFIRMED === '1', // until set, every due date is shown as provisional
    recentDays: 14,
    // Shorts and TikTok records begin here. An Instagram post from before this date reads "Not recorded", never "due".
    trackFrom: new Date((process.env.DASH_TRACK_FROM || '2026-11-16') + 'T00:00:00Z'),
    dropDir: join(root, 'Instagram_transcript'),
    inputsDir: join(root, 'reels-data', 'inputs'),
    workOutDir: join(root, 'reels-data', 'outputs'),
    scriptsOut: join(root, 'instagram_scripts_output'),
    approvedDir: join(root, 'instagram_scripts_output', 'approved'),
    resourcesMd: join(root, 'reels-data', 'resources.md'),
    resourceSources: join(root, 'reels-data', 'resource-sources'),
    linksJson: join(root, 'reels-data', 'insights', 'links.json'),
    projectsDir: join(root, 'video-projects'),
    rawMedia: join(root, 'raw-media'),
    contentDir: join(root, 'reels-data', 'content'), // the only folder the dashboard writes to
    researchDir: join(root, 'reels-data', 'research'), // written by dashboard/research-import.mjs; ideas.json in it by lib/ideas.mjs
    uploadsDir: process.env.DASH_UPLOADS || 'D:/Uploads',
    approver: process.env.DASH_APPROVER || 'Mits', // the name written into hook and candidate approvals
    // The real Reel Studio scripts, found from this file's own place in the repo (not from the data root).
    reelScriptsDir: join(import.meta.dirname, '..', '..', '.claude', 'skills', 'create-reel', 'scripts'),
    uploadsAllDir: process.env.DASH_UPLOADS_ALL || 'All social media', // Mits, 2026-11-16: a file here is on every platform; a file in the Uploads root is on Instagram only
    missionCli: process.env.DASH_MISSION_CLI || 'D:/claudeclaw-os/dist/mission-cli.js',
    missionAgent: process.env.DASH_MISSION_AGENT || 'main',
    queueHealthUrl: process.env.DASH_QUEUE_URL || 'http://127.0.0.1:3141/api/health',
    ...overrides,
  };
  cfg.gumroadScript = overrides.gumroadScript || join(cfg.root, '.claude', 'skills', 'approve-reel', 'gumroad_upload.mjs');
  cfg.approvalsFile = join(cfg.contentDir, 'pdf-approvals.json'); // read by gumroad_upload.mjs before any upload
  cfg.tokenFile = join(cfg.contentDir, 'phone-token.txt'); // created the first time the server starts with DASH_LAN=1
  cfg.runtime = { queue: { available: false, running: false, reason: 'not checked yet', missions: [] }, uploads: {} };
  return cfg;
}
