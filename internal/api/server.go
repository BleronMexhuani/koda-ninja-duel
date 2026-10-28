// Package api is the HTTP layer: routing, auth, and JSON handlers.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/BleronMexhuani/koda-ninja-duel/internal/store"
)

// Config controls server behaviour.
type Config struct {
	SecureCookies bool // set the Secure flag on cookies (use behind HTTPS)
	TrustProxy    bool // read client IPs from X-Forwarded-For
}

// Server holds dependencies for the handlers.
type Server struct {
	st      *store.Store
	cfg     Config
	log     *slog.Logger
	authLim *limiter
	mux     *http.ServeMux
}

type ctxKey int

const playerKey ctxKey = 1

// New builds the router. static serves the web client.
func New(st *store.Store, cfg Config, static fs.FS, log *slog.Logger) *Server {
	s := &Server{st: st, cfg: cfg, log: log, authLim: newLimiter(10, 10), mux: http.NewServeMux()}
	m := s.mux

	m.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := st.DB.PingContext(ctx); err != nil {
			writeErr(w, http.StatusServiceUnavailable, "database unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	m.HandleFunc("POST /api/auth/register", s.limited(s.register))
	m.HandleFunc("POST /api/auth/login", s.limited(s.login))
	m.HandleFunc("POST /api/auth/logout", s.logout)

	m.HandleFunc("GET /api/me", s.auth(s.me))
	m.HandleFunc("POST /api/shop/buy", s.auth(s.buy))
	m.HandleFunc("POST /api/techniques/{id}/upgrade", s.auth(s.upgrade))
	m.HandleFunc("PUT /api/loadout", s.auth(s.setLoadout))
	m.HandleFunc("POST /api/battles", s.auth(s.startBattle))
	m.HandleFunc("GET /api/battles/active", s.auth(s.activeBattle))
	m.HandleFunc("POST /api/battles/{id}/turn", s.auth(s.turn))
	m.HandleFunc("POST /api/battles/{id}/forfeit", s.auth(s.forfeit))
	m.HandleFunc("GET /api/leaderboard", s.auth(s.leaderboard))
	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { writeErr(w, http.StatusNotFound, "no such endpoint") })

	files := http.FileServerFS(static)
	m.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	}))
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("X-Frame-Options", "DENY")
	// 'unsafe-eval' lets the strategy script tab run the player's own code in their own browser.
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:")
	if strings.HasPrefix(r.URL.Path, "/api/") {
		w.Header().Set("Cache-Control", "no-store")
		// Every state-changing request must be JSON. Browsers can't send that
		// cross-site without a CORS preflight, which this server never grants.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				writeErr(w, http.StatusUnsupportedMediaType, "send JSON with Content-Type: application/json")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		}
	}
	start := time.Now()
	rec := &statusRecorder{ResponseWriter: w, code: 200}
	s.mux.ServeHTTP(rec, r)
	if strings.HasPrefix(r.URL.Path, "/api/") {
		s.log.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.code, "ms", time.Since(start).Milliseconds())
	}
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (r *statusRecorder) WriteHeader(code int) { r.code = code; r.ResponseWriter.WriteHeader(code) }

func (s *Server) auth(next func(http.ResponseWriter, *http.Request, *store.Player)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil || c.Value == "" {
			writeErr(w, http.StatusUnauthorized, "log in first")
			return
		}
		p, err := s.st.PlayerBySession(r.Context(), tokenHash(c.Value))
		if errors.Is(err, store.ErrNotFound) {
			s.setSessionCookie(w, "", -1)
			writeErr(w, http.StatusUnauthorized, "your session expired, log in again")
			return
		}
		if err != nil {
			s.internal(w, err)
			return
		}
		next(w, r, p)
	}
}

func (s *Server) limited(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authLim.allow(clientIP(r, s.cfg.TrustProxy)) {
			w.Header().Set("Retry-After", "30")
			writeErr(w, http.StatusTooManyRequests, "too many attempts, wait a moment and try again")
			return
		}
		next(w, r)
	}
}

func readJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return errors.New("request body is not valid JSON for this endpoint")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *Server) internal(w http.ResponseWriter, err error) {
	s.log.Error("internal error", "err", err)
	writeErr(w, http.StatusInternalServerError, "something went wrong on the server")
}
