/**
 * Shared data model for the Images / Videos studio pages.
 *
 * These pages are presentation-first until the media/list slice lands: the
 * library is injected via props (`initialImages` / `initialVideos`) and the
 * built-in demo datasets below act as the default source. When host-backed
 * listing arrives, only the default prop value changes.
 */

export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:2'] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export const IMAGE_STYLES = [
  { labelEn: 'Photorealistic', labelZh: '写实摄影', value: 'Photorealistic' },
  { labelEn: 'Anime', labelZh: '动漫二次元', value: 'Anime' },
  { labelEn: '3D Render', labelZh: '3D 艺术', value: '3D Render' },
  { labelEn: 'Cyberpunk', labelZh: '赛博朋克', value: 'Cyberpunk' },
  { labelEn: 'Oil Painting', labelZh: '复古油画', value: 'Oil Painting' },
  { labelEn: 'Concept Art', labelZh: '概念设计', value: 'Concept Art' },
  { labelEn: 'Minimalist', labelZh: '极简矢量', value: 'Minimalist' },
] as const;

export const IMAGE_MODELS = [
  { value: 'Flux-1.1 Pro', label: 'Flux-1.1 Pro · 默认' },
  { value: 'SDXL Turbo', label: 'SDXL Turbo · 快速' },
  { value: 'DALL-E 3', label: 'DALL-E 3 · OpenAI' },
  { value: 'Midjourney v6', label: 'Midjourney Agent' },
] as const;

export const VIDEO_MODELS = [
  { value: 'Kling 1.5 HD', label: 'Kling 1.5 HD · 默认' },
  { value: 'Runway Gen-3', label: 'Runway Gen-3 Alpha' },
  { value: 'Luma Dream Machine', label: 'Luma Dream Machine' },
  { value: 'Open-Sora Agent', label: 'Open-Sora Agent' },
] as const;

export const CAMERA_MOTIONS = [
  { value: 'FPV Drone', en: 'FPV Drone', zh: '穿越机视角' },
  { value: 'Pan Left', en: 'Pan Left', zh: '左摇镜头' },
  { value: 'Pan Right', en: 'Pan Right', zh: '右摇镜头' },
  { value: 'Zoom In', en: 'Zoom In', zh: '推进镜头' },
  { value: 'Zoom Out', en: 'Zoom Out', zh: '拉远镜头' },
  { value: 'Orbit 360', en: 'Orbit 360', zh: '环绕运镜' },
  { value: 'Static', en: 'Static', zh: '固定机位' },
] as const;

export type GeneratedImageItem = {
  id: string;
  url: string;
  /** Absolute path under ~/.piwin/media; resolved to an asset URL at render time. */
  localPath?: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  style: string;
  model: string;
  resolution: string;
  createdAt: string;
};

export type GeneratedVideoItem = {
  id: string;
  thumbnailUrl: string;
  videoUrl: string;
  localPath?: string;
  prompt: string;
  mode: 'text-to-video' | 'image-to-video' | 'remix';
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  cameraMotion: string;
  motionStrength: 'subtle' | 'moderate' | 'dynamic';
  model: string;
  resolution: string;
  createdAt: string;
};

export type ImageInspiration = {
  tag: string;
  tagZh: string;
  prompt: string;
  ratio: ImageAspectRatio;
  style: string;
};

export const IMAGE_INSPIRATIONS: ImageInspiration[] = [
  {
    tag: 'Cinematic Portrait',
    tagZh: '电影人像',
    prompt:
      'Studio portrait of a cybernetic girl with glowing bioluminescent makeup, 85mm lens, golden hour rim lighting, ultra-detailed.',
    ratio: '9:16',
    style: 'Photorealistic',
  },
  {
    tag: 'Anime Fantasy',
    tagZh: '动漫幻想',
    prompt:
      'Anime girl reading ancient grimoire in a sunlit floating library in the clouds, ghibli aesthetics, vibrant watercolor tones.',
    ratio: '16:9',
    style: 'Anime',
  },
  {
    tag: 'Cyberpunk City',
    tagZh: '赛博都市',
    prompt:
      'Rainy cyberpunk street market at night with neon holographic billboards, reflections on asphalt, cinematic wide angle.',
    ratio: '16:9',
    style: 'Cyberpunk',
  },
  {
    tag: '3D Isometric',
    tagZh: '3D 等距',
    prompt:
      'Minimalist 3D isometric cozy developer bedroom with multiple monitors, plants, neon accents, rendered in Octane.',
    ratio: '1:1',
    style: '3D Render',
  },
  {
    tag: 'Oil Painting',
    tagZh: '复古油画',
    prompt:
      'Impressionist oil painting of a vintage coffee shop in Paris during autumn rain, thick brushstrokes, rich warm palette.',
    ratio: '4:3',
    style: 'Oil Painting',
  },
  {
    tag: 'Concept Art',
    tagZh: '概念设计',
    prompt:
      'Majestic sci-fi starship docked at a crystal planetary station, nebula in the background, epic scale concept art.',
    ratio: '16:9',
    style: 'Concept Art',
  },
];

export type VideoInspiration = {
  tag: string;
  tagZh: string;
  prompt: string;
  cameraMotion: string;
  durationSeconds: number;
  ratio: VideoAspectRatio;
};

export const VIDEO_INSPIRATIONS: VideoInspiration[] = [
  {
    tag: 'Cinematic Drone',
    tagZh: '电影航拍',
    prompt:
      'Slow motion cinematic drone flythrough of misty pine mountain valley with morning golden sunlight casting long shadows.',
    cameraMotion: 'FPV Drone',
    durationSeconds: 5,
    ratio: '16:9',
  },
  {
    tag: 'Cyberpunk Skyline',
    tagZh: '霓虹天际线',
    prompt:
      'Futuristic flying vehicles navigating between towering neon skyscrapers in heavy rainfall, reflections on wet windshields.',
    cameraMotion: 'Zoom In',
    durationSeconds: 5,
    ratio: '16:9',
  },
  {
    tag: 'Anime Blossom',
    tagZh: '动漫樱花',
    prompt:
      'Anime girl turning around with smiling eyes as cherry blossom petals drift past the camera in the gentle spring breeze.',
    cameraMotion: 'Orbit 360',
    durationSeconds: 5,
    ratio: '9:16',
  },
  {
    tag: 'Macro Fluid',
    tagZh: '微距流体',
    prompt:
      'Extreme close up slow motion macro swirl of golden ink dissolving into deep indigo water with shimmering mica particles.',
    cameraMotion: 'Pan Right',
    durationSeconds: 3,
    ratio: '1:1',
  },
];


/* ── Safe defaults (arrays above are non-empty; these satisfy
   noUncheckedIndexedAccess without scattering assertions) ──────────── */

const IMAGE_INSPIRATION_FALLBACK: ImageInspiration = {
  tag: 'Cinematic Portrait',
  tagZh: '电影人像',
  prompt: IMAGE_INSPIRATIONS[0]?.prompt ?? 'Cinematic studio portrait, soft rim lighting.',
  ratio: '9:16',
  style: 'Photorealistic',
};

const VIDEO_INSPIRATION_FALLBACK: VideoInspiration = {
  tag: 'Cinematic Drone',
  tagZh: '电影航拍',
  prompt: VIDEO_INSPIRATIONS[0]?.prompt ?? 'Cinematic drone flythrough at golden hour.',
  cameraMotion: 'FPV Drone',
  durationSeconds: 5,
  ratio: '16:9',
};

export function randomImageInspiration(): ImageInspiration {
  return (
    IMAGE_INSPIRATIONS[Math.floor(Math.random() * IMAGE_INSPIRATIONS.length)] ??
    IMAGE_INSPIRATION_FALLBACK
  );
}

export function randomVideoInspiration(): VideoInspiration {
  return (
    VIDEO_INSPIRATIONS[Math.floor(Math.random() * VIDEO_INSPIRATIONS.length)] ??
    VIDEO_INSPIRATION_FALLBACK
  );
}

export const DEFAULT_IMAGE_STYLE: string = IMAGE_STYLES[0]?.value ?? 'Photorealistic';
export const DEFAULT_IMAGE_MODEL: string = IMAGE_MODELS[0]?.value ?? 'Flux-1.1 Pro';
export const DEFAULT_VIDEO_MODEL: string = VIDEO_MODELS[0]?.value ?? 'Kling 1.5 HD';
export const DEFAULT_CAMERA_MOTION: string = CAMERA_MOTIONS[0]?.value ?? 'FPV Drone';

/** Demo library shown until host-backed media listing replaces it. */
export const DEMO_IMAGES: GeneratedImageItem[] = [
  {
    id: 'img-1',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    prompt:
      'Studio cinematic portrait of a young woman in soft sunlight, high fashion editorial, natural skin texture, 85mm f1.4 lens.',
    aspectRatio: '9:16',
    style: 'Photorealistic',
    model: 'Flux-1.1 Pro',
    resolution: '1024x1792',
    createdAt: '10 min',
  },
  {
    id: 'img-2',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
    prompt:
      'Abstract liquid geometric fluid art in iridescent purple and deep cyan, raytraced glass caustics, clean gradient wallpaper.',
    aspectRatio: '16:9',
    style: '3D Render',
    model: 'SDXL Turbo',
    resolution: '1920x1080',
    createdAt: '1 h',
  },
  {
    id: 'img-3',
    url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80',
    prompt:
      'Futuristic sci-fi corridor with ambient purple LED strips and reflective black glass floor, minimal architectural photography.',
    aspectRatio: '1:1',
    style: 'Cyberpunk',
    model: 'DALL-E 3',
    resolution: '1024x1024',
    createdAt: '1 d',
  },
  {
    id: 'img-4',
    url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=800&q=80',
    prompt:
      'Ethereal oil painting portrait with golden floral elements, Renaissance lighting, delicate fine art texture.',
    aspectRatio: '4:3',
    style: 'Oil Painting',
    model: 'Midjourney v6',
    resolution: '1440x1080',
    createdAt: '2 d',
  },
  {
    id: 'img-5',
    url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
    prompt:
      'Misty pine forest valley at sunrise with sunbeams piercing through morning fog, high dynamic range landscape.',
    aspectRatio: '16:9',
    style: 'Photorealistic',
    model: 'Flux-1.1 Pro',
    resolution: '1920x1080',
    createdAt: '3 d',
  },
  {
    id: 'img-6',
    url: 'https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=800&q=80',
    prompt:
      'Neon cybernetic skull surrounded by holographic equations and floating data crystals, vaporwave aesthetics.',
    aspectRatio: '1:1',
    style: 'Cyberpunk',
    model: 'SDXL Turbo',
    resolution: '1024x1024',
    createdAt: '4 d',
  },
];

/** Demo library shown until host-backed media listing replaces it. */
export const DEMO_VIDEOS: GeneratedVideoItem[] = [
  {
    id: 'vid-1',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    prompt:
      'FPV drone shot sweeping through neon illuminated cyberpunk alleyways with steam rising from vents and holographic street signs.',
    mode: 'text-to-video',
    durationSeconds: 5,
    aspectRatio: '16:9',
    cameraMotion: 'FPV Drone',
    motionStrength: 'dynamic',
    model: 'Runway Gen-3',
    resolution: '1920x1080',
    createdAt: '15 min',
  },
  {
    id: 'vid-2',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    prompt:
      'Scenic aerial camera panning slowly across pristine alpine lake reflecting snow-capped mountain peaks at sunrise.',
    mode: 'text-to-video',
    durationSeconds: 5,
    aspectRatio: '16:9',
    cameraMotion: 'Pan Right',
    motionStrength: 'subtle',
    model: 'Kling 1.5 HD',
    resolution: '1920x1080',
    createdAt: '2 h',
  },
  {
    id: 'vid-3',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    prompt:
      'Portrait video of young woman smiling gently as evening golden sunlight warms her face, wind blowing soft hair strands.',
    mode: 'image-to-video',
    durationSeconds: 5,
    aspectRatio: '9:16',
    cameraMotion: 'Orbit 360',
    motionStrength: 'moderate',
    model: 'Luma Dream Machine',
    resolution: '1080x1920',
    createdAt: '1 d',
  },
  {
    id: 'vid-4',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    prompt:
      'Hypnotic 3D fluid art swirling with purple and cyan iridescent metallic textures, pulsing to ambient rhythm.',
    mode: 'text-to-video',
    durationSeconds: 3,
    aspectRatio: '1:1',
    cameraMotion: 'Zoom In',
    motionStrength: 'dynamic',
    model: 'Open-Sora Agent',
    resolution: '1024x1024',
    createdAt: '3 d',
  },
];
