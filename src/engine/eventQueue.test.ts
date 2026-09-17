import { describe, expect, it } from 'vitest';

import { createEventQueue } from './eventQueue';

describe('eventQueue', () => {
  it('pops events in chronological order regardless of push order', () => {
    const queue = createEventQueue<string>();
    queue.push('third', 30);
    queue.push('first', 10);
    queue.push('second', 20);

    expect(queue.pop()).toEqual({ event: 'first', time: 10 });
    expect(queue.pop()).toEqual({ event: 'second', time: 20 });
    expect(queue.pop()).toEqual({ event: 'third', time: 30 });
    expect(queue.isEmpty()).toBe(true);
  });

  it('breaks ties for equal timestamps with stable FIFO (insertion) order', () => {
    const queue = createEventQueue<string>();
    queue.push('a', 5);
    queue.push('b', 5);
    queue.push('c', 5);
    queue.push('d', 1); // earlier time, should still come out first

    expect(queue.pop()).toEqual({ event: 'd', time: 1 });
    expect(queue.pop()).toEqual({ event: 'a', time: 5 });
    expect(queue.pop()).toEqual({ event: 'b', time: 5 });
    expect(queue.pop()).toEqual({ event: 'c', time: 5 });
  });

  it('maintains FIFO tie-break across a larger interleaved set (stresses heap sift logic)', () => {
    const queue = createEventQueue<number>();
    const pushes: Array<{ event: number; time: number }> = [];
    let counter = 0;
    for (const time of [3, 1, 3, 2, 1, 3, 2, 1]) {
      pushes.push({ event: counter, time });
      queue.push(counter, time);
      counter += 1;
    }

    const expected = [...pushes]
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => (a.time !== b.time ? a.time - b.time : a.index - b.index))
      .map(({ event, time }) => ({ event, time }));

    const actual: Array<{ event: number; time: number }> = [];
    while (!queue.isEmpty()) {
      const popped = queue.pop();
      if (popped) actual.push(popped);
    }

    expect(actual).toEqual(expected);
  });

  it('peek returns the earliest entry without removing it', () => {
    const queue = createEventQueue<string>();
    queue.push('only', 100);

    expect(queue.peek()).toEqual({ event: 'only', time: 100 });
    expect(queue.peek()).toEqual({ event: 'only', time: 100 }); // still there
    expect(queue.isEmpty()).toBe(false);

    expect(queue.pop()).toEqual({ event: 'only', time: 100 });
    expect(queue.isEmpty()).toBe(true);
  });

  it('peek and pop return undefined on an empty queue, and isEmpty is true', () => {
    const queue = createEventQueue<string>();

    expect(queue.isEmpty()).toBe(true);
    expect(queue.peek()).toBeUndefined();
    expect(queue.pop()).toBeUndefined();
  });
});
