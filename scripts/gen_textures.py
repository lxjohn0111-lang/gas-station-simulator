#!/usr/bin/env python3
"""Procedural PBR texture generator for Last Chance Gas.

Generates tileable albedo / normal / roughness maps with numpy + Pillow and
writes them to public/assets/tex. Everything is generated from noise, so there
are no third-party texture licenses involved.

    python3 scripts/gen_textures.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'tex')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1337)


# ----------------------------------------------------------------- helpers
def smooth_noise(n, cells, seed=None):
    """Tileable smooth value noise of size n x n with `cells` lattice cells."""
    r = np.random.default_rng(seed) if seed is not None else rng
    g = r.random((cells, cells)).astype(np.float32)
    big = np.tile(g, (3, 3))
    img = Image.fromarray(big).resize((n * 3, n * 3), Image.BICUBIC)
    a = np.asarray(img, dtype=np.float32)[n:2 * n, n:2 * n]
    return a


def fbm(n, base=4, octaves=6, gain=0.5, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    total = np.zeros((n, n), np.float32)
    amp, norm = 1.0, 0.0
    cells = base
    for _ in range(octaves):
        if cells >= n:
            layer = r.random((n, n)).astype(np.float32)
        else:
            layer = smooth_noise(n, cells, r.integers(1 << 30))
        total += layer * amp
        norm += amp
        amp *= gain
        cells *= 2
    return total / norm


def norm01(a):
    a = a - a.min()
    m = a.max()
    return a / m if m > 0 else a


def blur(a, radius):
    """Wrap-around gaussian blur via FFT (keeps textures tileable)."""
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    sigma = max(radius, 1e-3)
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)


def normal_from_height(h, strength=4.0):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy * strength  # OpenGL convention (green up)
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / l, ny / l, nz / l], -1)
    return ((rgb * 0.5 + 0.5) * 255).astype(np.uint8)


def save_rgb(name, arr, q=88):
    arr = np.clip(arr, 0, 1)
    img = Image.fromarray((arr * 255).astype(np.uint8))
    img.save(os.path.join(OUT, name), quality=q, optimize=True)
    print('wrote', name)


def save_gray(name, arr, q=88):
    arr = np.clip(arr, 0, 1)
    Image.fromarray((arr * 255).astype(np.uint8), 'L').save(os.path.join(OUT, name), quality=q, optimize=True)
    print('wrote', name)


def save_normal(name, h, strength, q=90):
    Image.fromarray(normal_from_height(h, strength)).save(os.path.join(OUT, name), quality=q, optimize=True)
    print('wrote', name)


def colorize(t, c0, c1):
    c0 = np.array(c0, np.float32) / 255.0
    c1 = np.array(c1, np.float32) / 255.0
    return c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]


def speckles(n, density, size_px=1, seed=None):
    r = np.random.default_rng(seed)
    m = (r.random((n, n)) < density).astype(np.float32)
    if size_px > 1:
        m = blur(m, size_px * 0.5)
        m = np.clip(m * 4, 0, 1)
    return m


def cracks(n, count, seed=None, width=1.6):
    """Random-walk crack lines, returns mask 0..1 (tileable via wrap drawing)."""
    r = np.random.default_rng(seed)
    img = Image.new('L', (n * 3, n * 3), 0)
    d = ImageDraw.Draw(img)
    for _ in range(count):
        x, y = r.random() * n + n, r.random() * n + n
        ang = r.random() * np.pi * 2
        steps = int(r.integers(20, 70))
        w = width * (0.6 + r.random())
        for _ in range(steps):
            ang += (r.random() - 0.5) * 0.9
            nx, ny = x + np.cos(ang) * 6, y + np.sin(ang) * 6
            for ox in (-n, 0, n):
                for oy in (-n, 0, n):
                    d.line([(x + ox, y + oy), (nx + ox, ny + oy)], fill=255, width=max(1, int(w)))
            x, y = nx, ny
            if r.random() < 0.05:  # branch
                ang += (r.random() - 0.5) * 2.5
    a = np.asarray(img, np.float32)[n:2 * n, n:2 * n] / 255.0
    return a


N = 1024

# ----------------------------------------------------------------- ASPHALT
def gen_asphalt():
    base = fbm(N, 8, 7, 0.55, 1)
    macro = fbm(N, 2, 3, 0.5, 2)
    aggregate = speckles(N, 0.035, 1, 3) * 0.5 + speckles(N, 0.01, 2, 4) * 0.6
    light_stones = speckles(N, 0.012, 1, 5)
    cr = cracks(N, 9, 6, 1.3)
    cr = blur(cr, 0.6)
    tone = 0.20 + base * 0.10 + macro * 0.08
    tone = tone - aggregate * 0.06 + light_stones * 0.18
    tone = tone * (1 - cr * 0.55)
    # tar patches (sealed cracks)
    patches = np.clip((fbm(N, 6, 4, 0.5, 7) - 0.62) * 6, 0, 1)
    tone = tone * (1 - patches * 0.35)
    col = np.stack([tone * 1.02, tone * 1.0, tone * 0.97], -1)
    save_rgb('asphalt_c.jpg', col)
    h = base * 0.4 + aggregate * 0.6 + light_stones * 0.4 - cr * 1.2
    save_normal('asphalt_n.jpg', h, 3.2)
    rough = 0.82 + base * 0.12 - patches * 0.25 - light_stones * 0.1
    save_gray('asphalt_r.jpg', rough)


# ----------------------------------------------------------------- CONCRETE
def gen_concrete():
    base = fbm(N, 6, 7, 0.55, 11)
    stains = np.clip((fbm(N, 3, 5, 0.6, 12) - 0.5) * 2.5, 0, 1)
    pores = speckles(N, 0.02, 1, 13)
    cr = blur(cracks(N, 4, 14, 1.0), 0.5)
    # expansion joints: texture covers 4m, joint every 2m
    joints = np.zeros((N, N), np.float32)
    for p in (0, N // 2):
        joints[:, max(p - 2, 0):p + 3] = 1
        joints[max(p - 2, 0):p + 3, :] = 1
    joints = np.roll(np.roll(joints, 2, 0), 2, 1)
    joints = blur(joints, 1.2)
    tone = 0.55 + base * 0.14 - stains * 0.12 - pores * 0.08
    tone = tone * (1 - joints * 0.45) * (1 - cr * 0.4)
    col = np.stack([tone * 1.0, tone * 0.985, tone * 0.955], -1)
    save_rgb('concrete_c.jpg', col)
    h = base * 0.3 - pores * 0.5 - joints * 1.5 - cr * 0.8
    save_normal('concrete_n.jpg', h, 2.5)
    save_gray('concrete_r.jpg', 0.78 + base * 0.15 - stains * 0.2)


# ----------------------------------------------------------------- SAND / DESERT GROUND
def gen_sand():
    base = fbm(N, 4, 7, 0.55, 21)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
    warp = fbm(N, 3, 4, 0.5, 22)
    ripples = np.sin((yy * 22 + warp * 6 + xx * 3) * np.pi * 2) * 0.5 + 0.5
    pebbles = speckles(N, 0.006, 2, 23)
    small = speckles(N, 0.05, 1, 24)
    dark = np.clip((fbm(N, 5, 4, 0.5, 25) - 0.55) * 3, 0, 1)
    t = np.clip(base * 0.7 + ripples * 0.12 + small * 0.08, 0, 1)
    col = colorize(t, (168, 120, 78), (222, 178, 128))
    col = col * (1 - dark[..., None] * 0.18)
    col = col * (1 - pebbles[..., None] * 0.35) + pebbles[..., None] * np.array([0.42, 0.33, 0.27])[None, None, :] * 0.35
    save_rgb('sand_c.jpg', col)
    h = ripples * 0.6 + base * 0.6 + pebbles * 1.2 + small * 0.2
    save_normal('sand_n.jpg', h, 2.2)


# ----------------------------------------------------------------- DRY CRACKED DIRT (shoulders)
def gen_dirt():
    base = fbm(N, 6, 7, 0.55, 31)
    cr = blur(cracks(N, 26, 32, 1.4), 0.7)
    stones = speckles(N, 0.01, 2, 33)
    t = np.clip(base * 0.8 + 0.15, 0, 1)
    col = colorize(t, (128, 96, 70), (186, 150, 112))
    col = col * (1 - cr[..., None] * 0.5)
    col = col * (1 - stones[..., None] * 0.25)
    save_rgb('dirt_c.jpg', col)
    save_normal('dirt_n.jpg', base * 0.5 - cr * 1.4 + stones, 2.8)


# ----------------------------------------------------------------- SHOP FLOOR TILES (vinyl, checker)
def gen_tiles():
    n = N
    tiles = 4  # texture covers 4 tiles x 4 tiles
    s = n // tiles
    base = fbm(n, 8, 5, 0.5, 41)
    col = np.zeros((n, n, 3), np.float32)
    rnd = np.random.default_rng(42)
    for i in range(tiles):
        for j in range(tiles):
            light = (i + j) % 2 == 0
            c = np.array([0.86, 0.85, 0.82]) if light else np.array([0.30, 0.31, 0.33])
            c = c * (0.96 + rnd.random() * 0.06)
            col[i * s:(i + 1) * s, j * s:(j + 1) * s] = c
    flecks = speckles(n, 0.03, 1, 43)
    col = col * (0.95 + base[..., None] * 0.08) - flecks[..., None] * 0.05
    grout = np.zeros((n, n), np.float32)
    for k in range(tiles + 1):
        p = min(k * s, n - 1)
        grout[:, max(p - 2, 0):p + 2] = 1
        grout[max(p - 2, 0):p + 2, :] = 1
    grout = blur(grout, 0.8)
    col = col * (1 - grout[..., None] * 0.6) + grout[..., None] * 0.12
    scuffs = np.clip((fbm(n, 12, 4, 0.6, 44) - 0.6) * 4, 0, 1)
    col = col * (1 - scuffs[..., None] * 0.12)
    save_rgb('tiles_c.jpg', col)
    save_normal('tiles_n.jpg', -grout * 1.0 + base * 0.05, 3.0)
    save_gray('tiles_r.jpg', 0.28 + scuffs * 0.35 + grout * 0.5 + base * 0.08)


# ----------------------------------------------------------------- STUCCO WALL
def gen_stucco():
    base = fbm(N, 16, 7, 0.6, 51)
    blobs = fbm(N, 32, 4, 0.7, 52)
    grime = np.clip((fbm(N, 2, 5, 0.6, 53) - 0.45) * 2, 0, 1)
    yy = np.mgrid[0:N, 0:N][0].astype(np.float32) / N
    streaks = np.clip(fbm(N, 64, 3, 0.5, 54) * (yy ** 2) * 1.5 - 0.3, 0, 1)
    tone = 0.80 + base * 0.10 - grime * 0.10 - streaks * 0.15
    col = np.stack([tone * 1.0, tone * 0.93, tone * 0.82], -1)
    save_rgb('stucco_c.jpg', col)
    save_normal('stucco_n.jpg', base * 0.7 + blobs * 0.5, 4.0)


# ----------------------------------------------------------------- PAINTED / SCRATCHED METAL roughness
def gen_metal():
    base = fbm(N, 8, 6, 0.5, 61)
    scratches = np.zeros((N, N), np.float32)
    img = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(62)
    for _ in range(500):
        x, y = r.random() * N, r.random() * N
        a = r.random() * np.pi
        l = r.random() * 60 + 10
        d.line([(x, y), (x + np.cos(a) * l, y + np.sin(a) * l)], fill=int(80 + r.random() * 170), width=1)
    scratches = np.asarray(img, np.float32) / 255.0
    grime = np.clip((fbm(N, 3, 5, 0.6, 63) - 0.5) * 2, 0, 1)
    save_gray('metal_r.jpg', 0.35 + base * 0.2 + grime * 0.3 - scratches * 0.2)
    save_gray('grime.jpg', np.clip(grime * 0.8 + base * 0.3, 0, 1))
    save_normal('metal_n.jpg', base * 0.2 - scratches * 0.4, 1.5)


# ----------------------------------------------------------------- CORRUGATED METAL
def gen_corrugated():
    n = 512
    xx = np.mgrid[0:n, 0:n][1].astype(np.float32) / n
    h = np.sin(xx * np.pi * 2 * 8) * 0.5 + 0.5
    rust = np.clip((fbm(n, 4, 6, 0.55, 71) - 0.5) * 3, 0, 1)
    save_normal('corrugated_n.jpg', h * 6 + fbm(n, 16, 4, 0.5, 72) * 0.3, 2.0)
    col = colorize(rust, (170, 175, 178), (122, 70, 40))
    save_rgb('corrugated_c.jpg', col)


# ----------------------------------------------------------------- WOOD (pallets, shelves trims)
def gen_wood():
    n = 512
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    warp = fbm(n, 4, 5, 0.5, 81)
    grain = np.sin((xx * 40 + warp * 6) * np.pi) * 0.5 + 0.5
    fine = fbm(n, 64, 3, 0.5, 82)
    t = np.clip(grain * 0.5 + fine * 0.4, 0, 1)
    col = colorize(t, (120, 82, 50), (190, 145, 98))
    planks = np.zeros((n, n), np.float32)
    for k in range(0, n, n // 4):
        planks[k:k + 3, :] = 1
    col = col * (1 - planks[..., None] * 0.6)
    save_rgb('wood_c.jpg', col)
    save_normal('wood_n.jpg', grain * 0.3 + fine * 0.3 - planks, 2.0)


# ----------------------------------------------------------------- CEILING TILES
def gen_ceiling():
    n = 512
    base = fbm(n, 32, 4, 0.6, 91)
    holes = speckles(n, 0.05, 1, 92)
    grid = np.zeros((n, n), np.float32)
    for p in (0, n // 2):
        grid[:, max(p - 3, 0):p + 3] = 1
        grid[max(p - 3, 0):p + 3, :] = 1
    grid = blur(grid, 0.6)
    tone = 0.88 + base * 0.06 - holes * 0.12
    tone = tone * (1 - grid * 0.12)
    col = np.stack([tone, tone * 0.99, tone * 0.96], -1)
    save_rgb('ceiling_c.jpg', col)
    save_normal('ceiling_n.jpg', base * 0.2 - holes * 0.6 - grid * 1.2, 2.0)


# ----------------------------------------------------------------- ROCK (mesas, boulders)
def gen_rock():
    base = fbm(N, 4, 8, 0.58, 101)
    yy = np.mgrid[0:N, 0:N][0].astype(np.float32) / N
    warp = fbm(N, 3, 4, 0.5, 102)
    strata = np.sin((yy * 14 + warp * 2.5) * np.pi * 2) * 0.5 + 0.5
    cr = blur(cracks(N, 18, 103, 1.6), 0.8)
    t = np.clip(strata * 0.45 + base * 0.6, 0, 1)
    col = colorize(t, (120, 62, 40), (205, 140, 98))
    col = col * (1 - cr[..., None] * 0.45)
    save_rgb('rock_c.jpg', col)
    save_normal('rock_n.jpg', base * 1.2 + strata * 0.4 - cr * 1.3, 4.0)


# ----------------------------------------------------------------- TIRE TREAD normal
def gen_tread():
    n = 256
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    blocks = ((np.floor(yy * 16) % 2) == 0) ^ ((np.floor(xx * 4 + np.floor(yy * 16) * 0.5) % 2) == 0)
    h = blocks.astype(np.float32)
    grooves = (np.abs(xx - 0.5) < 0.03).astype(np.float32) + (np.abs(xx - 0.2) < 0.02) + (np.abs(xx - 0.8) < 0.02)
    h = h * 0.5 - grooves
    save_normal('tread_n.jpg', blur(h, 0.8), 3.0)


# ----------------------------------------------------------------- DECALS with alpha
def save_rgba(name, rgb, a):
    arr = np.concatenate([np.clip(rgb, 0, 1), np.clip(a, 0, 1)[..., None]], -1)
    Image.fromarray((arr * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, name), optimize=True)
    print('wrote', name)


def radial(n):
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n - 0.5
    return np.sqrt(xx * xx + yy * yy) * 2


def gen_decals():
    n = 256
    r = radial(n)
    # oil stain
    noise = fbm(n, 4, 5, 0.6, 111)
    a = np.clip((1 - r) * 1.6 + (noise - 0.5) * 1.6 - 0.2, 0, 1)
    a = a ** 1.4 * 0.95
    rgb = np.stack([0.03 + noise * 0.02, 0.03 + noise * 0.02, 0.035 + noise * 0.03], -1)
    save_rgba('oil.png', rgb, a)
    # generic stain/dirt
    noise2 = fbm(n, 6, 5, 0.6, 112)
    a2 = np.clip((1 - r) * 1.3 + (noise2 - 0.5) * 2 - 0.4, 0, 1) * 0.7
    save_rgba('stain.png', np.stack([noise2 * 0 + 0.18, noise2 * 0 + 0.14, noise2 * 0 + 0.10], -1), a2)
    # tire skid (long)
    yy, xx = np.mgrid[0:64, 0:256].astype(np.float32)
    n2 = fbm(256, 16, 4, 0.5, 113)[:64, :]
    band = np.exp(-((yy - 32) / 14) ** 2)
    fade = np.clip(np.minimum(xx, 255 - xx) / 40, 0, 1)
    a3 = band * fade * (0.5 + n2 * 0.5) * 0.8
    save_rgba('skid.png', np.zeros((64, 256, 3)) + 0.04, a3)
    # soft blob shadow
    a4 = np.clip(1 - r, 0, 1) ** 2
    save_rgba('blob.png', np.zeros((n, n, 3)), a4)
    # puddle normal-ish mask (for spill)
    a5 = np.clip((1 - r) * 2.0 + (noise - 0.5) * 2.2 - 0.8, 0, 1)
    save_rgba('spill.png', np.stack([noise * 0 + 0.02, noise * 0 + 0.02, noise * 0 + 0.02], -1), a5)


def gen_sky_noise():
    """Cloud noise for the sky dome (tileable)."""
    n = 512
    c = fbm(n, 4, 7, 0.55, 121)
    save_gray('clouds.jpg', norm01(c), 90)


if __name__ == '__main__':
    gen_asphalt()
    gen_concrete()
    gen_sand()
    gen_dirt()
    gen_tiles()
    gen_stucco()
    gen_metal()
    gen_corrugated()
    gen_wood()
    gen_ceiling()
    gen_rock()
    gen_tread()
    gen_decals()
    gen_sky_noise()
