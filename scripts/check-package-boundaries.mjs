#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
const packagesRoot = join(repositoryRoot, 'packages');

const applicationPackageNames = new Set([
  '@piwin/automation',
  '@piwin/artifact',
  '@piwin/browser',
  '@piwin/doc-rag',
  '@piwin/flashcards',
  '@piwin/git',
  '@piwin/marketplace',
  '@piwin/mcp',
  '@piwin/media',
  '@piwin/notes',
  '@piwin/pet',
  '@piwin/process',
  '@piwin/project',
  '@piwin/session',
  '@piwin/skills',
  '@piwin/theme',
  '@piwin/tools-web',
]);

const packageRecords = readPackageRecords();
const violations = [];

checkAgentHostDependencies();
checkProductionImports();
checkRootTypeScriptReferences();
checkAgentHostLegacyExports();
checkArchitectureDeletionGates();

if (violations.length > 0) {
  console.error('Package boundary violations:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('Package boundaries OK');
}

function readPackageRecords() {
  const records = new Map();
  if (!existsSync(packagesRoot)) {
    return records;
  }
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageDirectory = join(packagesRoot, entry.name);
    const packageJsonPath = join(packageDirectory, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (typeof packageJson.name === 'string') {
      records.set(packageJson.name, {
        name: packageJson.name,
        directory: packageDirectory,
        packageJson,
      });
    }
  }
  return records;
}

function checkAgentHostDependencies() {
  const record = packageRecords.get('@piwin/agent-host');
  if (!record) {
    violations.push('missing @piwin/agent-host package metadata');
    return;
  }
  const dependencies = {
    ...(record.packageJson.dependencies ?? {}),
    ...(record.packageJson.optionalDependencies ?? {}),
  };
  for (const dependencyName of Object.keys(dependencies)) {
    if (dependencyName.startsWith('@piwin/') && dependencyName !== '@piwin/contracts') {
      violations.push(`agent-host dependency is not backend-only: ${dependencyName}`);
    }
  }
}

function checkProductionImports() {
  for (const [packageName, record] of packageRecords) {
    for (const filePath of listProductionSourceFiles(join(record.directory, 'src'))) {
      const sourceText = readFileSync(filePath, 'utf8');
      const moduleSpecifiers = extractModuleSpecifiers(sourceText);
      for (const moduleSpecifier of moduleSpecifiers) {
        if (packageName === '@piwin/agent-host' && isApplicationImport(moduleSpecifier)) {
          violations.push(`${formatPath(filePath)} imports application package ${moduleSpecifier}`);
        }
        if (packageName !== '@piwin/agent-host' && isPiImport(moduleSpecifier)) {
          // Only agent-host may import Pi packages. This catches accidental
          // imports in application packages as well as apps.
          violations.push(`${formatPath(filePath)} imports Pi package ${moduleSpecifier}`);
        }
        if (packageName !== '@piwin/host-runtime' && isApplicationPackage(packageName)) {
          if (moduleSpecifier === '@piwin/agent-host' || moduleSpecifier === '@piwin/host-runtime') {
            violations.push(
              `${formatPath(filePath)} imports composition/backend package ${moduleSpecifier}`,
            );
          }
        }
        if (packageName === '@piwin/contracts' && moduleSpecifier.startsWith('@piwin/')) {
          violations.push(`${formatPath(filePath)} imports another piwin package ${moduleSpecifier}`);
        }
        if (isDeepSourceImport(moduleSpecifier)) {
          violations.push(`${formatPath(filePath)} uses deep package source import ${moduleSpecifier}`);
        }
      }
    }
  }

  for (const applicationPath of listApplicationSourceRoots()) {
    for (const filePath of listProductionSourceFiles(applicationPath)) {
      const sourceText = readFileSync(filePath, 'utf8');
      for (const moduleSpecifier of extractModuleSpecifiers(sourceText)) {
        if (isPiImport(moduleSpecifier)) {
          violations.push(`${formatPath(filePath)} imports Pi package ${moduleSpecifier}`);
        }
        if (moduleSpecifier === '@piwin/agent-host') {
          violations.push(`${formatPath(filePath)} imports agent-host directly`);
        }
      }
    }
  }
}

function checkRootTypeScriptReferences() {
  const rootTsconfigPath = join(repositoryRoot, 'tsconfig.json');
  if (!existsSync(rootTsconfigPath)) {
    violations.push('missing root tsconfig.json');
    return;
  }
  const rootTsconfig = JSON.parse(readFileSync(rootTsconfigPath, 'utf8'));
  const references = Array.isArray(rootTsconfig.references) ? rootTsconfig.references : [];
  const hasHostRuntimeReference = references.some(
    (reference) => reference && reference.path === 'packages/host-runtime',
  );
  if (!hasHostRuntimeReference) {
    violations.push('root tsconfig.json omits packages/host-runtime');
  }
}

function checkAgentHostLegacyExports() {
  const agentHostRecord = packageRecords.get('@piwin/agent-host');
  if (!agentHostRecord) {
    return;
  }
  for (const filePath of listProductionSourceFiles(join(agentHostRecord.directory, 'src'))) {
    const sourceText = readFileSync(filePath, 'utf8');
    if (/\bexport\s+(?:default\s+)?(?:class|function|const|let|var|type|interface)\s+HostRuntime\b/.test(sourceText)) {
      violations.push(`${formatPath(filePath)} exports HostRuntime from agent-host`);
    }
    if (/export\s+(?:\*|\{[^}]*\bHostRuntime\b[^}]*\})\s+from\s+['"][^'"]*host-runtime/.test(sourceText)) {
      violations.push(`${formatPath(filePath)} re-exports HostRuntime from agent-host`);
    }
    if (/\bcreateAgentHost\b/.test(sourceText) && /export\s/.test(sourceText)) {
      violations.push(`${formatPath(filePath)} exports legacy createAgentHost`);
    }
  }
}

function checkArchitectureDeletionGates() {
  const productionFiles = new Set();
  for (const record of packageRecords.values()) {
    for (const filePath of listProductionSourceFiles(join(record.directory, 'src'))) {
      productionFiles.add(filePath);
    }
  }
  for (const applicationPath of listApplicationSourceRoots()) {
    for (const filePath of listProductionSourceFiles(applicationPath)) {
      productionFiles.add(filePath);
    }
  }
  for (const filePath of listProductionSourceFiles(join(repositoryRoot, 'scripts'))) {
    productionFiles.add(filePath);
  }

  const forbiddenPatterns = [
    /\b(?:ActiveRunRegistry|createActiveRunRegistry|terminalRunIdsBySession)\b/,
    /\b(?:createProcessRegistry|ProcessRegistry|ManagedProcessRecord|ManagedProcessStartInput)\b/,
    /\b(?:Legacy sequential path|spawnPlanSubagent|mergePlanSubagent|applyWorktreeToMain)\b/,
    /session\/(?:spawn|cancel-subagent|complete-subagent|merge-subagent)/,
    /\brunRegistry\?:|\bintegrationPort\?:|sessionBlueprint:\s*undefined|runtimeGenerationId\s*\?\?\s*['"]unknown['"]/,
    /\b(?:PIWIN_RPC_STOCK|PIWIN_RPC_SDK_FALLBACK|PIWIN_RPC_WORKER|useSdkFallback|rpc-fallback)\b/,
    /\b(?:requireCleanBaseForParallelWrites|maxParallelWriteTasks)\b/,
    /Promise\.all\(dispatches\)/,
    /\b(?:WorkerRpcSessionBackend|handleCreateLegacy)\b/,
    /\b(?:parametersForHostTool|parametersForProxyTool|Type\.Any)\b/,
  ];

  for (const filePath of productionFiles) {
    // The guard necessarily names the paths it prohibits. It is the narrow,
    // documented self-exemption for the production-only source scan.
    if (filePath === fileURLToPath(import.meta.url)) {
      continue;
    }
    const sourceText = readFileSync(filePath, 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(sourceText)) {
        violations.push(`${formatPath(filePath)} contains removed architecture path ${pattern}`);
      }
    }
    if (/new\s+RpcSdkWorkerClient\s*\(/.test(sourceText) && !filePath.endsWith('agent-worker-supervisor.ts')) {
      violations.push(`${formatPath(filePath)} creates workers outside AgentWorkerSupervisor`);
    }
  }

  const orchestratorCreations = [...productionFiles]
    .map((filePath) => readFileSync(filePath, 'utf8').match(/new\s+SubagentOrchestrator\s*\(/g)?.length ?? 0)
    .reduce((total, count) => total + count, 0);
  if (orchestratorCreations !== 1) {
    violations.push(
      `expected exactly one production SubagentOrchestrator construction, found ${orchestratorCreations}`,
    );
  }
}

function listApplicationSourceRoots() {
  const roots = [];
  for (const record of packageRecords.values()) {
    if (isApplicationPackage(record.name)) {
      roots.push(join(record.directory, 'src'));
    }
  }
  for (const applicationName of ['cli', 'desktop']) {
    const applicationDirectory = join(repositoryRoot, 'apps', applicationName);
    if (existsSync(applicationDirectory)) {
      roots.push(join(applicationDirectory, 'src'));
    }
  }
  return roots;
}

function listProductionSourceFiles(rootDirectory) {
  if (!existsSync(rootDirectory)) {
    return [];
  }
  const files = [];
  visit(rootDirectory);
  return files;

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isExcludedDirectory(entry.name)) {
          continue;
        }
        visit(entryPath);
        continue;
      }
      if (isProductionSourceFile(entryPath)) {
        files.push(entryPath);
      }
    }
  }
}

function isProductionSourceFile(filePath) {
  const normalizedPath = filePath.replaceAll('\\', '/');
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(normalizedPath)) {
    return false;
  }
  return !/(?:\.test|\.spec|\.fixture)\.[^.]+$/.test(normalizedPath);
}

function isExcludedDirectory(directoryName) {
  return new Set(['dist', 'dist-host', 'build', 'generated', 'fixtures', '__tests__', 'target', 'node_modules']).has(
    directoryName,
  );
}

function extractModuleSpecifiers(sourceText) {
  const moduleSpecifiers = new Set();
  const importPattern = /(?:from\s*|import\s*\(|require\s*\()(['"])([^'"\n]+)\1/g;
  for (const match of sourceText.matchAll(importPattern)) {
    const moduleSpecifier = match[2];
    if (moduleSpecifier) {
      moduleSpecifiers.add(moduleSpecifier);
    }
  }
  return moduleSpecifiers;
}

function isPiImport(moduleSpecifier) {
  return moduleSpecifier.startsWith('@earendil-works/pi-');
}

function isApplicationImport(moduleSpecifier) {
  return applicationPackageNames.has(moduleSpecifier) || moduleSpecifier === '@piwin/host-runtime';
}

function isApplicationPackage(packageName) {
  return packageName.startsWith('@piwin/') &&
    packageName !== '@piwin/contracts' &&
    packageName !== '@piwin/agent-host' &&
    packageName !== '@piwin/host-runtime';
}

function isApplicationPackageName(packageName) {
  return applicationPackageNames.has(packageName);
}

function isDeepSourceImport(moduleSpecifier) {
  return /@piwin\/[^/]+\/src(?:\/|$)/.test(moduleSpecifier) || /packages\/[^/]+\/src(?:\/|$)/.test(moduleSpecifier);
}

function formatPath(filePath) {
  return relative(repositoryRoot, filePath).replaceAll('\\', '/');
}
