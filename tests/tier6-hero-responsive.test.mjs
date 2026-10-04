/**
 * Tier 6: Homepage Hero Responsive Hierarchy E2E Test Suite
 * CNCF Peshawar Automation Suite
 *
 * Guards the mobile-first information hierarchy of the homepage hero and the
 * community facts strip (issue #15):
 * - Chapter identity and the Upcoming Events CTA lead the first screen
 * - Secondary telemetry is simplified, never reordered ahead of the CTA
 * - Tap targets, headline wrapping, and CTA labels stay robust at 320-390px
 * - Text-size and reduced-motion preferences are honoured site-wide
 * - Tablet and desktop keep the richer presentation
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TestHarness } from './test-utils.mjs';

const heroSrc = fs.readFileSync('src/components/Hero.astro', 'utf-8');
const statsSrc = fs.readFileSync('src/components/TrackRecordStats.astro', 'utf-8');
const globalCss = fs.readFileSync('src/styles/global.css', 'utf-8');

const markup = heroSrc.split('<style>')[0];
const heroCss = heroSrc.split('<style>')[1] ?? '';

const orderOf = (haystack, needle, from = 0) => {
  const i = haystack.indexOf(needle, from);
  assert.notEqual(i, -1, `Expected markup to contain "${needle}"`);
  return i;
};

// Extract a single declaration value for `selector` from a CSS source block.
const cssValue = (css, selector, property) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(rule, `Expected a "${selector}" rule in the component CSS`);
  const decl = new RegExp(`${property}\\s*:\\s*([^;]+)`).exec(rule[1]);
  return decl ? decl[1].trim() : null;
};

// Media-query block that contains `selector`.
const mediaBlock = (css, breakpoint, selector) => {
  const at = new RegExp(`@media\\s*\\(min-width:\\s*${breakpoint}px\\)\\s*\\{`);
  let cursor = 0;
  while (true) {
    const m = at.exec(css.slice(cursor));
    if (!m) return null;
    const start = cursor + m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    if (new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(body)) return body;
    cursor = cursor + m.index + m[0].length;
  }
};

export async function runTier6Suite() {
  const suite = new TestHarness('Tier 6: Homepage Hero Responsive Hierarchy');

  // =====================================================================
  // PRIMARY ACTION HIERARCHY
  // =====================================================================
  suite.group('Primary Action: Upcoming Events Leads Every Viewport');

  await suite.test('H1: First hero action is the Upcoming Events CTA and carries the accent styling', () => {
    const firstAction = orderOf(markup, 'class="hero__actions"');
    const eventsCta = orderOf(markup, 'hero__action--primary');
    const ocgCta = orderOf(markup, 'ocgroups.dev');

    assert.ok(
      firstAction < eventsCta && eventsCta < ocgCta,
      'Upcoming Events CTA must be the first action, ahead of the OCG join link'
    );
    assert.match(
      markup,
      /<a[^>]*class="btn btn--accent hero__action hero__action--primary"[^>]*>\s*<span>Upcoming Events<\/span>/s,
      'Upcoming Events CTA must be an anchor with btn--accent and hero__action--primary'
    );
    assert.match(
      markup,
      /<a href=\{`\$\{base\}\/events`\} class="btn btn--accent hero__action hero__action--primary">/,
      'Primary CTA must be the events-index link and lead the action group'
    );
  });

  await suite.test('H2: Exactly one accent hero action, so the primary CTA is unambiguous', () => {
    const start = orderOf(markup, 'class="hero__actions"');
    const actionBlock = markup.slice(start, orderOf(markup, '</div>', start));
    const accents = actionBlock.match(/btn--accent/g) || [];
    assert.equal(accents.length, 1, `Hero actions must contain exactly one accent button, found ${accents.length}`);
  });

  await suite.test('H3: Secondary OCG action keeps a screen-reader label expansion and is not accent', () => {
    assert.match(
      markup,
      /<span>Join on OCG<\/span>\s*<span class="sr-only"> \(Open Community Groups\)<\/span>/,
      'Short OCG label must be expanded for assistive technology via sr-only text'
    );
    const ocgStart = orderOf(markup, 'ocgroups.dev');
    const ocgBlock = markup.slice(ocgStart, ocgStart + 600);
    assert.ok(!/btn--accent/.test(ocgBlock), 'OCG join action must be secondary, not accent');
    assert.ok(!/nowrap/.test(markup), 'CTA labels must be allowed to reflow rather than clip at narrow widths');
  });

  // =====================================================================
  // READING / SCREEN-READER ORDER
  // =====================================================================
  suite.group('Reading Order: Identity and CTA Before Secondary Telemetry');

  await suite.test('H4: Headline, supporting copy, actions, proof, then charter telemetry in DOM order', () => {
    const o = {
      badges: orderOf(markup, 'hero__badge-row'),
      title: orderOf(markup, 'hero__title'),
      lede: orderOf(markup, 'hero__lede'),
      actions: orderOf(markup, 'class="hero__actions"'),
      proof: orderOf(markup, 'hero__proof'),
      charter: orderOf(markup, 'terminal-card')
    };
    assert.deepEqual(
      [o.badges, o.title, o.lede, o.actions, o.proof, o.charter].sort((a, b) => a - b),
      [o.badges, o.title, o.lede, o.actions, o.proof, o.charter],
      'Hero DOM order must be identity -> headline -> copy -> actions -> proof -> telemetry'
    );
    assert.ok(
      !/(^|[;{\s])order\s*:/.test(heroCss),
      'Hero must not rely on CSS order, which would desync visual and screen-reader reading order'
    );
  });

  await suite.test('H5: Charter telemetry is grouped so it can be simplified as one block on mobile', () => {
    assert.match(
      markup,
      /<div class="charter-telemetry">[\s\S]*PLATFORM:[\s\S]*STATUS:[\s\S]*FOUNDED \/ INAUGURAL:[\s\S]*CORE TECHNICAL FOCUS[\s\S]*<\/div>\s*<\/div>/,
      'Supplementary charter telemetry must live inside a single .charter-telemetry wrapper'
    );
    assert.equal(cssValue(heroCss, '.charter-telemetry', 'display'), 'none', 'Telemetry must be hidden by default (mobile-first)');
    const tablet = mediaBlock(heroCss, 768, '.charter-telemetry');
    assert.ok(tablet, 'Telemetry must be restored from tablet width up');
    assert.equal(cssValue(tablet, '.charter-telemetry', 'display'), 'flex', 'Telemetry must return as a flex column at >=768px');
  });

  // =====================================================================
  // MOBILE DENSITY & TAP TARGETS
  // =====================================================================
  suite.group('Mobile Density, Tap Targets, and Headline Wrapping');

  await suite.test('H6: Hero actions stack full-width below 768px and stay 44px tappable', () => {
    assert.equal(cssValue(heroCss, '.hero__actions', 'display'), 'grid', 'Hero actions must be a single-column stack on mobile');
    assert.equal(cssValue(heroCss, '.hero__actions', 'grid-template-columns'), '1fr');
    assert.equal(cssValue(heroCss, '.hero__action', 'width'), '100%', 'Mobile CTAs must span the column for easy tapping');
    assert.equal(cssValue(heroCss, '.hero__action', 'min-height'), '44px', 'CTAs must keep a 44px minimum tap target');

    const tablet = mediaBlock(heroCss, 768, '.hero__actions');
    assert.ok(tablet, 'Actions must return to an inline row from 768px up');
    assert.equal(cssValue(tablet, '.hero__actions', 'display'), 'flex');
    assert.equal(cssValue(tablet, '.hero__action', 'width'), 'auto', 'Desktop CTAs must size to their label again');
  });

  await suite.test('H7: Headline uses balanced wrapping and relaxes the desktop-only 16ch cap on mobile', () => {
    assert.equal(cssValue(heroCss, '.hero__title', 'text-wrap'), 'balance', 'Headline must balance its lines');
    assert.equal(cssValue(heroCss, '.hero__title', 'overflow-wrap'), 'break-word', 'Headline must never overflow its column');
    assert.equal(cssValue(heroCss, '.hero__title', 'max-width'), 'none', 'Mobile headline must use the full column, not a 16ch cap');
    assert.match(cssValue(heroCss, '.hero__title', 'font-size'), /^clamp\(/, 'Mobile headline size must be fluid');

    const tablet = mediaBlock(heroCss, 768, '.hero__title');
    assert.ok(tablet, 'Display headline treatment must be restored from 768px up');
    assert.equal(cssValue(tablet, '.hero__title', 'font-size'), 'var(--font-size-5xl)');
    assert.equal(cssValue(tablet, '.hero__title', 'max-width'), '16ch', 'Desktop headline keeps its original 16ch measure');
  });

  await suite.test('H8: Mobile hero spacing is tightened and the richer rhythm is restored at 768px', () => {
    assert.match(cssValue(heroCss, '.hero', 'padding-top'), /var\(--space-lg\)/, 'Mobile hero must start closer to the fold');
    assert.match(cssValue(heroCss, '.hero', 'padding-bottom'), /var\(--space-xl\)/);
    assert.match(cssValue(heroCss, '.hero__grid', 'gap'), /var\(--space-xl\)/);

    const tablet = mediaBlock(heroCss, 768, '.hero');
    assert.ok(tablet, 'Tablet hero padding must be restored');
    assert.match(cssValue(tablet, '.hero', 'padding-top'), /var\(--space-xl\)/);
    assert.match(cssValue(tablet, '.hero', 'padding-bottom'), /var\(--space-2xl\)/);

    // The wide-screen two-column rule must come after the tablet reset so it wins.
    assert.ok(
      heroCss.indexOf('@media (min-width: 992px)') > heroCss.indexOf('@media (min-width: 768px)'),
      'The 992px two-column rule must follow the 768px reset, otherwise desktop gaps regress'
    );
  });

  await suite.test('H9: Charter card drops the decorative hostname and tightens padding on narrow screens', () => {
    assert.equal(cssValue(heroCss, '.terminal-card__title', 'display'), 'none', 'Hostname must not squeeze the narrow card header');
    assert.equal(cssValue(heroCss, '.terminal-card__body', 'padding'), 'var(--space-md)');

    const wide = mediaBlock(heroCss, 480, '.terminal-card__title');
    assert.ok(wide, 'Hostname must return from 480px up');
    assert.equal(cssValue(wide, '.terminal-card__title', 'display'), 'inline');

    const tablet = mediaBlock(heroCss, 768, '.terminal-card__body');
    assert.ok(tablet, 'Card body padding must be restored at 768px');
    assert.equal(cssValue(tablet, '.terminal-card__body', 'padding'), 'var(--space-lg)');
  });

  // =====================================================================
  // STATISTICS STRIP
  // =====================================================================
  suite.group('Statistics Strip: Compact 2-Up Mobile Presentation');

  await suite.test('H10: Facts render as a 2-up grid on mobile and 4-up on desktop, with detail below 600px hidden', () => {
    assert.equal(
      cssValue(statsCss(), '.facts-grid', 'grid-template-columns'),
      'repeat(2, minmax(0, 1fr))',
      'Mobile facts must be a 2-up grid instead of a tall 1-column stack'
    );
    assert.equal(cssValue(statsCss(), '.fact-item__desc', 'display'), 'none', 'Long fact detail must not dominate the mobile screen');
    assert.match(cssValue(statsCss(), '.fact-item', 'padding'), /var\(--space-sm\)/, 'Mobile fact cards must be compact');

    const mid = mediaBlock(statsCss(), 600, '.fact-item__desc');
    assert.ok(mid, 'Fact detail must return from 600px up');
    assert.equal(cssValue(mid, '.fact-item__desc', 'display'), 'block');

    const wide = mediaBlock(statsCss(), 1024, '.facts-grid');
    assert.ok(wide, 'Four-up desktop facts must be preserved');
    assert.equal(cssValue(wide, '.facts-grid', 'grid-template-columns'), 'repeat(4, 1fr)');

    // Mobile base rules must precede the 600px reset, or the reset silently loses.
    assert.ok(
      statsCss().indexOf('.fact-item__desc') < statsCss().indexOf('@media (min-width: 600px)'),
      'Fact detail base rule must precede the 600px media query'
    );
  });

  function statsCss() {
    return statsSrc.split('<style>')[1] ?? '';
  }

  // =====================================================================
  // USER PREFERENCES
  // =====================================================================
  suite.group('User Preferences: Text Size and Reduced Motion');

  await suite.test('H11: Root font size follows the user agent so text can be enlarged', () => {
    const htmlBlock = /html\s*\{([^}]*)\}/.exec(globalCss);
    assert.ok(htmlBlock, 'global.css must define an html block');
    assert.equal(
      /font-size:\s*([^;]+)/.exec(htmlBlock[1])[1].trim(),
      '100%',
      'Root font size must not be pinned to 16px, which blocks browser/OS text-size preferences'
    );
  });

  await suite.test('H12: A prefers-reduced-motion block disables animation, transitions, and smooth scrolling', () => {
    assert.match(globalCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'Reduced-motion preference must be honoured');
    const block = globalCss.slice(globalCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(block, /animation-duration:\s*0\.001ms\s*!important/);
    assert.match(block, /animation-iteration-count:\s*1\s*!important/);
    assert.match(block, /transition-duration:\s*0\.001ms\s*!important/);
    assert.match(block, /scroll-behavior:\s*auto/, 'Smooth scrolling must be disabled under reduced motion');
  });

  suite.printResults();
  return suite.getSummary();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTier6Suite().then(summary => {
    if (summary.failed > 0) process.exit(1);
  });
}