/**
 * 首页开幕动画的调度。
 *
 * 时间轴全部在 styles/hero-intro.css；这里只负责三件事：
 * 1. 量出徽标从「视口正中」到最终位置的位移，交给 CSS 变量；
 * 2. 给 <html> 加上运行态类名，动画开始；
 * 3. 播完或用户有任何操作时，撤掉类名回到常态。
 *
 * 待播状态（`hero-intro`）由 config.mts 里的内联脚本在首帧之前加上，
 * 这样服务端渲染出的最终画面不会先闪一下再开始动画。
 */
const ARMED_CLASS = 'hero-intro';
const RUNNING_CLASS = 'hero-intro-run';
const INTRO_DURATION_MS = 4300;
const SKIP_EVENTS = ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const;

export function runHeroIntro(): () => void {
  const root = document.documentElement;
  if (!root.classList.contains(ARMED_CLASS)) return () => {};

  const mark = document.querySelector<SVGElement>('.VPHome .hero-mark');
  if (!mark) {
    root.classList.remove(ARMED_CLASS);
    return () => {};
  }

  // 运笔发生在视口正中，画完再移回 Hero 里的位置。
  const markRect = mark.getBoundingClientRect();
  const shiftX = window.innerWidth / 2 - (markRect.left + markRect.width / 2);
  const shiftY = Math.max(0, window.innerHeight / 2 - (markRect.top + markRect.height / 2));
  root.style.setProperty('--hero-intro-shift-x', `${Math.round(shiftX)}px`);
  root.style.setProperty('--hero-intro-shift-y', `${Math.round(shiftY)}px`);

  let timerId: number | undefined;
  let frameId: number | undefined;

  function finish(): void {
    if (timerId !== undefined) window.clearTimeout(timerId);
    if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    timerId = undefined;
    frameId = undefined;
    for (const eventName of SKIP_EVENTS) window.removeEventListener(eventName, finish);
    root.classList.remove(ARMED_CLASS, RUNNING_CLASS);
    root.style.removeProperty('--hero-intro-shift-x');
    root.style.removeProperty('--hero-intro-shift-y');
  }

  // 后台打开的标签页不播：没人看，而且那里的帧回调会被浏览器大幅推迟。
  if (document.hidden) {
    finish();
    return () => {};
  }

  for (const eventName of SKIP_EVENTS) {
    window.addEventListener(eventName, finish, { passive: true, once: true });
  }
  // 等一帧，保证待播状态已经渲染过，动画才有起点。收尾计时从动画真正开始时算起，
  // 否则帧回调一旦来迟，计时器会先撤掉类名、回调再把运行态加回去，页面就卡在动画首帧。
  frameId = window.requestAnimationFrame(() => {
    frameId = undefined;
    // 内联脚本的兜底计时可能已经撤掉了待播态，这时页面已是成品，不再补播。
    if (!root.classList.contains(ARMED_CLASS)) {
      finish();
      return;
    }
    root.classList.add(RUNNING_CLASS);
    timerId = window.setTimeout(finish, INTRO_DURATION_MS);
  });

  return finish;
}
