package api

import "testing"

func TestPasswordHashing(t *testing.T) {
	h, err := hashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !checkPassword(h, "correct horse") {
		t.Fatal("correct password rejected")
	}
	if checkPassword(h, "wrong horse") {
		t.Fatal("wrong password accepted")
	}
	if checkPassword("garbage", "x") {
		t.Fatal("malformed hash accepted")
	}
}

func TestValidateCredentials(t *testing.T) {
	cases := []struct {
		u, p string
		ok   bool
	}{
		{"koda", "secret123", true},
		{"ko", "secret123", false},
		{"bad name", "secret123", false},
		{"koda", "short", false},
	}
	for _, c := range cases {
		if err := validateCredentials(c.u, c.p); (err == nil) != c.ok {
			t.Errorf("%q/%q: got %v", c.u, c.p, err)
		}
	}
}

func TestLimiter(t *testing.T) {
	l := &limiter{buckets: map[string]*bucket{}, rate: 0, burst: 2}
	if !l.allow("a") || !l.allow("a") || l.allow("a") {
		t.Fatal("limiter should allow exactly the burst")
	}
	if !l.allow("b") {
		t.Fatal("limiter should track keys separately")
	}
}
