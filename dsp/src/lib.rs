//! Tactus DSP: the audio-thread voices, written in Rust and compiled to WebAssembly.
//! It runs inside an AudioWorklet; the worklet hands over note events at their exact sample
//! and calls `render` for the samples in between, so timing stays sample-accurate.
//!
//! Voices
//! - Karplus-Strong plucked string (gayageum, koto, guitar, harp), up to 16 at once
//! - a TB-303 style mono voice: polyBLEP saw/square into a saturating 4-pole ladder,
//!   with slide (glide into the next note) and accent
//! - an analog mono bass: two detuned polyBLEP saws (or squares, or a blend) and a square sub an octave
//!   down, into the same kind of ladder with its own envelope, an ADSR, and glide
//! - the synth engine: polyphonic analog (saw/pulse, sync, ring), wavetable and FM voices with unison, sub,
//!   noise, several filters, vowel formants, envelopes and lfos
//!
//! `no_std` and no allocator: every buffer is fixed, so nothing allocates on the audio thread.
#![no_std]

use core::f32::consts::PI;
const TAU: f32 = 2.0 * PI;
const BLOCK: usize = 128;
const KS_VOICES: usize = 16;
const KS_MAX: usize = 4096; // longest string period (about 12 Hz at 48 kHz)

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

// ---------- small math kit (no libm on the audio thread) ----------
#[inline(always)]
fn floorf(x: f32) -> f32 {
    let t = x as i32 as f32;
    if t > x { t - 1.0 } else { t }
}
/// 2^x, about 1e-7 relative error
#[inline(always)]
fn exp2f(x: f32) -> f32 {
    let x = x.clamp(-126.0, 126.0);
    let i = floorf(x);
    let f = x - i;
    let p = 1.0 + f * (0.693_147_2 + f * (0.240_226_5 + f * (0.055_504_11 + f * (0.009_618_129 + f * 0.001_333_355))));
    p * f32::from_bits(((i as i32 + 127) as u32) << 23)
}
#[inline(always)]
fn powf(b: f32, e: f32) -> f32 { exp2f(e * log2f(b)) }
fn log2f(x: f32) -> f32 {
    // split into exponent and mantissa in [1,2), then a short series for the mantissa
    let bits = x.to_bits();
    let e = ((bits >> 23) & 0xff) as i32 - 127;
    let m = f32::from_bits((bits & 0x007f_ffff) | 0x3f80_0000);
    let t = (m - 1.0) / (m + 1.0);
    let t2 = t * t;
    let ln = 2.0 * t * (1.0 + t2 * (1.0 / 3.0 + t2 * (1.0 / 5.0 + t2 * (1.0 / 7.0 + t2 / 9.0))));
    e as f32 + ln * core::f32::consts::LOG2_E
}
/// sine on any input, 7th-order odd polynomial after reduction to [-pi/2, pi/2]
#[inline(always)]
fn sinf(x: f32) -> f32 {
    let mut x = x - TAU * floorf(x / TAU + 0.5); // [-pi, pi]
    if x > PI / 2.0 { x = PI - x } else if x < -PI / 2.0 { x = -PI - x }
    let x2 = x * x;
    x * (1.0 + x2 * (-0.166_666_67 + x2 * (0.008_333_331 + x2 * (-0.000_198_409 + x2 * 0.000_002_752_6))))
}
#[inline(always)]
fn cosf(x: f32) -> f32 { sinf(x + PI / 2.0) }
/// e^x in double precision (the ladder filter feeds back on itself, so it keeps full precision like the JS voice)
#[inline(always)]
fn expd(x: f64) -> f64 {
    let x = x.clamp(-700.0, 700.0);
    let kf = x * core::f64::consts::LOG2_E + 0.5;
    let k = { let t = kf as i64 as f64; if t > kf { t - 1.0 } else { t } };
    let r = x - k * core::f64::consts::LN_2;
    let mut term = 1.0f64; let mut sum = 1.0f64;
    let mut i = 1.0f64;
    while i < 11.0 { term *= r / i; sum += term; i += 1.0; }
    sum * f64::from_bits(((k as i64 + 1023) as u64) << 52)
}
#[inline(always)]
fn thd(x: f64) -> f64 {
    if x > 3.0 { return 1.0 }
    if x < -3.0 { return -1.0 }
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}
#[inline(always)]
fn blepd(mut t: f64, dt: f64) -> f64 {
    if t < dt { t /= dt; return t + t - t * t - 1.0 }
    if t > 1.0 - dt { t = (t - 1.0) / dt; return t * t + t + t + 1.0 }
    0.0
}
// ---------- state ----------
#[derive(Clone, Copy)]
struct Ks {
    on: bool, n: usize, w: usize, base: f32, prev: f32, amp: f32, pl: f32, pr: f32,
    g: f32, g_rel: f32, off: u64, start: u64, life: u64, vib: f32, ph: f32, rate: f32,
}
const KS0: Ks = Ks { on: false, n: 0, w: 0, base: 0.0, prev: 0.0, amp: 0.0, pl: 0.0, pr: 0.0, g: 0.0, g_rel: 0.0, off: 0, start: 0, life: 0, vib: 0.0, ph: 0.0, rate: 0.0 };

struct Acid {
    on: bool, ph: f64, f: f64, target: f64, y: [f64; 4], fenv: f64, amp: f64, gate: bool, off: u64, slide: bool,
    cut: f64, k: f64, env: f64, acc: bool, dec: f64, gain: f64, square: bool, drive: f64,
}

struct Mono {
    on: bool, ph: f64, ph2: f64, phs: f64, f: f64, target: f64, gk: f64, y: [f64; 4], fenv: f64, fd: f64,
    amp: f64, attack: bool, ainc: f64, dk: f64, sus: f64, rk: f64, gate: bool, off: u64,
    cut: f64, kt: f64, k: f64, env: f64, gain: f64, wave: f64, sub: f64, det: f64, drive: f64,
}
const MONO0: Mono = Mono { on: false, ph: 0.0, ph2: 0.0, phs: 0.0, f: 110.0, target: 110.0, gk: 1.0, y: [0.0; 4], fenv: 0.0, fd: 0.999,
    amp: 0.0, attack: false, ainc: 0.01, dk: 0.001, sus: 0.5, rk: 0.01, gate: false, off: 0,
    cut: 800.0, kt: 1.0, k: 0.0, env: 0.0, gain: 0.0, wave: 0.0, sub: 0.0, det: 1.0, drive: 1.0 };

struct Dsp {
    sr: f32, now: u64, seed: u32,
    ks: [Ks; KS_VOICES], ks_next: usize,
    ac: Acid,
    mo: Mono,
    out_l: [f32; BLOCK], out_r: [f32; BLOCK],
}
static mut D: Dsp = Dsp {
    sr: 48000.0, now: 0, seed: 0x9e37_79b9,
    ks: [KS0; KS_VOICES], ks_next: 0,
    ac: Acid { on: false, ph: 0.0, f: 110.0, target: 110.0, y: [0.0; 4], fenv: 0.0, amp: 0.0, gate: false, off: 0, slide: false, cut: 800.0, k: 0.0, env: 0.0, acc: false, dec: 0.999, gain: 0.0, square: false, drive: 1.0 },
    mo: MONO0,
    out_l: [0.0; BLOCK], out_r: [0.0; BLOCK],
};
// string delay lines live apart from the rest so they stay zero-filled memory instead of bytes in the module
static mut KS_BUF: [[f32; KS_MAX]; KS_VOICES] = [[0.0; KS_MAX]; KS_VOICES];
#[inline(always)]
fn d() -> &'static mut Dsp { unsafe { &mut *core::ptr::addr_of_mut!(D) } }
#[inline(always)]
fn ks_buf() -> &'static mut [[f32; KS_MAX]; KS_VOICES] { unsafe { &mut *core::ptr::addr_of_mut!(KS_BUF) } }
fn rnd(s: &mut u32) -> f32 {
    *s ^= *s << 13; *s ^= *s >> 17; *s ^= *s << 5;
    (*s as f32) * (1.0 / 4_294_967_296.0)
}

// ---------- exports ----------
#[unsafe(no_mangle)]
pub extern "C" fn init(sr: f32, seed: u32) {
    let d = d();
    d.sr = sr; d.now = 0; d.seed = seed | 1;
    for v in d.ks.iter_mut() { v.on = false }
    d.ac.on = false;
    d.mo = MONO0;
    vs_seed(seed);
}
#[unsafe(no_mangle)]
pub extern "C" fn out_l() -> *const f32 { d().out_l.as_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn out_r() -> *const f32 { d().out_r.as_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn active() -> u32 { let d = d(); d.ks.iter().filter(|v| v.on).count() as u32 + d.ac.on as u32 + d.mo.on as u32 }

/// pluck a string now. dur and the decay are in samples / seconds like the JS voice
#[unsafe(no_mangle)]
pub extern "C" fn ks_on(f: f32, gain: f32, pan: f32, bright: f32, t60: f32, vib: f32, dur: u32) {
    let d = d();
    let sr = d.sr;
    let period = sr / f.max(sr / (KS_MAX as f32 - 8.0));
    let n = ((period * 1.04) as usize + 5).min(KS_MAX);
    // reuse a free voice, or the oldest one when all 16 ring
    let slot = match d.ks.iter().position(|v| !v.on) { Some(i) => i, None => { let i = d.ks_next; d.ks_next = (i + 1) % KS_VOICES; i } };
    let buf = &mut ks_buf()[slot];
    let a = 0.12 + 0.85 * bright.clamp(0.0, 1.0);
    let (mut y, mut mean) = (0.0f32, 0.0f32);
    for i in 0..n { y += a * ((rnd(&mut d.seed) * 2.0 - 1.0) - y); buf[i] = y; mean += y; }
    mean /= n as f32;
    let mut pk = 0.0f32;
    for i in 0..n { buf[i] -= mean; pk = pk.max(buf[i].abs()); }
    let inv = if pk > 0.0 { 1.0 / pk } else { 1.0 };
    for i in 0..n { buf[i] *= inv; }
    let p = (pan.clamp(-1.0, 1.0) + 1.0) * PI / 4.0;
    let t60 = t60.max(0.05);
    d.ks[slot] = Ks {
        on: true, n, w: 0, base: period - 0.5, prev: 0.0, amp: gain, pl: cosf(p), pr: sinf(p),
        g: powf(10.0, -3.0 / (t60 * f)), g_rel: powf(10.0, -3.0 / (0.15 * f)),
        off: d.now + dur as u64, start: d.now, life: d.now + dur as u64 + (sr * t60.min(6.0)) as u64,
        vib, ph: rnd(&mut d.seed) * TAU, rate: (5.0 + rnd(&mut d.seed)) / sr,
    };
}

/// start or glide the acid voice
#[unsafe(no_mangle)]
pub extern "C" fn acid_on(f: f32, dur: u32, slide: u32, acc: u32, cut: f32, res: f32, env: f32, dec: f32, gain: f32, wave: f32, drive: f32) {
    let d = d();
    let v = &mut d.ac;
    let (f, cut, res, env, dec, gain, drive) = (f as f64, cut as f64, res as f64, env as f64, dec as f64, gain as f64, drive as f64);
    if !v.on { v.on = true; v.ph = 0.0; v.f = f; v.y = [0.0; 4]; v.fenv = 0.0; v.amp = 0.0; v.gate = false; v.off = 0; }
    let legato = v.gate && d.now <= v.off + 64;
    v.slide = legato || (slide != 0 && v.amp > 0.001);
    v.target = f;
    if !v.slide { v.f = f; v.fenv = 1.0; }
    v.acc = acc != 0;
    if v.acc { v.fenv = (v.fenv + 0.7).min(1.8); }
    v.gate = true; v.off = d.now + dur as u64;
    v.cut = cut; v.k = (res / 4.0).min(3.9); v.env = env;
    v.dec = expd(-1.0 / (dec.max(0.02) * if v.acc { 0.6 } else { 1.0 } * d.sr as f64));
    v.gain = gain; v.square = wave > 0.5; v.drive = 1.0 + drive * 3.0;
}

/// start a note on the mono bass. cut is the track's cut, kt the note's key tracking (cut × kt is where the
/// filter rests); det is the second oscillator's frequency ratio; times are in seconds.
/// Each note opens the filter again and restarts the envelope from where it is (no click); with glide and a
/// voice still sounding, the pitch slides in from the last note
#[unsafe(no_mangle)]
pub extern "C" fn mono_on(f: f32, dur: u32, cut: f32, kt: f32, res: f32, env: f32, dec: f32, atk: f32, sus: f32, rel: f32, gain: f32, wave: f32, sub: f32, det: f32, drive: f32, glide: f32) {
    let d = d();
    let srd = d.sr as f64;
    let v = &mut d.mo;
    let f = f as f64;
    if !v.on { *v = MONO0; v.on = true; v.f = f; }
    let sounding = v.amp > 1e-4;
    v.target = f;
    let glide = glide as f64;
    if glide > 0.0 && sounding { v.gk = 1.0 - expd(-1.0 / (glide / 3.0 * srd)); } else { v.f = f; v.gk = 1.0; }
    v.gate = true; v.off = d.now + dur as u64; v.attack = true; v.fenv = 1.0;
    let dec = (dec as f64).max(0.01);
    v.ainc = 1.0 / ((atk as f64).max(0.002) * srd);
    v.dk = 1.0 - expd(-1.0 / (dec / 3.0 * srd));
    v.fd = expd(-1.0 / (dec / 3.0 * srd));
    v.rk = 1.0 - expd(-1.0 / ((rel as f64).max(0.02) / 4.0 * srd));
    v.sus = (sus as f64).clamp(0.0, 1.0);
    v.cut = cut as f64; v.kt = kt as f64; v.k = (res as f64 / 4.0).min(3.9); v.env = env as f64;
    v.gain = gain as f64; v.wave = (wave as f64).clamp(0.0, 1.0); v.sub = (sub as f64).clamp(0.0, 1.0); v.det = det as f64; v.drive = 1.0 + drive as f64 * 3.0;
}

/// a knob turned while the line plays (the acid line and the mono bass)
#[unsafe(no_mangle)]
pub extern "C" fn live(cut: f32, res: f32) {
    let d = d();
    if cut >= 0.0 { d.ac.cut = cut as f64; d.mo.cut = cut as f64 }
    if res >= 0.0 { d.ac.k = (res as f64 / 4.0).min(3.9); d.mo.k = (res as f64 / 4.0).min(3.9) }
}
#[inline(always)]
fn sqd(ph: f64, dt: f64) -> f64 {
    let mut p2 = ph + 0.5; if p2 >= 1.0 { p2 -= 1.0 }
    (if ph < 0.5 { 1.0 } else { -1.0 }) + blepd(ph, dt) - blepd(p2, dt)
}

/// render n (<= 128) samples into out_l / out_r
#[unsafe(no_mangle)]
pub extern "C" fn render(n: u32) {
    let d = d();
    let bufs = ks_buf();
    let n = (n as usize).min(BLOCK);
    let sr = d.sr;
    let srd = sr as f64;
    let glide = 1.0 - expd(-1.0 / (0.055 * srd));
    let a_atk = 1.0 - expd(-1.0 / (0.002 * srd));
    let a_rel = 1.0 - expd(-1.0 / (0.008 * srd));
    let fmax = srd * 0.42;
    for i in 0..n { d.out_l[i] = 0.0; d.out_r[i] = 0.0; }
    // strings: one voice at a time across the block, so its state stays in registers
    for (k, v) in d.ks.iter_mut().enumerate() {
        if !v.on { continue }
        let buf = &mut bufs[k][..v.n];
        let nn = v.n;
        let (mut w, mut prev, mut ph) = (v.w, v.prev, v.ph);
        let (pl, pr) = (v.amp * v.pl, v.amp * v.pr);
        // one tight loop per case, so the common no-vibrato string has no per-sample branch on it
        let g_on = v.g; let g_rel = v.g_rel;
        let off_i = if v.off > d.now { (v.off - d.now).min(n as u64) as usize } else { 0 };
        let vib = v.vib;
        for i in 0..n {
            let dl = if vib != 0.0 {
                let age = (d.now + i as u64 - v.start) as f32 / sr;
                let depth = vib * ((age - 0.2) / 0.4).clamp(0.0, 1.0);
                ph += TAU * v.rate;
                if ph > TAU { ph -= TAU }
                v.base * exp2f(-depth * sinf(ph) / 1200.0)
            } else { v.base };
            let mut rd = w as f32 - dl;
            if rd < 0.0 { rd += nn as f32 }
            if rd < 0.0 { rd += nn as f32 }
            let mut i0 = rd as usize;
            let f = rd - i0 as f32;
            if i0 >= nn { i0 -= nn }
            let i1 = if i0 + 1 == nn { 0 } else { i0 + 1 };
            let (a0, a1) = (buf[i0], buf[i1]);
            let y = a0 + (a1 - a0) * f;
            // flush tiny values: a decaying string otherwise drifts into denormals, which are very slow on the CPU
            let s = 0.5 * (y + prev) * if i >= off_i { g_rel } else { g_on };
            buf[w] = if s.abs() < 1e-20 { 0.0 } else { s };
            prev = y;
            w += 1; if w == nn { w = 0 }
            d.out_l[i] += y * pl; d.out_r[i] += y * pr;
        }
        v.w = w; v.prev = prev; v.ph = ph;
        if d.now + n as u64 >= v.life { v.on = false }
    }
    for i in 0..n {
        let fr = d.now + i as u64;
        let (mut l, mut r) = (0.0f32, 0.0f32);
        let v = &mut d.ac;
        if v.on {
            let srd = sr as f64;
            if v.gate && fr >= v.off { v.gate = false }
            if v.slide { v.f += (v.target - v.f) * glide }
            let dt = v.f / srd;
            v.ph += dt;
            if v.ph >= 1.0 { v.ph -= 1.0 }
            let osc = if v.square {
                let mut p2 = v.ph + 0.5; if p2 >= 1.0 { p2 -= 1.0 }
                (if v.ph < 0.5 { 1.0 } else { -1.0 }) + blepd(v.ph, dt) - blepd(p2, dt)
            } else { 2.0 * v.ph - 1.0 - blepd(v.ph, dt) };
            v.fenv *= v.dec;
            let fc = (v.cut * (1.0 + v.env * 8.0 * v.fenv)).clamp(30.0, fmax);
            let g = 1.0 - expd(-core::f64::consts::TAU * fc / srd);
            let k = v.k;
            let x = thd(osc * v.drive * 0.8 - k * v.y[3]);
            let t0 = thd(v.y[0]);
            v.y[0] += g * (x - t0);
            let t0 = thd(v.y[0]); let t1 = thd(v.y[1]);
            v.y[1] += g * (t0 - t1);
            let t1 = thd(v.y[1]); let t2 = thd(v.y[2]);
            v.y[2] += g * (t1 - t2);
            let t2 = thd(v.y[2]); let t3 = thd(v.y[3]);
            v.y[3] += g * (t2 - t3);
            let target = if v.gate { if v.acc { 1.35 } else { 1.0 } } else { 0.0 };
            v.amp += (target - v.amp) * if v.gate { a_atk } else { a_rel };
            let o = (v.y[3] * v.amp * v.gain * (1.0 + k * 0.35)) as f32;
            l += o; r += o;
            if !v.gate && v.amp < 1e-5 && fr > v.off + (sr as u64) { v.on = false }
        }
        let m = &mut d.mo;
        if m.on {
            let srd = sr as f64;
            if m.gate && fr >= m.off { m.gate = false }
            m.f += (m.target - m.f) * m.gk;
            let dt = m.f / srd; let dt2 = dt * m.det; let dts = dt * 0.5;
            m.ph += dt; if m.ph >= 1.0 { m.ph -= 1.0 }
            m.ph2 += dt2; if m.ph2 >= 1.0 { m.ph2 -= 1.0 }
            m.phs += dts; if m.phs >= 1.0 { m.phs -= 1.0 }
            let mut osc = 0.0;
            if m.wave < 1.0 { osc += (1.0 - m.wave) * (0.62 * (2.0 * m.ph - 1.0 - blepd(m.ph, dt)) + 0.32 * (2.0 * m.ph2 - 1.0 - blepd(m.ph2, dt2))); }
            if m.wave > 0.0 { osc += m.wave * (0.5 * sqd(m.ph, dt) + 0.25 * sqd(m.ph2, dt2)); }
            if m.sub > 0.0 { osc += m.sub * 0.22 * sqd(m.phs, dts); }
            m.fenv *= m.fd;
            let fc = (m.cut * m.kt * (1.0 + m.env * 10.0 * m.fenv)).clamp(30.0, srd * 0.42);
            let g = 1.0 - expd(-core::f64::consts::TAU * fc / srd);
            let k = m.k;
            let x = thd(osc * m.drive * 0.8 - k * m.y[3]);
            let t0 = thd(m.y[0]);
            m.y[0] += g * (x - t0);
            let t0 = thd(m.y[0]); let t1 = thd(m.y[1]);
            m.y[1] += g * (t0 - t1);
            let t1 = thd(m.y[1]); let t2 = thd(m.y[2]);
            m.y[2] += g * (t1 - t2);
            let t2 = thd(m.y[2]); let t3 = thd(m.y[3]);
            m.y[3] += g * (t2 - t3);
            if m.gate {
                if m.attack { m.amp += m.ainc; if m.amp >= 1.0 { m.amp = 1.0; m.attack = false } }
                else { m.amp += (m.sus - m.amp) * m.dk }
            } else { m.amp -= m.amp * m.rk }
            let o = (m.y[3] * m.amp * m.gain * (1.0 + k * 0.35)) as f32;
            l += o; r += o;
            if !m.gate && m.amp < 1e-5 && fr > m.off + (sr as u64) { m.on = false }
        }
        let (mut el, mut er) = (0.0f64, 0.0f64);
        vs_sample(fr, sr as f64, &mut el, &mut er);
        l += el as f32; r += er as f32;
        d.out_l[i] += l; d.out_r[i] += r;
    }
    d.now += n as u64;
}

// ======================= the synth engine (analog, wavetable, FM) =======================
// A polyphonic voice per note (12 per track), each with up to 7 unison oscillators, a sub, noise, a choice of
// filters (state-variable 12/24 dB low-pass, high-pass, band-pass, notch, or the ladder), vowel formants, an amp
// and a filter envelope, a pitch envelope and two tempo-locked lfos. The JavaScript worklet voice mirrors this line by
// line with the same math helpers (sinp, tanp, exp2p), so the two agree to rounding.
const VS_VOICES: usize = 12;
const UNI: usize = 7;
pub const WT_TABLES: usize = 8;
pub const WT_FRAMES: usize = 16;
pub const WT_MIPS: usize = 7;
pub const WT_N: usize = 1024;
const WT_LEN: usize = WT_TABLES * WT_FRAMES * WT_MIPS * WT_N;
static mut WT: [f32; WT_LEN] = [0.0; WT_LEN];
static mut PB: [f32; 96] = [0.0; 96];
#[inline(always)]
fn wt() -> &'static mut [f32; WT_LEN] { unsafe { &mut *core::ptr::addr_of_mut!(WT) } }
#[inline(always)]
fn pb() -> &'static mut [f32; 96] { unsafe { &mut *core::ptr::addr_of_mut!(PB) } }

const PI_D: f64 = core::f64::consts::PI;
const TAU_D: f64 = core::f64::consts::TAU;
#[inline(always)]
fn floord(x: f64) -> f64 { let t = x as i64 as f64; if t > x { t - 1.0 } else { t } }
/// sine, 9th-order after folding into [-pi/2, pi/2]
#[inline(always)]
fn sinp(x: f64) -> f64 {
    let mut x = x - TAU_D * floord(x / TAU_D + 0.5);
    if x > PI_D / 2.0 { x = PI_D - x } else if x < -PI_D / 2.0 { x = -PI_D - x }
    let x2 = x * x;
    x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362880.0)))))
}
#[inline(always)]
fn tanp(x: f64) -> f64 { sinp(x) / sinp(x + PI_D / 2.0) }
#[inline(always)]
fn exp2p(x: f64) -> f64 {
    let x = x.clamp(-1000.0, 1000.0);
    let i = floord(x); let f = x - i;
    let p = 1.0 + f * (0.693_147_180_559_945_3 + f * (0.240_226_506_959_100_7 + f * (0.055_504_108_664_821_58 + f * (0.009_618_129_107_628_477 + f * (0.001_333_355_814_642_844_3 + f * 0.000_154_035_303_933_816_06)))));
    p * f64::from_bits(((i as i64 + 1023) as u64) << 52)
}
#[inline(always)]
fn expp(x: f64) -> f64 { exp2p(x * 1.442_695_040_888_963_4) }
fn rndd(s: &mut u32) -> f64 { *s ^= *s << 13; *s ^= *s >> 17; *s ^= *s << 5; *s as f64 / 4_294_967_296.0 }
#[inline(always)]
fn sawb(ph: f64, dt: f64) -> f64 { 2.0 * ph - 1.0 - blepd(ph, dt) }
#[inline(always)]
fn fracd(x: f64) -> f64 { x - floord(x) }
/// a pulse high for the last (1 - pw) of the cycle, made of two band-limited saws
#[inline(always)]
fn pulseb(ph: f64, pw: f64, dt: f64) -> f64 { sawb(ph, dt) - sawb(fracd(ph - pw), dt) - (2.0 * pw - 1.0) }
#[inline(always)]
fn lfo_wave(shape: u32, ph: f64, held: f64) -> f64 {
    match shape { 1 => 1.0 - 4.0 * (ph - 0.5).abs(), 2 => 2.0 * ph - 1.0, 3 => 1.0 - 2.0 * ph, 4 => if ph < 0.5 { 1.0 } else { -1.0 }, 5 => held, _ => sinp(TAU_D * ph) }
}
/// one sample of a state-variable filter (Simper's form): returns (low, band, high)
#[inline(always)]
fn svf(s: &mut [f64; 2], x: f64, g: f64, k: f64) -> (f64, f64, f64) {
    let a1 = 1.0 / (1.0 + g * (g + k)); let a2 = g * a1; let a3 = g * a2;
    let v3 = x - s[1]; let v1 = a1 * s[0] + a2 * v3; let v2 = s[1] + a2 * s[0] + a3 * v3;
    s[0] = 2.0 * v1 - s[0]; s[1] = 2.0 * v2 - s[1];
    (v2, v1, x - k * v1 - v2)
}
const VOWEL_F: [[f64; 3]; 5] = [[730.0, 1090.0, 2440.0], [530.0, 1840.0, 2480.0], [270.0, 2290.0, 3010.0], [570.0, 840.0, 2410.0], [300.0, 870.0, 2240.0]];

#[derive(Clone, Copy)]
struct Lfo { tgt: u32, inc: f64, ph: f64, shape: u32, depth: f64, held: f64 }
const LFO0: Lfo = Lfo { tgt: 0, inc: 0.0, ph: 0.0, shape: 0, depth: 0.0, held: 0.0 };
#[derive(Clone, Copy)]
struct Vs {
    on: bool, gate: bool, off: u64, start: u64, kind: u32,
    f: f64, target: f64, gk: f64,
    ph: [f64; UNI], ph2: [f64; UNI], fbm: [f64; UNI], phs: f64, phr: f64,
    nv: usize, rat: [f64; UNI], gl: [f64; UNI], gr: [f64; UNI],
    amp: f64, attack: bool, ainc: f64, dk: f64, sus: f64, rk: f64,
    fe: f64, fatt: bool, finc: f64, fdk: f64, fsus: f64, frk: f64,
    pe: f64, pdk: f64, penv: f64,
    cut: f64, kt: f64, res: f64, env: f64, ftype: u32, drive: f64,
    sub: f64, noise: f64, wave: f64, pw: f64, sync: f64, ring: f64, table: usize, scan: f64,
    fm: f64, ratio: f64, fb: f64, fme: f64, fmdk: f64, vowel: f64, gain: f64,
    sl: [f64; 2], sl2: [f64; 2], sr_: [f64; 2], sr2: [f64; 2], yl: [f64; 4], yr: [f64; 4], vl: [[f64; 2]; 3], vr: [[f64; 2]; 3],
    lfo: [Lfo; 2],
}
const VS0: Vs = Vs {
    on: false, gate: false, off: 0, start: 0, kind: 0, f: 110.0, target: 110.0, gk: 1.0,
    ph: [0.0; UNI], ph2: [0.0; UNI], fbm: [0.0; UNI], phs: 0.0, phr: 0.0, nv: 1, rat: [1.0; UNI], gl: [1.0; UNI], gr: [1.0; UNI],
    amp: 0.0, attack: false, ainc: 0.01, dk: 0.001, sus: 0.5, rk: 0.01,
    fe: 0.0, fatt: false, finc: 1.0, fdk: 0.001, fsus: 0.0, frk: 0.01, pe: 0.0, pdk: 0.99, penv: 0.0,
    cut: 1000.0, kt: 1.0, res: 0.7, env: 0.0, ftype: 0, drive: 0.0,
    sub: 0.0, noise: 0.0, wave: 0.0, pw: 0.5, sync: 1.0, ring: 0.0, table: 0, scan: 0.0,
    fm: 0.0, ratio: 1.0, fb: 0.0, fme: 1.0, fmdk: 1.0, vowel: -1.0, gain: 0.0,
    sl: [0.0; 2], sl2: [0.0; 2], sr_: [0.0; 2], sr2: [0.0; 2], yl: [0.0; 4], yr: [0.0; 4], vl: [[0.0; 2]; 3], vr: [[0.0; 2]; 3],
    lfo: [LFO0; 2],
};
static mut VS: [Vs; VS_VOICES] = [VS0; VS_VOICES];
static mut VSEED: u32 = 0x1234_5678;
#[inline(always)]
fn vs() -> &'static mut [Vs; VS_VOICES] { unsafe { &mut *core::ptr::addr_of_mut!(VS) } }
#[inline(always)]
fn vseed() -> &'static mut u32 { unsafe { &mut *core::ptr::addr_of_mut!(VSEED) } }

#[unsafe(no_mangle)]
pub extern "C" fn vs_params() -> *mut f32 { pb().as_mut_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn wt_ptr() -> *mut f32 { wt().as_mut_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn wt_len() -> u32 { WT_LEN as u32 }
#[unsafe(no_mangle)]
pub extern "C" fn vs_seed(s: u32) { *vseed() = s | 1; for v in vs().iter_mut() { *v = VS0 } }

/// start a note with the parameters written into vs_params (see the layout in synth.js)
#[unsafe(no_mangle)]
pub extern "C" fn vs_on(dur: u32) {
    let d = d();
    let srd = d.sr as f64;
    let p = pb();
    let q = |i: usize| p[i] as f64;
    let mono = q(34) > 0.0;
    let voices = vs();
    // a voice: the mono one, a free one, or the quietest released one, or the oldest
    let mut slot = 0usize;
    if !mono {
        let mut best = usize::MAX; let mut score = f64::MAX;
        for (i, v) in voices.iter().enumerate() {
            let sc = if !v.on { -1.0 } else if !v.gate { v.amp } else { 10.0 + (d.now - v.start) as f64 * -1e-9 };
            if sc < score { score = sc; best = i }
        }
        slot = best;
    }
    let s = vseed();
    let v = &mut voices[slot];
    let sounding = v.on && v.amp > 1e-4;
    let f = q(0);
    if !(mono && v.on) {
        *v = VS0; v.on = true; v.f = f;
        for u in 0..UNI { v.ph[u] = rndd(s); v.ph2[u] = 0.0; }
    }
    v.kind = q(1) as u32; v.target = f;
    let glide = q(33);
    if mono && glide > 0.0 && sounding { v.gk = 1.0 - expp(-1.0 / (glide / 3.0 * srd)); } else { v.f = f; v.gk = 1.0; }
    v.gate = true; v.off = d.now + dur as u64; v.start = d.now; v.attack = true;
    v.gain = q(2);
    let dec = q(5).max(0.01);
    v.ainc = 1.0 / (q(4).max(0.002) * srd); v.dk = 1.0 - expp(-1.0 / (dec / 3.0 * srd)); v.sus = q(6).clamp(0.0, 1.0);
    v.rk = 1.0 - expp(-1.0 / (q(7).max(0.02) / 4.0 * srd));
    v.cut = q(8); v.kt = q(9); v.res = q(10); v.env = q(11);
    let fatk = q(12); let fdec = q(13).max(0.01);
    v.fatt = fatk > 0.0; v.finc = if fatk > 0.0 { 1.0 / (fatk * srd) } else { 1.0 }; v.fe = if fatk > 0.0 { 0.0 } else { 1.0 };
    v.fdk = 1.0 - expp(-1.0 / (fdec / 3.0 * srd)); v.fsus = q(14).clamp(0.0, 1.0); v.frk = v.rk;
    v.ftype = q(15) as u32; v.drive = q(16).max(0.0);
    v.penv = q(17); v.pe = 1.0; v.pdk = expp(-1.0 / (q(18).max(0.002) / 3.0 * srd));
    v.nv = (q(19) as usize).clamp(1, UNI);
    v.sub = q(20); v.noise = q(21); v.wave = q(22).clamp(0.0, 1.0); v.pw = q(23).clamp(0.02, 0.98); v.sync = q(24).max(1.0); v.ring = q(25).clamp(0.0, 1.0);
    v.table = (q(26) as usize).min(WT_TABLES - 1); v.scan = q(27);
    v.fm = q(28); v.ratio = q(29).max(0.01); v.fb = q(30).clamp(0.0, 1.0);
    let fmdec = q(31);
    v.fme = 1.0; v.fmdk = if fmdec > 0.0 { expp(-1.0 / (fmdec / 3.0 * srd)) } else { 1.0 };
    v.vowel = q(32);
    for k in 0..2 {
        let b = 36 + k * 5;
        v.lfo[k] = Lfo { tgt: q(b) as u32, inc: q(b + 1) / srd, ph: q(b + 2), shape: q(b + 3) as u32, depth: q(b + 4), held: rndd(s) * 2.0 - 1.0 };
    }
    for u in 0..UNI { v.rat[u] = q(46 + u); v.gl[u] = q(53 + u); v.gr[u] = q(60 + u); }
}

#[inline(always)]
fn wt_read(t: usize, scan: f64, ph: f64, f: f64, srd: f64) -> f64 {
    let w = wt();
    let ok = 0.45 * srd / f.max(1.0);
    let mut mip = 0usize;
    while mip < WT_MIPS - 1 && (512usize >> mip) as f64 > ok { mip += 1 }
    let pos = scan.clamp(0.0, 1.0) * (WT_FRAMES - 1) as f64;
    let mut fi = floord(pos) as usize; if fi > WT_FRAMES - 2 { fi = WT_FRAMES - 2 }
    let ff = pos - fi as f64;
    let b0 = ((t * WT_FRAMES + fi) * WT_MIPS + mip) * WT_N; let b1 = ((t * WT_FRAMES + fi + 1) * WT_MIPS + mip) * WT_N;
    let x = ph * WT_N as f64; let i0 = (floord(x) as usize) & (WT_N - 1); let fr = x - floord(x); let i1 = (i0 + 1) & (WT_N - 1);
    let a = w[b0 + i0] as f64 + (w[b0 + i1] as f64 - w[b0 + i0] as f64) * fr;
    let b = w[b1 + i0] as f64 + (w[b1 + i1] as f64 - w[b1 + i0] as f64) * fr;
    a + (b - a) * ff
}

/// one sample of every engine voice, added into (l, r)
#[inline(always)]
fn vs_sample(fr: u64, srd: f64, l: &mut f64, r: &mut f64) {
    let s = vseed();
    for v in vs().iter_mut() {
        if !v.on { continue }
        if v.gate && fr >= v.off { v.gate = false }
        // lfos: 1 cut, 2 res, 3 pitch, 4 scan, 5 pw, 6 fm, 7 vowel, 8 sync, 9 noise
        let mut m = [0.0f64; 10];
        for k in 0..2 {
            let lf = &mut v.lfo[k];
            if lf.tgt == 0 { continue }
            lf.ph += lf.inc;
            if lf.ph >= 1.0 { lf.ph -= 1.0; if lf.shape == 5 { lf.held = rndd(s) * 2.0 - 1.0 } }
            if (lf.tgt as usize) < 10 { m[lf.tgt as usize] += lf.depth * lfo_wave(lf.shape, lf.ph, lf.held) }
        }
        v.f += (v.target - v.f) * v.gk;
        v.pe *= v.pdk;
        let fc0 = v.f * exp2p(v.penv * v.pe / 12.0 + m[3] / 1200.0);
        let scan = v.scan + m[4]; let pw = (v.pw + m[5]).clamp(0.02, 0.98); let sync = (v.sync + m[8]).max(1.0);
        let idx = (v.fm + m[6]) * v.fme; v.fme *= v.fmdk;
        let (mut xl, mut xr) = (0.0f64, 0.0f64);
        for u in 0..v.nv {
            let fu = fc0 * v.rat[u];
            let dt = fu / srd;
            let o = match v.kind {
                1 => { v.ph[u] += dt; if v.ph[u] >= 1.0 { v.ph[u] -= 1.0 } wt_read(v.table, scan, v.ph[u], fu, srd) }
                2 => {
                    v.ph2[u] += dt * v.ratio; if v.ph2[u] >= 1.0 { v.ph2[u] -= 1.0 }
                    let mo = sinp(TAU_D * v.ph2[u] + v.fb * PI_D * v.fbm[u]); v.fbm[u] = mo;
                    v.ph[u] += dt; if v.ph[u] >= 1.0 { v.ph[u] -= 1.0 }
                    sinp(TAU_D * v.ph[u] + idx * mo)
                }
                _ => {
                    v.ph[u] += dt;
                    let wrapped = v.ph[u] >= 1.0; if wrapped { v.ph[u] -= 1.0 }
                    if sync > 1.0 {
                        let ds = dt * sync;
                        v.ph2[u] += ds; if v.ph2[u] >= 1.0 { v.ph2[u] -= floord(v.ph2[u]) }
                        if wrapped { v.ph2[u] = fracd(v.ph[u] * sync) }
                        (1.0 - v.wave) * sawb(v.ph2[u], ds) + v.wave * pulseb(v.ph2[u], pw, ds)
                    } else { (1.0 - v.wave) * sawb(v.ph[u], dt) + v.wave * pulseb(v.ph[u], pw, dt) }
                }
            };
            xl += o * v.gl[u]; xr += o * v.gr[u];
        }
        if v.ring > 0.0 {
            v.phr += fc0 * v.ratio / srd; if v.phr >= 1.0 { v.phr -= 1.0 }
            let rm = (1.0 - v.ring) + v.ring * sinp(TAU_D * v.phr);
            xl *= rm; xr *= rm;
        }
        if v.sub > 0.0 {
            let ds = fc0 * 0.5 / srd; v.phs += ds; if v.phs >= 1.0 { v.phs -= 1.0 }
            let o = v.sub * 0.5 * pulseb(v.phs, 0.5, ds); xl += o; xr += o;
        }
        let nz = v.noise + m[9];
        if nz > 0.0 { let o = nz * 0.6 * (rndd(s) * 2.0 - 1.0); xl += o; xr += o; }
        // filter envelope
        if v.fatt { v.fe += v.finc; if v.fe >= 1.0 { v.fe = 1.0; v.fatt = false } }
        else if v.gate { v.fe += (v.fsus - v.fe) * v.fdk } else { v.fe -= v.fe * v.frk }
        let fc = (v.cut * v.kt * (1.0 + v.env * 10.0 * v.fe) + m[1]).clamp(30.0, srd * 0.42);
        let res = (v.res + m[2]).max(0.05);
        if v.drive > 0.0 { let g = 1.0 + v.drive * 3.0; let c = 1.0 / (1.0 + v.drive); xl = thd(xl * g) * c; xr = thd(xr * g) * c; }
        let (yl, yr) = if v.ftype == 2 {
            // the ladder: 4 saturating one-poles with feedback
            let g = 1.0 - expp(-TAU_D * fc / srd); let k = (res / 4.0).min(3.9);
            let ch = |y: &mut [f64; 4], x: f64| -> f64 {
                let x = thd(x * 0.8 - k * y[3]);
                let t0 = thd(y[0]); y[0] += g * (x - t0);
                let t0 = thd(y[0]); let t1 = thd(y[1]); y[1] += g * (t0 - t1);
                let t1 = thd(y[1]); let t2 = thd(y[2]); y[2] += g * (t1 - t2);
                let t2 = thd(y[2]); let t3 = thd(y[3]); y[3] += g * (t2 - t3);
                y[3] * (1.0 + k * 0.35) * 1.25
            };
            (ch(&mut v.yl, xl), ch(&mut v.yr, xr))
        } else {
            let g = tanp(PI_D * fc / srd); let k = 1.0 / res.max(0.5);
            let (l1, b1, h1) = svf(&mut v.sl, xl, g, k); let (r1, rb1, rh1) = svf(&mut v.sr_, xr, g, k);
            match v.ftype {
                1 => { let k2 = 1.0 / 0.6; (svf(&mut v.sl2, l1, g, k2).0, svf(&mut v.sr2, r1, g, k2).0) }
                3 => (h1, rh1),
                4 => (b1 * k, rb1 * k),
                5 => (l1 + h1, r1 + rh1),
                _ => (l1, r1),
            }
        };
        let (mut ol, mut or) = (yl, yr);
        let vw = if v.vowel >= 0.0 { (v.vowel + m[7]).clamp(0.0, 4.0) } else { -1.0 };
        if vw >= 0.0 {
            let i = (floord(vw) as usize).min(3); let f = vw - i as f64;
            let (mut al, mut ar) = (0.0, 0.0);
            for k in 0..3 {
                let ff = VOWEL_F[i][k] * (1.0 - f) + VOWEL_F[i + 1][k] * f;
                let g = tanp(PI_D * ff.min(srd * 0.42) / srd); let kk = 1.0 / [6.0, 9.0, 11.0][k]; let a = [1.0, 0.5, 0.25][k];
                al += a * svf(&mut v.vl[k], yl, g, kk).1 * kk; ar += a * svf(&mut v.vr[k], yr, g, kk).1 * kk;
            }
            ol = al * 3.4; or = ar * 3.4;
        }
        if v.gate {
            if v.attack { v.amp += v.ainc; if v.amp >= 1.0 { v.amp = 1.0; v.attack = false } } else { v.amp += (v.sus - v.amp) * v.dk }
        } else { v.amp -= v.amp * v.rk }
        let a = v.amp * v.gain;
        *l += ol * a; *r += or * a;
        if !v.gate && v.amp < 1e-5 && fr > v.off + 4800 { v.on = false }
    }
}
