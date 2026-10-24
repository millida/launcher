// Minecraft news from Mojang's own launcher feed, the same list the official launcher shows.
// The address is fixed here; the webview gets titles, short texts, picture and article links.
use crate::engine::*;
use serde_json::Value;
use std::time::Duration;

const FEED: &str = "https://launchercontent.mojang.com/v2/news.json";
const CONTENT_BASE: &str = "https://launchercontent.mojang.com";
const FRESH_FOR: Duration = Duration::from_secs(3 * 3600);
const MAX_ITEMS: usize = 12;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct McNews {
    pub id: String,
    pub title: String,
    pub text: String,
    pub date: String,
    pub image: Option<String>,
    pub link: Option<String>,
}

fn https_only(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    (parsed.scheme() == "https").then(|| parsed.to_string())
}

fn image_url(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with('/') {
        return https_only(&format!("{}{}", CONTENT_BASE, raw));
    }
    https_only(raw)
}

/// Java Edition entries only, newest first.
pub(crate) fn parse_news(doc: &Value) -> Vec<McNews> {
    let Some(entries) = doc["entries"].as_array() else { return vec![] };
    let mut out: Vec<McNews> = entries
        .iter()
        .filter(|e| e["newsType"].as_array().is_none_or(|t| t.iter().any(|x| x.as_str() == Some("Java"))))
        .filter_map(|e| {
            let title = e["title"].as_str()?.trim().to_string();
            if title.is_empty() {
                return None;
            }
            let image = e["newsPageImage"]["url"].as_str().or(e["playPageImage"]["url"].as_str()).and_then(image_url);
            Some(McNews {
                id: e["id"].as_str().unwrap_or(&title).to_string(),
                text: e["text"].as_str().unwrap_or_default().trim().to_string(),
                date: e["date"].as_str().unwrap_or_default().to_string(),
                link: e["readMoreLink"].as_str().and_then(https_only),
                image,
                title,
            })
        })
        .collect();
    out.sort_by(|a, b| b.date.cmp(&a.date));
    out.truncate(MAX_ITEMS);
    out
}

pub async fn minecraft_news() -> Result<Vec<McNews>, String> {
    let cache = data_dir().join("cache").join("mc-news.json");
    let doc = get_json_fresh(FEED, &cache, FRESH_FOR).await?;
    Ok(parse_news(&doc))
}

#[cfg(test)]
mod tests {
    use super::parse_news;

    #[test]
    fn java_entries_with_safe_links_newest_first() {
        let doc = serde_json::json!({ "entries": [
            { "id": "a", "title": "Old Java", "date": "2026-01-01", "newsType": ["Java"], "readMoreLink": "https://www.minecraft.net/a",
              "newsPageImage": { "url": "/images/a.png" } },
            { "id": "b", "title": "Bedrock only", "date": "2026-05-01", "newsType": ["Bedrock"] },
            { "id": "c", "title": "New Java", "date": "2026-06-01", "newsType": ["Java", "Bedrock"], "readMoreLink": "javascript:alert(1)" },
            { "id": "d", "title": "", "date": "2026-07-01", "newsType": ["Java"] }
        ]});
        let news = parse_news(&doc);
        let titles: Vec<&str> = news.iter().map(|n| n.title.as_str()).collect();
        assert_eq!(titles, ["New Java", "Old Java"], "Bedrock-only and untitled entries are dropped, newest first");
        assert_eq!(news[1].image.as_deref(), Some("https://launchercontent.mojang.com/images/a.png"), "relative pictures resolve on Mojang's host");
        assert_eq!(news[0].link, None, "only https article links reach the button");
    }
}
