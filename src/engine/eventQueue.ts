// Generic time-ordered scheduling queue used internally by the simulation loop.
//
// A binary min-heap keyed by (time, sequence), where `sequence` is a monotonically increasing
// insertion counter. This gives stable FIFO tie-breaking for events scheduled at the exact same
// simulation time (see dev_log/02_engine.md, "Event queue" — confirmed FIFO, pure insertion
// order, no semantic priority).
//
// Implemented as a factory function returning plain data + closures rather than a class, to
// match the project's "functional core" style.

interface QueueEntry<T> {
  time: number;
  sequence: number;
  event: T;
}

export interface QueuePeek<T> {
  event: T;
  time: number;
}

export interface EventQueue<T> {
  push(event: T, time: number): void;
  pop(): QueuePeek<T> | undefined;
  peek(): QueuePeek<T> | undefined;
  isEmpty(): boolean;
}

function isEarlier<T>(a: QueueEntry<T>, b: QueueEntry<T>): boolean {
  return a.time !== b.time ? a.time < b.time : a.sequence < b.sequence;
}

export function createEventQueue<T>(): EventQueue<T> {
  const heap: QueueEntry<T>[] = [];
  let nextSequence = 0;

  function swap(i: number, j: number): void {
    const tmp = heap[i]!;
    heap[i] = heap[j]!;
    heap[j] = tmp;
  }

  function siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      if (!isEarlier(heap[index]!, heap[parentIndex]!)) break;
      swap(index, parentIndex);
      index = parentIndex;
    }
  }

  function siftDown(startIndex: number): void {
    let index = startIndex;
    const length = heap.length;
    for (;;) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;
      if (left < length && isEarlier(heap[left]!, heap[smallest]!)) smallest = left;
      if (right < length && isEarlier(heap[right]!, heap[smallest]!)) smallest = right;
      if (smallest === index) break;
      swap(index, smallest);
      index = smallest;
    }
  }

  return {
    push(event: T, time: number): void {
      heap.push({ time, sequence: nextSequence, event });
      nextSequence += 1;
      siftUp(heap.length - 1);
    },

    pop(): QueuePeek<T> | undefined {
      const top = heap[0];
      if (top === undefined) return undefined;
      const last = heap.pop();
      if (heap.length > 0 && last !== undefined) {
        heap[0] = last;
        siftDown(0);
      }
      return { event: top.event, time: top.time };
    },

    peek(): QueuePeek<T> | undefined {
      const top = heap[0];
      return top === undefined ? undefined : { event: top.event, time: top.time };
    },

    isEmpty(): boolean {
      return heap.length === 0;
    },
  };
}
