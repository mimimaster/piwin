import type { HostRuntime } from './host-runtime.js';

/**
 * Friend-module view of HostRuntime. Extracted functions receive the live
 * instance; fields are writable so constructor initialization can live outside
 * the class body without changing runtime assignment behavior.
 */
export type HostRuntimeKernel = HostRuntime;
