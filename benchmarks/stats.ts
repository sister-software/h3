/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

const quantile = (xs: number[], q: number) => {
	const s = xs.toSorted((a, b) => a - b)
	const pos = (s.length - 1) * q
	const lo = Math.floor(pos)
	const hi = Math.ceil(pos)

	return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo)
}

export interface Stat {
	median: number
	p25: number
	p75: number
	samples: number
}

export const stat = (xs: number[]): Stat => ({
	median: quantile(xs, 0.5),
	p25: quantile(xs, 0.25),
	p75: quantile(xs, 0.75),
	samples: xs.length,
})
