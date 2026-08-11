import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectWireSong } from "./ws";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: string) {
    this.onmessage?.({ data });
  }

  emitError() {
    this.onerror?.();
  }

  emitClose() {
    this.onclose?.();
  }
}

const noteJson = JSON.stringify({
  timestamp_ms: 1,
  event_type: "tcp_syn",
  pitch: 60,
  velocity: 0.5,
  duration_ms: 180,
  pan: 0.6,
  size_bytes: 100,
});

const controlJson = JSON.stringify({
  type: "control",
  message: "You are lagging behind — some events were dropped",
});

describe("connectWireSong", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("calls onNoteEvent for NoteEvent messages and onControlMessage for control messages", () => {
    const onNoteEvent = vi.fn();
    const onControlMessage = vi.fn();
    const onStatusChange = vi.fn();
    const connection = connectWireSong("ws://test/ws", {
      onNoteEvent,
      onControlMessage,
      onStatusChange,
    });
    const socket = MockWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage(noteJson);
    socket.emitMessage(controlJson);

    expect(onNoteEvent).toHaveBeenCalledTimes(1);
    expect(onNoteEvent.mock.calls[0][0]).toMatchObject({ event_type: "tcp_syn" });
    expect(onControlMessage).toHaveBeenCalledTimes(1);
    expect(onControlMessage.mock.calls[0][0]).toEqual({
      type: "control",
      message: "You are lagging behind — some events were dropped",
    });
    expect(onStatusChange).toHaveBeenCalledWith("open");

    connection.close();
  });

  it("logs malformed JSON with console.warn and does not crash", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onNoteEvent = vi.fn();
    const onControlMessage = vi.fn();
    const connection = connectWireSong("ws://test/ws", {
      onNoteEvent,
      onControlMessage,
      onStatusChange: vi.fn(),
    });
    const socket = MockWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage("{not json");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onNoteEvent).not.toHaveBeenCalled();
    expect(onControlMessage).not.toHaveBeenCalled();

    warn.mockRestore();
    connection.close();
  });

  it("reconnects with exponential backoff after close", () => {
    const onStatusChange = vi.fn();
    const connection = connectWireSong("ws://test/ws", {
      onNoteEvent: vi.fn(),
      onControlMessage: vi.fn(),
      onStatusChange,
    });
    const first = MockWebSocket.instances[0];
    first.emitOpen();
    first.emitClose();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(onStatusChange).toHaveBeenLastCalledWith("closed");

    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(onStatusChange).toHaveBeenLastCalledWith("connecting");

    MockWebSocket.instances[1].emitClose();
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(2);

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    connection.close();
  });

  it("close() stops reconnection attempts", () => {
    const connection = connectWireSong("ws://test/ws", {
      onNoteEvent: vi.fn(),
      onControlMessage: vi.fn(),
      onStatusChange: vi.fn(),
    });
    const socket = MockWebSocket.instances[0];
    socket.emitClose();
    connection.close();

    vi.advanceTimersByTime(6000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
