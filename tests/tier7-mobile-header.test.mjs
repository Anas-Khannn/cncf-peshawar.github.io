/**
 * Tier 7: Mobile Header Action Hierarchy
 * CNCF Peshawar Automation Suite
 *
 * Guards issue #13: mobile shows one Join action inside the drawer, while
 * desktop keeps the persistent header action.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TestHarness } from './test-utils.mjs';

const navSrc = fs.readFileSync('src/components/Nav.astro', 'utf-8');
const markup = navSrc.split('<style>')[0];
const navCss = navSrc.split('<style>')[1]?.split('</style>')[0] ?? '';
const navScript = navSrc.split('<script>')[1]?.split('</script>')[0] ?? '';

const cssValue = (css, selector, property) => {
  const escaped = selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const rule = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(css);
  assert.ok(rule, 'Expected a ' + selector + ' rule in the component CSS');
  const body = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const declaration = new RegExp('(?:^|[;{]\\s*)' + property + '\\s*:\\s*([^;]+)').exec(body);
  return declaration ? declaration[1].trim() : null;
};

const mediaBlock = (css, breakpoint, selector) => {
  const query = new RegExp('@media\\s*\\(min-width:\\s*' + breakpoint + 'px\\)\\s*\\{', 'g');
  let match;

  while ((match = query.exec(css))) {
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth++;
      if (css[cursor] === '}') depth--;
      cursor++;
    }

    const body = css.slice(match.index + match[0].length, cursor - 1);
    if (body.includes(selector)) return body;
  }

  return null;
};

export async function runTier7Suite() {
  const suite = new TestHarness('Tier 7: Mobile Header Action Hierarchy');

  suite.group('One Join Action Per Layout');

  await suite.test('M1: Header Join action is hidden by default for mobile', () => {
    assert.equal(cssValue(navCss, '.nav__cta', 'display'), 'none');
  });

  await suite.test('M2: Header Join action returns at the 860px desktop breakpoint', () => {
    const desktop = mediaBlock(navCss, 860, '.nav__cta');
    assert.ok(desktop, 'Expected a desktop rule for .nav__cta');
    assert.equal(cssValue(desktop, '.nav__cta', 'display'), 'inline-flex');
  });

  await suite.test('M3: Drawer contains one prominent full-width Join action', () => {
    const drawerStart = markup.indexOf('id="mobile-nav-drawer"');
    assert.notEqual(drawerStart, -1, 'Expected the mobile drawer');
    const drawerMarkup = markup.slice(drawerStart);
    assert.equal((drawerMarkup.match(/class="nav-drawer__action"/g) ?? []).length, 1);
    assert.equal(cssValue(navCss, '.nav-drawer__action .btn', 'width'), '100%');
    assert.equal(cssValue(navCss, '.nav-drawer__action .btn', 'min-height'), '44px');
  });

  await suite.test('M4: Both Join links preserve the external destination and safe new-tab attributes', () => {
    const joinLinks = [...markup.matchAll(/<a[\s\S]*?href="https:\/\/ocgroups\.dev\/cncf\/group\/6vwk2n4"[\s\S]*?<\/a>/g)];
    assert.equal(joinLinks.length, 2, 'Expected one desktop and one drawer Join link');
    for (const [index, match] of joinLinks.entries()) {
      assert.match(match[0], /target="_blank"/, 'Join link ' + (index + 1) + ' must open in a new tab');
      assert.match(match[0], /rel="noopener noreferrer"/, 'Join link ' + (index + 1) + ' must prevent opener access');
    }
  });

  suite.group('Toggle Accessibility');

  await suite.test('M5: Toggle ships with a clear closed-state accessible name', () => {
    assert.match(markup, /id="mobile-nav-toggle"[\s\S]*?aria-label="Open navigation menu"[\s\S]*?aria-expanded="false"/);
  });

  await suite.test('M6: Toggle name follows the drawer state', () => {
    assert.match(navScript, /setAttribute\('aria-expanded', 'false'\)[\s\S]{0,140}setAttribute\('aria-label', 'Open navigation menu'\)/);
    assert.match(navScript, /setAttribute\('aria-expanded', 'true'\)[\s\S]{0,140}setAttribute\('aria-label', 'Close navigation menu'\)/);
  });

  await suite.test('M7: Brand yields space to a 44px toggle on narrow and enlarged-text layouts', () => {
    assert.equal(cssValue(navCss, '.nav__brand', 'min-width'), '0');
    assert.equal(cssValue(navCss, '.nav__brand-text', 'flex-wrap'), 'wrap');
    assert.equal(cssValue(navCss, '.nav__brand-text', 'overflow-wrap'), 'break-word');
    assert.equal(cssValue(navCss, '.nav__actions', 'flex-shrink'), '0');
    assert.equal(cssValue(navCss, '.nav__actions', 'margin-left'), 'auto');
    assert.equal(cssValue(navCss, '.nav__toggle', 'width'), '44px');
    assert.equal(cssValue(navCss, '.nav__toggle', 'height'), '44px');
    assert.equal(cssValue(navCss, '.nav__toggle', 'flex-shrink'), '0');
  });

  suite.printResults();
  return suite.getSummary();
}

if (import.meta.url === 'file://' + process.argv[1]) {
  runTier7Suite().then(summary => {
    if (summary.failed > 0) process.exit(1);
  });
}
