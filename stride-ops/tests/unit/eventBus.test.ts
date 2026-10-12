/**
 * EventBus unit tests — verifies the sorted-insert hot path and correctness.
 */
import { EventBus, ListenerPriority } from '../../src/engine/events/EventBus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => { bus = new EventBus(); });
  afterEach(() => bus.dispose());

  test('listeners fire in descending priority order', () => {
    const order: number[] = [];
    bus.on('test', () => order.push(1), ListenerPriority.LOW);
    bus.on('test', () => order.push(3), ListenerPriority.HIGH);
    bus.on('test', () => order.push(2), ListenerPriority.NORMAL);
    bus.emit('test');
    expect(order).toEqual([3, 2, 1]);
  });

  test('once listener fires exactly once', () => {
    let count = 0;
    bus.once('ping', () => count++);
    bus.emit('ping');
    bus.emit('ping');
    expect(count).toBe(1);
  });

  test('off removes listener', () => {
    let count = 0;
    const cb = () => count++;
    bus.on('x', cb);
    bus.off('x', cb);
    bus.emit('x');
    expect(count).toBe(0);
  });

  test('deferred off during emit does not corrupt iterator', () => {
    let calls = 0;
    let unsub!: () => void;
    unsub = bus.on('y', () => {
      calls++;
      unsub();
    });
    bus.on('y', () => calls++);
    bus.emit('y');
    bus.emit('y');
    // First emit: both fire; second emit: only the second (unsub was deferred)
    expect(calls).toBe(3);
  });

  test('onAny receives all events', () => {
    const received: string[] = [];
    bus.onAny(({ event }) => received.push(event));
    bus.emit('a');
    bus.emit('b');
    expect(received).toEqual(['a', 'b']);
  });

  test('removeAll clears all listeners', () => {
    let count = 0;
    bus.on('z', () => count++);
    bus.removeAll();
    bus.emit('z');
    expect(count).toBe(0);
  });
});
