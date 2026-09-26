// The smoke scenario's WebSocket client. The public socket route accepts only the exact configured Origin, which the
// standard WHATWG client cannot send, so this speaks the protocol directly over `node:net`: a handshake carrying
// `Origin`, then text, ping, and close frames. It is deliberately small — the service under test sends one JSON text
// frame per revision and one close frame, never a fragmented message.

import { randomBytes } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

export class SocketFailure extends Error {
  override readonly name = 'SocketFailure';
}

/** One revision frame. Only the fields the scenario asserts are modelled; the payload itself stays opaque. */
export type BriefingJobEvent = {
  readonly status: string;
  readonly revision: number;
};

export type Subscription = {
  readonly frames: readonly BriefingJobEvent[];
  readonly close: { readonly code: number; readonly reason: string };
};

const FRAME_STATUSES = ['queued', 'running', 'available', 'unavailable'];

/** A frame the scenario should read: an object carrying this protocol's status and revision. */
const isJobEvent = (value: unknown): value is BriefingJobEvent => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('status' in value) || typeof value.status !== 'string') return false;
  if (!('revision' in value) || typeof value.revision !== 'number') return false;
  return FRAME_STATUSES.includes(value.status);
};

const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

type Frame = {
  readonly opcode: number;
  readonly final: boolean;
  readonly payload: Buffer;
};

/** The payload length and header size of the frame at the buffer's start, or `undefined` while it is incomplete. */
const readHeader = (buffer: Buffer): { length: number; offset: number } | undefined => {
  const [first, second] = [buffer[0], buffer[1]];
  if (first === undefined || second === undefined) return undefined;
  const maskExtra = (second & 0x80) !== 0 ? 4 : 0;
  const short = second & 0x7f;
  if (short === 126) {
    if (buffer.length < 4) return undefined;
    return { length: buffer.readUInt16BE(2), offset: 4 + maskExtra };
  }
  if (short !== 127) return { length: short, offset: 2 + maskExtra };
  if (buffer.length < 10) return undefined;
  const wide = buffer.readBigUInt64BE(2);
  if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new SocketFailure('Frame too large for this client');
  return { length: Number(wide), offset: 10 + maskExtra };
};

/** The next complete frame, or `undefined` while the buffer still holds a partial one. */
const readFrame = (buffer: Buffer): { frame: Frame; rest: Buffer } | undefined => {
  const first = buffer[0];
  const header = readHeader(buffer);
  if (first === undefined || header === undefined) return undefined;
  const end = header.offset + header.length;
  if (buffer.length < end) return undefined;
  return {
    frame: {
      opcode: first & 0x0f,
      final: (first & 0x80) !== 0,
      payload: Buffer.from(buffer.subarray(header.offset, end)),
    },
    rest: buffer.subarray(end),
  };
};

const closeDetails = (payload: Buffer): { code: number; reason: string } => ({
  code: payload.length >= 2 ? payload.readUInt16BE(0) : 1005,
  reason: payload.length > 2 ? payload.subarray(2).toString('utf8') : '',
});

/**
 * One subscription: resolves with the frames observed and the close the service sent, rejects on a timeout, a refused
 * upgrade, an unreadable frame, or a transport error.
 */
const subscribe = (socket: Socket, path: string, timeoutMs: number): Promise<Subscription> => {
  const { promise, resolve, reject } = Promise.withResolvers<Subscription>();
  const frames: BriefingJobEvent[] = [];
  let buffer: Buffer = Buffer.alloc(0);
  let handshakeComplete = false;

  const timer = setTimeout(() => {
    socket.destroy();
    reject(new SocketFailure(`The subscription to ${path} produced no terminal frame within ${timeoutMs} ms`));
  }, timeoutMs);

  const finish = (subscription: Subscription) => {
    clearTimeout(timer);
    socket.destroy();
    resolve(subscription);
  };

  const fail = (error: unknown) => {
    clearTimeout(timer);
    socket.destroy();
    reject(error instanceof Error ? error : new SocketFailure(String(error)));
  };

  const sendControlFrame = (opcode: number, payload: Buffer) => {
    const mask = randomBytes(4);
    const masked = Buffer.from(payload);
    for (let index = 0; index < masked.length; index += 1) {
      masked[index] = (masked[index] ?? 0) ^ (mask[index % 4] ?? 0);
    }
    socket.write(Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, masked]));
  };

  const readText = (payload: Buffer) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.toString('utf8'));
    } catch {
      throw new SocketFailure(`The subscription sent a frame that is not JSON: ${payload.toString('utf8')}`);
    }
    if (!isJobEvent(parsed))
      throw new SocketFailure(
        `The subscription sent a frame this protocol does not define: ${payload.toString('utf8')}`,
      );
    frames.push(parsed);
  };

  const dispatch = (frame: Frame) => {
    switch (frame.opcode) {
      case OPCODE_CLOSE:
        finish({ frames, close: closeDetails(frame.payload) });
        return;
      case OPCODE_TEXT:
        if (!frame.final) throw new SocketFailure('The subscription sent a fragmented message');
        readText(frame.payload);
        return;
      case OPCODE_PING:
        sendControlFrame(OPCODE_PONG, frame.payload);
        return;
      default:
        // A pong needs no reply, and this client never asks for an extension another opcode could use.
        return;
    }
  };

  const readHandshake = (): boolean => {
    const end = buffer.indexOf('\r\n\r\n');
    if (end === -1) return false;
    const statusLine = buffer.subarray(0, end).toString('utf8').split('\r\n')[0] ?? '';
    buffer = buffer.subarray(end + 4);
    if (!statusLine.includes('101')) throw new SocketFailure(`The socket upgrade was refused: ${statusLine}`);
    handshakeComplete = true;
    return true;
  };

  socket.on('data', (chunk: Buffer) => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeComplete && !readHandshake()) return;
      let next = readFrame(buffer);
      while (next !== undefined) {
        buffer = next.rest;
        dispatch(next.frame);
        next = readFrame(buffer);
      }
    } catch (error) {
      fail(error);
    }
  });
  socket.on('error', (error: Error) => fail(new SocketFailure(`The subscription to ${path} failed: ${error.message}`)));

  return promise;
};

export const openSubscription = async (url: string, origin: string, timeoutMs: number): Promise<Subscription> => {
  const target = new URL(url);
  const socket = createConnection({ host: target.hostname, port: Number(target.port) });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const subscription = subscribe(socket, target.pathname, timeoutMs);
  socket.write(
    `GET ${target.pathname} HTTP/1.1\r\n` +
      `Host: ${target.host}\r\n` +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
      'Sec-WebSocket-Version: 13\r\n' +
      `Origin: ${origin}\r\n\r\n`,
  );
  return await subscription;
};
