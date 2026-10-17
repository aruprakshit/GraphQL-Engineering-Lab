export class CapacityExceededError extends Error {
  constructor() {
    super("Password verification capacity exhausted");
    this.name = "CapacityExceededError";
  }
}

export function createConcurrencyLimiter(maxActive: number) {
  if (!Number.isInteger(maxActive) || maxActive < 1) {
    throw new Error("Concurrency limit must be a positive integer");
  }

  let active = 0;

  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      // 1. REJECT EXCESS WORK WITHOUT QUEUING
      if (active >= maxActive) {
        throw new CapacityExceededError();
      }

      // 2. RESERVE A SLOT BEFORE STARTING WORK
      active += 1;

      try {
        return await work();
      } finally {
        // 3. RELEASE THE SLOT ON SUCCESS OR FAILURE
        active -= 1;
      }
    },
  };
}
