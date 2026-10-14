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

// ======================= live effects (mirrors class Fx in src/js/synth.js) =======================
// One mono input, a fixed chain, stereo out; nothing looks ahead, so it adds no delay of its own. The order and the
// arithmetic follow the JavaScript line by line, so the two sound the same. The long buffers (the delay's two seconds,
// the reverb's lines) are taken from new memory pages only when fx_init runs, so the synth's own instances of this
// module do not carry them.
const FX_N: usize = 48;
const FX_PR: usize = 8192;
const FX_TB: usize = 512;
const FX_FDN: [f64; 8] = [31.7, 37.1, 41.1, 43.7, 47.9, 53.3, 59.9, 67.1];
const LOG2_10: f64 = 3.321_928_094_887_362;
/// log2 for positive numbers: split off the exponent, then ln(m) = 2 atanh((m - 1) / (m + 1))
fn log2d(x: f64) -> f64 {
    if !(x > 0.0) { return -1074.0 }
    let b = x.to_bits(); let e = ((b >> 52) & 0x7ff) as i64 - 1023;
    let m = f64::from_bits((b & 0x000f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000);
    let z = (m - 1.0) / (m + 1.0); let z2 = z * z;
    let mut t = z; let mut s = 0.0; let mut k = 1.0;
    while k < 40.0 { s += t / k; t *= z2; k += 2.0; }
    e as f64 + 2.0 * s * core::f64::consts::LOG2_E
}
fn sqrtd(x: f64) -> f64 {
    if !(x > 0.0) { return 0.0 }
    let mut y = exp2p(0.5 * log2d(x));
    y = 0.5 * (y + x / y); y = 0.5 * (y + x / y);
    y
}
#[inline(always)]
fn fxr(x: f64) -> f64 { floord(x + 0.5) }
#[inline(always)]
fn fxdb(db: f64) -> f64 { exp2p(db * 0.166_096_404_744_368_13) }
type Bq = [f64; 9];
fn fx_biq(b: &mut Bq, kind: u32, f: f64, q: f64, db: f64, sr: f64) {
    let w = TAU_D * f / sr; let cw = sinp(w + PI_D / 2.0); let sw = sinp(w); let al = sw / (2.0 * q); let a = exp2p(db * 0.083_048_202_372_184_06);
    let (b0, b1, b2, a0, a1, a2);
    if kind == 0 { b0 = (1.0 - cw) / 2.0; b1 = 1.0 - cw; b2 = b0; a0 = 1.0 + al; a1 = -2.0 * cw; a2 = 1.0 - al; }
    else if kind == 1 { b0 = (1.0 + cw) / 2.0; b1 = -(1.0 + cw); b2 = b0; a0 = 1.0 + al; a1 = -2.0 * cw; a2 = 1.0 - al; }
    else if kind == 2 { b0 = 1.0 + al * a; b1 = -2.0 * cw; b2 = 1.0 - al * a; a0 = 1.0 + al / a; a1 = -2.0 * cw; a2 = 1.0 - al / a; }
    else {
        let s2 = 2.0 * sqrtd(a) * al; let sg = if kind == 3 { -1.0 } else { 1.0 };
        b0 = a * ((a + 1.0) - sg * (a - 1.0) * cw + s2); b1 = 2.0 * sg * a * ((a - 1.0) - sg * (a + 1.0) * cw); b2 = a * ((a + 1.0) - sg * (a - 1.0) * cw - s2);
        a0 = (a + 1.0) + sg * (a - 1.0) * cw + s2; a1 = -2.0 * sg * ((a - 1.0) + sg * (a + 1.0) * cw); a2 = (a + 1.0) + sg * (a - 1.0) * cw - s2;
    }
    b[0] = b0 / a0; b[1] = b1 / a0; b[2] = b2 / a0; b[3] = a1 / a0; b[4] = a2 / a0;
}
#[inline(always)]
fn fx_bq(b: &mut Bq, x: f64) -> f64 { let y = b[0] * x + b[1] * b[5] + b[2] * b[6] - b[3] * b[7] - b[4] * b[8]; b[6] = b[5]; b[5] = x; b[8] = b[7]; b[7] = y; y }
#[inline(always)]
fn fx_read(buf: &[f32], mask: i64, w: i64, d: f64) -> f64 {
    let p = w as f64 - d; let i = floord(p); let f = p - i; let i = i as i64;
    buf[((i - 1) & mask) as usize] as f64 * (1.0 - f) + buf[(i & mask) as usize] as f64 * f
}
struct Fx {
    sr: f64, dl: usize, rl: usize,
    genv: f64, gg: f64, gopen: bool, ce: f64, cg: f64,
    prw: i64, ps: [f64; 3], tbw: i64, dacc: f64, dn: i64, tk: i64, tf: f64, hs: f64,
    we: f64, ws: [f64; 2], xp: f64, hp: f64,
    cw: i64, fw: i64, phl: [f64; 6], phr: [f64; 6], pfl: f64, pfr: f64,
    dw: i64, dt: f64, lpl: f64, lpr: f64,
    rw: i64, rz: [f64; 8], rlen: [i64; 8], rsize: f64, rg: [f64; 8], apw: i64,
    bq: [Bq; 12], dd: [f64; 448],
}
const FX0: Fx = Fx { sr: 48000.0, dl: 0, rl: 0, genv: 0.0, gg: 0.0, gopen: false, ce: 0.0, cg: 0.0, prw: 0, ps: [0.0, 0.33, 0.66], tbw: 0, dacc: 0.0, dn: 0, tk: 0, tf: 0.0, hs: 0.0,
    we: 0.0, ws: [0.0; 2], xp: 0.0, hp: 0.0, cw: 0, fw: 0, phl: [0.0; 6], phr: [0.0; 6], pfl: 0.0, pfr: 0.0, dw: 0, dt: -1.0, lpl: 0.0, lpr: 0.0,
    rw: 0, rz: [0.0; 8], rlen: [0; 8], rsize: -1.0, rg: [0.0; 8], apw: 0, bq: [[0.0; 9]; 12], dd: [0.0; 448] };
static mut FX: Fx = FX0;
static mut FP: [f32; FX_N] = [0.0; FX_N];
static mut FX_IN: [f32; BLOCK] = [0.0; BLOCK];
static mut FX_OL: [f32; BLOCK] = [0.0; BLOCK];
static mut FX_OR: [f32; BLOCK] = [0.0; BLOCK];
static mut FX_CL: [f32; 4096] = [0.0; 4096];
static mut FX_CR: [f32; 4096] = [0.0; 4096];
static mut FX_FL: [f32; 2048] = [0.0; 2048];
static mut FX_FR: [f32; 2048] = [0.0; 2048];
static mut FX_PRB: [f32; FX_PR] = [0.0; FX_PR];
static mut FX_TBB: [f32; FX_TB] = [0.0; FX_TB];
static mut FX_AP: [[f32; 1024]; 2] = [[0.0; 1024]; 2];
static mut FX_BIG: *mut f32 = core::ptr::null_mut();
#[inline(always)]
fn fx() -> &'static mut Fx { unsafe { &mut *core::ptr::addr_of_mut!(FX) } }
macro_rules! st { ($n:ident) => { unsafe { &mut *core::ptr::addr_of_mut!($n) } } }
/// the delay's two sides, then the reverb's eight lines, in the pages fx_init took
fn fx_big(off: usize, len: usize) -> &'static mut [f32] { unsafe { core::slice::from_raw_parts_mut(FX_BIG.add(off), len) } }
#[unsafe(no_mangle)]
pub extern "C" fn fx_params() -> *mut f32 { st!(FP).as_mut_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn fx_in() -> *mut f32 { st!(FX_IN).as_mut_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn fx_out_l() -> *const f32 { st!(FX_OL).as_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn fx_out_r() -> *const f32 { st!(FX_OR).as_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn fx_tuner() -> f32 { fx().tf as f32 }
#[unsafe(no_mangle)]
pub extern "C" fn fx_init(sr: f32) -> u32 {
    let f = fx(); *f = FX0; f.sr = sr as f64;
    let mut dl = 1usize; while (dl as f64) < f.sr * 2.0 + 8.0 { dl <<= 1 }
    let mut rl = 1usize; while (rl as f64) < f.sr * 0.075 { rl <<= 1 }
    f.dl = dl; f.rl = rl;
    let need = (2 * dl + 8 * rl) * 4;
    #[cfg(target_arch = "wasm32")]
    unsafe {
        if FX_BIG.is_null() {
            let pages = (need + 65535) / 65536;
            let prev = core::arch::wasm32::memory_grow(0, pages);
            if prev == usize::MAX { return 0 }
            FX_BIG = (prev * 65536) as *mut f32;
        }
    }
    fx_reset();
    1
}
#[unsafe(no_mangle)]
pub extern "C" fn fx_reset() {
    let f = fx(); let (sr, dl, rl) = (f.sr, f.dl, f.rl);
    *f = FX0; f.sr = sr; f.dl = dl; f.rl = rl;
    if !unsafe { FX_BIG.is_null() } { for v in fx_big(0, 2 * dl + 8 * rl).iter_mut() { *v = 0.0 } }
    for v in st!(FX_CL).iter_mut().chain(st!(FX_CR).iter_mut()).chain(st!(FX_FL).iter_mut()).chain(st!(FX_FR).iter_mut()).chain(st!(FX_PRB).iter_mut()).chain(st!(FX_TBB).iter_mut()) { *v = 0.0 }
    for a in st!(FX_AP).iter_mut() { for v in a.iter_mut() { *v = 0.0 } }
}
// the pitch of the input, every 256 samples, on a copy taken down to about 12 kHz (a small YIN)
fn fx_track(f: &mut Fx, p: &[f32; FX_N]) {
    let tb = st!(FX_TBB);
    let d_ = 1.0f64.max(fxr(f.sr / 12000.0)); let dsr = f.sr / d_;
    let tmin = 2i64.max(floord(dsr / 900.0) as i64); let tmax = 220i64.min(floord(dsr / 55.0) as i64); let w = 256i64;
    let m = (FX_TB - 1) as i64; let w0 = f.tbw - w - tmax;
    let mut e = 0.0; for j in 0..w { let v = tb[((w0 + j) & m) as usize] as f64; e += v * v; }
    if e < w as f64 * 1e-6 { f.tf = 0.0; return }
    let mut sum = 0.0; let mut best = -1i64;
    for t in 1..=tmax + 1 {
        let mut s = 0.0; for j in 0..w { let a = tb[((w0 + j) & m) as usize] as f64 - tb[((w0 + j + t) & m) as usize] as f64; s += a * a; }
        sum += s; f.dd[t as usize] = if sum > 0.0 { s * t as f64 / sum } else { 1.0 };
    }
    let mut t = tmin; while t <= tmax { if f.dd[t as usize] < 0.15 && f.dd[t as usize] <= f.dd[t as usize + 1] { best = t; break } t += 1 }
    if best < 0 { f.tf = 0.0; return }
    let (a, b, c) = (f.dd[best as usize - 1], f.dd[best as usize], f.dd[best as usize + 1]); let den = a - 2.0 * b + c;
    let sh = if den != 0.0 { 0.5 * (a - c) / den } else { 0.0 };
    f.tf = dsr / (best as f64 + sh.clamp(-0.5, 0.5));
    // a harmony in the key: the heard note's place in the scale, moved by the asked number of scale steps
    let h = fxr(p[27] as f64) as i64;
    if h != 0 {
        let root = fxr(p[30] as f64) as i64; let mut mask = fxr(p[31] as f64) as i64; if mask == 0 { mask = 2741 }
        let mm = 69.0 + 12.0 * log2d(f.tf / 440.0); let n = fxr(mm) as i64;
        let mut sc = [0i64; 12]; let mut l = 0usize; for k in 0..12 { if mask & (1 << k) != 0 { sc[l] = k; l += 1 } }
        let pc = ((n - root) % 12 + 12) % 12; let mut k = l - 1; for j in 0..l { if sc[j] <= pc { k = j } }
        let li = l as i64; let kt = k as i64 + h; let o = floord(kt as f64 / li as f64) as i64;
        f.hs = (sc[(((kt % li) + li) % li) as usize] + 12 * o - sc[k]) as f64;
    }
}
// a voice shifted by r (a ratio) from the pitch ring: two taps sweeping a 40 ms window, crossfaded
#[inline(always)]
fn fx_shift(f: &mut Fx, i: usize, r: f64, w: f64) -> f64 {
    let mut ph = f.ps[i] + (1.0 - r) / w; ph -= floord(ph); f.ps[i] = ph;
    let mut p2 = ph + 0.5; p2 -= floord(p2);
    let pr = st!(FX_PRB); let m = (FX_PR - 1) as i64;
    let a = fx_read(pr, m, f.prw, ph * w + 1.0); let b = fx_read(pr, m, f.prw, p2 * w + 1.0);
    a * (1.0 - (2.0 * ph - 1.0).abs()) + b * (1.0 - (2.0 * p2 - 1.0).abs())
}
#[unsafe(no_mangle)]
pub extern "C" fn fx_process(n: u32, c0: f64, cps: f64) {
    let f = fx(); let p = st!(FP); let sr = f.sr;
    let pv = |i: usize| p[i] as f64;
    let ka1 = 1.0 - expp(-1.0 / (0.001 * sr)); let kr80 = 1.0 - expp(-1.0 / (0.08 * sr)); let grel = expp(-1.0 / (0.05 * sr)); let kd = 1.0 - expp(-1.0 / (0.01 * sr));
    let ka3 = 1.0 - expp(-1.0 / (0.003 * sr)); let kr120 = 1.0 - expp(-1.0 / (0.12 * sr)); let ka2 = 1.0 - expp(-1.0 / (0.002 * sr)); let kr60 = 1.0 - expp(-1.0 / (0.06 * sr));
    let gate = pv(0) < 0.0; let thr = fxdb(pv(0));
    let ca = pv(1); let cthr = -10.0 - 30.0 * ca; let crat = 1.0 + 7.0 * ca; let cmk = -cthr * (1.0 - 1.0 / crat) * 0.5;
    let w = fxr(0.04 * sr).min((FX_PR - 8) as f64);
    let r0 = exp2p(pv(24) / 12.0); let r1 = 0.5; let track = pv(27) != 0.0 || pv(32) > 0.0;
    let drive = pv(4); let at = fxr(pv(5)).clamp(0.0, 3.0) as usize;
    let gk = [4.0, 18.0, 60.0, 160.0][at]; let g_ = 1.0 + drive * gk; let dgain = [1.0, 0.9, 0.6, 0.4][at] * exp2p(-[0.85, 0.75, 0.6, 0.45][at] * log2d(g_));
    let hpk = 1.0 - expp(-TAU_D * [20.0, 90.0, 150.0, 40.0][at] / sr);
    let tone = pv(6) != 0.0 || pv(7) != 0.0 || pv(8) != 0.0; let cab = pv(9) > 0.5 || (pv(9) < 0.0 && drive > 0.0);
    if drive > 0.0 { fx_biq(&mut f.bq[0], 0, 0.11 * 4.0 * sr, 0.54, 0.0, 4.0 * sr); fx_biq(&mut f.bq[1], 0, 0.11 * 4.0 * sr, 1.31, 0.0, 4.0 * sr); }
    if tone { fx_biq(&mut f.bq[2], 3, 120.0, 0.707, pv(6), sr); fx_biq(&mut f.bq[3], 2, 750.0, 0.8, pv(7), sr); fx_biq(&mut f.bq[4], 4, 3200.0, 0.707, pv(8), sr); }
    if cab { fx_biq(&mut f.bq[5], 1, 80.0, 0.707, 0.0, sr); fx_biq(&mut f.bq[6], 2, 2000.0, 1.0, 4.0, sr); fx_biq(&mut f.bq[7], 0, 5000.0, 0.9, 0.0, sr); fx_biq(&mut f.bq[8], 0, 6500.0, 0.6, 0.0, sr); }
    let dc = if cps > 0.0 { cps } else { 0.5 }; let dtt = (pv(19) / dc * sr).min((f.dl - 8) as f64).max(1.0);
    let dfb = pv(20).clamp(0.0, 0.95); let dmode = fxr(pv(21)) as i64;
    let dlk = 1.0 - expp(-TAU_D * (if dmode == 2 { 2800.0 } else { 7000.0 }) / sr);
    if f.dt < 0.0 { f.dt = dtt }
    if pv(22) > 0.0 && pv(23) != f.rsize {
        f.rsize = pv(23); let rt = 0.5 + 4.5 * pv(23);
        for i in 0..8 { f.rlen[i] = ((f.rl - 2) as f64).min(fxr(FX_FDN[i] * (0.35 + 0.65 * pv(23)) * sr / 1000.0)) as i64; f.rg[i] = exp2p(-3.0 * f.rlen[i] as f64 / (rt * sr) * LOG2_10); }
    }
    let rdk = 1.0 - expp(-TAU_D * 4500.0 / sr); let ap1 = fxr(142.0 * sr / 48000.0) as i64; let ap2 = fxr(379.0 * sr / 48000.0) as i64;
    let lvl = fxdb(pv(29)); let dcb = cps / sr;
    let dsub = 1.0f64.max(fxr(sr / 12000.0)) as i64;
    let big = !unsafe { FX_BIG.is_null() };
    let (dl, rl) = (f.dl, f.rl);
    let mut cb = c0;
    let inp = st!(FX_IN); let ol = st!(FX_OL); let or_ = st!(FX_OR);
    for k in 0..n as usize {
        let mut x = inp[k] as f64;
        // gate: opens above the threshold, closes 6 dB under it
        if gate {
            let ax = x.abs(); f.genv = if ax > f.genv { ax } else { f.genv * grel };
            if f.genv > thr { f.gopen = true } else if f.genv < thr * 0.5 { f.gopen = false }
            let tg = if f.gopen { 1.0 } else { 0.0 }; f.gg += (tg - f.gg) * (if tg > f.gg { ka1 } else { kr80 }); x *= f.gg;
        }
        // compressor: an RMS detector, the gain worked out in dB, half the reduction given back
        if ca > 0.0 {
            f.ce += (x * x - f.ce) * kd;
            let lev = 3.010_299_956_639_811_6 * log2d(f.ce + 1e-12); let gr = if lev > cthr { (cthr - lev) * (1.0 - 1.0 / crat) } else { 0.0 };
            f.cg += (gr - f.cg) * (if gr < f.cg { ka3 } else { kr120 }); x *= fxdb(f.cg + cmk);
        }
        // pitch voices, from a ring of what came in
        st!(FX_PRB)[(f.prw & (FX_PR as i64 - 1)) as usize] = x as f32; f.prw += 1;
        if track {
            f.dacc += x; f.dn += 1;
            if f.dn >= dsub { st!(FX_TBB)[(f.tbw & (FX_TB as i64 - 1)) as usize] = (f.dacc / f.dn as f64) as f32; f.tbw += 1; f.dacc = 0.0; f.dn = 0; f.tk += 1; if f.tk >= 64 { f.tk = 0; fx_track(f, p); } }
        }
        let mut s = x;
        if pv(25) > 0.0 { s += fx_shift(f, 0, r0, w) * pv(25); }
        if pv(26) > 0.0 { s += fx_shift(f, 1, r1, w) * pv(26); }
        if pv(27) != 0.0 && pv(28) > 0.0 { let r2 = exp2p(f.hs / 12.0); s += fx_shift(f, 2, r2, w) * pv(28); }
        // wah: a band-pass swept by how loud it is, or by the song's beat
        if pv(2) > 0.0 {
            let ctl;
            if pv(3) > 0.0 { let ph = cb / pv(3); ctl = 0.5 - 0.5 * sinp(TAU_D * (ph - floord(ph)) + PI_D / 2.0); }
            else { let a_ = s.abs(); f.we += (a_ - f.we) * (if a_ > f.we { ka2 } else { kr60 }); ctl = (f.we * 8.0).min(1.0); }
            let g = tanp(PI_D * 350.0 * exp2p(2.6 * ctl) / sr); let kk = 0.25; let a1 = 1.0 / (1.0 + g * (g + kk)); let a2 = g * a1; let a3 = g * a2;
            let v3 = s - f.ws[1]; let v1 = a1 * f.ws[0] + a2 * v3; let v2 = f.ws[1] + a2 * f.ws[0] + a3 * v3;
            f.ws[0] = 2.0 * v1 - f.ws[0]; f.ws[1] = 2.0 * v2 - f.ws[1];
            s += (v1 * 1.8 - s) * pv(2);
        }
        // drive: four times the rate through the curve, so the overtones it makes do not fold back down
        if drive > 0.0 {
            f.hp += (s - f.hp) * hpk; let xin = s - f.hp;
            let mut y = 0.0;
            for j in 1..=4 {
                let v = (f.xp + (xin - f.xp) * j as f64 / 4.0) * g_;
                let sh = match at { 0 => thd(v), 1 => thd(v + 0.3) - thd(0.3), 2 => thd(1.5 * thd(v)), _ => v.clamp(-1.0, 1.0) };
                let u = fx_bq(&mut f.bq[0], sh); y = fx_bq(&mut f.bq[1], u);
            }
            f.xp = xin; s = y * dgain;
        }
        if tone { let a = fx_bq(&mut f.bq[2], s); let b = fx_bq(&mut f.bq[3], a); s = fx_bq(&mut f.bq[4], b); }
        if cab { let a = fx_bq(&mut f.bq[5], s); let b = fx_bq(&mut f.bq[6], a); let c = fx_bq(&mut f.bq[7], b); s = fx_bq(&mut f.bq[8], c); }
        let (mut l, mut r) = (s, s);
        // chorus: two voices 6 to 18 ms behind, swaying in opposite directions
        if pv(10) > 0.0 {
            st!(FX_CL)[(f.cw & 4095) as usize] = l as f32; st!(FX_CR)[(f.cw & 4095) as usize] = r as f32; f.cw += 1;
            let per = if pv(11) != 0.0 { pv(11) } else { 2.0 }; let ph = cb / per; let u = TAU_D * (ph - floord(ph));
            let dl_ = (0.012 + 0.006 * sinp(u)) * sr; let dr_ = (0.012 + 0.006 * sinp(u + PI_D)) * sr;
            let wl = fx_read(st!(FX_CL), 4095, f.cw, dl_); let wr = fx_read(st!(FX_CR), 4095, f.cw, dr_); let m = pv(10);
            l = l * (1.0 - 0.3 * m) + wl * 0.7 * m; r = r * (1.0 - 0.3 * m) + wr * 0.7 * m;
        }
        // flanger: a short delay with feedback, swept from under a millisecond to about five
        if pv(12) > 0.0 {
            let per = if pv(13) != 0.0 { pv(13) } else { 4.0 }; let ph = cb / per; let u = TAU_D * (ph - floord(ph));
            let d = (0.0006 + 0.004 * (0.5 - 0.5 * sinp(u + PI_D / 2.0))) * sr;
            let wl = fx_read(st!(FX_FL), 2047, f.fw, d); let wr = fx_read(st!(FX_FR), 2047, f.fw, d * 1.07);
            st!(FX_FL)[(f.fw & 2047) as usize] = (l + wl * 0.6) as f32; st!(FX_FR)[(f.fw & 2047) as usize] = (r + wr * 0.6) as f32; f.fw += 1;
            let m = pv(12); l = (l + wl * m) / (1.0 + 0.5 * m); r = (r + wr * m) / (1.0 + 0.5 * m);
        }
        // phaser: six all-passes swept between 300 Hz and 2 kHz, a quarter turn apart on each side
        if pv(14) > 0.0 {
            let per = if pv(15) != 0.0 { pv(15) } else { 2.0 }; let ph = cb / per; let u = TAU_D * (ph - floord(ph)); let m = pv(14);
            for side in 0..2 {
                let ctl = 0.5 - 0.5 * sinp(u + (if side == 1 { PI_D } else { PI_D / 2.0 })); let t = tanp(PI_D * 300.0 * exp2p(2.7 * ctl) / sr); let a = (t - 1.0) / (t + 1.0);
                let mut v = (if side == 1 { r } else { l }) + 0.5 * (if side == 1 { f.pfr } else { f.pfl });
                let st_ = if side == 1 { &mut f.phr } else { &mut f.phl };
                for j in 0..6 { let y = a * v + st_[j]; st_[j] = v - a * y; v = y; }
                if side == 1 { f.pfr = v; r = (r * (1.0 - 0.5 * m) + v * 0.5 * m) * (1.0 + 0.35 * m); } else { f.pfl = v; l = (l * (1.0 - 0.5 * m) + v * 0.5 * m) * (1.0 + 0.35 * m); }
            }
        }
        // tremolo, on the beat
        if pv(16) > 0.0 { let per = if pv(17) != 0.0 { pv(17) } else { 0.125 }; let ph = cb / per; let g = 1.0 - pv(16) * (0.5 - 0.5 * sinp(TAU_D * (ph - floord(ph)) + PI_D / 2.0)); l *= g; r *= g; }
        // delay: the time in bars of the song; a tempo change slides the time over about a tenth of a second
        if pv(18) > 0.0 && big {
            f.dt += (dtt - f.dt) * 0.0002;
            let m = (dl - 1) as i64; let (bl, br) = (fx_big(0, dl), fx_big(dl, dl));
            let wl = fx_read(bl, m, f.dw, f.dt); let wr = fx_read(br, m, f.dw, f.dt);
            f.lpl += (wl - f.lpl) * dlk; f.lpr += (wr - f.lpr) * dlk;
            let (mut fl, mut fr) = (f.lpl, f.lpr); if dmode == 2 { fl = thd(fl * 1.2) / 1.2; fr = thd(fr * 1.2) / 1.2; }
            let wi = (f.dw & m) as usize;
            if dmode == 1 { bl[wi] = ((l + r) * 0.5 + fr * dfb) as f32; br[wi] = (fl * dfb) as f32; }
            else { bl[wi] = (l + fl * dfb) as f32; br[wi] = (r + fr * dfb) as f32; }
            f.dw += 1; l += wl * pv(18); r += wr * pv(18);
        } else { f.dt = dtt }
        // reverb: two all-passes to smear the attack, then eight delay lines mixed back into each other
        if pv(22) > 0.0 && big {
            let mut v = (l + r) * 0.15;
            for q in 0..2 { let b = &mut st!(FX_AP)[q]; let ln = if q == 1 { ap2 } else { ap1 }; let y = b[((f.apw - ln) & 1023) as usize] as f64; let u = v + 0.6 * y; b[(f.apw & 1023) as usize] = u as f32; v = y - 0.6 * u; }
            f.apw += 1;
            let mk = (rl - 1) as i64; let mut sum = 0.0;
            for i in 0..8 { let line = fx_big(2 * dl + i * rl, rl); let y = line[((f.rw - f.rlen[i]) & mk) as usize] as f64; f.rz[i] += (y - f.rz[i]) * rdk; sum += f.rz[i]; }
            for i in 0..8 { let line = fx_big(2 * dl + i * rl, rl); line[(f.rw & mk) as usize] = (v + (f.rz[i] - 0.25 * sum) * f.rg[i]) as f32; }
            f.rw += 1;
            let z = &f.rz; l += (z[0] + z[2] + z[4] + z[6]) * 0.6 * pv(22); r += (z[1] + z[3] + z[5] + z[7]) * 0.6 * pv(22);
        }
        ol[k] = (l * lvl) as f32; or_[k] = (r * lvl) as f32;
        cb += dcb;
    }
}
