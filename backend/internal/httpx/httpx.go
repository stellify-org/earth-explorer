package httpx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strconv"
	"time"
)

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func Error(w http.ResponseWriter, status int, code, msg, field string) {
	JSON(w, status, map[string]APIError{"error": {Code: code, Message: msg, Field: field}})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusWriter) WriteHeader(c int) { s.status = c; s.ResponseWriter.WriteHeader(c) }
func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = 200
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

func Middleware(h http.Handler, log *slog.Logger, corsOrigin string, timeout time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		defer func() {
			if rec := recover(); rec != nil {
				log.Error("panic", "err", rec, "stack", string(debug.Stack()))
				Error(sw, http.StatusInternalServerError, "internal_error", "internal server error", "")
			}
			log.Info("http", "method", r.Method, "path", r.URL.Path, "query", r.URL.RawQuery, "status", sw.status, "bytes", sw.bytes, "ms", time.Since(start).Milliseconds())
		}()
		if corsOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		h.ServeHTTP(sw, r.WithContext(ctx))
	})
}

func Float(r *http.Request, name string, lo, hi float64) (float64, *APIError) {
	s := r.URL.Query().Get(name)
	if s == "" {
		return 0, &APIError{Code: "missing_parameter", Message: name + " is required", Field: name}
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || v != v {
		return 0, &APIError{Code: "invalid_parameter", Message: name + " must be a number", Field: name}
	}
	if v < lo || v > hi {
		return 0, &APIError{Code: "out_of_range", Message: name + " must be between " + strconv.FormatFloat(lo, 'g', -1, 64) + " and " + strconv.FormatFloat(hi, 'g', -1, 64), Field: name}
	}
	return v, nil
}

func Int(r *http.Request, name string, def, lo, hi int) (int, *APIError) {
	s := r.URL.Query().Get(name)
	if s == "" {
		return def, nil
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0, &APIError{Code: "invalid_parameter", Message: name + " must be an integer", Field: name}
	}
	if v < lo || v > hi {
		return 0, &APIError{Code: "out_of_range", Message: name + " must be between " + strconv.Itoa(lo) + " and " + strconv.Itoa(hi), Field: name}
	}
	return v, nil
}

func Fail(w http.ResponseWriter, e *APIError) {
	Error(w, http.StatusBadRequest, e.Code, e.Message, e.Field)
}
