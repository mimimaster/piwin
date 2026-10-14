import { useEffect, useState, type ReactElement } from 'react';
import type { DesktopLocale } from '../../desktop-locale.js';

export type MarketplaceHeroCarouselProps = {
  locale?: DesktopLocale | undefined;
};

type SlideData = {
  tag: { en: string; zhCN: string };
  title: { en: string; zhCN: string };
  description: { en: string; zhCN: string };
  image: string;
};

const SLIDES: readonly SlideData[] = [
  {
    tag: { en: 'INKSTONE · EXTENSIONS', zhCN: 'INKSTONE · 墨境' },
    title: {
      en: 'Between Ink and Paper · Discover Capabilities',
      zhCN: '在墨与纸之间 · 发现更多可能',
    },
    description: {
      en: 'Curated agent extensions, skills, and connected services designed for your private Host.',
      zhCN: '拓展市场连接由官方与生态严选的 Agent 拓展、技能与连接服务，赋能私有智能体。',
    },
    image: '/banners/1.png',
  },
  {
    tag: { en: 'AGENT HOST · ARCHITECTURE', zhCN: 'AGENT HOST · 智能体' },
    title: {
      en: 'Native Synergy · Deep Tool Integration',
      zhCN: '原生架构协同 · 深度连接工具',
    },
    description: {
      en: 'Zero runtime overhead: let your agent orchestrate code analysis, fuzzy search, and automated workflows directly.',
      zhCN: '无需中间层损耗，让智能体直接调度代码分析、模糊检索与自动化工作流。',
    },
    image: '/banners/2.png',
  },
  {
    tag: { en: 'MCP & SKILLS · PROTOCOLS', zhCN: 'MCP & SKILLS · 协议' },
    title: {
      en: 'Entity Memory & Full MCP Ecosystem',
      zhCN: '实体记忆与全域 MCP 生态',
    },
    description: {
      en: 'Seamlessly tap into official MCP servers, GitHub skill stores, and custom tools for your private matrix.',
      zhCN: '整合官方 MCP Registry 与 GitHub 技能库，构建你的私有能力矩阵。',
    },
    image: '/banners/3.png',
  },
];

export function MarketplaceHeroCarousel(props: MarketplaceHeroCarouselProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (item: { en: string; zhCN: string }) => (zh ? item.zhCN : item.en);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % SLIDES.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [isPaused]);

  return (
    <div
      className="market-hero-carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
      aria-label={zh ? '精选横幅轮播' : 'Featured banners carousel'}
    >
      <div
        className="market-carousel-track"
        style={{ transform: `translateX(-${(currentSlide * 100) / SLIDES.length}%)` }}
      >
        {SLIDES.map((slide, index) => (
          <div
            key={slide.image}
            className={`market-carousel-slide${index === currentSlide ? ' is-active' : ''}`}
          >
            <img src={slide.image} alt={t(slide.title)} className="market-slide-img" />
            <div className="market-slide-overlay" />
            <div className="market-slide-content">
              <span className="market-slide-tag">{t(slide.tag)}</span>
              <h2 className="market-slide-title">{t(slide.title)}</h2>
              <p className="market-slide-desc">{t(slide.description)}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="market-carousel-nav is-prev"
        onClick={() => setCurrentSlide((prev) => (prev - 1 + SLIDES.length) % SLIDES.length)}
        aria-label={zh ? '上一张' : 'Previous slide'}
      >
        ‹
      </button>
      <button
        type="button"
        className="market-carousel-nav is-next"
        onClick={() => setCurrentSlide((prev) => (prev + 1) % SLIDES.length)}
        aria-label={zh ? '下一张' : 'Next slide'}
      >
        ›
      </button>

      <div className="market-carousel-dots">
        {SLIDES.map((_, index) => (
          <button
            key={index}
            type="button"
            className={`market-carousel-dot${index === currentSlide ? ' is-active' : ''}`}
            onClick={() => setCurrentSlide(index)}
            aria-label={`${zh ? '切换至第' : 'Go to slide'} ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
