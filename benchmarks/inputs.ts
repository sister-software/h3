/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

export function points(n: number): [number, number][] {
	let s = 0x51_57_48_33n

	const next = () => {
		s = (s + 0x9e_37_79_b9_7f_4a_7c_15n) & 0xff_ff_ff_ff_ff_ff_ff_ffn
		let z = s
		z = ((z ^ (z >> 30n)) * 0xbf_58_47_6d_1c_e4_e5_b9n) & 0xff_ff_ff_ff_ff_ff_ff_ffn
		z = ((z ^ (z >> 27n)) * 0x94_d0_49_bb_13_31_11_ebn) & 0xff_ff_ff_ff_ff_ff_ff_ffn

		return Number((z ^ (z >> 31n)) >> 11n) / 2 ** 53
	}

	return Array.from({ length: n }, () => [next() * 160 - 80, next() * 360 - 180])
}
