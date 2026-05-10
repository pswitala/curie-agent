import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './event-bus.js';
import type { Event } from './event-bus.js';

describe('EventBus', () => {
  it('subscribes and emits events', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.subscribe('status', fn);
    bus.emit({ type: 'status', id: '1', message: 'hello', timestamp: Date.now() });
    expect(fn).toHaveBeenCalledWith({ type: 'status', id: '1', message: 'hello', timestamp: expect.any(Number) });
  });

  it('unsubscribe stops receiving events', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const unsub = bus.subscribe('status', fn);
    unsub();
    bus.emit({ type: 'status', id: '1', message: 'hi', timestamp: Date.now() });
    expect(fn).not.toHaveBeenCalled();
  });

  it('once fires only one time', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.once('status', fn);
    bus.emit({ type: 'status', id: '1', message: 'a', timestamp: Date.now() });
    bus.emit({ type: 'status', id: '2', message: 'b', timestamp: Date.now() });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('history returns all emitted events', () => {
    const bus = new EventBus();
    const e1: Event = { type: 'status', id: '1', message: 'a', timestamp: 1 };
    const e2: Event = { type: 'error', id: '2', message: 'b', timestamp: 2 };
    bus.emit(e1);
    bus.emit(e2);
    expect(bus.history()).toEqual([e1, e2]);
  });

  it('emitAll emits multiple events', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.subscribe('status', fn);
    const events: Event[] = [
      { type: 'status', id: '1', message: 'a', timestamp: 1 },
      { type: 'status', id: '2', message: 'b', timestamp: 2 },
    ];
    bus.emitAll(events);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clear removes listeners and history', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.subscribe('status', fn);
    bus.emit({ type: 'status', id: '1', message: 'a', timestamp: 1 });
    bus.clear();
    expect(bus.history()).toHaveLength(0);
    bus.emit({ type: 'status', id: '2', message: 'b', timestamp: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('filters by event type', () => {
    const bus = new EventBus();
    const statusFn = vi.fn();
    const errorFn = vi.fn();
    bus.subscribe('status', statusFn);
    bus.subscribe('error', errorFn);
    bus.emit({ type: 'status', id: '1', message: 'hi', timestamp: 1 });
    expect(statusFn).toHaveBeenCalledTimes(1);
    expect(errorFn).not.toHaveBeenCalled();
  });
});
