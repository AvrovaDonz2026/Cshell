use std::net::{IpAddr, SocketAddr};

use axum::http::{HeaderMap, HeaderName, HeaderValue, Uri, header};
use ipnet::IpNet;
use url::Host;

use crate::config::Origin;

pub(crate) fn has_token(headers: &HeaderMap, name: HeaderName, token: &str) -> bool {
    headers.get_all(name).iter().any(|value| {
        value
            .as_bytes()
            .split(|b| *b == b',')
            .any(|part| part.trim_ascii().eq_ignore_ascii_case(token.as_bytes()))
    })
}

pub(crate) fn strip_hop(headers: &mut HeaderMap) {
    let nominated: Vec<_> = headers
        .get_all(header::CONNECTION)
        .iter()
        .flat_map(|value| {
            value
                .as_bytes()
                .split(|b| *b == b',')
                .filter_map(|part| HeaderName::from_bytes(part.trim_ascii()).ok())
        })
        .collect();
    for name in nominated {
        headers.remove(name);
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-connection",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
}

pub(crate) fn set_websocket(headers: &mut HeaderMap) {
    headers.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
    headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
}

fn ip_is_trusted(ip: IpAddr, trusted: &[IpNet]) -> bool {
    trusted
        .iter()
        .any(|net| net.contains(&ip) || net.contains(&ip.to_canonical()))
}

fn single<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let values = headers.get_all(name);
    let mut iter = values.iter();
    let value = iter.next()?.to_str().ok()?;
    iter.next().is_none().then_some(value)
}

fn validated_host(proto: &str, host: &str) -> Option<Origin> {
    if host.contains([',', '/']) {
        return None;
    }
    Origin::parse(&format!("{proto}://{host}"))
}

pub(crate) fn set_forwarding(
    headers: &mut HeaderMap,
    uri: &Uri,
    peer: SocketAddr,
    trusted: &[IpNet],
    public: Option<&Origin>,
) {
    let trusted_peer = ip_is_trusted(peer.ip(), trusted);
    let mut chain = if trusted_peer {
        let ips = headers
            .get_all("x-forwarded-for")
            .iter()
            .flat_map(|v| v.as_bytes().split(|b| *b == b','));
        let collected = ips
            .take(33)
            .map(|s| {
                std::str::from_utf8(s.trim_ascii())
                    .ok()?
                    .parse::<IpAddr>()
                    .ok()
            })
            .collect::<Option<Vec<_>>>();
        collected.filter(|ips| ips.len() <= 32).unwrap_or_default()
    } else {
        Vec::new()
    };
    // Retain the part vouched for by trusted hops, stopping at the first client.
    if let Some(i) = chain.iter().rposition(|ip| !ip_is_trusted(*ip, trusted)) {
        chain.drain(..i);
    }
    chain.push(peer.ip());
    let proto = if trusted_peer && single(headers, "x-forwarded-proto") == Some("https") {
        "https"
    } else {
        "http"
    };
    let host = if trusted_peer {
        single(headers, "x-forwarded-host").and_then(|h| validated_host(proto, h))
    } else {
        None
    }
    .or_else(|| {
        uri.authority()
            .and_then(|h| validated_host(proto, h.as_str()))
    })
    .or_else(|| single(headers, "host").and_then(|h| validated_host(proto, h)));
    let origin = public.or(host.as_ref());
    let proto = origin.map_or(proto, |o| o.scheme.as_str());
    let discarded: Vec<_> = headers
        .keys()
        .filter(|key| {
            key.as_str().starts_with("x-forwarded-")
                || matches!(
                    key.as_str(),
                    "forwarded" | "x-real-ip" | "true-client-ip" | "cf-connecting-ip"
                )
        })
        .cloned()
        .collect();
    for name in discarded {
        headers.remove(name);
    }
    let xff = chain
        .iter()
        .map(IpAddr::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    headers.insert(
        "x-forwarded-for",
        HeaderValue::from_str(&xff).expect("valid IP list"),
    );
    headers.insert(
        "x-forwarded-proto",
        HeaderValue::from_str(proto).expect("valid scheme"),
    );
    if let Some(origin) = origin {
        headers.insert(
            "x-forwarded-host",
            HeaderValue::from_str(origin.authority.as_str()).expect("valid authority"),
        );
        let port = origin.url.port_or_known_default().expect("HTTP port");
        headers.insert(
            "x-forwarded-port",
            HeaderValue::from_str(&port.to_string()).expect("valid port"),
        );
    }
}

pub(crate) fn rewrite_response(headers: &mut HeaderMap, upstream: &Origin, public: &Origin) {
    replace_values(headers, header::LOCATION, |value| {
        rewrite_location(value, upstream, public)
    });
    replace_values(headers, header::SET_COOKIE, |value| {
        rewrite_cookie(value, upstream, public)
    });
}

fn replace_values(
    headers: &mut HeaderMap,
    name: HeaderName,
    rewrite: impl Fn(&HeaderValue) -> Option<HeaderValue>,
) {
    let values: Vec<_> = headers
        .get_all(&name)
        .iter()
        .map(|v| rewrite(v).unwrap_or_else(|| v.clone()))
        .collect();
    headers.remove(&name);
    for value in values {
        headers.append(&name, value);
    }
}

fn rewrite_location(
    value: &HeaderValue,
    upstream: &Origin,
    public: &Origin,
) -> Option<HeaderValue> {
    let raw = value.to_str().ok()?;
    let (scheme, rest) = if let Some(rest) = raw.strip_prefix("//") {
        (upstream.scheme.as_str().to_string(), rest)
    } else {
        let (scheme, rest) = raw.split_once("://")?;
        (scheme.to_ascii_lowercase(), rest)
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let loc_origin = Origin::parse(&format!("{scheme}://{}", &rest[..end]))?;
    if loc_origin.url.origin() != upstream.url.origin() {
        return None;
    }
    HeaderValue::from_str(&format!(
        "{}://{}{}",
        public.scheme,
        public.authority,
        &rest[end..]
    ))
    .ok()
}

fn rewrite_cookie(value: &HeaderValue, upstream: &Origin, public: &Origin) -> Option<HeaderValue> {
    let mut raw = value.as_bytes().split(|&b| b == b';');
    let mut cookie = raw.next()?.to_vec();
    let upstream_host = upstream.url.host_str()?;
    let mut changed = false;
    for attr in raw {
        let mut parts = attr.splitn(2, |&b| b == b'=');
        let key = parts.next().unwrap_or_default().trim_ascii();
        if key.eq_ignore_ascii_case(b"domain")
            && parts.next().is_some_and(|domain| {
                let domain = domain.trim_ascii();
                domain
                    .strip_prefix(b".")
                    .unwrap_or(domain)
                    .eq_ignore_ascii_case(upstream_host.as_bytes())
            })
        {
            changed = true;
            if let Some(Host::Domain(host)) = public.url.host() {
                cookie.extend_from_slice(b"; Domain=");
                cookie.extend_from_slice(host.as_bytes());
            }
        } else {
            cookie.push(b';');
            cookie.extend_from_slice(attr);
        }
    }
    if !changed {
        return None;
    }
    HeaderValue::from_bytes(&cookie).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwarding_discards_spoofing_and_stops_at_untrusted_hop() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "local.test:8080".parse().unwrap());
        headers.insert(
            "x-forwarded-for",
            "1.1.1.1, 198.51.100.4, 10.1.1.1".parse().unwrap(),
        );
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("x-forwarded-host", "external.test:8443".parse().unwrap());
        headers.insert("forwarded", "for=spoofed".parse().unwrap());
        headers.insert("cf-connecting-ip", "1.1.1.1".parse().unwrap());
        let mut trusted_headers = headers.clone();
        set_forwarding(
            &mut headers,
            &"/test".parse().unwrap(),
            "192.0.2.1:1234".parse().unwrap(),
            &[],
            None,
        );
        assert_eq!(headers["x-forwarded-for"], "192.0.2.1");
        assert_eq!(headers["x-forwarded-proto"], "http");
        assert_eq!(headers["x-forwarded-host"], "local.test:8080");
        assert!(!headers.contains_key("forwarded"));
        assert!(!headers.contains_key("cf-connecting-ip"));
        set_forwarding(
            &mut trusted_headers,
            &"/test".parse().unwrap(),
            "10.2.2.2:1234".parse().unwrap(),
            &["10.0.0.0/8".parse().unwrap()],
            None,
        );
        assert_eq!(
            trusted_headers["x-forwarded-for"],
            "198.51.100.4, 10.1.1.1, 10.2.2.2"
        );
        assert_eq!(trusted_headers["x-forwarded-proto"], "https");
        assert_eq!(trusted_headers["x-forwarded-port"], "8443");
    }
}
