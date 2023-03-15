export function wait(delay: number = 0) {
	return new Promise<void>((res) => {
		setTimeout(res, delay);
	});
}

export function timeout<T>(p: Promise<T>, delay: number): Promise<T> {
	return new Promise(async (res, rej) => {
		let isTooLate = false,
			isResolved = false;
		let to = setTimeout(() => {
			if (!isResolved) {
				isTooLate = true;
				clearTimeout(to);
				rej(new Error("Promise timed out"));
			}
		}, delay);
		p.then((v) => {
			if (isTooLate) rej();
			else {
				isResolved = true;
				clearTimeout(to);
				res(v);
			}
		});
	});
}

export function unsync<TResult>(fct: (...args: any) => TResult): Promise<TResult> {
	return new Promise((res, rej) => {
		setTimeout(() => {
			try {
				const result = fct();
				res(result);
			} catch (e) {
				rej(e);
			}
		});
	});
}
