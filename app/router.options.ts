import type { RouterOptions } from 'vue-router';

/**
 * Nuxt resolves `to.hash` as soon as the router is ready, but this app renders its anchors from
 * client-side data: on a refresh the comparison rows and evidence entries do not exist yet. Vue
 * Router then reports VUE_ROUTER_R0042 and never retries, so the deep link never scrolls. Wait for
 * the anchor to render instead, then scroll to it. This replaces Nuxt's default scroll behavior.
 */
const ANCHOR_TIMEOUT_MS = 30_000;

type RouterScrollBehavior = NonNullable<RouterOptions['scrollBehavior']>;

type AnchorPosition = { el: Element; top: number; behavior: 'auto' };

const findAnchor = (hash: string): Element | null => document.getElementById(hash.slice(1));

const waitForAnchor = (hash: string, timeoutMs: number): Promise<Element | null> => {
  const rendered = findAnchor(hash);

  if (rendered) return Promise.resolve(rendered);

  const { promise, resolve } = Promise.withResolvers<Element | null>();

  const observer = new MutationObserver(() => {
    const anchor = findAnchor(hash);

    if (anchor === null) return;
    observer.disconnect();
    clearTimeout(timeout);
    resolve(anchor);
  });

  const timeout = setTimeout(() => {
    observer.disconnect();
    resolve(null);
  }, timeoutMs);

  observer.observe(document.documentElement, { childList: true, subtree: true });

  return promise;
};

const scrollOffset = (anchor: Element): number =>
  (Number.parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0) +
  (Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0);

const revealAnchor = (anchor: Element): void => {
  const disclosure = anchor.closest('details');

  if (disclosure !== null && !disclosure.open) disclosure.open = true;
};

const anchorPosition = async (hash: string): Promise<AnchorPosition | false> => {
  const anchor = await waitForAnchor(hash, ANCHOR_TIMEOUT_MS);

  if (anchor === null) return false;
  revealAnchor(anchor);

  return { el: anchor, top: scrollOffset(anchor), behavior: 'auto' };
};

const isSamePage = (to: { path: string }, from: { path: string }): boolean =>
  to.path.replace(/\/$/, '') === from.path.replace(/\/$/, '');

const scrollBehavior: RouterScrollBehavior = async (to, from, savedPosition) => {
  if (isSamePage(to, from)) {
    if (from.hash && !to.hash) return savedPosition ?? { left: 0, top: 0 };

    return to.hash ? anchorPosition(to.hash) : false;
  }

  // oxlint-disable-next-line rules/no-runtime-typeof -- Discriminating vue-router's declared boolean | function meta union, not unparsed input.
  const scrollToTop = typeof to.meta.scrollToTop === 'function' ? to.meta.scrollToTop(to, from) : to.meta.scrollToTop;

  if (scrollToTop === false) return false;

  if (savedPosition) return savedPosition;

  return to.hash ? anchorPosition(to.hash) : { left: 0, top: 0 };
};

export default { scrollBehavior } satisfies Partial<RouterOptions>;
