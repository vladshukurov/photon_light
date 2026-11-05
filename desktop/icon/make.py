# Иконка Фотона: плотный круг света в середине тёмной плитки, вокруг — рассеянный свет.
# Свет считается в линейном HDR и проходит тон-кривую ACES, как в движке.
#
#   python3 desktop/icon/make.py
#
# Пересобирает иконки macOS (.icns, сквиркл на сетке 1024 с тенью), Windows (.ico)
# и лендинга. Нужны numpy и Pillow; .icns собирает iconutil из macOS.
import os, subprocess, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
LANDING = os.path.join(HERE, '..', '..', 'landing', 'assets')

N = 1648  # рендер вдвое больше плитки 824 — для чистого края круга
WALL, WALL_EDGE = '#08090c', '#020203'  # стена: к углам темнее
RADIUS = 0.40  # радиус круга в долях полуплитки
EDGE = 0.005  # мягкость края круга
INTENSITY = 3.2
CORE = (0.97, 0.985, 1)  # почти белый, чуть холодный
# Рассеяние: (сигма в долях полуплитки, вес, цвет). Узкое — у края круга,
# широкое заполняет плитку.
SCATTER = [
    (0.01, 0.4, (0.95, 0.97, 1)),
    (0.1, 0.42, (0.72, 0.8, 0.95)),
    (0.4, 0.26, (0.5, 0.58, 0.8)),
]


def linear(hex_):
    c = np.array([int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def aces(x):
    return np.clip(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)


def srgb(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.clip(x, 0, 1), 1 / 2.4) - 0.055)


def render():
    y, x = (np.mgrid[0:N, 0:N] + 0.5) / N * 2 - 1
    r = np.hypot(x, y)
    disc = np.clip((RADIUS - r) / EDGE + 0.5, 0, 1)
    # к центру плотнее: свет собран, край читается
    src = disc * (1 + 0.35 * np.clip(1 - (r / RADIUS) ** 2, 0, 1))
    t = np.clip(r / 1.414, 0, 1) ** 1.6
    img = linear(WALL) * (1 - t[..., None]) + linear(WALL_EDGE) * t[..., None]
    img += INTENSITY * src[..., None] * np.array(CORE)
    # гаусс через FFT в поле вдвое больше, чтобы свет не заворачивался с края на край
    P = 2 * N
    pad = np.zeros((P, P)); pad[:N, :N] = src
    F = np.fft.rfft2(pad)
    f2 = np.fft.rfftfreq(P)[None, :] ** 2 + np.fft.fftfreq(P)[:, None] ** 2
    for sigma, weight, tint in SCATTER:
        s = sigma * N / 2
        b = np.fft.irfft2(F * np.exp(-2 * np.pi ** 2 * s ** 2 * f2), s=(P, P))[:N, :N]
        img += INTENSITY * weight * b[..., None] * np.array(tint)
    out = srgb(aces(img)) + np.random.default_rng(1).normal(0, 0.6 / 255, img.shape)
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))


def squircle(size, n=5.0, ss=4):
    S = size * ss
    y, x = np.mgrid[0:S, 0:S].astype(np.float64)
    u = np.abs((x + 0.5) / S * 2 - 1); v = np.abs((y + 0.5) / S * 2 - 1)
    m = (u ** n + v ** n) <= 1
    return Image.fromarray((m * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)


def rounded(size, r, ss=4):
    S = size * ss
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=r * ss, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def tile(art, mask, rim_alpha):
    # тонкий светлый кант по краю плитки; поле вокруг маски — чтобы кант
    # не пропадал там, где плитка касается края картинки
    size = mask.width
    padded = Image.new('L', (size + 8, size + 8), 0); padded.paste(mask, (4, 4))
    inner = np.asarray(padded.filter(ImageFilter.MinFilter(5)))[4:-4, 4:-4] / 255
    edge = np.clip(np.asarray(mask) / 255 - inner, 0, 1) * rim_alpha
    white = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    white.putalpha(Image.fromarray((edge * 255).astype(np.uint8)))
    t = Image.alpha_composite(art.resize((size, size), Image.LANCZOS).convert('RGBA'), white)
    t.putalpha(mask)
    return t


art = render()

# macOS: плитка 824 в поле 1024, тень вниз
mask = squircle(824)
mac = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
sh = Image.new('L', (1024, 1024), 0); sh.paste(mask, (100, 112))
mac.putalpha(sh.filter(ImageFilter.GaussianBlur(14)).point(lambda p: int(p * 0.45)))
mac.alpha_composite(tile(art, mask, 0.18), (100, 100))
mac.save(os.path.join(HERE, 'icon-mac-1024.png'))
with tempfile.TemporaryDirectory() as tmp:
    iconset = os.path.join(tmp, 'Photon.iconset'); os.makedirs(iconset)
    for s in [16, 32, 128, 256, 512]:
        mac.resize((s, s), Image.LANCZOS).save(f'{iconset}/icon_{s}x{s}.png')
        mac.resize((s * 2, s * 2), Image.LANCZOS).save(f'{iconset}/icon_{s}x{s}@2x.png')
    subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(HERE, 'Photon.icns')], check=True)

# Windows: плитка почти во всё поле, скругление поменьше
win = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
win.alpha_composite(tile(art, rounded(240, 44), 0.16), (8, 8))
win.save(os.path.join(HERE, 'icon-win-256.png'))
win.save(os.path.join(HERE, 'Photon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# Лендинг: значок в шапке и favicon
mac.resize((256, 256), Image.LANCZOS).save(os.path.join(LANDING, 'icon.png'))
mac.resize((64, 64), Image.LANCZOS).save(os.path.join(LANDING, 'favicon.png'))
print('ok')
