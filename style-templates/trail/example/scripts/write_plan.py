"""Writes assets/plan.json (schema v2) for the full reel from assets/transcript.json.
Run from the project folder: python -I scripts/write_plan.py"""
import hashlib, json, re

T = json.load(open('assets/transcript.json', encoding='utf-8'))
D, W = T['duration'], T['words']
FPS = 30


def sha(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()
def norm(s): return re.sub(r"[^a-z0-9']", '', s.lower())
def at(text, after=0): return next(w['start'] for w in W if w['start'] >= after - 1e-3 and norm(w['text']) == norm(text))
def end(text, after=0): return next(w['end'] for w in W if w['start'] >= after - 1e-3 and norm(w['text']) == norm(text))
def fr(t): return round(round(t * FPS) / FPS - 0.0002, 4) if t > 0 else 0


# ---------- captions: hand-grouped phrases (word-index boundaries), read for meaning, not a fixed word count
CUTS = [0, 4, 6, 9, 11, 14, 18, 20, 23, 25, 30, 33, 36, 38, 43, 47, 49, 51, 54, 57, 60, 63, 65, 68, 72, 77, 80, 83, 87, 90,
        93, 96, 99, 102, 105, 107, 111, 116]
assert CUTS[-1] == len(W), (CUTS[-1], len(W))
caps = [W[a:b] for a, b in zip(CUTS, CUTS[1:])]
captions = []
for k, c in enumerate(caps):
    e = caps[k + 1][0]['start'] if k + 1 < len(caps) else D
    captions.append({'start': c[0]['start'], 'end': round(min(e, c[-1]['end'] + 0.6, D), 3),
                     'words': [{x: w[x] for x in ('text', 'start', 'end', 'sourceStart', 'sourceEnd')} for w in c]})


def asset(ref, source, method, why, file=None, paid=False):
    a = {'ref': ref, 'source': source, 'method': method, 'paid': paid, 'whyThis': why}
    if file: a.update({'status': 'ready', 'file': file, 'sha256': sha(file)})
    else: a['status'] = 'planned'
    return a


GH = 'https://github.com/Nutlope/hallmark'
SITE = 'https://www.usehallmark.com'
t_skill, t_called, t_comes, t_has, t_and = at("It's", 4), at("It's", 9), at('It', 10.3), at('It', 12), at('and', 13.4)
t_this_end, t_so, t_tell, t_then, t_A, t_comment = end('this', 16), at('so', 17), at('Tell'), at('Then'), at('A', 27), at('Comment')
B = [0, fr(4.5333 + 0.0002), fr(t_called - 0.07), fr(t_comes - 0.07), fr(t_has - 0.06), fr(t_and - 0.06),
     fr(at('this', 16) - 0.05), fr(t_tell - 0.08), fr(t_then - 0.08), fr(t_A - 0.06), fr(t_comment - 0.07), D]

S = []
def scene(i, sid, layout, kind, anchor, purpose, mode, evidence, intent=None, a=None, motifs=None, **kw):
    s = {'id': sid, 'start': B[i], 'end': B[i + 1], 'layout': layout, 'kind': kind, 'anchor': anchor,
         'anchorTime': round(at(anchor.split()[0], B[i] - 0.1), 3), 'visualPurpose': purpose, 'brollMode': mode, 'evidenceType': evidence}
    if intent: s['visualIntent'] = intent
    if a: s['asset'] = a
    if motifs: s['motifs'] = motifs
    s.update(kw); S.append(s)


scene(0, 's00', 'split', 'hook', 'Claude Code can now', 'evidence', 'screenshot', 'authentic',
      'Under the title "Claude Code Websites / without the AI-made look", four real Hallmark theme previews (Dusk, Ribbon, '
      'Atelier, Refract) replace each other inside one fixed browser frame on spoken beats, so by second three the viewer has '
      'seen three finished, very different sites and wants to know how.',
      asset('hallmark theme previews', GH + ' docs/screenshots (MIT)', 'have',
            'They are the actual output the speaker is talking about, not stock web-design footage or a mocked page.', 'assets/web/dusk.jpg'),
      ['frame', 'clawd', 'refract'],
      carryOut=[{'to': 's01', 'motif': 'frame', 'element': 'browser frame', 'state': 'dimmed and blurred behind the skill card'},
                {'to': 's07', 'motif': 'refract', 'element': 'Refract preview', 'state': 'one of three themes dealt for a pool site, and the one picked'}])
scene(1, 's01', 'split', 'explain', "It's all down to one skill", 'explanation', 'designed', 'reconstructed',
      'The title lifts away and the sites dim behind a sharp SKILL.md card highlighted on "one skill"; on "a set of instructions" '
      'it opens to its real first rules ("Never one italic word inside a roman heading"); on "you add to Claude Code" it drops into '
      'a light Claude Code window as the real install line types out and the skill shows as added.',
      asset('SKILL.md card and Claude Code window', GH + ' skills/hallmark/SKILL.md and the README install line', 'design',
            'It shows that the whole thing is one file of written rules added to Claude Code; a text card would only repeat the caption.',
            'assets/captures/SKILL.md.txt'),
      ['frame', 'clawd'], carryIn=[{'from': 's00', 'motif': 'frame', 'element': 'browser frame'}])
scene(2, 's02', 'face', 'name', "It's called Hallmark", 'performance', 'none', 'none',
      holdReason='Human reset: the speaker names the tool full frame, with the name set large beside him; the face carries the beat.')
scene(3, 's03', 'split', 'provenance', 'It comes from Together AI', 'evidence', 'screenshot', 'authentic',
      'The real GitHub page for Hallmark slides into the frame and the README line "Made by Together AI." is highlighted as he says it.',
      asset('GitHub README capture', GH, 'capture', 'Shows where the skill comes from at the moment the claim is made.', 'assets/captures/github-readme.png'),
      ['frame'])
scene(4, 's04', 'paper', 'breadth', 'It has 50 design themes', 'evidence', 'screenshot', 'authentic',
      'The frame pulls back across the real "Fifty themes to start from" gallery while a counter rolls to 50 on "50", so the range '
      'is seen as actual thumbnails, not just a number.',
      asset('fifty-theme gallery capture', SITE, 'capture', 'The real gallery makes the number visible.', 'assets/captures/site-full.png'),
      ['frame'])
scene(5, 's05', 'split', 'problem', 'and a list of telltale signs', 'evidence', 'screenshot', 'authentic',
      'The frame shows the page Opus 5.5 built alone from the same prompt with its real "26 issues" tag enlarged, while three of '
      'Hallmark\'s listed tells stack beside it as red-marked chips ("an eyebrow above every heading", "one coloured word in a '
      'headline", "an email sign-up at the end of every page").',
      asset('comparison: Opus alone side', SITE + ' "One prompt, two pages"', 'capture',
            'Hallmark\'s own side-by-side and its own list of tells are the evidence; outlining tells we cannot verify on the page would invent it.',
            'assets/captures/compare-without.png'),
      ['frame'], carryOut=[{'to': 's06', 'motif': 'frame', 'element': 'comparison slider', 'state': 'swept to the Hallmark side'}])
scene(6, 's06', 'paper', 'payoff', 'this, so it knows what to avoid', 'evidence', 'screenshot', 'authentic',
      'In the pause the real comparison slider sweeps across the same prompt to the Hallmark version; the tag drops from 26 issues to '
      '0, the tells chips strike through and fall away, and Clawd raises its arms.',
      asset('comparison: with Hallmark side', SITE + ' "One prompt, two pages"', 'capture',
            'The same prompt with and without the skill is the clearest proof of "knows what to avoid".', 'assets/captures/compare-with.png'),
      ['frame', 'clawd'], carryIn=[{'from': 's05', 'motif': 'frame', 'element': 'comparison slider'}])
scene(7, 's07', 'split', 'process', 'Tell it what you\'re making', 'explanation', 'ui-mock', 'simulated',
      'A light Claude Code window types "/hallmark a booking site for an outdoor pool"; on "three themes" three real theme thumbnails '
      'are dealt like cards, and on "fit" Refract lifts while the other two dim. Labelled as an illustration.',
      asset('theme deal mock', 'designed, with real theme thumbnails from ' + SITE, 'design',
            'Shows the one interaction the line describes (one request, three choices) using the real themes; the pick calls back to the hook.'),
      ['frame', 'clawd', 'refract'],
      carryIn=[{'from': 's00', 'motif': 'refract', 'element': 'Refract preview'}],
      carryOut=[{'to': 's08', 'motif': 'refract', 'element': 'Refract preview', 'state': 'built as a real page'}])
scene(8, 's08', 'split', 'hero', 'Then it builds the page', 'evidence', 'screenshot', 'authentic',
      'The fixed frame finally moves: page blocks settle into the real Refract page on "builds the page", the address bar fills on '
      '"real browser", then on "different size screens" the frame narrows from desktop to tablet to phone, the same real page '
      'reflowing at 1440, 834 and 390 px with a tick at each width.',
      asset('Refract theme captures at three widths', SITE + '/themes/refract/', 'capture',
            'Real renders of one page at three widths show the screen-size check literally; a resized screenshot would fake it.',
            'assets/captures/refract-390.png'),
      ['frame', 'clawd', 'refract'], carryIn=[{'from': 's07', 'motif': 'refract', 'element': 'Refract preview'}],
      carryOut=[{'to': 's09', 'motif': 'frame', 'element': 'phone-width frame', 'state': 'under review by a second Clawd'}])
scene(9, 's09', 'split', 'review', 'A second AI reviews', 'explanation', 'designed', 'illustrative',
      'A second Clawd steps in beside the phone-width page, closes and opens its eyes on "fresh eyes", looks it over, and on "comes '
      'back to you" the finished page glides down toward the speaker.',
      asset('reviewer Clawd', 'official Clawd glyph data (assets/brand/clawd-provenance.md)', 'design',
            'A second, separate character makes "a second AI with fresh eyes" visible in one glance.'),
      ['frame', 'clawd'], carryIn=[{'from': 's08', 'motif': 'frame', 'element': 'phone-width frame'}])
scene(10, 's10', 'face', 'cta', 'Comment design', 'cta', 'none', 'none',
      holdReason='Human reset for the request: full face, the keyword DESIGN in a comment bubble.')

EV = [
    (0, 'title-stack', 's00', 'Claude', None), (at('websites') - .04, 'example-swap', 's00', 'websites', None),
    (at('vibe') - .02, 'example-swap', 's00', 'vibe-coded', None), (at('AI') - .04, 'example-swap', 's00', 'AI-made', None),
    (4.50, 'title-retire', 's00', 'AI-made', None), (t_skill - .02, 'focus-dim', 's01', "It's all down to", None),
    (at('one', 4) - .04, 'card-forward', 's01', 'one skill', None), (at('instructions') - .1, 'card-open', 's01', 'set of instructions', None),
    (at('add') - .04, 'install', 's01', 'add to Claude Code', None), (at('Hallmark') - .02, 'name', 's02', 'Hallmark', None),
    (at('Together') - .04, 'highlight', 's03', 'Together AI', None), (at('50') - .02, 'count', 's04', '50', None),
    (at('telltale') - .04, 'tells', 's05', 'telltale signs', None), (at('signs') - .02, 'tell-2', 's05', 'signs', None),
    (at('scream') + .05, 'tell-3', 's05', 'scream', None),
    (t_this_end - .03, 'slider-sweep', 's06', 'this,', None),
    (t_this_end + .35, 'issues-zero', 's06', 'so it knows what to avoid', None),
    (at('Tell') + .05, 'type', 's07', "Tell it what you're making", None), (at('three') - .04, 'deal', 's07', 'three themes', None),
    (at('fit') - .04, 'pick', 's07', 'fit', None), (at('builds') - .04, 'build', 's08', 'builds the page', None),
    (at('opens') - .06, 'full-screen', 's08', 'opens it in', None), (at('real') - .04, 'browser', 's08', 'real browser', None), (at('different') - .04, 'resize', 's08', 'different size screens', None),
    (at('second') - .04, 'reviewer-in', 's09', 'second AI', None), (at('fresh') - .02, 'blink', 's09', 'fresh eyes', None),
    (at('back') - .1, 'hand-back', 's09', 'comes back to you', None), (at('Comment') + .05, 'keyword', 's10', 'Comment design', None)]
events = []
for t, ty, v, an, sfx in EV:
    e = {'time': round(t, 3), 'type': ty, 'visual': v, 'anchor': an}
    if sfx: e['sfx'] = sfx
    events.append(e)

plan = {'schemaVersion': 2, 'duration': D, 'fps': FPS,
        'motifs': [{'id': 'frame', 'description': 'One browser frame that holds still while finished sites change in it; it becomes the backdrop the skill steps in front of, holds the proof, and only moves in the hero, narrowing to phone width.'},
                   {'id': 'clawd', 'description': 'Clawd is Claude doing the work: watches the examples, cheers 0 issues, and a second Clawd arrives as the fresh-eyes reviewer.'},
                   {'id': 'refract', 'description': 'The Refract pool site: seen in the hook, dealt and picked for "an outdoor pool", then built and checked at three widths.'}],
        'scenes': S, 'events': events, 'captions': captions}
json.dump(plan, open('assets/plan.json', 'w', encoding='utf-8'), indent=1)
# The composition reads the same timings (no fetch at render time): words, caption chunks, scene bounds, events.
data = {'D': D, 'words': [{'t': w['text'], 's': w['start'], 'e': w['end']} for w in W],
        'caps': [{'s': c['start'], 'e': c['end'], 'text': ' '.join(x['text'] for x in c['words']).replace(' -', '-')} for c in captions],
        'scenes': {s['id']: [s['start'], s['end']] for s in S}, 'events': {e['type'] + ('' if e['type'] not in ('example-swap',) else str(i)): e['time'] for i, e in enumerate(events)}}
open('assets/reel-data.js', 'w', encoding='utf-8').write('window.REEL = ' + json.dumps(data) + ';\n')
for s in S: print(s['id'], s['start'], s['end'], s['layout'], s['anchor'])
print(len(captions), 'caption chunks:', ' | '.join(' '.join(w['text'] for w in c['words']) for c in captions))
