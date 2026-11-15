package fetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"
)

type UpstreamError struct {
	Service string
	Status  int
	Body    string
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("%s upstream returned HTTP %d: %s", e.Service, e.Status, e.Body)
}

type Client struct {
	HTTP       *http.Client
	Service    string
	MaxRetries int
	BaseDelay  time.Duration
	MaxBody    int64
	UserAgent  string
	Log        *slog.Logger

	semOnce sync.Once
	sem     chan struct{}

	mu      sync.Mutex
	lastOK  time.Time
	lastErr time.Time
	lastMsg string
}

func (c *Client) Status() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	m := map[string]any{}
	if !c.lastOK.IsZero() {
		m["last_ok"] = c.lastOK.UTC().Format(time.RFC3339)
	}
	if !c.lastErr.IsZero() {
		m["last_error"] = c.lastErr.UTC().Format(time.RFC3339)
		m["last_error_message"] = c.lastMsg
	}
	m["reachable"] = !c.lastOK.IsZero() && !c.lastOK.Before(c.lastErr)
	if c.lastOK.IsZero() && c.lastErr.IsZero() {
		m["reachable"] = nil
	}
	return m
}

func (c *Client) record(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err == nil {
		c.lastOK = time.Now()
	} else {
		c.lastErr, c.lastMsg = time.Now(), err.Error()
	}
}

func New(service string, timeout time.Duration, log *slog.Logger) *Client {
	return &Client{
		HTTP:       &http.Client{Timeout: timeout},
		Service:    service,
		MaxRetries: 2,
		BaseDelay:  500 * time.Millisecond,
		MaxBody:    64 << 20,
		UserAgent:  "EarthExplorer/0.1 (research prototype; +https://github.com/)",
		Log:        log,
	}
}

func retryable(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}

func (c *Client) Do(ctx context.Context, method, url string) ([]byte, http.Header, error) {
	c.semOnce.Do(func() { c.sem = make(chan struct{}, 4) })
	select {
	case c.sem <- struct{}{}:
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	}
	defer func() { <-c.sem }()
	b, h, err := c.do(ctx, method, url)
	var ue *UpstreamError
	if err == nil || (errors.As(err, &ue) && ue.Status < 500 && ue.Status != http.StatusTooManyRequests) {
		c.record(nil)
	} else if !errors.Is(err, context.Canceled) {
		c.record(err)
	}
	return b, h, err
}

func (c *Client) do(ctx context.Context, method, url string) ([]byte, http.Header, error) {
	var lastErr error
	for attempt := 0; attempt <= c.MaxRetries; attempt++ {
		if attempt > 0 {
			d := c.BaseDelay * time.Duration(1<<(attempt-1))
			d += time.Duration(rand.Int64N(int64(d / 2)))
			select {
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			case <-time.After(d):
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, url, nil)
		if err != nil {
			return nil, nil, err
		}
		req.Header.Set("User-Agent", c.UserAgent)
		start := time.Now()
		resp, err := c.HTTP.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, nil, ctx.Err()
			}
			lastErr = fmt.Errorf("%s request failed: %w", c.Service, err)
			c.Log.Warn("upstream error", "service", c.Service, "attempt", attempt, "err", err)
			continue
		}
		body, rerr := io.ReadAll(io.LimitReader(resp.Body, c.MaxBody))
		resp.Body.Close()
		c.Log.Debug("upstream", "service", c.Service, "status", resp.StatusCode, "ms", time.Since(start).Milliseconds(), "attempt", attempt)
		if rerr != nil {
			lastErr = rerr
			continue
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return body, resp.Header, nil
		}
		snippet := string(body)
		if len(snippet) > 300 {
			snippet = snippet[:300]
		}
		ue := &UpstreamError{Service: c.Service, Status: resp.StatusCode, Body: snippet}
		if !retryable(resp.StatusCode) {
			return nil, resp.Header, ue
		}
		lastErr = ue
		c.Log.Warn("upstream retryable status", "service", c.Service, "status", resp.StatusCode, "attempt", attempt)
	}
	if lastErr == nil {
		lastErr = errors.New("unknown upstream failure")
	}
	return nil, nil, lastErr
}

func (c *Client) Get(ctx context.Context, url string) ([]byte, http.Header, error) {
	return c.Do(ctx, http.MethodGet, url)
}
