//! Production security middleware: API key auth, rate limiting, security headers.

use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderMap, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use governor::{
    clock::DefaultClock,
    state::{InMemoryState, NotKeyed},
    Quota, RateLimiter,
};
use serde::Serialize;

use crate::state::SecurityConfig;

// ═══════════════════════════════════════════════════════════════════════════
// API KEY AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════

/// Rejects requests to mutating endpoints (POST/PUT/DELETE) without a valid API key.
/// GET requests and /health are always allowed (public reads).
pub async fn api_key_auth(
    State(security): State<Arc<SecurityConfig>>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    // Skip auth if no API key is configured (dev mode)
    let required_key = match &security.api_key {
        Some(key) if !key.is_empty() => key,
        _ => return next.run(request).await,
    };

    let path = request.uri().path().to_string();
    let method = request.method().clone();

    // Allow: health check, GET requests (public reads), OPTIONS (CORS preflight)
    if path == "/health" || method == Method::GET || method == Method::OPTIONS {
        return next.run(request).await;
    }

    // Check X-API-Key header
    let provided_key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !constant_time_eq(provided_key.as_bytes(), required_key.as_bytes()) {
        tracing::warn!(path = %path, "Rejected request: invalid or missing API key");
        return (
            StatusCode::UNAUTHORIZED,
            Json(SecurityErrorResponse {
                error: SecurityErrorBody {
                    code: "UNAUTHORIZED".into(),
                    message: "Missing or invalid API key. Include X-API-Key header.".into(),
                },
            }),
        )
            .into_response();
    }

    next.run(request).await
}

/// Constant-time comparison to prevent timing attacks on API key.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

// ═══════════════════════════════════════════════════════════════════════════
// PER-IP RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════

/// Per-IP rate limiter state.
pub struct RateLimitState {
    /// Per-IP rate limiters
    limiters: DashMap<IpAddr, Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>>>,
    /// Requests per second per IP
    rps: NonZeroU32,
    /// Burst size
    burst: NonZeroU32,
}

impl RateLimitState {
    pub fn new(rps: u32, burst: u32) -> Self {
        Self {
            limiters: DashMap::new(),
            rps: NonZeroU32::new(rps).unwrap_or(NonZeroU32::new(10).unwrap()),
            burst: NonZeroU32::new(burst).unwrap_or(NonZeroU32::new(30).unwrap()),
        }
    }

    fn get_limiter(&self, ip: IpAddr) -> Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>> {
        self.limiters
            .entry(ip)
            .or_insert_with(|| {
                let quota = Quota::per_second(self.rps).allow_burst(self.burst);
                Arc::new(RateLimiter::direct(quota))
            })
            .clone()
    }

    /// Periodically clean up stale entries (call from a background task).
    pub fn cleanup_stale(&self) {
        // Remove IPs that haven't been seen recently (limiter will be recreated if needed)
        // Keep map from growing unbounded
        if self.limiters.len() > 10_000 {
            self.limiters.retain(|_, limiter| {
                // Keep entries that still have pending requests
                limiter.check().is_err()
            });
        }
    }
}

/// Rate limiting middleware. Extracts client IP and enforces per-IP limits.
pub async fn rate_limit(
    State(limiter): State<Arc<RateLimitState>>,
    headers: HeaderMap,
    connect_info: Option<ConnectInfo<std::net::SocketAddr>>,
    request: Request,
    next: Next,
) -> Response {
    // Extract real client IP: X-Forwarded-For (behind proxy) > X-Real-IP > socket addr
    let ip = extract_client_ip(&headers, connect_info.as_ref());

    let rate_limiter = limiter.get_limiter(ip);

    if rate_limiter.check().is_err() {
        tracing::warn!(ip = %ip, "Rate limit exceeded");

        // Clean up stale entries opportunistically
        limiter.cleanup_stale();

        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, "1")],
            Json(SecurityErrorResponse {
                error: SecurityErrorBody {
                    code: "RATE_LIMITED".into(),
                    message: "Too many requests. Please slow down.".into(),
                },
            }),
        )
            .into_response();
    }

    next.run(request).await
}

/// Extract the real client IP from headers or socket.
fn extract_client_ip(
    headers: &HeaderMap,
    connect_info: Option<&ConnectInfo<std::net::SocketAddr>>,
) -> IpAddr {
    // Try X-Forwarded-For first (leftmost = original client)
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            if let Ok(ip) = first.trim().parse::<IpAddr>() {
                return ip;
            }
        }
    }

    // Try X-Real-IP
    if let Some(real_ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        if let Ok(ip) = real_ip.trim().parse::<IpAddr>() {
            return ip;
        }
    }

    // Fall back to socket address
    connect_info
        .map(|ci| ci.0.ip())
        .unwrap_or_else(|| IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════════════════

/// Adds production security headers to every response.
pub async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    // Prevent MIME type sniffing
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());

    // Prevent clickjacking
    headers.insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());

    // XSS protection (legacy browsers)
    headers.insert("x-xss-protection", "1; mode=block".parse().unwrap());

    // Don't send referrer to other origins
    headers.insert(
        header::REFERRER_POLICY,
        "strict-origin-when-cross-origin".parse().unwrap(),
    );

    // Restrict permissions
    headers.insert(
        "permissions-policy",
        "camera=(), microphone=(), geolocation=()".parse().unwrap(),
    );

    response
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED ERROR TYPE
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
struct SecurityErrorResponse {
    error: SecurityErrorBody,
}

#[derive(Serialize)]
struct SecurityErrorBody {
    code: String,
    message: String,
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKGROUND CLEANUP TASK
// ═══════════════════════════════════════════════════════════════════════════

/// Spawns a background task that periodically cleans up stale rate limiter entries.
pub fn spawn_rate_limit_cleanup(state: Arc<RateLimitState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300)); // every 5 min
        loop {
            interval.tick().await;
            state.cleanup_stale();
        }
    });
}
