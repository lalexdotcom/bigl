export type PromiseFunction<T = any> = () => Promise<T>;
type QueuedPromise = { generator: PromiseFunction; index: number };

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_NAME = "pool";
type POOL_EVENT_TYPE = "start" | "full" | "next" | "close" | "available";

export interface Pool {
	readonly promise: Promise<any[]>;
	readonly running: number;
	readonly waiting: number;

	readonly isStarted: boolean;
	readonly isClosed: boolean;
	readonly isResolved: boolean;

	start(): void;
	enqueue<P extends PromiseFunction>(promiseGenerator: P): void;
	close(): Promise<any[]>;

	on(event: POOL_EVENT_TYPE, callback: () => void): void;
	once(event: POOL_EVENT_TYPE, callback: () => void): void;
}

const VERBOSE_LEVELS = {
	debug: console.debug,
	info: console.info,
	warn: console.warn,
	error: console.error,
};

export type PoolOptions = {
	concurrency: number;
	name?: string;
	rejectOnError?: boolean;
	autoStart?: boolean;
	verbose?: boolean | ((level: keyof typeof VERBOSE_LEVELS, ...debug: Parameters<typeof console.log>) => any);
};

export interface PoolError extends Error {
	catched: any;
}

class PoolErrorImpl extends Error implements PoolError {
	catched: any;

	constructor(message: string, catched: any) {
		super(message);
		this.catched = catched;
	}
}

class PromisePool implements Pool {
	size: number;

	private name: string;
	private options?: PoolOptions;

	private currentIndex = 0;

	#running: Promise<any>[] = [];
	#enqueued: QueuedPromise[] = [];
	private result: any[] = [];

	#isStarted = false;
	#isClosed = false;
	#isResolved = false;

	#promise: Promise<any[]>;
	#resolve!: (...args: any[]) => void;
	#reject!: (...args: any[]) => void;

	#listeners: Partial<Record<POOL_EVENT_TYPE, Map<() => void, boolean>>> = {};

	#emit(type: POOL_EVENT_TYPE) {
		if (!!this.#listeners[type]) {
			this.verbose("debug", `emit ${type}`);
			for (const [cb, once] of this.#listeners[type]!) {
				cb();
				if (once) this.#listeners[type]?.delete(cb);
			}
		}
	}

	on(type: POOL_EVENT_TYPE, cb: () => void) {
		(this.#listeners[type] ??= new Map()).set(cb, false);
	}

	once(type: POOL_EVENT_TYPE, cb: () => void) {
		(this.#listeners[type] ??= new Map()).set(cb, true);
	}

	constructor(options?: PoolOptions) {
		this.size = options?.concurrency || DEFAULT_CONCURRENCY;
		this.name = options?.name || DEFAULT_NAME;
		this.options = options;
		this.#promise = new Promise((res, rej) => {
			this.#resolve = res;
			this.#reject = rej;
		});
	}

	start() {
		if (!this.#isStarted) {
			this.#emit("start");
			this.verbose("info", "start pool");
			this.#isStarted = true;
		}
		this.runNext();
	}

	enqueue<P extends PromiseFunction>(promiseGenerator: P) {
		if (this.#isClosed) throw new Error(`[${this.name}] PromisePool already closed`);
		if (this.#isResolved) throw new Error(`[${this.name}] PromisePool already performed`);
		this.verbose("info", `enqueue promise@${this.currentIndex}`);
		this.#enqueued.push({
			index: this.currentIndex++,
			generator: promiseGenerator,
		});
		if ((this.options?.autoStart ?? true) && !this.#isStarted) {
			this.start();
		} else if (this.#isStarted) {
			this.runNext();
		}
	}
	private verbose(level: keyof typeof VERBOSE_LEVELS, ...args: any[]) {
		if (!this.options?.verbose) return;
		if (typeof this.options?.verbose === "function") {
			this.options.verbose(level, ...args);
		} else if (this.options?.verbose) {
			VERBOSE_LEVELS[level](...args);
		}
	}

	private runNext() {
		if (this.#isStarted) {
			if (this.#enqueued.length) {
				let added = 0;
				while (this.#running.length < this.size && !!this.#enqueued.length) {
					const nextQueuedPromise = this.#enqueued.shift();
					this.verbose("info", `run promise ${nextQueuedPromise?.index}`);
					if (nextQueuedPromise) {
						const nextPromise = nextQueuedPromise.generator();
						nextPromise
							.then((res) => this.promiseDone(nextPromise, res, nextQueuedPromise.index))
							.catch((err) => this.promiseRejected(nextPromise, err, nextQueuedPromise.index));
						this.#running.push(nextPromise);
						added++;
					}
				}
				if (this.#running.length >= this.size) {
					if (added) this.#emit("full");
				}
			} else if (!this.#running.length) {
				if (this.#isClosed) {
					this.verbose("info", "no more queue: done");
					this.#isResolved = true;
					this.#resolve(this.result);
				} else {
					this.verbose("info", "waiting for new promises or close");
				}
			} else {
				if (this.#running.length == this.size - 1) {
					this.#emit("available");
				}
				this.verbose("info", `${this.#running.length} promises still running`);
			}
		}
	}

	get promise() {
		return this.#promise;
	}

	get running() {
		return this.#running.length;
	}

	get waiting() {
		return this.#enqueued.length;
	}

	get isStarted() {
		return this.#isStarted;
	}

	get isClosed() {
		return this.#isClosed;
	}

	get isResolved() {
		return this.#isResolved;
	}

	private promiseDone(p: Promise<void>, result: any, index: number) {
		if (this.#isResolved) return;
		const promiseIndex = this.#running.indexOf(p);
		if (promiseIndex >= 0) {
			this.#running.splice(promiseIndex, 1);
			this.result[index] = result;
			this.verbose("info", `promise@${index} done`);
			this.#emit("next");
			this.runNext();
		} else {
			this.verbose("warn", "unknown promise resolved");
		}
	}

	private promiseRejected(p: Promise<void>, error: any, index: number) {
		if (this.#isResolved) return;
		const promiseIndex = this.#running.indexOf(p);
		if (promiseIndex >= 0) {
			this.#running.splice(promiseIndex, 1);
			this.result[index] = new PoolErrorImpl(`Promise ${index} was rejected`, error);
			if (this.options?.rejectOnError) {
				this.#isResolved = true;
				this.#reject(error);
			} else {
				console.error(error instanceof Error ? error.message : JSON.stringify(error));
				this.#emit("next");
				this.runNext();
			}
			this.verbose("error", `promise@${index} error`, error);
		} else {
			this.verbose("warn", "unknown promise error");
		}
	}

	get pending(): number {
		return this.#enqueued.length;
	}

	close() {
		this.verbose("info", "close pool");
		this.#isClosed = true;
		this.start();
		return this.#promise;
	}
}

export function pool(concurrency = 10, options?: Omit<PoolOptions, "concurrency">): Pool {
	return new PromisePool({ ...options, concurrency });
}

export function parallel(commands: PromiseFunction[], options?: PoolOptions): Promise<any[]> {
	if (!commands.length) return Promise.resolve([]);
	const parallelPool = new PromisePool({
		concurrency: Number.POSITIVE_INFINITY,
		...options,
	});
	for (const cmd of commands) parallelPool.enqueue(cmd);
	return parallelPool.close();
}

export function serie(commands: PromiseFunction[], options?: Omit<PoolOptions, "concurrency">): Promise<any[]> {
	if (!commands.length) return Promise.resolve([]);
	const parallelPool = new PromisePool({ ...options, concurrency: 1 });
	for (const cmd of commands) parallelPool.enqueue(cmd);
	return parallelPool.close();
}
