/**
 * In-frame contrast probe for artifacts whose colors the host does not
 * control (style="expressive" and legacy own-palette scenes). Runs once after
 * load, samples up to 200 text elements, and reports only when something is
 * wrong. The host shows a badge; it never rewrites the artifact (design §6.4).
 *
 * Expects `post(type, payload)` from the bridge bootstrap in scope.
 */
import {
  ARTIFACT_BRIDGE_CONTRAST_TYPE,
  ARTIFACT_CONTRAST_FAILING_SHARE,
  ARTIFACT_CONTRAST_MAX_SAMPLES,
} from './constants.js';

export function buildArtifactContrastProbeRuntime(): string {
  return `
  var contrastType = ${JSON.stringify(ARTIFACT_BRIDGE_CONTRAST_TYPE)};
  var probeColorCache = {};
  var probeCanvas = null;
  // Normalize any CSS color (hex, rgb, hsl, oklch, named) to sRGB by painting
  // one pixel; computed styles keep oklch() as written.
  var probeRgba = function (value) {
    if (!value) return null;
    if (Object.prototype.hasOwnProperty.call(probeColorCache, value)) return probeColorCache[value];
    var result = null;
    try {
      if (!probeCanvas) {
        probeCanvas = document.createElement('canvas');
        probeCanvas.width = 1;
        probeCanvas.height = 1;
      }
      var context = probeCanvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = 'rgba(0,0,0,0)';
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        var pixel = context.getImageData(0, 0, 1, 1).data;
        result = { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 };
      }
    } catch (error) {
      result = null;
    }
    probeColorCache[value] = result;
    return result;
  };
  var probeOver = function (top, bottom) {
    var a = top.a + bottom.a * (1 - top.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    var mix = function (x, y) { return (x * top.a + y * bottom.a * (1 - top.a)) / a; };
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: a };
  };
  var probeLuminance = function (c) {
    var channel = function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  };
  var probeRatio = function (a, b) {
    var la = probeLuminance(a), lb = probeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  // Every color stop in a gradient, so a full-bleed gradient stage counts as
  // a fill for the theme-side check.
  var probeGradientStops = function (image) {
    if (!image || image === 'none' || /url\\(/i.test(image)) return [];
    var tokens = image.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)|#[0-9a-f]{3,8}\\b/gi) || [];
    var stops = [];
    for (var i = 0; i < tokens.length && i < 12; i += 1) {
      var stop = probeRgba(tokens[i]);
      if (stop && stop.a > 0) stops.push(stop);
    }
    return stops;
  };
  var probeElementFill = function (element) {
    var style = getComputedStyle(element);
    var stops = probeGradientStops(style.backgroundImage);
    if (stops.length > 0) {
      var opaque = 0, lum = 0;
      for (var i = 0; i < stops.length; i += 1) {
        opaque += stops[i].a;
        lum += probeLuminance(stops[i]);
      }
      if (opaque / stops.length >= 0.9) return lum / stops.length;
    }
    var fill = probeRgba(style.backgroundColor);
    return fill && fill.a >= 0.9 ? probeLuminance(fill) : null;
  };
  var probeGradientColor = function (image) {
    if (!image || image === 'none') return null;
    if (/url\\(/i.test(image)) return 'image';
    var token = image.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)|#[0-9a-f]{3,8}\\b/i);
    return token ? token[0] : null;
  };
  var probeHostBackground = function () {
    var raw = getComputedStyle(document.documentElement).getPropertyValue('--piwin-artifact-bg').trim();
    var color = probeRgba(raw);
    if (color && color.a > 0) return { r: color.r, g: color.g, b: color.b, a: 1 };
    var dark = getComputedStyle(document.documentElement).getPropertyValue('--piwin-artifact-theme').trim() !== 'light';
    return dark ? { r: 20, g: 20, b: 20, a: 1 } : { r: 250, g: 250, b: 248, a: 1 };
  };
  var probeBackgroundBehind = function (element, hostBackground) {
    var layers = [];
    for (var node = element; node && node.nodeType === 1; node = node.parentElement) {
      var style = getComputedStyle(node);
      var gradient = probeGradientColor(style.backgroundImage);
      if (gradient === 'image') return null;
      if (gradient) {
        var stop = probeRgba(gradient);
        if (stop && stop.a > 0) {
          layers.push(stop);
          if (stop.a >= 0.99) break;
        }
      }
      var fill = probeRgba(style.backgroundColor);
      if (fill && fill.a > 0) {
        layers.push(fill);
        if (fill.a >= 0.99) break;
      }
    }
    var color = hostBackground;
    for (var i = layers.length - 1; i >= 0; i -= 1) color = probeOver(layers[i], color);
    return color;
  };
  var runContrastProbe = function () {
    if (!document.body || typeof getComputedStyle !== 'function') return;
    var hostBackground = probeHostBackground();
    var hostDark = probeLuminance(hostBackground) < 0.4;
    var seen = [];
    var sampled = 0, failing = 0, minRatio = 21;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && sampled < ${ARTIFACT_CONTRAST_MAX_SAMPLES}) {
      var text = walker.currentNode;
      var element = text.parentElement;
      if (!element || !text.nodeValue || !text.nodeValue.trim()) continue;
      if (seen.indexOf(element) !== -1) continue;
      seen.push(element);
      if (element.closest('script,style,svg,noscript,[aria-hidden="true"]')) continue;
      if (!element.getClientRects().length) continue;
      var style = getComputedStyle(element);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      var background = probeBackgroundBehind(element, hostBackground);
      var ink = probeRgba(style.color);
      if (!background || !ink || ink.a === 0) continue;
      var ratio = probeRatio(probeOver(ink, background), background);
      var size = parseFloat(style.fontSize) || 14;
      var weight = parseInt(style.fontWeight, 10) || 400;
      var large = size >= 24 || (size >= 18.66 && weight >= 700);
      sampled += 1;
      if (ratio < minRatio) minRatio = ratio;
      if (ratio < (large ? 3 : 4.5)) failing += 1;
    }
    // Theme mismatch: one opaque fill covers most of the stage and sits on
    // the far side of the host scheme (a white page on ink, black on paper).
    var stageArea = Math.max(1, document.documentElement.scrollWidth * document.documentElement.scrollHeight);
    var largestLum = null, largestArea = 0;
    var candidates = document.body.querySelectorAll('*');
    for (var j = 0; j < candidates.length && j < 400; j += 1) {
      var box = candidates[j].getBoundingClientRect();
      var area = box.width * box.height;
      if (area <= largestArea) continue;
      var fillLum = probeElementFill(candidates[j]);
      if (fillLum === null) continue;
      largestLum = fillLum;
      largestArea = area;
    }
    var mismatch = false;
    if (largestLum !== null && largestArea / stageArea > 0.6) {
      mismatch = hostDark ? largestLum > 0.6 : largestLum < 0.12;
    }
    var lowContrast = sampled > 0 && failing / sampled > ${ARTIFACT_CONTRAST_FAILING_SHARE};
    if (!lowContrast && !mismatch) return;
    post(contrastType, {
      lowContrast: lowContrast,
      themeMismatch: mismatch,
      sampled: sampled,
      failing: failing,
      minRatio: Math.round(minRatio * 100) / 100,
    });
  };
  var scheduleContrastProbe = function () {
    if (!window.setTimeout) return;
    window.setTimeout(function () {
      try { runContrastProbe(); } catch (error) { warnBridge('piwin artifact contrast probe failed', error); }
    }, 400);
  };
  if (document.readyState === 'complete') scheduleContrastProbe();
  else window.addEventListener('load', scheduleContrastProbe, { once: true });
`;
}
