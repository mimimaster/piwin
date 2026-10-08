<template>
  <svg
    class="image-src hero-mark"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 512 512"
    width="320"
    height="320"
    role="img"
    aria-label="Piwin 笔刷圆环与朱砂红点"
  >
    <defs>
      <filter id="hero-ring-ink" color-interpolation-filters="sRGB">
        <!-- The source icon's green channel separates the pale brush from its dark tile and red dot. -->
        <feColorMatrix
          type="matrix"
          values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 2.5 0 0 -1.25"
        />
      </filter>
      <mask id="hero-ring-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style="mask-type: alpha">
        <image href="/logo.png" width="512" height="512" filter="url(#hero-ring-ink)" />
      </mask>
      <!--
        运笔遮罩：一条足够粗的圆弧描边盖住整圈笔触，开幕时让它从朱砂点的位置
        逆时针走完一圈，位图圆环就像被一笔画出来。先上下翻转把 SVG 默认的顺时针
        变成逆时针，再转到红点所在的角度起笔。
      -->
      <mask id="hero-sweep-mask" maskUnits="userSpaceOnUse">
        <circle
          class="hero-sweep"
          cx="253"
          cy="250"
          r="150"
          fill="none"
          stroke="#fff"
          stroke-width="232"
          pathLength="1"
          stroke-dasharray="1"
          transform="rotate(-21 253 250) translate(0 500) scale(1 -1)"
        />
      </mask>
    </defs>
    <!-- 墨滴落砚的涟漪：两圈错相扩散 -->
    <circle class="hero-ripple" cx="256" cy="256" r="150" />
    <circle class="hero-ripple hero-ripple-late" cx="256" cy="256" r="150" />
    <g mask="url(#hero-sweep-mask)">
      <rect class="hero-ring" width="512" height="512" fill="currentColor" mask="url(#hero-ring-mask)" />
    </g>
    <circle class="hero-dot-halo" cx="419" cy="178" r="18" fill="#fa6639" />
    <circle class="hero-dot" cx="419" cy="178" r="18" fill="#fa6639" />
  </svg>
</template>

<style scoped>
.hero-ring,
.hero-ripple,
.hero-dot,
.hero-dot-halo {
  transform-box: fill-box;
  transform-origin: center;
}

/* 研墨：笔刷圆环小幅往复。整圈旋转会让笔锋离开朱砂点，破坏标志构图 */
.hero-ring {
  animation: hero-grind 11s ease-in-out infinite alternate;
}

.hero-ripple {
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  opacity: 0;
  animation: hero-ripple 6s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
}

.hero-ripple-late {
  animation-delay: 3s;
}

.hero-dot-halo {
  animation: hero-dot-pulse 3.2s ease-out infinite;
}

@keyframes hero-grind {
  from {
    transform: rotate(-3.5deg);
  }
  to {
    transform: rotate(3.5deg);
  }
}

@keyframes hero-ripple {
  0% {
    opacity: 0;
    transform: scale(0.82);
  }
  18% {
    opacity: 0.16;
  }
  100% {
    opacity: 0;
    transform: scale(1.5);
  }
}

@keyframes hero-dot-pulse {
  0% {
    opacity: 0.55;
    transform: scale(1);
  }
  70%,
  100% {
    opacity: 0;
    transform: scale(2.8);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-ring,
  .hero-ripple,
  .hero-dot-halo {
    animation: none;
  }
}
</style>
