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
    </defs>
    <rect width="512" height="512" fill="currentColor" mask="url(#hero-ring-mask)" />
    <circle cx="419" cy="178" r="18" fill="#fa6639" />
  </svg>
</template>
