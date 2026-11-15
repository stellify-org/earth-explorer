package cache

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

func TestStaleIfError(t *testing.T) {
	dir := t.TempDir()
	c := New(10, 50*time.Millisecond, dir)
	ctx := context.Background()
	v, o, err := c.Load(ctx, "k", func(context.Context) ([]byte, error) { return []byte("v1"), nil })
	if err != nil || string(v) != "v1" || o != Fresh {
		t.Fatalf("first load: %s %v %v", v, o, err)
	}
	if _, o, _ := c.Load(ctx, "k", nil); o != Cached {
		t.Fatalf("expected cached, got %v", o)
	}
	time.Sleep(80 * time.Millisecond) // expire
	fail := func(context.Context) ([]byte, error) { return nil, errors.New("upstream down") }
	v, o, err = c.Load(ctx, "k", fail)
	if err != nil || string(v) != "v1" || o != Stale {
		t.Fatalf("expected stale v1, got %s %v %v", v, o, err)
	}
	// A key never loaded still reports the error.
	if _, _, err := c.Load(ctx, "other", fail); err == nil {
		t.Fatal("expected error")
	}
	// Survives a restart (new cache on the same directory).
	c2 := New(10, time.Hour, dir)
	if v, o, _ := c2.Load(ctx, "k", fail); string(v) != "v1" || o != Cached {
		// The file is older than 50 ms but younger than 1 h, so it is a normal hit.
		t.Fatalf("restart: %s %v", v, o)
	}
	_ = os.RemoveAll(dir)
}
