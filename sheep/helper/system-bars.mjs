const MAX_SYSTEM_BAR_CSS_PX = 160;

function parseInset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= MAX_SYSTEM_BAR_CSS_PX ? number : 0;
}

export function parseRuntimeSystemBars(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^[^?]*\?/, ''));
  return Object.freeze({
    top: parseInset(params.get('skitTopInset')),
    bottom: parseInset(params.get('skitBottomInset')),
  });
}

function finiteDimension(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function mergeRuntimeSystemBars(info = {}, bars = {}) {
  const windowWidth = finiteDimension(info.windowWidth ?? info.screenWidth);
  const windowHeight = finiteDimension(info.windowHeight ?? info.screenHeight);
  const top = Math.max(
    finiteDimension(info.statusBarHeight),
    finiteDimension(info.safeAreaInsets?.top),
    parseInset(bars.top),
  );
  const bottom = Math.max(finiteDimension(info.safeAreaInsets?.bottom), parseInset(bars.bottom));
  const left = finiteDimension(info.safeAreaInsets?.left);
  const right = finiteDimension(info.safeAreaInsets?.right);
  const existingSafeArea = info.safeArea || {};
  const safeTop = Math.max(finiteDimension(existingSafeArea.top), top);
  const safeBottom = Math.min(
    finiteDimension(existingSafeArea.bottom, windowHeight),
    Math.max(safeTop, windowHeight - bottom),
  );
  const safeLeft = Math.max(finiteDimension(existingSafeArea.left), left);
  const safeRight = Math.min(
    finiteDimension(existingSafeArea.right, windowWidth),
    Math.max(safeLeft, windowWidth - right),
  );

  return {
    ...info,
    statusBarHeight: top,
    safeAreaInsets: {
      ...(info.safeAreaInsets || {}),
      top,
      bottom,
      left,
      right,
    },
    safeArea: {
      ...existingSafeArea,
      left: safeLeft,
      right: safeRight,
      top: safeTop,
      bottom: safeBottom,
      width: Math.max(0, safeRight - safeLeft),
      height: Math.max(0, safeBottom - safeTop),
    },
  };
}
