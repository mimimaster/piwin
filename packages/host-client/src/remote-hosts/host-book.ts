import {
  isRemoteDeviceRole,
  isRemoteId,
  type HostBookEntry,
  type HostEndpointsData,
} from '@piwin/contracts';
import {
  decodeBase64Url,
  normalizeChannelUrl,
  normalizeRemoteDisplayName,
} from '@piwin/host-transport';
import type { KeyValueStorage } from './key-value-storage.js';

const STORAGE_KEY = 'piwin.host-book.v1';
const MAX_ENTRIES = 64;
const MAX_ALIAS_LENGTH = 64;

/** Entries of one relay user, for a host switcher grouped by user (ADR 0101 §8). */
export type HostBookUserGroup = { userId: string; userName: string; entries: HostBookEntry[] };

/**
 * The paired Hosts this shell can reach (ADR 0101 §2). One entry is one
 * connection target; secrets live in `RemoteHostVault`, never here.
 * Writes are serialized; a damaged document reads as empty and is reported.
 */
export class HostBook {
  private writeTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly storage: KeyValueStorage,
    private readonly onDamaged: (error: Error) => void = () => undefined,
  ) {}

  public async list(): Promise<HostBookEntry[]> {
    await this.writeTail;
    return this.readEntries();
  }

  public async get(hostId: string): Promise<HostBookEntry | undefined> {
    return (await this.list()).find((entry) => entry.hostId === hostId);
  }

  public async findByAlias(alias: string): Promise<HostBookEntry | undefined> {
    const wanted = alias.trim().toLowerCase();
    return (await this.list()).find((entry) => entry.alias?.toLowerCase() === wanted);
  }

  /** Inserts or replaces the entry for its `hostId`. */
  public upsert(entry: HostBookEntry): Promise<HostBookEntry> {
    const normalized = normalizeEntry(entry);
    if (normalized === undefined) {
      return Promise.reject(new Error('Host book entry is invalid'));
    }
    return this.mutate((entries) => {
      const others = entries.filter((existing) => existing.hostId !== normalized.hostId);
      if (others.length >= MAX_ENTRIES) {
        throw new Error('Host book is full');
      }
      return { entries: [...others, normalized], result: normalized };
    });
  }

  public remove(hostId: string): Promise<boolean> {
    return this.mutate((entries) => {
      const kept = entries.filter((entry) => entry.hostId !== hostId);
      return { entries: kept, result: kept.length !== entries.length };
    });
  }

  public setAlias(hostId: string, alias: string | undefined): Promise<HostBookEntry | undefined> {
    const trimmed = alias?.trim();
    if (trimmed !== undefined && (trimmed.length === 0 || trimmed.length > MAX_ALIAS_LENGTH)) {
      return Promise.reject(new Error(`Alias must be 1-${MAX_ALIAS_LENGTH} characters`));
    }
    return this.update(hostId, (entry) => {
      const { alias: _previous, ...rest } = entry;
      return trimmed === undefined ? rest : { ...rest, alias: trimmed };
    });
  }

  /**
   * Refreshes ids, names and addresses from `host/hello` / `host/endpoints`.
   * The Host key is never taken from the wire; a different `hostId` is ignored.
   */
  public applyEndpoints(
    hostId: string,
    data: HostEndpointsData,
  ): Promise<HostBookEntry | undefined> {
    if (data.hostId !== hostId) {
      return Promise.resolve(undefined);
    }
    return this.update(hostId, (entry) => {
      const { relayUrl: _relay, directUrl: _direct, ...rest } = entry;
      const relayUrl = normalizeChannelUrl(data.relayUrl, true);
      const directUrl = normalizeChannelUrl(data.directUrl, false);
      return {
        ...rest,
        userId: data.userId,
        userName: data.userName,
        hostName: data.hostName,
        ...(relayUrl === undefined ? {} : { relayUrl }),
        ...(directUrl === undefined ? {} : { directUrl }),
      };
    });
  }

  private update(
    hostId: string,
    change: (entry: HostBookEntry) => HostBookEntry,
  ): Promise<HostBookEntry | undefined> {
    return this.mutate((entries) => {
      const index = entries.findIndex((entry) => entry.hostId === hostId);
      const current = entries[index];
      if (current === undefined) {
        return { entries, result: undefined };
      }
      const next = normalizeEntry(change(current));
      if (next === undefined) {
        // An update that would leave no reachable address keeps the old entry.
        return { entries, result: current };
      }
      const updated = [...entries];
      updated[index] = next;
      return { entries: updated, result: next };
    });
  }

  private mutate<T>(
    change: (entries: HostBookEntry[]) => { entries: HostBookEntry[]; result: T },
  ): Promise<T> {
    const operation = this.writeTail.then(async () => {
      const { entries, result } = change(await this.readEntries());
      await this.storage.write(STORAGE_KEY, JSON.stringify({ version: 1, entries }));
      return result;
    });
    this.writeTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async readEntries(): Promise<HostBookEntry[]> {
    const raw = await this.storage.read(STORAGE_KEY);
    if (raw === undefined) {
      return [];
    }
    try {
      const document = JSON.parse(raw) as { version?: unknown; entries?: unknown };
      if (document.version !== 1 || !Array.isArray(document.entries)) {
        throw new Error('unsupported host book document');
      }
      return document.entries.flatMap((entry) => {
        const normalized = normalizeEntry(entry);
        return normalized === undefined ? [] : [normalized];
      });
    } catch (error) {
      this.onDamaged(error instanceof Error ? error : new Error('Host book is damaged'));
      return [];
    }
  }
}

export function groupHostBookByUser(entries: readonly HostBookEntry[]): HostBookUserGroup[] {
  const groups = new Map<string, HostBookUserGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.userId) ?? {
      userId: entry.userId,
      userName: entry.userName,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(entry.userId, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: group.entries.sort((a, b) => a.hostName.localeCompare(b.hostName)),
    }))
    .sort((a, b) => a.userName.localeCompare(b.userName));
}

function normalizeEntry(value: unknown): HostBookEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const userName =
    typeof record.userName === 'string' ? normalizeRemoteDisplayName(record.userName) : undefined;
  const hostName =
    typeof record.hostName === 'string' ? normalizeRemoteDisplayName(record.hostName) : undefined;
  const relayUrl =
    record.relayUrl === undefined ? undefined : normalizeChannelUrl(record.relayUrl, true);
  const directUrl =
    record.directUrl === undefined ? undefined : normalizeChannelUrl(record.directUrl, false);
  const alias =
    typeof record.alias === 'string' && record.alias.trim().length > 0
      ? record.alias.trim()
      : undefined;
  if (
    !isRemoteId(record.userId) ||
    !isRemoteId(record.hostId) ||
    userName === undefined ||
    hostName === undefined ||
    typeof record.hostKey !== 'string' ||
    decodeBase64Url(record.hostKey)?.length !== 32 ||
    !isRemoteDeviceRole(record.role) ||
    typeof record.pairedAt !== 'string' ||
    (relayUrl === undefined && directUrl === undefined)
  ) {
    return undefined;
  }
  return {
    userId: record.userId,
    userName,
    hostId: record.hostId,
    hostName,
    hostKey: record.hostKey,
    ...(relayUrl === undefined ? {} : { relayUrl }),
    ...(directUrl === undefined ? {} : { directUrl }),
    role: record.role,
    ...(alias === undefined ? {} : { alias }),
    pairedAt: record.pairedAt,
  };
}
