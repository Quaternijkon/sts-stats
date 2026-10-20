use super::{
    atomic_bytes, background, confined_storage_path, error, file_stamp, game_dir, hash, read_text,
    Storage,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io, path::Path};
use tauri::Manager;

const RESULT_LIMIT: u64 = 128 * 1024 * 1024;
const SUMMARY_LIMIT: u64 = 16 * 1024 * 1024;
const POOL_LIMIT: u64 = 4 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub(super) struct Snapshot {
    pub identity: String,
    pub dataset: Value,
}
#[derive(Deserialize, Serialize)]
struct Envelope {
    identity: String,
    key: String,
    checksum: String,
    text: String,
}

pub(super) fn atomic_copy(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination.parent().ok_or("Invalid destination")?;
    fs::create_dir_all(parent).map_err(error)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    let mut input = fs::File::open(source).map_err(error)?;
    io::copy(&mut input, &mut temporary).map_err(error)?;
    temporary.as_file().sync_all().map_err(error)?;
    temporary.persist(destination).map_err(error)?;
    Ok(())
}

pub(super) fn identity(root: &Path, game: &str, engine_version: &str) -> Result<String, String> {
    if engine_version.is_empty()
        || engine_version.len() > 128
        || !engine_version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        return Err("Invalid engine version".into());
    }
    let path = root.join("dataset.json");
    let stamp = match fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => file_stamp(&meta)?,
        Ok(_) => return Err("Invalid dataset file".into()),
        Err(failure) if failure.kind() == io::ErrorKind::NotFound => "empty".into(),
        Err(failure) => return Err(error(failure)),
    };
    Ok(hash(
        format!("derived-v2|{game}|{engine_version}|{stamp}").as_bytes(),
    ))
}

pub(super) fn summary(value: &Value) -> Result<Value, String> {
    let source = value
        .get("source")
        .and_then(Value::as_str)
        .ok_or("Invalid source")?;
    let imported_at = value
        .get("importedAt")
        .and_then(Value::as_f64)
        .ok_or("Invalid import date")?;
    let runs = value
        .get("runs")
        .and_then(Value::as_array)
        .ok_or("Invalid runs")?;
    let keys = [
        "id",
        "fileName",
        "character",
        "ascension",
        "status",
        "floor",
        "runTime",
        "startTime",
        "playerCount",
        "isMultiplayer",
        "buildId",
        "gameMode",
    ];
    let rows: Vec<Value> = runs.iter().map(|run| {
        let mut row: serde_json::Map<String, Value> = keys.iter().filter_map(|key| {
            run.get(*key).map(|value| ((*key).to_owned(), value.clone()))
        }).collect();
        let players: Vec<Value> = run.get("players").and_then(Value::as_array).into_iter().flatten().map(|player| {
            json!({ "id": player.get("id"), "character": player.get("character") })
        }).collect();
        row.insert("players".into(), json!(players));
        Value::Object(row)
    }).collect();
    let progress = value
        .get("progress")
        .filter(|value| !value.is_null())
        .map(|progress| {
            let mut result = serde_json::Map::new();
            for key in ["totalPlaytime", "recordedFields"] {
                if let Some(value) = progress.get(key) {
                    result.insert(key.into(), value.clone());
                }
            }
            let characters: Vec<_> = progress
                .get("characterStats")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|row| {
                    Value::Object(
                        ["character", "wins", "losses", "recordedFields"]
                            .iter()
                            .filter_map(|key| {
                                row.get(*key)
                                    .map(|value| ((*key).to_owned(), value.clone()))
                            })
                            .collect(),
                    )
                })
                .collect();
            result.insert("characterStats".into(), Value::Array(characters));
            Value::Object(result)
        });
    Ok(json!({ "source": source, "importedAt": imported_at, "runs": rows, "progress": progress }))
}

fn read_envelope(path: &Path, identity: &str, key: &str, limit: u64) -> Option<String> {
    let value: Envelope = serde_json::from_str(&read_text(path, limit).ok()?).ok()?;
    (value.identity == identity
        && value.key == key
        && value.checksum == hash(value.text.as_bytes()))
    .then_some(value.text)
}
fn write_envelope(
    path: &Path,
    identity: &str,
    key: &str,
    text: &str,
    limit: u64,
) -> Result<(), String> {
    if text.len() as u64 > limit {
        return Ok(());
    }
    let value = Envelope {
        identity: identity.into(),
        key: key.into(),
        checksum: hash(text.as_bytes()),
        text: text.into(),
    };
    let bytes = serde_json::to_vec(&value).map_err(error)?;
    if bytes.len() as u64 <= limit {
        atomic_bytes(path, &bytes)?;
    }
    Ok(())
}

pub(super) fn open(root: &Path, game: &str, engine_version: &str) -> Result<Snapshot, String> {
    let identity = identity(root, game, engine_version)?;
    let derived = root.join("derived-v2");
    let safe_cache = confined_storage_path(root, &derived).is_ok();
    let startup = derived.join("startup.json");
    if let Some(text) = safe_cache
        .then(|| read_envelope(&startup, &identity, "startup", SUMMARY_LIMIT))
        .flatten()
    {
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            if let Ok(dataset) = summary(&value) {
                return Ok(Snapshot { identity, dataset });
            }
        }
    }
    let path = root.join("dataset.json");
    let value = if path.exists() {
        serde_json::from_str(&read_text(&path, u64::MAX)?).map_err(error)?
    } else {
        json!({ "runs": [], "progress": null, "source": "", "importedAt": 0 })
    };
    let dataset = summary(&value)?;
    let text = serde_json::to_string(&dataset).map_err(error)?;
    // This is a disposable optimization, including on first open after an upgrade.
    if safe_cache {
        let _ = write_envelope(&startup, &identity, "startup", &text, SUMMARY_LIMIT);
    }
    Ok(Snapshot { identity, dataset })
}

pub(super) fn committed(
    root: &Path,
    game: &str,
    engine_version: &str,
    value: &Value,
) -> Result<Snapshot, String> {
    let identity = identity(root, game, engine_version)?;
    let dataset = summary(value)?;
    let path = root.join("derived-v2/startup.json");
    if confined_storage_path(root, &path).is_ok() {
        if let Ok(text) = serde_json::to_string(&dataset) {
            let _ = write_envelope(&path, &identity, "startup", &text, SUMMARY_LIMIT);
        }
    }
    Ok(Snapshot { identity, dataset })
}

fn derived_path(root: &Path, identity: &str, key: &str) -> Result<std::path::PathBuf, String> {
    if key != "card-pools" && (key.len() != 64 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err("Invalid cache key".into());
    }
    let path = if key == "card-pools" {
        root.join("derived-v2/card-pools.json")
    } else {
        root.join("derived-v2/results").join(format!(
            "{}.json",
            hash(format!("{identity}|{key}").as_bytes())
        ))
    };
    confined_storage_path(root, &path)?;
    Ok(path)
}
fn prune(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut files: Vec<_> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let meta = fs::symlink_metadata(entry.path()).ok()?;
            if !meta.is_file() || meta.file_type().is_symlink() {
                return None;
            }
            Some((entry.path(), meta.len(), meta.modified().ok()?))
        })
        .collect();
    files.sort_by_key(|entry| std::cmp::Reverse(entry.2));
    let mut bytes = 0u64;
    for (index, (path, size, _)) in files.into_iter().enumerate() {
        bytes = bytes.saturating_add(size);
        if index >= 128 || bytes > RESULT_LIMIT {
            let _ = fs::remove_file(path);
        }
    }
}

#[tauri::command]
pub(super) async fn open_dataset(
    app: tauri::AppHandle,
    game: String,
    engine_version: String,
) -> Result<Snapshot, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        open(&game_dir(&storage, &game)?, &game, &engine_version)
    })
    .await
}
#[tauri::command]
pub(super) async fn load_dataset_text(
    app: tauri::AppHandle,
    game: String,
    engine_version: String,
    identity: String,
) -> Result<Option<String>, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let root = game_dir(&storage, &game)?;
        if self::identity(&root, &game, &engine_version)? != identity {
            return Err("本地数据已更新，请重新打开当前游戏".into());
        }
        let path = root.join("dataset.json");
        if path.exists() {
            read_text(&path, u64::MAX).map(Some)
        } else {
            Ok(None)
        }
    })
    .await
}
#[tauri::command]
pub(super) async fn read_derived(
    app: tauri::AppHandle,
    game: String,
    engine_version: String,
    identity: String,
    key: String,
) -> Result<Option<String>, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let root = game_dir(&storage, &game)?;
        if self::identity(&root, &game, &engine_version)? != identity {
            return Ok(None);
        }
        let path = derived_path(&root, &identity, &key)?;
        let limit = if key == "card-pools" {
            POOL_LIMIT
        } else {
            RESULT_LIMIT
        };
        let text = read_envelope(&path, &identity, &key, limit);
        if text.is_some() {
            if let Ok(file) = fs::OpenOptions::new().write(true).open(&path) {
                let _ =
                    file.set_times(fs::FileTimes::new().set_modified(std::time::SystemTime::now()));
            }
        }
        Ok(text)
    })
    .await
}
#[tauri::command]
pub(super) async fn write_derived(
    app: tauri::AppHandle,
    game: String,
    engine_version: String,
    identity: String,
    key: String,
    text: String,
) -> Result<(), String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let root = game_dir(&storage, &game)?;
        if self::identity(&root, &game, &engine_version)? != identity {
            return Ok(());
        }
        let path = derived_path(&root, &identity, &key)?;
        let limit = if key == "card-pools" {
            POOL_LIMIT
        } else {
            RESULT_LIMIT
        };
        write_envelope(&path, &identity, &key, &text, limit)?;
        if key != "card-pools" {
            prune(path.parent().ok_or("Invalid cache path")?);
        }
        Ok(())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ArchiveSummary {
    source: String,
    runs: usize,
    imported_at: f64,
}
#[tauri::command]
pub(super) async fn list_archives(
    app: tauri::AppHandle,
    game: String,
) -> Result<Vec<ArchiveSummary>, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let root = game_dir(&storage, &game)?.join("archives");
        confined_storage_path(&storage.root, &root)?;
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut sources = Vec::new();
        for entry in fs::read_dir(root).map_err(error)? {
            let entry = entry.map_err(error)?;
            if !entry.file_type().map_err(error)?.is_dir() {
                continue;
            }
            let path = entry.path().join("dataset.json");
            confined_storage_path(&storage.root, &path)?;
            if !path.exists() {
                continue;
            }
            let value: Value = serde_json::from_str(&read_text(&path, u64::MAX)?).map_err(error)?;
            sources.push(ArchiveSummary {
                source: value
                    .get("source")
                    .and_then(Value::as_str)
                    .ok_or("Invalid source archive")?
                    .into(),
                runs: value
                    .get("runs")
                    .and_then(Value::as_array)
                    .ok_or("Invalid source archive")?
                    .len(),
                imported_at: value
                    .get("importedAt")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
            });
        }
        sources.sort_by(|left, right| {
            right
                .imported_at
                .total_cmp(&left.imported_at)
                .then_with(|| left.source.cmp(&right.source))
        });
        Ok(sources)
    })
    .await
}
#[tauri::command]
pub(super) async fn activate_archive(
    app: tauri::AppHandle,
    game: String,
    source: String,
    engine_version: String,
) -> Result<Snapshot, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let root = game_dir(&storage, &game)?;
        let archive = root
            .join("archives")
            .join(hash(source.as_bytes()))
            .join("dataset.json");
        confined_storage_path(&storage.root, &archive)?;
        let value: Value = serde_json::from_str(&read_text(&archive, u64::MAX)?).map_err(error)?;
        if value.get("source").and_then(Value::as_str) != Some(source.as_str()) {
            return Err("来源归档校验失败".into());
        }
        summary(&value)?;
        atomic_copy(&archive, &root.join("dataset.json"))?;
        open(&root, &game, &engine_version)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atomic;

    #[test]
    fn startup_summary_excludes_raw_data_and_tracks_file_and_engine_identity() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let data = json!({ "runs": [{ "id": "synthetic.run", "players": [{ "id": 1, "character": "Ironclad", "deck": ["private-synthetic"] }], "raw": { "payload": "synthetic" } }], "source": "/synthetic", "importedAt": 123.0, "progress": { "characterStats": [{ "character": "Ironclad", "wins": 0, "recordedFields": ["wins"] }] } });
        atomic(&root.join("dataset.json"), &data.to_string()).unwrap();
        let first = open(root, "sts2", "engine-a").unwrap();
        assert!(first.dataset["runs"][0].get("raw").is_none());
        assert!(first.dataset["runs"][0]["players"][0].get("deck").is_none());
        assert!(first.dataset["progress"]["characterStats"][0]
            .get("losses")
            .is_none());
        assert_eq!(
            first.identity,
            open(root, "sts2", "engine-a").unwrap().identity
        );
        assert_ne!(
            first.identity,
            open(root, "sts2", "engine-b").unwrap().identity
        );
        atomic(&root.join("dataset.json"), &data.to_string()).unwrap();
        assert_ne!(
            first.identity,
            open(root, "sts2", "engine-a").unwrap().identity
        );
    }

    #[test]
    fn corrupt_caches_and_stale_identities_are_misses() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache.json");
        write_envelope(&path, "a", "key", "{\"value\":0}", 1024).unwrap();
        assert_eq!(
            read_envelope(&path, "a", "key", 1024).unwrap(),
            "{\"value\":0}"
        );
        assert!(read_envelope(&path, "b", "key", 1024).is_none());
        atomic(&path, "broken").unwrap();
        assert!(read_envelope(&path, "a", "key", 1024).is_none());
        assert!(derived_path(directory.path(), "a", "../dataset.json").is_err());
    }

    #[test]
    fn disk_results_keep_at_most_the_native_entry_limit() {
        let directory = tempfile::tempdir().unwrap();
        for index in 0..140 {
            atomic(&directory.path().join(format!("{index}.json")), "{}").unwrap();
        }
        prune(directory.path());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 128);
    }
}
