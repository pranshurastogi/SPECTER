//! API error handling.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use specter_core::error::SpecterError;

/// API error type.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
    code: String,
}

impl ApiError {
    /// Creates a new API error.
    pub fn new(status: StatusCode, message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            code: code.into(),
        }
    }

    /// Bad request error.
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message, "BAD_REQUEST")
    }

    /// Not found error.
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message, "NOT_FOUND")
    }

    /// Internal server error.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message, "INTERNAL_ERROR")
    }

    /// Validation error.
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, message, "VALIDATION_ERROR")
    }
}

/// Error response body.
#[derive(Serialize)]
struct ErrorResponse {
    error: ErrorBody,
}

#[derive(Serialize)]
struct ErrorBody {
    code: String,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorResponse {
            error: ErrorBody {
                code: self.code,
                message: self.message,
            },
        };

        (self.status, Json(body)).into_response()
    }
}

impl From<SpecterError> for ApiError {
    fn from(err: SpecterError) -> Self {
        match &err {
            SpecterError::ValidationError(_) => {
                ApiError::validation(err.to_string())
            }
            SpecterError::InvalidMetaAddress(_) 
            | SpecterError::InvalidStealthAddress(_)
            | SpecterError::InvalidAnnouncement(_) => {
                ApiError::bad_request(err.to_string())
            }
            SpecterError::EnsNameNotFound(_)
            | SpecterError::NoSpecterRecord(_)
            | SpecterError::AnnouncementNotFound(_) => {
                ApiError::not_found(err.to_string())
            }
            SpecterError::HexError(_) => {
                ApiError::bad_request(format!("Invalid hex encoding: {}", err))
            }
            _ => {
                tracing::error!(error = %err, "Internal error");
                ApiError::internal("An internal error occurred")
            }
        }
    }
}

impl From<hex::FromHexError> for ApiError {
    fn from(err: hex::FromHexError) -> Self {
        ApiError::bad_request(format!("Invalid hex: {}", err))
    }
}
