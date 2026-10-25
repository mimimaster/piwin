const MAX_PEER_ID = 0xffff_ffff;

type Room<Socket> = {
  userId: string;
  hostId: string;
  host: Socket;
  peers: Map<number, Socket>;
  nextPeer: number;
};

/**
 * Who is attached where: one Host socket per `(userId, hostId)` and its client
 * peers. Pure bookkeeping — sockets are opaque here; the server closes them.
 */
export class RelayRooms<Socket> {
  private readonly rooms = new Map<string, Room<Socket>>();

  /** Attaches a Host; returns the socket it replaced, if any. */
  public attachHost(userId: string, hostId: string, host: Socket): Socket | undefined {
    const key = roomKey(userId, hostId);
    const existing = this.rooms.get(key);
    if (existing !== undefined) {
      const previous = existing.host;
      existing.host = host;
      return previous;
    }
    this.rooms.set(key, { userId, hostId, host, peers: new Map(), nextPeer: 1 });
    return undefined;
  }

  /**
   * Detaches only if `host` is still the attached socket (a replaced Host
   * closing late must not tear down its successor). Returns the room's peers.
   */
  public detachHost(userId: string, hostId: string, host: Socket): Socket[] {
    const key = roomKey(userId, hostId);
    const room = this.rooms.get(key);
    if (room === undefined || room.host !== host) {
      return [];
    }
    this.rooms.delete(key);
    return [...room.peers.values()];
  }

  public findHost(userId: string, hostId: string): Socket | undefined {
    return this.rooms.get(roomKey(userId, hostId))?.host;
  }

  public hostCount(userId: string): number {
    let count = 0;
    for (const room of this.rooms.values()) {
      if (room.userId === userId) count += 1;
    }
    return count;
  }

  /** Undefined when no Host is attached or the room is full. */
  public joinPeer(
    userId: string,
    hostId: string,
    peer: Socket,
    maxPeers: number,
  ): { peer: number; host: Socket } | undefined {
    const room = this.rooms.get(roomKey(userId, hostId));
    if (room === undefined || room.peers.size >= maxPeers) {
      return undefined;
    }
    let id = room.nextPeer;
    while (room.peers.has(id)) {
      id = id >= MAX_PEER_ID ? 1 : id + 1;
    }
    room.nextPeer = id >= MAX_PEER_ID ? 1 : id + 1;
    room.peers.set(id, peer);
    return { peer: id, host: room.host };
  }

  /** True when the peer was still in the room (its Host should hear `peer-left`). */
  public leavePeer(userId: string, hostId: string, peer: number, socket: Socket): boolean {
    const room = this.rooms.get(roomKey(userId, hostId));
    if (room === undefined || room.peers.get(peer) !== socket) {
      return false;
    }
    room.peers.delete(peer);
    return true;
  }

  /** Removes and returns every peer of a room (its Host was replaced). */
  public dropPeers(userId: string, hostId: string): Socket[] {
    const room = this.rooms.get(roomKey(userId, hostId));
    if (room === undefined) {
      return [];
    }
    const peers = [...room.peers.values()];
    room.peers.clear();
    return peers;
  }

  public findPeer(userId: string, hostId: string, peer: number): Socket | undefined {
    return this.rooms.get(roomKey(userId, hostId))?.peers.get(peer);
  }

  public peerCount(userId: string, hostId: string): number {
    return this.rooms.get(roomKey(userId, hostId))?.peers.size ?? 0;
  }

  /** Every attached Host with its ids, for registry reloads. */
  public listHosts(): Array<{ userId: string; hostId: string; host: Socket }> {
    return [...this.rooms.values()].map(({ userId, hostId, host }) => ({ userId, hostId, host }));
  }
}

function roomKey(userId: string, hostId: string): string {
  return `${userId}/${hostId}`;
}
