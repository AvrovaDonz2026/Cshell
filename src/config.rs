use std::{env, fmt, net::SocketAddr, path::PathBuf, time::Duration};

use axum::http::uri::{Authority, Scheme};
use ipnet::IpNet;
use url::Url;

#[derive(Clone)]
pub struct Origin {
    pub(crate) url: Url,
    pub(crate) scheme: Scheme,
    pub(crate) authority: Authority,
}

impl Origin {
    pub(crate) fn parse(raw: &str) -> Option<Self> {
        let (scheme, rest) = raw.split_once("://")?;
        let authority = rest.strip_suffix('/').unwrap_or(rest);
        if authority.contains('/') {
            return None;
        }
        if !matches!(scheme, "http" | "https")
            || authority.is_empty()
            || authority.contains(['@', '/', '\\', '?', '#'])
            || authority.ends_with(':')
            || authority.bytes().any(|b| b.is_ascii_whitespace())
        {
            return None;
        }
        // Check the original syntax before URL normalization can hide credentials or paths.
        let authority = authority.split_once('/').map_or(authority, |(a, _)| a);
        authority.parse::<Authority>().ok()?;
        let url = Url::parse(raw).ok()?;
        let (canonical_scheme, canonical_authority) = url
            .origin()
            .ascii_serialization()
            .split_once("://")
            .map(|(s, a)| (s.parse::<Scheme>(), a.parse::<Authority>()))?;
        Some(Self {
            url,
            scheme: canonical_scheme.ok()?,
            authority: canonical_authority.ok()?,
        })
    }
}

#[derive(Clone)]
pub struct Config {
    pub upstream: Origin,
    pub public: Option<Origin>,
    pub listen: SocketAddr,
    pub static_dir: PathBuf,
    pub trusted_proxies: Vec<IpNet>,
    pub connect_timeout: Duration,
}

#[derive(Debug)]
pub struct ConfigError(&'static str, &'static str);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.0, self.1)
    }
}

impl std::error::Error for ConfigError {}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::load(|key| match env::var(key) {
            Ok(value) => Ok(Some(value)),
            Err(env::VarError::NotPresent) => Ok(None),
            Err(env::VarError::NotUnicode(_)) => Err(ConfigError(key, "must be valid UTF-8")),
        })
    }

    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        Self::load(|key| Ok(lookup(key)))
    }

    fn load(
        lookup: impl Fn(&'static str) -> Result<Option<String>, ConfigError>,
    ) -> Result<Self, ConfigError> {
        let origin = |key| {
            lookup(key)?
                .map(|s| {
                    Origin::parse(&s).ok_or(ConfigError(
                        key,
                        "expected an HTTP(S) origin without credentials, path, query, or fragment",
                    ))
                })
                .transpose()
        };
        let upstream =
            origin("SUB2API_UPSTREAM")?.ok_or(ConfigError("SUB2API_UPSTREAM", "is required"))?;
        let public = origin("CSHELL_PUBLIC_URL")?;
        let listen = lookup("CSHELL_LISTEN")?
            .unwrap_or_else(|| "0.0.0.0:8080".into())
            .parse()
            .map_err(|_| ConfigError("CSHELL_LISTEN", "expected an IP socket address"))?;
        let static_dir = lookup("CSHELL_STATIC_DIR")?.unwrap_or_else(|| "frontend/dist".into());
        if static_dir.is_empty() {
            return Err(ConfigError("CSHELL_STATIC_DIR", "cannot be empty"));
        }
        let cidrs = lookup("CSHELL_TRUSTED_PROXY_CIDRS")?.unwrap_or_default();
        let trusted_proxies = if cidrs.trim().is_empty() {
            Vec::new()
        } else {
            cidrs
                .split(',')
                .map(|part| {
                    part.trim()
                        .parse::<IpNet>()
                        .map(|net| net.trunc())
                        .map_err(|_| {
                            ConfigError(
                                "CSHELL_TRUSTED_PROXY_CIDRS",
                                "expected comma-separated IPv4 or IPv6 CIDRs",
                            )
                        })
                })
                .collect::<Result<Vec<_>, _>>()?
        };
        let connect_timeout = lookup("CSHELL_CONNECT_TIMEOUT_SECS")?
            .unwrap_or_else(|| "5".into())
            .parse::<u64>()
            .ok()
            .filter(|n| (1..=300).contains(n))
            .ok_or(ConfigError(
                "CSHELL_CONNECT_TIMEOUT_SECS",
                "expected an integer from 1 to 300",
            ))?;
        Ok(Self {
            upstream,
            public,
            listen,
            static_dir: static_dir.into(),
            trusted_proxies,
            connect_timeout: Duration::from_secs(connect_timeout),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_origin_validation() {
        for value in [
            "http://localhost:8080",
            "https://example.com/",
            "http://[::1]:9000/",
        ] {
            assert!(Origin::parse(value).is_some(), "{value}");
        }
        for value in [
            "http://",
            "ftp://host",
            "http://user:password@host",
            "http://@host",
            "http://host/path",
            "http://host/./",
            "http://host?",
            "http://host#",
            "http://host//",
            "http://host:",
            "http://host\\",
            " http://host",
            "http://ho\nst",
            "http://host:65536",
        ] {
            assert!(Origin::parse(value).is_none(), "{value}");
        }
    }

    #[test]
    fn validation_reports_variable_without_its_value() {
        assert!(
            Config::from_lookup(|_| None)
                .err()
                .unwrap()
                .to_string()
                .contains("SUB2API_UPSTREAM")
        );
        let cases = [
            ("CSHELL_TRUSTED_PROXY_CIDRS", "invalid-cidr-value"),
            ("CSHELL_TRUSTED_PROXY_CIDRS", "invalid-cidr-value,"),
            ("CSHELL_CONNECT_TIMEOUT_SECS", "zero-timeout"),
            ("CSHELL_LISTEN", "secret-listen-value"),
            ("CSHELL_PUBLIC_URL", "https://secret-public-value/path"),
        ];
        for (bad_key, bad_value) in cases {
            let error = Config::from_lookup(|key| {
                if key == "SUB2API_UPSTREAM" {
                    Some("http://127.0.0.1".into())
                } else if key == bad_key {
                    Some(bad_value.into())
                } else {
                    None
                }
            })
            .err()
            .unwrap()
            .to_string();
            assert!(error.contains(bad_key));
            assert!(!error.contains(bad_value));
        }
    }
}
