import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_MAX_RESIDENT_RUNTIMES,
  createDefaultSubagentConfig,
  createDefaultExecutionConfig,
  DEFAULT_SUBAGENT_MAX_CONCURRENCY,
  DEFAULT_MAX_CONCURRENT_RUNS,
  DEFAULT_MIN_AVAILABLE_MEMORY_MIB,
  MAX_MIN_AVAILABLE_MEMORY_MIB,
  deriveSubagentQuota,
  deriveSupervisorMaxWorkers,
  deriveWorkerPoolSize,
  modelSupportsCapability,
  THINKING_LEVEL_OPTIONS,
  WORKER_POOL_FOREGROUND_RESERVE,
  WORKER_REPLACEMENT_HEADROOM,
  normalizeExecutionConfig,
  resolveProviderCategory,
  resolveModelCategory,
} from './config.js';
import type {
  ModelConfigEntry,
  ModelCapability,
  ModelRouteConfig,
  PiwinConfig,
  ImageGenerationConfig,
  SubagentConfig,
} from './config.js';
import {
  deriveMemoryHighWaterMiB,
  deriveMemoryLowWaterMiB,
  normalizeSessionRuntimeRetentionConfig,
} from './config.js';
import type { HostRuntimeResourcesData as HostRuntimeResourcesDataFromResponseData } from './ipc-response-data.js';
import type { HostRuntimeResourcesData as HostRuntimeResourcesDataFromHostResponses } from './ipc-host-responses.js';

describe('ModelConfigEntry capabilities + routes', () => {
  it('accepts capabilities and routes', () => {
    const entry: ModelConfigEntry = {
      id: 'glm-image',
      label: 'GLM-图像生成',
      capabilities: ['image-generation'],
      routes: {
        'image-generation': {
          path: '/images/generations',
          timeoutMs: 300_000,
        },
      },
    };
    expect(entry.capabilities).toContain('image-generation');
    expect(entry.routes?.['image-generation']?.path).toBe('/images/generations');
  });

  it('accepts an image-generation route with an explicit wire format', () => {
    const entry: ModelConfigEntry = {
      id: 'gemini-3.1-flash-image',
      capabilities: ['image-generation'],
      routes: {
        'image-generation': {
          apiStyle: 'gemini',
          path: '/v1beta/models/gemini-3.1-flash-image:generateContent',
          timeoutMs: 180_000,
        },
      },
    };
    expect(entry.routes?.['image-generation']?.apiStyle).toBe('gemini');
    expect(entry.routes?.['image-generation']?.path).toBe(
      '/v1beta/models/gemini-3.1-flash-image:generateContent',
    );
  });

  it('accepts a video-generation route with a native async API style', () => {
    const entry: ModelConfigEntry = {
      id: 'sora-2',
      capabilities: ['video-generation'],
      routes: {
        'video-generation': {
          apiStyle: 'openai-videos',
          path: '/videos',
          timeoutMs: 900_000,
          pollIntervalMs: 5_000,
        },
      },
    };
    expect(entry.capabilities).toContain('video-generation');
    expect(entry.routes?.['video-generation']?.apiStyle).toBe('openai-videos');
    expect(entry.routes?.['video-generation']?.pollIntervalMs).toBe(5_000);
  });

  it('accepts a chat-only model without capabilities (backward compat)', () => {
    const entry: ModelConfigEntry = { id: 'gpt-4.1' };
    expect(entry.capabilities).toBeUndefined();
  });

  it('accepts input modalities and reasoning flags', () => {
    const entry: ModelConfigEntry = {
      id: 'claude-sonnet',
      input: ['text', 'image'],
      reasoning: true,
    };
    expect(entry.input).toContain('image');
    expect(entry.reasoning).toBe(true);
  });

  it('accepts an explicit effort list and default effort', () => {
    const entry: ModelConfigEntry = {
      id: 'claude-max',
      reasoning: true,
      thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
      thinkingLevel: 'high',
    };
    expect(entry.thinkingLevels).toContain('max');
    expect(entry.thinkingLevels).toContain(entry.thinkingLevel);
  });

  it('treats legacy models as chat models and requires explicit speech tags', () => {
    expect(modelSupportsCapability({}, 'chat')).toBe(true);
    expect(modelSupportsCapability({ capabilities: ['native-web-search'] }, 'chat')).toBe(true);
    expect(modelSupportsCapability({ capabilities: ['image-generation'] }, 'chat')).toBe(false);
    expect(modelSupportsCapability({}, 'speech-to-text')).toBe(false);
    expect(modelSupportsCapability({ capabilities: ['speech-to-text'] }, 'speech-to-text')).toBe(
      true,
    );
    expect(modelSupportsCapability({ capabilities: ['text-to-speech'] }, 'speech-to-text')).toBe(
      false,
    );
  });
});

describe('THINKING_LEVEL_OPTIONS', () => {
  it('exposes the complete ordered thinking-level option set', () => {
    expect(THINKING_LEVEL_OPTIONS).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });
});

describe('PiwinConfig.browser', () => {
  it('accepts headed and an explicit CDP endpoint', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 0,
      },
      browser: {
        headless: false,
        cdpEndpoint: 'http://127.0.0.1:9222',
      },
    };
    expect(config.browser?.headless).toBe(false);
    expect(config.browser?.cdpEndpoint).toBe('http://127.0.0.1:9222');
  });
});

describe('PiwinConfig.imageGeneration', () => {
  it('accepts an imageGeneration default model', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 0,
      },
      imageGeneration: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'zhipu',
          modelId: 'glm-image',
        },
      },
    };
    expect(config.imageGeneration?.defaultModel?.modelId).toBe('glm-image');
  });
});

describe('PiwinConfig.videoGeneration', () => {
  it('accepts a videoGeneration default model independently from image generation', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 0,
      },
      videoGeneration: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'runway',
          modelId: 'gen4.5',
        },
      },
    };
    expect(config.videoGeneration?.defaultModel?.modelId).toBe('gen4.5');
  });
});

describe('PiwinConfig.speech', () => {
  it('accepts independent ASR and TTS defaults', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 0,
      },
      speech: {
        asr: {
          defaultModel: {
            protocol: 'openai-compatible',
            providerId: 'openai',
            modelId: 'whisper-1',
          },
          language: 'zh',
        },
        tts: {
          defaultModel: {
            protocol: 'openai-compatible',
            providerId: 'openai',
            modelId: 'tts-1',
          },
          voice: 'alloy',
        },
      },
    };
    expect(config.speech?.asr?.defaultModel?.modelId).toBe('whisper-1');
    expect(config.speech?.tts?.voice).toBe('alloy');
  });
});

describe('PiwinConfig.subagents', () => {
  it('accepts a subagents block with profiles and limits', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 0,
      },
      subagents: {
        profiles: [
          {
            id: 'fast-explorer',
            description: 'Fast read-only codebase exploration',
            model: {
              protocol: 'openai-compatible',
              providerId: 'local-provider',
              modelId: 'fast-coder',
            },
            thinkingLevel: 'low',
            capabilities: ['read'],
            skillIds: [],
            isolation: 'readonly',
          },
        ],
        defaultProfileId: 'fast-explorer',
        maxConcurrency: 4,
        maxTasksPerRun: 8,
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        dirtyBasePolicy: 'ask',
      },
    };
    expect(config.subagents?.profiles[0]?.id).toBe('fast-explorer');
    expect(config.subagents?.defaultProfileId).toBe('fast-explorer');
  });

  it('createDefaultSubagentConfig returns safe defaults', () => {
    const defaults = createDefaultSubagentConfig();
    expect(defaults.profiles).toEqual([]);
    expect(defaults.maxConcurrency).toBe(4);
    expect(defaults.processIsolation).toBe('required');
    expect(defaults.parallelWritePolicy).toBe('worktree-only');
    expect(defaults.dirtyBasePolicy).toBe('ask');
  });

  it('SubagentConfig type accepts empty profiles', () => {
    const cfg: SubagentConfig = {
      profiles: [],
      maxConcurrency: 2,
      maxTasksPerRun: 4,
      processIsolation: 'best-effort',
      parallelWritePolicy: 'disabled',
      dirtyBasePolicy: 'ask',
    };
    expect(cfg.profiles).toHaveLength(0);
    expect(cfg.processIsolation).toBe('best-effort');
  });

  it('createDefaultSubagentConfig.maxConcurrency equals DEFAULT_SUBAGENT_MAX_CONCURRENCY', () => {
    expect(DEFAULT_SUBAGENT_MAX_CONCURRENCY).toBe(4);
    expect(createDefaultSubagentConfig().maxConcurrency).toBe(DEFAULT_SUBAGENT_MAX_CONCURRENCY);
  });
});

describe('worker pool derivation formulas', () => {
  it('deriveWorkerPoolSize clamps N + foreground reserve into [2, ABSOLUTE_MAX_RESIDENT_RUNTIMES]', () => {
    expect(WORKER_POOL_FOREGROUND_RESERVE).toBe(1);
    expect(ABSOLUTE_MAX_RESIDENT_RUNTIMES).toBe(8);
    expect(deriveWorkerPoolSize(4)).toBe(5);
    expect(deriveWorkerPoolSize(1)).toBe(2);
    expect(deriveWorkerPoolSize(7)).toBe(8);
    expect(deriveWorkerPoolSize(12)).toBe(8);
  });

  it('deriveSupervisorMaxWorkers is pool + replacement headroom', () => {
    expect(WORKER_REPLACEMENT_HEADROOM).toBe(1);
    expect(deriveSupervisorMaxWorkers(4)).toBe(6);
    expect(deriveSupervisorMaxWorkers(1)).toBe(3);
    expect(deriveSupervisorMaxWorkers(7)).toBe(9);
  });

  it('illegal maxConcurrency falls back to DEFAULT_SUBAGENT_MAX_CONCURRENCY', () => {
    const defaultPool = deriveWorkerPoolSize(DEFAULT_SUBAGENT_MAX_CONCURRENCY);
    const defaultSupervisor = deriveSupervisorMaxWorkers(DEFAULT_SUBAGENT_MAX_CONCURRENCY);
    const defaultQuota = deriveSubagentQuota(DEFAULT_SUBAGENT_MAX_CONCURRENCY);
    expect(defaultPool).toBe(5);
    expect(defaultSupervisor).toBe(6);
    expect(defaultQuota).toBe(4);
    for (const illegal of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(deriveWorkerPoolSize(illegal)).toBe(defaultPool);
      expect(deriveSupervisorMaxWorkers(illegal)).toBe(defaultSupervisor);
      expect(deriveSubagentQuota(illegal)).toBe(defaultQuota);
    }
  });

  it('deriveSubagentQuota is min(N, pool - foreground reserve)', () => {
    expect(deriveSubagentQuota(4)).toBe(4);
    expect(deriveSubagentQuota(8)).toBe(7);
    expect(deriveSubagentQuota(20)).toBe(7);
    for (const n of [1, 4, 7, 8, 12, 20]) {
      expect(deriveSubagentQuota(n)).toBe(
        Math.min(n, deriveWorkerPoolSize(n) - WORKER_POOL_FOREGROUND_RESERVE),
      );
    }
  });
});

describe('HostRuntimeResourcesData.workers', () => {
  const baseResources = {
    counts: {
      resident: 0,
      idle: 0,
      busy: 0,
      activating: 0,
      suspending: 0,
    },
    waiterCount: 0,
    budget: {
      maxResidentRuntimes: 8,
      maxIdleRuntimes: 2,
      memoryHighWaterMiB: 1024,
      memoryLowWaterMiB: 819,
    },
    memory: {
      hostRssMiB: 100,
      sampleCompleteness: 'missing' as const,
    },
    counters: {
      evictedByIdleTtl: 0,
      evictedByMaxIdle: 0,
      evictedByMaxResident: 0,
      evictedByMemoryPressure: 0,
      memoryPressureFailures: 0,
    },
    execution: {
      configuredMaxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
      effectiveMaxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
      activeRuns: 0,
      waitingRuns: 0,
      activeForegroundRuns: 0,
      waitingForegroundRuns: 0,
      activeSubagentRuns: 0,
      waitingSubagentRuns: 0,
      subagentMaxConcurrency: DEFAULT_SUBAGENT_MAX_CONCURRENCY,
    },
  };

  it('may omit workers, or carry a complete workers block including pool and max', () => {
    const omitted: HostRuntimeResourcesDataFromResponseData = { ...baseResources };
    expect(omitted.workers).toBeUndefined();

    const withWorkers: HostRuntimeResourcesDataFromResponseData = {
      ...baseResources,
      workers: {
        pool: 5,
        max: 6,
        active: 2,
        starting: 1,
        subagent: 1,
        subagentMax: 4,
        subagentWaiting: 0,
      },
    };
    expect(withWorkers.workers?.pool).toBe(5);
    expect(withWorkers.workers?.max).toBe(6);

    const omittedHost: HostRuntimeResourcesDataFromHostResponses = { ...baseResources };
    expect(omittedHost.workers).toBeUndefined();
    const withWorkersHost: HostRuntimeResourcesDataFromHostResponses = {
      ...baseResources,
      workers: {
        pool: 5,
        max: 6,
        active: 2,
        starting: 1,
        subagent: 1,
        subagentMax: 4,
        subagentWaiting: 0,
      },
    };
    expect(withWorkersHost.workers?.pool).toBe(5);
    expect(withWorkersHost.workers?.max).toBe(6);
  });
});

describe('ExecutionConfig', () => {
  it('defaults missing config to 8 concurrent runs', () => {
    expect(createDefaultExecutionConfig()).toEqual({
      maxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
      minAvailableMemoryMiB: DEFAULT_MIN_AVAILABLE_MEMORY_MIB,
    });
    expect(normalizeExecutionConfig({}).minAvailableMemoryMiB).toBe(2048);
    expect(normalizeExecutionConfig(undefined).maxConcurrentRuns).toBe(8);
    expect(normalizeExecutionConfig({}).maxConcurrentRuns).toBe(8);
  });

  it('clamps values into 1–8', () => {
    expect(normalizeExecutionConfig({ maxConcurrentRuns: 0 }).maxConcurrentRuns).toBe(1);
    expect(normalizeExecutionConfig({ maxConcurrentRuns: 99 }).maxConcurrentRuns).toBe(8);
    expect(normalizeExecutionConfig({ maxConcurrentRuns: 4.9 }).maxConcurrentRuns).toBe(4);
  });

  it('keeps a partial block from resetting the other field', () => {
    expect(normalizeExecutionConfig({ maxConcurrentRuns: 2 }).minAvailableMemoryMiB).toBe(2048);
    expect(normalizeExecutionConfig({ minAvailableMemoryMiB: 512 }).maxConcurrentRuns).toBe(8);
  });

  it('clamps the memory floor but keeps 0 as the off switch', () => {
    expect(normalizeExecutionConfig({ minAvailableMemoryMiB: 0 }).minAvailableMemoryMiB).toBe(0);
    expect(normalizeExecutionConfig({ minAvailableMemoryMiB: -5 }).minAvailableMemoryMiB).toBe(0);
    expect(normalizeExecutionConfig({ minAvailableMemoryMiB: 99999 }).minAvailableMemoryMiB).toBe(
      MAX_MIN_AVAILABLE_MEMORY_MIB,
    );
  });
});

describe('SessionRuntimeRetentionConfig normalization (ADR 0040)', () => {
  it('applies ADR defaults when the config is omitted', () => {
    const normalized = normalizeSessionRuntimeRetentionConfig(undefined);
    expect(normalized.idleTtlSeconds).toBe(600);
    expect(normalized.maxIdleRuntimes).toBe(2);
    expect(normalized.maxResidentRuntimes).toBeUndefined();
    expect(normalized.memoryHighWaterMiB).toBeUndefined();
  });

  it('clamps values into the supported range', () => {
    const normalized = normalizeSessionRuntimeRetentionConfig({
      idleTtlSeconds: -10,
      maxIdleRuntimes: -1,
      maxResidentRuntimes: 99,
      memoryHighWaterMiB: 10,
    });
    expect(normalized.idleTtlSeconds).toBe(0);
    expect(normalized.maxIdleRuntimes).toBe(0);
    expect(normalized.maxResidentRuntimes).toBe(8);
    expect(normalized.memoryHighWaterMiB).toBe(512);
  });

  it('derives the adaptive memory high water from system memory', () => {
    // 16 GiB system => 4096 MiB at 25%, clamped to 2048.
    expect(deriveMemoryHighWaterMiB(16 * 1024)).toBe(2048);
    // 1 GiB system => 256 MiB at 25%, clamped up to 512.
    expect(deriveMemoryHighWaterMiB(1024)).toBe(512);
    // 8 GiB system => 2048 MiB at 25%, within clamp.
    expect(deriveMemoryHighWaterMiB(8 * 1024)).toBe(2048);
  });

  it('derives the low-water target as 80% of the high water', () => {
    expect(deriveMemoryLowWaterMiB(2048)).toBe(1638);
    expect(deriveMemoryLowWaterMiB(512)).toBe(410);
  });

  it('keeps optional overrides as provided within clamps', () => {
    const normalized = normalizeSessionRuntimeRetentionConfig({
      idleTtlSeconds: 120,
      maxIdleRuntimes: 4,
      maxResidentRuntimes: 6,
      memoryHighWaterMiB: 1024,
    });
    expect(normalized).toEqual({
      idleTtlSeconds: 120,
      maxIdleRuntimes: 4,
      maxResidentRuntimes: 6,
      memoryHighWaterMiB: 1024,
    });
  });
});

describe('resolveProviderCategory & resolveModelCategory', () => {
  it('resolves explicit category when present', () => {
    expect(resolveProviderCategory({ category: 'package' })).toBe('package');
    expect(resolveProviderCategory({ category: 'custom' })).toBe('custom');
    expect(resolveProviderCategory({ category: 'package', source: 'channel' })).toBe('package');
    expect(resolveProviderCategory({ category: 'custom', source: 'subscription' })).toBe('custom');
  });

  it('falls back to source: subscription -> package, otherwise custom', () => {
    expect(resolveProviderCategory({ source: 'subscription' })).toBe('package');
    expect(resolveProviderCategory({ source: 'channel' })).toBe('custom');
    expect(resolveProviderCategory({})).toBe('custom');
  });

  it('resolves model category with inheritance from provider', () => {
    expect(resolveModelCategory({ category: 'package' })).toBe('package');
    expect(resolveModelCategory({ category: 'custom' })).toBe('custom');
    expect(resolveModelCategory({}, { category: 'package' })).toBe('package');
    expect(resolveModelCategory({}, { source: 'subscription' })).toBe('package');
    expect(resolveModelCategory({}, { category: 'custom' })).toBe('custom');
    expect(resolveModelCategory({}, {})).toBe('custom');
    expect(resolveModelCategory({})).toBe('custom');
  });
});

