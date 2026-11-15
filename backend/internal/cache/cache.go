package cache

import (
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type entry struct {
	key     string
	val     []byte
	expires time.Time
}

type call struct {
	wg  sync.WaitGroup
	val []byte
	err error
}

type Cache struct {
	mu        sync.Mutex
	ll        *list.List
	items     map[string]*list.Element
	max       int
	ttl       time.Duration
	dir       string
	inflight  map[string]*call
	hits      uint64
	misses    uint64
	staleHits uint64
}

func New(max int, ttl time.Duration, dir string) *Cache {
	if dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	return &Cache{ll: list.New(), items: map[string]*list.Element{}, max: max, ttl: ttl, dir: dir, inflight: map[string]*call{}}
}

func (c *Cache) path(key string) string {
	h := sha256.Sum256([]byte(key))
	return filepath.Join(c.dir, hex.EncodeToString(h[:16])+".bin")
}

func (c *Cache) Get(key string) ([]byte, bool) {
	c.mu.Lock()
	if el, ok := c.items[key]; ok {
		e := el.Value.(*entry)
		if time.Now().Before(e.expires) {
			c.ll.MoveToFront(el)
			c.hits++
			c.mu.Unlock()
			return e.val, true
		}
		c.ll.Remove(el)
		delete(c.items, key)
	}
	c.mu.Unlock()
	if c.dir != "" {
		p := c.path(key)
		if st, err := os.Stat(p); err == nil && time.Since(st.ModTime()) < c.ttl {
			if b, err := os.ReadFile(p); err == nil {
				c.setMem(key, b, st.ModTime().Add(c.ttl))
				c.mu.Lock()
				c.hits++
				c.mu.Unlock()
				return b, true
			}
		}
	}
	c.mu.Lock()
	c.misses++
	c.mu.Unlock()
	return nil, false
}

func (c *Cache) setMem(key string, val []byte, exp time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		el.Value.(*entry).val, el.Value.(*entry).expires = val, exp
		c.ll.MoveToFront(el)
		return
	}
	c.items[key] = c.ll.PushFront(&entry{key: key, val: val, expires: exp})
	for c.ll.Len() > c.max {
		old := c.ll.Back()
		c.ll.Remove(old)
		delete(c.items, old.Value.(*entry).key)
	}
}

func (c *Cache) Set(key string, val []byte) {
	c.setMem(key, val, time.Now().Add(c.ttl))
	if c.dir != "" {
		p := c.path(key)
		tmp := p + ".tmp"
		if err := os.WriteFile(tmp, val, 0o644); err == nil {
			_ = os.Rename(tmp, p)
		}
	}
}

type Origin int

const (
	Fresh Origin = iota

	Cached

	Stale
)

func (c *Cache) GetOrLoad(ctx context.Context, key string, load func(context.Context) ([]byte, error)) ([]byte, bool, error) {
	v, o, err := c.Load(ctx, key, load)
	return v, o != Fresh, err
}

func (c *Cache) Load(ctx context.Context, key string, load func(context.Context) ([]byte, error)) ([]byte, Origin, error) {
	if v, ok := c.Get(key); ok {
		return v, Cached, nil
	}
	c.mu.Lock()
	if cl, ok := c.inflight[key]; ok {
		c.mu.Unlock()
		cl.wg.Wait()
		if cl.err != nil {
			if v, ok := c.stale(key); ok {
				return v, Stale, nil
			}
		}
		return cl.val, Fresh, cl.err
	}
	cl := &call{}
	cl.wg.Add(1)
	c.inflight[key] = cl
	c.mu.Unlock()

	cl.val, cl.err = load(ctx)
	if cl.err == nil {
		c.Set(key, cl.val)
	}
	c.mu.Lock()
	delete(c.inflight, key)
	c.mu.Unlock()
	cl.wg.Done()
	if cl.err != nil {
		if v, ok := c.stale(key); ok {
			c.mu.Lock()
			c.staleHits++
			c.mu.Unlock()
			return v, Stale, nil
		}
	}
	return cl.val, Fresh, cl.err
}

func (c *Cache) stale(key string) ([]byte, bool) {
	if c.dir == "" {
		return nil, false
	}
	b, err := os.ReadFile(c.path(key))
	if err != nil {
		return nil, false
	}
	return b, true
}

func (c *Cache) Stats() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	return map[string]any{"entries": c.ll.Len(), "hits": c.hits, "misses": c.misses, "stale_served": c.staleHits}
}
