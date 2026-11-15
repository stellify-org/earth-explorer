"""Minimal Mapbox Vector Tile reader (protobuf wire format), points only. No dependencies."""
def _varint(b, i):
    v = 0; s = 0
    while True:
        c = b[i]; i += 1
        v |= (c & 0x7F) << s; s += 7
        if c < 0x80: return v, i
def _fields(b):
    i = 0; n = len(b)
    while i < n:
        key, i = _varint(b, i); f, w = key >> 3, key & 7
        if w == 0: v, i = _varint(b, i)
        elif w == 2: l, i = _varint(b, i); v = b[i:i + l]; i += l
        elif w == 5: v = b[i:i + 4]; i += 4
        elif w == 1: v = b[i:i + 8]; i += 8
        else: raise ValueError("wire type %d" % w)
        yield f, w, v
def _value(b):
    import struct
    for f, w, v in _fields(b):
        if f == 1: return bytes(v).decode("utf8")
        if f == 2: return struct.unpack("<f", v)[0]
        if f == 3: return struct.unpack("<d", v)[0]
        if f in (4, 5): return v if v < 1 << 63 else v - (1 << 64)
        if f == 6: return (v >> 1) ^ -(v & 1)
        if f == 7: return bool(v)
def _packed(b):
    out = []; i = 0
    while i < len(b): v, i = _varint(b, i); out.append(v)
    return out
def decode_points(data):
    """-> {layer: {"extent": n, "features": [{"x","y" (tile units), "props": {...}}]}}"""
    out = {}
    for f, w, layer in _fields(data):
        if f != 3: continue
        name = None; keys = []; vals = []; feats = []; extent = 4096
        for lf, lw, lv in _fields(layer):
            if lf == 1: name = bytes(lv).decode()
            elif lf == 2: feats.append(lv)
            elif lf == 3: keys.append(bytes(lv).decode())
            elif lf == 4: vals.append(_value(lv))
            elif lf == 5: extent = lv
        fs = []
        for fb in feats:
            tags = []; geom = []; typ = 0
            for ff, fw, fv in _fields(fb):
                if ff == 2: tags = _packed(fv)
                elif ff == 3: typ = fv
                elif ff == 4: geom = _packed(fv)
            if typ != 1 or len(geom) < 3: continue
            zz = lambda n: (n >> 1) ^ -(n & 1)
            cnt = geom[0] >> 3; x = y = 0
            props = {keys[tags[k]]: vals[tags[k + 1]] for k in range(0, len(tags), 2)}
            for k in range(cnt):
                x += zz(geom[1 + 2 * k]); y += zz(geom[2 + 2 * k])
                fs.append({"x": x, "y": y, "props": props})
        out[name] = {"extent": extent, "features": fs}
    return out
