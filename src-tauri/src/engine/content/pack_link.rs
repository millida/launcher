// The signed address of a catalogue pack archive on garage.millida.net (X-Amz-* in the query).
// The storage checks the signature when a request starts, not while the bytes flow. A long
// install (hundreds of ranges one after another, a pause, a retry) outlives the address, and
// every request after that was refused with «403 Forbidden» and the AWS address in the error
// (11.11.2026, Arcania). Each request takes its address from here, and a refused one is replaced.
use crate::engine::*;
use serde_json::Value;
use std::time::{Duration, Instant};

/// A request is not started on the last seconds of an address: its answer may come after them.
const RENEW_MARGIN: Duration = Duration::from_secs(120);

/// How a refusal of the address reads in a download error (core/http.rs status text).
pub(crate) const REFUSED_STATUS: &str = "403 Forbidden";

/// A download failed because the storage refused the address, not because of the network or the data.
pub(crate) fn storage_refused(err: &str) -> bool {
    err.contains(REFUSED_STATUS)
}

struct Held {
    url: String,
    got: Instant,
}

pub(crate) struct PackLink {
    /// The file and whether it is paid, to ask for a new address. None: a fixed address.
    file: Option<(String, bool)>,
    held: tokio::sync::Mutex<Held>,
}

impl PackLink {
    /// An address that is never renewed: the local servers of the download tests.
    #[cfg(test)]
    pub(crate) fn fixed(url: &str) -> Self {
        PackLink { file: None, held: tokio::sync::Mutex::new(Held { url: url.to_string(), got: Instant::now() }) }
    }

    /// The first address, and the API answer it came with (size and sum of the file).
    pub(crate) async fn ask(file_id: &str, paid: bool) -> Result<(Self, Value), String> {
        let (url, answer) = request(file_id, paid).await?;
        let link = PackLink { file: Some((file_id.to_string(), paid)), held: tokio::sync::Mutex::new(Held { url, got: Instant::now() }) };
        Ok((link, answer))
    }

    pub(crate) fn renewable(&self) -> bool {
        self.file.is_some()
    }

    /// The address to start a request with, renewed first when its lifetime is nearly over. A
    /// renewal that fails keeps the old address: it is still alive for a while, and an API hiccup
    /// must not cut a download that is going well.
    pub(crate) async fn current(&self) -> String {
        let mut held = self.held.lock().await;
        if let Some((id, paid)) = &self.file {
            if near_end(&held.url, held.got.elapsed()) {
                match request(id, *paid).await {
                    Ok((url, _)) => *held = Held { url, got: Instant::now() },
                    Err(e) => eprintln!("[pack] адрес архива не обновился заранее ({})", e),
                }
            }
        }
        held.url.clone()
    }

    /// The storage refused `used`. Requests running side by side get refused together; only the
    /// first one asks the API, the others take the address it brought.
    pub(crate) async fn renew(&self, used: &str) -> Result<String, String> {
        let Some((id, paid)) = &self.file else { return Err("a fixed address cannot be renewed".into()) };
        let mut held = self.held.lock().await;
        if held.url == used {
            let (url, _) = request(id, *paid).await?;
            *held = Held { url, got: Instant::now() };
        }
        Ok(held.url.clone())
    }
}

async fn request(file_id: &str, paid: bool) -> Result<(String, Value), String> {
    /*
     * Отказ по доступу помечается маркером, а не опознаётся по словам: текст
     * приходит с сервера и правится там же, а окно ввода ключа обязано
     * открыться и после того, как формулировку перепишут.
     */
    let answer = millida_api_auth(format!("/catalog/packs/files/{}/link", file_id), "POST".into(), None)
        .await
        .map_err(|e| super::catalog_pack::link_error(paid, e))?;
    let url = answer["url"].as_str().unwrap_or("").to_string();
    if !super::catalog_pack::pack_url_allowed(&url) {
        return Err("Сервер вернул ссылку на чужой адрес — установка остановлена".into());
    }
    Ok((url, answer))
}

/// The lifetime the signature declares (X-Amz-Expires, seconds). Counted from the moment the
/// address came, so the player's clock does not matter.
fn lifetime(url: &str) -> Option<Duration> {
    let parsed = url::Url::parse(url).ok()?;
    let secs = parsed.query_pairs().find(|(k, _)| k.eq_ignore_ascii_case("X-Amz-Expires"))?.1.parse::<u64>().ok()?;
    Some(Duration::from_secs(secs))
}

fn near_end(url: &str, age: Duration) -> bool {
    match lifetime(url) {
        Some(life) => age + RENEW_MARGIN.min(life / 4) >= life,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIGNED: &str = "https://garage.millida.net/packs/a.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261111T100000Z&X-Amz-Expires=900&X-Amz-Signature=abc";

    #[test]
    fn the_lifetime_comes_from_the_signature() {
        assert_eq!(lifetime(SIGNED), Some(Duration::from_secs(900)));
        assert_eq!(lifetime("https://garage.millida.net/packs/a.zip?x-amz-expires=60"), Some(Duration::from_secs(60)));
        assert_eq!(lifetime("https://garage.millida.net/packs/a.zip"), None);
    }

    #[test]
    fn an_address_is_renewed_before_its_last_minutes() {
        assert!(!near_end(SIGNED, Duration::from_secs(0)));
        assert!(!near_end(SIGNED, Duration::from_secs(700)));
        assert!(near_end(SIGNED, Duration::from_secs(780)), "two minutes before the end");
        assert!(near_end(SIGNED, Duration::from_secs(2000)));
        // A short address keeps a quarter of its life as the margin, not two minutes.
        let short = "https://garage.millida.net/a.zip?X-Amz-Expires=60";
        assert!(!near_end(short, Duration::from_secs(40)));
        assert!(near_end(short, Duration::from_secs(45)));
        assert!(!near_end("https://garage.millida.net/a.zip", Duration::from_secs(100_000)), "no lifetime, nothing to renew");
    }

    #[test]
    fn only_a_refused_address_reads_as_refused() {
        assert!(storage_refused("garage.millida.net/packs/a.zip → 403 Forbidden"));
        assert!(!storage_refused("garage.millida.net/packs/a.zip → 404 Not Found"));
        assert!(!storage_refused("обрыв загрузки (timeout)"));
    }

    #[tokio::test]
    async fn a_fixed_address_stays_and_cannot_be_renewed() {
        let link = PackLink::fixed(SIGNED);
        assert!(!link.renewable());
        assert_eq!(link.current().await, SIGNED);
        assert!(link.renew(SIGNED).await.is_err());
    }
}
