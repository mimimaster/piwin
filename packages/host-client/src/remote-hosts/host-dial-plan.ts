import { remoteChannelPath, REMOTE_CHANNEL_CLOSE, type HostBookEntry } from '@piwin/contracts';

export type DialPath = 'relay' | 'direct';
export type DialChoice = { path: DialPath; url: string };

type DialTarget = Pick<HostBookEntry, 'userId' | 'hostId' | 'relayUrl' | 'directUrl'>;

/**
 * ADR 0101 §1 path selection: relay first; direct only after the relay
 * failed before opening (unreachable, or `4404` Host offline). Once a path
 * opened, the next connection after a drop starts with the relay again, so a
 * shell that fell back to direct returns to the relay when it can. No race,
 * no LAN probing.
 */
export class HostDialPlan {
  private target: DialTarget;
  private index = 0;

  public constructor(target: DialTarget) {
    this.target = target;
  }

  /** New addresses from the host book (`host/endpoints`); restarts at the relay. */
  public update(target: DialTarget): void {
    this.target = target;
    this.index = 0;
  }

  public candidates(): DialChoice[] {
    const { relayUrl, directUrl } = this.target;
    const choices: DialChoice[] = [];
    if (relayUrl !== undefined) {
      choices.push({ path: 'relay', url: connectUrl(relayUrl, this.target) });
    }
    if (directUrl !== undefined) {
      choices.push({ path: 'direct', url: connectUrl(directUrl, this.target) });
    }
    return choices;
  }

  public next(): DialChoice {
    const choices = this.candidates();
    const choice = choices[this.index % Math.max(choices.length, 1)];
    if (choice === undefined) {
      throw new Error('This Host has no relay or direct address');
    }
    return choice;
  }

  /** Feedback from the socket a `next()` choice produced. */
  public reportClosed(code: number, opened: boolean): void {
    if (opened) {
      this.index = 0;
      return;
    }
    if (code === REMOTE_CHANNEL_CLOSE.badRequest) {
      return;
    }
    this.index += 1;
  }

  /** App foregrounded / network changed: try the relay first again. */
  public reset(): void {
    this.index = 0;
  }
}

export function connectUrl(base: string, target: Pick<HostBookEntry, 'userId' | 'hostId'>): string {
  return `${base.replace(/\/+$/, '')}${remoteChannelPath(target.userId, 'connect')}?hostId=${target.hostId}`;
}
